//! 工作会话时间线：把事件总线收到的 AgentEvent 按天落盘，并提供聚合查询。
//!
//! 存储位置：`%USERPROFILE%\.dsh-pet-desktop\timeline\YYYY-MM-DD.jsonl`
//! 每行一条事件，方便后续做晨间简报、下班收尾和工作成就。
//! 这里只做本地持久化，不上传任何内容。

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use crate::agent_hub::AgentEvent;
use crate::config::{app_dir, now_millis};

pub fn timeline_dir() -> PathBuf {
    app_dir().join("timeline")
}

/// 事件所属的本地日期（用户所在时区）。
pub fn day_of(ts: u64) -> String {
    use chrono::{Local, TimeZone};
    let millis = if ts == 0 { now_millis() } else { ts };
    match Local.timestamp_millis_opt(millis as i64).single() {
        Some(dt) => dt.format("%Y-%m-%d").to_string(),
        None => Local::now().format("%Y-%m-%d").to_string(),
    }
}

pub fn today() -> String {
    day_of(now_millis())
}

/// 追加一条事件；同一毫秒内的写入也保持行级完整。
pub fn append(event: &AgentEvent) -> Result<(), String> {
    append_to(&timeline_dir(), event)
}

fn append_to(dir: &std::path::Path, event: &AgentEvent) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建时间线目录失败：{e}"))?;
    let path = dir.join(format!("{}.jsonl", day_of(event.ts)));
    let line = serde_json::to_string(event).map_err(|e| format!("序列化事件失败：{e}"))?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("打开时间线文件失败：{e}"))?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|e| format!("写入时间线失败：{e}"))?;
    Ok(())
}

/// 读取某一天的事件，按时间升序返回；损坏的行会被跳过而不是让整天的数据失败。
pub fn read_day(day: &str) -> Result<Vec<AgentEvent>, String> {
    read_day_from(&timeline_dir(), day)
}

fn read_day_from(dir: &std::path::Path, day: &str) -> Result<Vec<AgentEvent>, String> {
    let path = dir.join(format!("{day}.jsonl"));
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = fs::File::open(&path).map_err(|e| format!("打开时间线文件失败：{e}"))?;
    let mut events = Vec::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(event) = serde_json::from_str::<AgentEvent>(&line) {
            events.push(event);
        }
    }
    events.sort_by_key(|e| e.ts);
    Ok(events)
}

