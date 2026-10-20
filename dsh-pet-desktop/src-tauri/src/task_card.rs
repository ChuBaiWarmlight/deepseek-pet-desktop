//! 任务卡：把一次 agent 会话里发生的事按会话聚合。
//!
//! 只读取事件里的元数据（项目、工具名、文件路径），不含 prompt 和代码内容。

use serde::Serialize;
use std::collections::HashMap;

use crate::agent_hub::AgentEvent;
use crate::timeline;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUse {
    pub name: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCard {
    pub provider: String,
    pub session_id: String,
    pub project: String,
    pub cwd: String,
    pub start_ts: u64,
    pub end_ts: u64,
    pub minutes: u64,
    pub events: usize,
    pub approvals: usize,
    pub failures: usize,
    pub completed: bool,
    pub tools: Vec<ToolUse>,
    pub files: Vec<String>,
}

fn is_failure(event: &AgentEvent) -> bool {
    event.severity.eq_ignore_ascii_case("error")
        || matches!(event.kind.as_str(), "task.failed" | "build.failed" | "test.failed")
}

fn tool_name(event: &AgentEvent) -> Option<String> {
    if let Some(tool) = event.data.get("tool").and_then(|v| v.as_str()) {
        if !tool.trim().is_empty() {
            return Some(tool.trim().to_string());
        }
    }
    event
        .status
        .strip_prefix("正在使用 ")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn paths_of(event: &AgentEvent) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(items) = event.data.get("paths").and_then(|v| v.as_array()) {
        for item in items {
            if let Some(path) = item.as_str() {
                let trimmed = path.trim();
                if !trimmed.is_empty() {
                    out.push(trimmed.to_string());
                }
            }
        }
    }
    if let Some(path) = event.data.get("file").and_then(|v| v.as_str()) {
        if !path.trim().is_empty() {
            out.push(path.trim().to_string());
        }
    }
    out
}

/// 纯函数：把一天的事件聚合成任务卡，按开始时间升序。
pub fn cards_from(events: &[AgentEvent]) -> Vec<TaskCard> {
    struct Acc {
        provider: String,
        session: String,
        project: String,
        cwd: String,
        start: u64,
        end: u64,
        events: usize,
        approvals: usize,
        failures: usize,
        completed: bool,
        tools: HashMap<String, usize>,
        files: Vec<String>,
    }

    let mut accs: HashMap<String, Acc> = HashMap::new();
    for event in events {
        let session = if event.session_id.trim().is_empty() {
            format!("adhoc-{}", event.project)
        } else {
            event.session_id.clone()
        };
        let key = format!("{}|{}", event.provider, session);
        let acc = accs.entry(key).or_insert_with(|| Acc {
            provider: event.provider.clone(),
            session: session.clone(),
            project: event.project.clone(),
            cwd: event.cwd.clone(),
            start: event.ts,
            end: event.ts,
            events: 0,
            approvals: 0,
            failures: 0,
            completed: false,
            tools: HashMap::new(),
            files: Vec::new(),
        });
        acc.start = acc.start.min(event.ts);
        acc.end = acc.end.max(event.ts);
        acc.events += 1;
        if acc.project.is_empty() && !event.project.is_empty() {
            acc.project = event.project.clone();
        }
        if acc.cwd.is_empty() && !event.cwd.is_empty() {
            acc.cwd = event.cwd.clone();
        }
        if event.kind == "tool.start" {
            if let Some(tool) = tool_name(event) {
                *acc.tools.entry(tool).or_insert(0) += 1;
            }
        }
        if event.kind == "approval.requested" {
            acc.approvals += 1;
        }
        if is_failure(event) {
            acc.failures += 1;
        }
        if matches!(event.kind.as_str(), "turn.completed" | "task.done") {
            acc.completed = true;
        }
        for path in paths_of(event) {
            if !acc.files.contains(&path) {
                acc.files.push(path);
            }
        }
    }

    let mut cards: Vec<TaskCard> = accs
        .into_iter()
        .map(|(_, acc)| {
            let mut tools: Vec<ToolUse> = acc
                .tools
                .into_iter()
                .map(|(name, count)| ToolUse { name, count })
                .collect();
            tools.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));
            tools.truncate(8);
            let minutes = if acc.end > acc.start {
                ((acc.end - acc.start) as f64 / 60_000.0).ceil() as u64
            } else {
                0
            };
            TaskCard {
                provider: acc.provider,
                session_id: acc.session,
                project: acc.project,
                cwd: acc.cwd,
                start_ts: acc.start,
                end_ts: acc.end,
                minutes,
                events: acc.events,
                approvals: acc.approvals,
                failures: acc.failures,
                completed: acc.completed,
                tools,
                files: acc.files.into_iter().take(20).collect(),
            }
        })
        .collect();
    cards.sort_by_key(|c| c.start_ts);
    cards
}

pub fn cards_for_day(day: &str) -> Result<Vec<TaskCard>, String> {
    let events = timeline::read_day(day)?;
    Ok(cards_from(&events))
}

/// 最近一天里出现过的文件名（去重、按出现顺序）。
pub fn recent_files(day: &str, limit: usize) -> Vec<String> {
    let cards = cards_for_day(day).unwrap_or_default();
    let mut out: Vec<String> = Vec::new();
    for card in cards {
        for file in card.files {
            if !out.contains(&file) {
                out.push(file);
            }
            if out.len() >= limit {
                return out;
            }
        }
    }
    out
}

#[tauri::command]
pub fn work_task_cards(day: Option<String>) -> Result<Vec<TaskCard>, String> {
    let day = day.unwrap_or_else(timeline::today);
    cards_for_day(&day)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(ts: u64, kind: &str, session: &str, project: &str) -> AgentEvent {
        AgentEvent {
            ts,
            provider: "claude-code".to_string(),
            kind: kind.to_string(),
            session_id: session.to_string(),
            project: project.to_string(),
            ..AgentEvent::default()
        }
    }

    #[test]
    fn groups_one_session_into_one_card() {
        let mut a = ev(1_000, "session.start", "s1", "pet");
        a.data = serde_json::json!({});
        let mut b = ev(61_000, "tool.start", "s1", "pet");
        b.status = "正在使用 Bash".to_string();
        b.data = serde_json::json!({ "tool": "Bash", "paths": ["src/PetApp.tsx"] });
        let mut c = ev(121_000, "tool.start", "s1", "pet");
        c.status = "正在使用 Bash".to_string();
        c.data = serde_json::json!({ "tool": "Bash", "paths": ["src/pet.css", "src/PetApp.tsx"] });
        let d = ev(181_000, "turn.completed", "s1", "pet");

        let cards = cards_from(&[a, b, c, d]);
        assert_eq!(cards.len(), 1);
        let card = &cards[0];
        assert_eq!(card.minutes, 3);
        assert!(card.completed);
        assert_eq!(card.tools.len(), 1);
        assert_eq!(card.tools[0].count, 2);
        assert_eq!(card.files, vec!["src/PetApp.tsx", "src/pet.css"]);
    }

    #[test]
    fn splits_by_session_and_provider() {
        let cards = cards_from(&[
            ev(1_000, "session.start", "s1", "pet"),
            ev(2_000, "session.start", "s2", "pet"),
        ]);
        assert_eq!(cards.len(), 2);
    }
}