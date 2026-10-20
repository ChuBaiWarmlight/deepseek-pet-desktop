//! 事件驱动的专注态：判断「是不是在工作」「连续多久」「该不该起身」。
//!
//! 不使用固定闹钟：只有事件持续到来才算工作，超过 10 分钟没有事件自动回到待机。
//! 连续工作满 90 分钟发一次提醒，同一段连续工作只提醒一次。

use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::agent_hub::AgentEvent;
use crate::config::now_millis;

/// 超过这个间隔没有事件，就认为人离开了。
pub const IDLE_GAP_MS: u64 = 10 * 60 * 1000;
/// 连续工作多久提醒起身。
pub const BREAK_AFTER_MS: u64 = 90 * 60 * 1000;
/// 审批请求超过这个时间还没等到结果，就不再计入待处理。
pub const PENDING_TTL_MS: u64 = 30 * 60 * 1000;

#[derive(Clone)]
struct Pending {
    provider: String,
    ts: u64,
}

#[derive(Default)]
struct Inner {
    last_event_ts: u64,
    stretch_start_ts: u64,
    break_flagged: bool,
    /// key = provider|session
    pending: HashMap<String, Pending>,
}

#[derive(Clone, Default)]
pub struct WorkFocus {
    inner: Arc<Mutex<Inner>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusState {
    pub working: bool,
    pub since_ts: u64,
    pub continuous_minutes: u64,
    pub idle_minutes: u64,
    pub needs_break: bool,
    pub pending_approvals: usize,
    pub providers: Vec<String>,
}

fn snapshot(inner: &Inner, now: u64) -> FocusState {
    let working = inner.last_event_ts > 0
        && now.saturating_sub(inner.last_event_ts) <= IDLE_GAP_MS;
    let continuous_ms = if working && inner.stretch_start_ts > 0 {
        now.saturating_sub(inner.stretch_start_ts)
    } else {
        0
    };
    let idle_minutes = if !working && inner.last_event_ts > 0 {
        now.saturating_sub(inner.last_event_ts) / 60_000
    } else {
        0
    };
    let mut providers: Vec<String> = inner
        .pending
        .values()
        .filter(|p| now.saturating_sub(p.ts) <= PENDING_TTL_MS)
        .map(|p| p.provider.clone())
        .collect();
    providers.sort();
    providers.dedup();
    let pending_approvals = inner
        .pending
        .values()
        .filter(|p| now.saturating_sub(p.ts) <= PENDING_TTL_MS)
        .count();
    FocusState {
        working,
        since_ts: if working { inner.stretch_start_ts } else { 0 },
        continuous_minutes: continuous_ms / 60_000,
        idle_minutes,
        needs_break: working && continuous_ms >= BREAK_AFTER_MS,
        pending_approvals,
        providers,
    }
}

fn approval_key(event: &AgentEvent) -> String {
    let session = if event.session_id.trim().is_empty() {
        event.project.clone()
    } else {
        event.session_id.clone()
    };
    format!("{}|{}", event.provider, session)
}

impl WorkFocus {
    /// 清空当前连续工作段和待确认列表（测试脚本、手动排障用）。
    pub fn reset(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.last_event_ts = 0;
            inner.stretch_start_ts = 0;
            inner.break_flagged = false;
            inner.pending.clear();
        }
    }

    pub fn state(&self) -> FocusState {
        let now = now_millis();
        match self.inner.lock() {
            Ok(inner) => snapshot(&inner, now),
            Err(_) => FocusState {
                working: false,
                since_ts: 0,
                continuous_minutes: 0,
                idle_minutes: 0,
                needs_break: false,
                pending_approvals: 0,
                providers: Vec::new(),
            },
        }
    }

    /// 每收到一条事件更新状态，必要时抛提醒。返回是否刚进入一段新的连续工作。
    pub fn observe(&self, app: &AppHandle, event: &AgentEvent) {
        // 专注态看「事件什么时候到达」，不看事件自带的时间戳；
        // 打卡补报或导入历史事件时不会把当前连续工作段打乱。
        let now = now_millis();
        let mut break_minutes = 0u64;
        let mut aggregate: Option<usize> = None;

        {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            let gap = if inner.last_event_ts == 0 {
                u64::MAX
            } else {
                now.saturating_sub(inner.last_event_ts)
            };
            if gap > IDLE_GAP_MS {
                inner.stretch_start_ts = now;
                inner.break_flagged = false;
            }
            inner.last_event_ts = now;
            inner
                .pending
                .retain(|_, p| now.saturating_sub(p.ts) <= PENDING_TTL_MS);

            match event.kind.as_str() {
                "approval.requested" => {
                    let before = inner.pending.len();
                    inner.pending.insert(
                        approval_key(event),
                        Pending {
                            provider: event.provider.clone(),
                            ts: now,
                        },
                    );
                    if inner.pending.len() > before {
                        aggregate = Some(inner.pending.len());
                    }
                }
                "approval.resolved" | "session.end" | "turn.completed" | "task.done" => {
                    if event.session_id.trim().is_empty() && event.project.trim().is_empty() {
                        inner.pending.retain(|_, p| p.provider != event.provider);
                    } else {
                        inner.pending.remove(&approval_key(event));
                    }
                }
                _ => {}
            }

            let continuous = now.saturating_sub(inner.stretch_start_ts);
            if continuous >= BREAK_AFTER_MS && !inner.break_flagged {
                inner.break_flagged = true;
                break_minutes = continuous / 60_000;
            }
        }

        if break_minutes > 0 {
            let _ = app.emit(
                "work-break",
                json!({
                    "minutes": break_minutes,
                    "message": format!("已经连续工作 {break_minutes} 分钟了，起来活动一下。"),
                }),
            );
        }
        // 只有「从 1 个变成 2 个及以上」时才提示一次，避免每次工具调用都弹。
        if let Some(count) = aggregate {
            if count == 2 {
                let _ = app.emit(
                    "approval-aggregate",
                    json!({
                        "count": count,
                        "message": "有多个任务在等你确认，先集中处理一下。",
                    }),
                );
            }
        }
    }
}

#[tauri::command]
pub fn work_focus_state(state: tauri::State<'_, WorkFocus>) -> FocusState {
    state.state()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inner(last: u64, start: u64) -> Inner {
        Inner {
            last_event_ts: last,
            stretch_start_ts: start,
            break_flagged: false,
            pending: HashMap::new(),
        }
    }

    #[test]
    fn idle_after_gap() {
        let now = 10_000_000u64;
        let state = snapshot(&inner(now - IDLE_GAP_MS - 1, now - 3_600_000), now);
        assert!(!state.working);
        assert_eq!(state.continuous_minutes, 0);
        assert!(state.idle_minutes >= 10);
    }

    #[test]
    fn working_and_needs_break() {
        let now = 10_000_000u64;
        let state = snapshot(&inner(now - 60_000, now - BREAK_AFTER_MS - 1), now);
        assert!(state.working);
        assert_eq!(state.continuous_minutes, 90);
        assert!(state.needs_break);
    }

    #[test]
    fn expired_approvals_are_not_counted() {
        let now = 10_000_000u64;
        let mut state = inner(now, now - 60_000);
        state.pending.insert(
            "claude-code|s1".to_string(),
            Pending {
                provider: "claude-code".to_string(),
                ts: now - PENDING_TTL_MS - 1,
            },
        );
        let snapshot = snapshot(&state, now);
        assert_eq!(snapshot.pending_approvals, 0);
        assert!(snapshot.providers.is_empty());
    }
}