/// 有记录的所有日期，新的在前。
pub fn days(limit: usize) -> Vec<String> {
    let dir = timeline_dir();
    let mut out: Vec<String> = fs::read_dir(&dir)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().to_string();
                    name.strip_suffix(".jsonl").map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out.reverse();
    out.truncate(limit.max(1));
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSpan {
    pub provider: String,
    pub session_id: String,
    pub project: String,
    pub start_ts: u64,
    pub end_ts: u64,
    pub minutes: u64,
    pub events: usize,
    pub tool_calls: usize,
    pub approvals: usize,
    pub failures: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStat {
    pub provider: String,
    pub events: usize,
    pub sessions: usize,
    pub tool_calls: usize,
    pub approvals: usize,
    pub failures: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineSummary {
    pub date: String,
    pub events: usize,
    pub sessions: usize,
    pub projects: Vec<String>,
    pub providers: Vec<String>,
    pub tool_calls: usize,
    pub approvals: usize,
    pub failures: usize,
    pub completions: usize,
    pub active_minutes: u64,
    pub first_ts: u64,
    pub last_ts: u64,
    pub by_provider: Vec<ProviderStat>,
    pub session_list: Vec<SessionSpan>,
}

fn is_failure(event: &AgentEvent) -> bool {
    event.severity.eq_ignore_ascii_case("error")
        || matches!(event.kind.as_str(), "task.failed" | "build.failed" | "test.failed")
}

fn is_completion(event: &AgentEvent) -> bool {
    matches!(event.kind.as_str(), "turn.completed" | "task.done")
}

/// 纯函数，方便单测：给定事件列表算出当天概览。
pub fn summarize(events: &[AgentEvent], date: &str) -> TimelineSummary {
    #[derive(Default)]
    struct Acc {
        start: Option<u64>,
        end: Option<u64>,
        project: String,
        events: usize,
        tool_calls: usize,
        approvals: usize,
        failures: usize,
    }

    let mut accs: HashMap<String, Acc> = HashMap::new();
    let mut providers: Vec<String> = Vec::new();
    let mut projects: Vec<String> = Vec::new();
    let mut tool_calls = 0usize;
    let mut approvals = 0usize;
    let mut failures = 0usize;
    let mut completions = 0usize;
    let mut first_ts: Option<u64> = None;
    let mut last_ts = 0u64;

    for event in events {
        let ts = event.ts;
        first_ts = Some(first_ts.map_or(ts, |v| v.min(ts)));
        if ts > last_ts {
            last_ts = ts;
        }
        if !event.provider.is_empty() && !providers.contains(&event.provider) {
            providers.push(event.provider.clone());
        }
        if !event.project.is_empty() && !projects.contains(&event.project) {
            projects.push(event.project.clone());
        }
        if event.kind == "tool.start" {
            tool_calls += 1;
        }
        if event.kind == "approval.requested" {
            approvals += 1;
        }
        if is_failure(event) {
            failures += 1;
        }
        if is_completion(event) {
            completions += 1;
        }

        let key = if event.session_id.trim().is_empty() {
            format!("{}|{}", event.provider, event.project)
        } else {
            format!("{}|{}", event.provider, event.session_id)
        };
        let acc = accs.entry(key).or_insert_with(|| Acc {
            project: event.project.clone(),
            ..Acc::default()
        });
        acc.start = Some(acc.start.map_or(ts, |v| v.min(ts)));
        acc.end = Some(acc.end.map_or(ts, |v| v.max(ts)));
        if acc.project.is_empty() {
            acc.project = event.project.clone();
        }
        acc.events += 1;
        if event.kind == "tool.start" {
            acc.tool_calls += 1;
        }
        if event.kind == "approval.requested" {
            acc.approvals += 1;
        }
        if is_failure(event) {
            acc.failures += 1;
        }
    }

    let mut session_list: Vec<SessionSpan> = accs
        .into_iter()
        .map(|(key, acc)| {
            let (provider, session_id) = key.split_once('|').unwrap_or((key.as_str(), ""));
            let start = acc.start.unwrap_or(0);
            let end = acc.end.unwrap_or(start);
            let minutes = if end > start {
                ((end - start) as f64 / 60_000.0).ceil() as u64
            } else {
                0
            };
            SessionSpan {
                provider: provider.to_string(),
                session_id: session_id.to_string(),
                project: acc.project.clone(),
                start_ts: start,
                end_ts: end,
                minutes,
                events: acc.events,
                tool_calls: acc.tool_calls,
                approvals: acc.approvals,
                failures: acc.failures,
            }
        })
        .collect();
    session_list.sort_by_key(|s| s.start_ts);

    // 同一天多个会话可能并行，按区间合并后再算「在岗分钟」。
    let mut intervals: Vec<(u64, u64)> = session_list
        .iter()
        .filter(|s| s.end_ts > s.start_ts)
        .map(|s| (s.start_ts, s.end_ts))
        .collect();
    intervals.sort();
    let mut active_ms = 0u64;
    let mut cursor_start = 0u64;
    let mut cursor_end = 0u64;
    for (start, end) in intervals {
        if cursor_end == 0 {
            cursor_start = start;
            cursor_end = end;
        } else if start <= cursor_end {
            if end > cursor_end {
                cursor_end = end;
            }
        } else {
            active_ms += cursor_end - cursor_start;
            cursor_start = start;
            cursor_end = end;
        }
    }
    if cursor_end > cursor_start {
        active_ms += cursor_end - cursor_start;
    }
    let active_minutes = if active_ms == 0 {
        0
    } else {
        ((active_ms as f64) / 60_000.0).ceil() as u64
    };

    let mut by_provider: Vec<ProviderStat> = providers
        .iter()
        .map(|p| {
            let related: Vec<&SessionSpan> = session_list.iter().filter(|s| &s.provider == p).collect();
            ProviderStat {
                provider: p.clone(),
                events: related.iter().map(|s| s.events).sum(),
                sessions: related.len(),
                tool_calls: related.iter().map(|s| s.tool_calls).sum(),
                approvals: related.iter().map(|s| s.approvals).sum(),
                failures: related.iter().map(|s| s.failures).sum(),
            }
        })
        .collect();
    by_provider.sort_by(|a, b| b.events.cmp(&a.events));

    TimelineSummary {
        date: date.to_string(),
        events: events.len(),
        sessions: session_list.len(),
        projects,
        providers,
        tool_calls,
        approvals,
        failures,
        completions,
        active_minutes,
        first_ts: first_ts.unwrap_or(0),
        last_ts,
        by_provider,
        session_list,
    }
}

/// 删除超过保留期的按天文件；返回删除数量。
pub fn prune(keep_days: usize) -> usize {
    use chrono::{Duration, Local, NaiveDate};
    // keep_days 包含今天：保留 90 天时，最早保留「今天 - 89 天」。
    let cutoff = Local::now().date_naive() - Duration::days(keep_days.max(1) as i64 - 1);
    let mut removed = 0usize;
    if let Ok(entries) = fs::read_dir(timeline_dir()) {
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(stem) = name.strip_suffix(".jsonl") else {
                continue;
            };
            let Ok(date) = NaiveDate::parse_from_str(stem, "%Y-%m-%d") else {
                continue;
            };
            if date < cutoff && fs::remove_file(entry.path()).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

#[tauri::command]
pub fn agent_timeline(day: Option<String>, limit: Option<usize>) -> Result<Vec<AgentEvent>, String> {
    let day = day.unwrap_or_else(today);
    let mut events = read_day(&day)?;
    events.reverse();
    events.truncate(limit.unwrap_or(500).clamp(1, 5000));
    Ok(events)
}

#[tauri::command]
pub fn agent_timeline_summary(day: Option<String>) -> Result<TimelineSummary, String> {
    let day = day.unwrap_or_else(today);
    let events = read_day(&day)?;
    Ok(summarize(&events, &day))
}

#[tauri::command]
pub fn agent_timeline_days(limit: Option<usize>) -> Vec<String> {
    days(limit.unwrap_or(30))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(ts: u64, provider: &str, kind: &str, session: &str, project: &str) -> AgentEvent {
        AgentEvent {
            ts,
            provider: provider.to_string(),
            kind: kind.to_string(),
            session_id: session.to_string(),
            project: project.to_string(),
            ..AgentEvent::default()
        }
    }

    #[test]
    fn summarizes_sessions_and_minutes() {
        let events = vec![
            ev(0, "claude-code", "session.start", "s1", "pet"),
            ev(60_000, "claude-code", "tool.start", "s1", "pet"),
            ev(120_000, "claude-code", "approval.requested", "s1", "pet"),
            ev(300_000, "claude-code", "turn.completed", "s1", "pet"),
            ev(360_000, "codex", "session.start", "s2", "pet"),
            ev(540_000, "codex", "task.failed", "s2", "pet"),
        ];
        let summary = summarize(&events, "2026-10-20");
        assert_eq!(summary.events, 6);
        assert_eq!(summary.sessions, 2);
        assert_eq!(summary.tool_calls, 1);
        assert_eq!(summary.approvals, 1);
        assert_eq!(summary.failures, 1);
        assert_eq!(summary.completions, 1);
        // s1: 0-300s, s2: 360-540s => 9 分钟
        assert_eq!(summary.active_minutes, 8);
    }

    #[test]
    fn events_without_session_id_group_by_project() {
        let events = vec![
            ev(1_000, "cursor", "notification", "", "a"),
            ev(2_000, "cursor", "notification", "", "a"),
            ev(3_000, "cursor", "notification", "", "b"),
        ];
        let summary = summarize(&events, "2026-10-20");
        assert_eq!(summary.sessions, 2);
    }

    #[test]
    fn append_and_read_roundtrip() {
        let dir = std::env::temp_dir().join(format!("dsh-pet-timeline-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let ts = 1_700_000_000_000u64;
        append_to(&dir, &ev(ts, "claude-code", "session.start", "s1", "pet")).unwrap();
        append_to(&dir, &ev(ts + 60_000, "claude-code", "tool.start", "s1", "pet")).unwrap();
        let day = day_of(ts);
        let events = read_day_from(&dir, &day).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, "session.start");
        assert_eq!(events[1].kind, "tool.start");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
