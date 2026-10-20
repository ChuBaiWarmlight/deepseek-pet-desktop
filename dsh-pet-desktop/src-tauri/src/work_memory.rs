//! 工作日常记忆：从时间线派生「今天/昨天干了什么」和长期习惯。
//!
//! 时间线是唯一事实来源，这里不重复落盘；所有结果都能从
//! `~/.dsh-pet-desktop/timeline/*.jsonl` 重新算出来。

use serde::Serialize;
use std::collections::{HashMap, HashSet};

use crate::agent_hub::AgentEvent;
use crate::timeline;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSlice {
    pub name: String,
    pub minutes: u64,
    pub events: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayDigest {
    pub date: String,
    pub events: usize,
    pub active_minutes: u64,
    pub sessions: usize,
    pub tool_calls: usize,
    pub approvals: usize,
    pub failures: usize,
    pub completions: usize,
    pub first_ts: u64,
    pub last_ts: u64,
    pub start_time: String,
    pub end_time: String,
    pub projects: Vec<ProjectSlice>,
    pub providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTotal {
    pub name: String,
    pub days: usize,
    pub minutes: u64,
    pub events: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkProfile {
    pub days: usize,
    pub total_minutes: u64,
    pub avg_minutes: u64,
    pub streak_days: usize,
    pub typical_start: String,
    pub typical_end: String,
    pub top_projects: Vec<ProjectTotal>,
    pub recent: Vec<DayDigest>,
    pub summary: String,
}

fn clock(ts: u64) -> String {
    use chrono::{Local, TimeZone};
    Local
        .timestamp_millis_opt(ts as i64)
        .single()
        .map(|d| d.format("%H:%M").to_string())
        .unwrap_or_default()
}

fn minutes_of_day(ts: u64) -> Option<i64> {
    use chrono::{Local, TimeZone, Timelike};
    Local
        .timestamp_millis_opt(ts as i64)
        .single()
        .map(|d| (d.hour() as i64) * 60 + d.minute() as i64)
}

fn clock_from_minutes(m: i64) -> String {
    format!("{:02}:{:02}", (m / 60).rem_euclid(24), m.rem_euclid(60))
}

fn median(values: &mut [i64]) -> Option<i64> {
    if values.is_empty() {
        return None;
    }
    values.sort_unstable();
    Some(values[values.len() / 2])
}

pub fn human_minutes(minutes: u64) -> String {
    if minutes >= 60 {
        let h = minutes / 60;
        let m = minutes % 60;
        if m == 0 {
            format!("{h} 小时")
        } else {
            format!("{h} 小时 {m} 分")
        }
    } else {
        format!("{minutes} 分钟")
    }
}

/// 从一天的事件算出摘要；纯函数，方便单测。
pub fn digest_from(events: &[AgentEvent], day: &str) -> DayDigest {
    let summary = timeline::summarize(events, day);

    let mut projects: HashMap<String, (u64, usize)> = HashMap::new();
    for span in &summary.session_list {
        let name = if span.project.trim().is_empty() {
            "未命名项目".to_string()
        } else {
            span.project.clone()
        };
        let entry = projects.entry(name).or_insert((0, 0));
        entry.0 += span.minutes;
        entry.1 += span.events;
    }
    let mut projects: Vec<ProjectSlice> = projects
        .into_iter()
        .map(|(name, (minutes, events))| ProjectSlice { name, minutes, events })
        .collect();
    projects.sort_by(|a, b| b.minutes.cmp(&a.minutes).then(b.events.cmp(&a.events)));
    projects.truncate(5);

    DayDigest {
        date: day.to_string(),
        events: summary.events,
        active_minutes: summary.active_minutes,
        sessions: summary.sessions,
        tool_calls: summary.tool_calls,
        approvals: summary.approvals,
        failures: summary.failures,
        completions: summary.completions,
        first_ts: summary.first_ts,
        last_ts: summary.last_ts,
        start_time: if summary.first_ts > 0 { clock(summary.first_ts) } else { String::new() },
        end_time: if summary.last_ts > 0 { clock(summary.last_ts) } else { String::new() },
        projects,
        providers: summary.providers,
    }
}

pub fn digest(day: &str) -> Result<DayDigest, String> {
    let events = timeline::read_day(day)?;
    Ok(digest_from(&events, day))
}

fn streak(digests: &[DayDigest]) -> usize {
    use chrono::{Duration, Local};
    let days: HashSet<&str> = digests.iter().map(|d| d.date.as_str()).collect();
    let mut cursor = Local::now().date_naive();
    let today = cursor.format("%Y-%m-%d").to_string();
    if !days.contains(today.as_str()) {
        cursor -= Duration::days(1);
    }
    let mut count = 0;
    loop {
        let key = cursor.format("%Y-%m-%d").to_string();
        if !days.contains(key.as_str()) {
            break;
        }
        count += 1;
        cursor -= Duration::days(1);
    }
    count
}

fn day_label(date: &str) -> String {
    use chrono::{Duration, Local, NaiveDate};
    let Ok(parsed) = NaiveDate::parse_from_str(date, "%Y-%m-%d") else {
        return date.to_string();
    };
    let today = Local::now().date_naive();
    if parsed == today {
        "今天".to_string()
    } else if parsed == today - Duration::days(1) {
        "昨天".to_string()
    } else {
        parsed.format("%m-%d").to_string()
    }
}

fn digest_line(digest: &DayDigest) -> String {
    let mut line = format!("{}：", day_label(&digest.date));
    if let Some(top) = digest.projects.first() {
        line.push_str(&format!(
            "主要在「{}」干了 {}",
            top.name,
            human_minutes(digest.active_minutes)
        ));
    } else {
        line.push_str(&format!("专注了 {}", human_minutes(digest.active_minutes)));
    }
    if let Some(provider) = digest.providers.first() {
        line.push_str(&format!("，用的是 {provider}"));
    }
    if digest.tool_calls > 0 {
        line.push_str(&format!("，调用工具 {} 次", digest.tool_calls));
    }
    if digest.approvals > 0 {
        line.push_str(&format!("，等你确认 {} 次", digest.approvals));
    }
    if digest.failures > 0 {
        line.push_str(&format!("，失败 {} 次", digest.failures));
    }
    line.push('。');
    line
}

pub fn profile(days_back: usize) -> WorkProfile {
    let limit = days_back.clamp(1, 120);
    let mut digests: Vec<DayDigest> = timeline::days(limit)
        .into_iter()
        .filter_map(|day| digest(&day).ok())
        .filter(|d| d.events > 0)
        .collect();
    digests.truncate(limit);

    let total_minutes: u64 = digests.iter().map(|d| d.active_minutes).sum();
    let count = digests.len();
    let avg_minutes = if count > 0 {
        (total_minutes as f64 / count as f64).round() as u64
    } else {
        0
    };

    let mut agg: HashMap<String, ProjectTotal> = HashMap::new();
    for day in &digests {
        for project in &day.projects {
            let entry = agg.entry(project.name.clone()).or_insert_with(|| ProjectTotal {
                name: project.name.clone(),
                days: 0,
                minutes: 0,
                events: 0,
            });
            entry.days += 1;
            entry.minutes += project.minutes;
            entry.events += project.events;
        }
    }
    let mut top_projects: Vec<ProjectTotal> = agg.into_values().collect();
    top_projects.sort_by(|a, b| b.days.cmp(&a.days).then(b.minutes.cmp(&a.minutes)));
    top_projects.truncate(3);

    let mut starts: Vec<i64> = digests.iter().filter_map(|d| minutes_of_day(d.first_ts)).collect();
    let mut ends: Vec<i64> = digests.iter().filter_map(|d| minutes_of_day(d.last_ts)).collect();
    let typical_start = median(&mut starts).map(clock_from_minutes).unwrap_or_default();
    let typical_end = median(&mut ends).map(clock_from_minutes).unwrap_or_default();

    let streak_days = streak(&digests);

    let mut summary = String::new();
    if !digests.is_empty() {
        summary.push_str(&format!(
            "最近 {} 天有 {} 天在工作，平均每天 {}",
            limit,
            digests.len(),
            human_minutes(avg_minutes)
        ));
        if !typical_start.is_empty() && !typical_end.is_empty() {
            summary.push_str(&format!("；通常 {typical_start} 开工、{typical_end} 收尾"));
        }
        if let Some(top) = top_projects.first() {
            summary.push_str(&format!("；最常做的是「{}」（{} 天）", top.name, top.days));
        }
        if streak_days > 1 {
            summary.push_str(&format!("；已连续 {streak_days} 天"));
        }
        summary.push('。');
    }

    WorkProfile {
        days: count,
        total_minutes,
        avg_minutes,
        streak_days,
        typical_start,
        typical_end,
        top_projects,
        recent: digests,
        summary,
    }
}

/// 给聊天 prompt 用的紧凑文本，控制在几行以内。
pub fn text(days_back: usize) -> String {
    let profile = profile(days_back);
    if profile.recent.is_empty() {
        return String::new();
    }
    let mut lines: Vec<String> = profile
        .recent
        .iter()
        .take(3)
        .map(digest_line)
        .collect();
    if !profile.summary.is_empty() {
        lines.push(format!("长期习惯：{}", profile.summary));
    }
    lines.join("\n")
}

#[tauri::command]
pub fn work_memory_digest(day: Option<String>) -> Result<DayDigest, String> {
    let day = day.unwrap_or_else(timeline::today);
    digest(&day)
}

#[tauri::command]
pub fn work_memory_profile(days: Option<usize>) -> WorkProfile {
    profile(days.unwrap_or(7))
}

#[tauri::command]
pub fn work_memory_text(days: Option<usize>) -> String {
    text(days.unwrap_or(7))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(ts: u64, session: &str, project: &str, kind: &str) -> AgentEvent {
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
    fn digest_groups_projects_and_formats_minutes() {
        let events = vec![
            ev(0, "s1", "pet", "session.start"),
            ev(600_000, "s1", "pet", "tool.start"),
            ev(1_800_000, "s2", "work", "session.start"),
            ev(3_600_000, "s2", "work", "turn.completed"),
        ];
        let digest = digest_from(&events, "2026-10-20");
        assert_eq!(digest.projects.len(), 2);
        assert_eq!(digest.projects[0].name, "work");
        assert_eq!(digest.active_minutes, 40);
        assert_eq!(human_minutes(40), "40 分钟");
        assert_eq!(human_minutes(125), "2 小时 5 分");
        assert!(digest_line(&digest).contains("work"));
    }

    #[test]
    fn empty_day_has_no_text() {
        let digest = digest_from(&[], "2026-10-20");
        assert_eq!(digest.events, 0);
        assert_eq!(digest.projects.len(), 0);
        assert_eq!(digest.active_minutes, 0);
    }
}