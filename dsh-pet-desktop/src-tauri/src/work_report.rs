//! 工作日报 / 周报 / 早晚简报：全部从时间线与任务卡生成，不调用大模型。

use serde::Serialize;
use std::fs;
use tauri::{AppHandle, Emitter};

use crate::agent_hub::AgentEvent;
use crate::config::{app_dir, now_millis};
use crate::task_card::{self, TaskCard};
use crate::timeline;
use crate::work_memory::{self, DayDigest};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkReport {
    pub period: String,
    pub date: String,
    pub title: String,
    pub markdown: String,
    pub generated_at: u64,
}

fn clock(ts: u64) -> String {
    use chrono::{Local, TimeZone};
    Local
        .timestamp_millis_opt(ts as i64)
        .single()
        .map(|d| d.format("%H:%M").to_string())
        .unwrap_or_default()
}

fn card_section(card: &TaskCard) -> String {
    let name = if card.project.trim().is_empty() {
        "未命名项目"
    } else {
        card.project.as_str()
    };
    let mut out = format!("### {name}\n");
    let span = if card.start_ts > 0 && card.end_ts > card.start_ts {
        format!("{}-{}", clock(card.start_ts), clock(card.end_ts))
    } else {
        "未记录".to_string()
    };
    out.push_str(&format!(
        "- {} · {} · {} · 工具调用 {} 次\n",
        card.provider,
        span,
        work_memory::human_minutes(card.minutes),
        card.tools.iter().map(|t| t.count).sum::<usize>()
    ));
    if !card.tools.is_empty() {
        let tools: Vec<String> = card
            .tools
            .iter()
            .map(|t| format!("{}×{}", t.name, t.count))
            .collect();
        out.push_str(&format!("- 主要工具：{}\n", tools.join("、")));
    }
    if !card.files.is_empty() {
        out.push_str(&format!("- 涉及文件：{}\n", card.files.join("、")));
    }
    let status = if card.failures > 0 {
        format!("有 {} 次失败", card.failures)
    } else if card.completed {
        "已完成".to_string()
    } else {
        "未标记完成".to_string()
    };
    out.push_str(&format!("- 状态：{status}\n"));
    out
}

fn suggestions(digest: &DayDigest, cards: &[TaskCard]) -> Vec<String> {
    let mut out = Vec::new();
    if digest.events == 0 {
        out.push("今天没有工作记录，明天可以先把要做的事写下来。".to_string());
        return out;
    }
    if digest.failures > 0 {
        out.push(format!(
            "有 {} 次失败，明天先把失败的会话捞出来复盘。",
            digest.failures
        ));
    }
    if digest.approvals >= 3 {
        out.push("等待确认的次数偏多，考虑给常用命令加白名单。".to_string());
    }
    let unfinished = cards.iter().filter(|c| !c.completed).count();
    if unfinished > 0 {
        out.push(format!("有 {unfinished} 个会话没有标记完成，明天先收尾。"));
    }
    if out.is_empty() {
        out.push("今天节奏不错，明天可以继续推进同一块。".to_string());
    }
    out
}

fn build_day(day: &str) -> Result<WorkReport, String> {
    let digest = work_memory::digest(day)?;
    let cards = task_card::cards_for_day(day)?;
    let mut md = format!("# 工作日报 · {day}\n\n## 概览\n");
    md.push_str(&format!(
        "- 在岗 {}，{} 个会话，{} 个项目\n",
        work_memory::human_minutes(digest.active_minutes),
        digest.sessions,
        digest.projects.len()
    ));
    md.push_str(&format!(
        "- 工具调用 {} 次，等待确认 {} 次，失败 {} 次\n",
        digest.tool_calls, digest.approvals, digest.failures
    ));
    if !digest.start_time.is_empty() && !digest.end_time.is_empty() {
        md.push_str(&format!(
            "- 时间跨度：{} - {}\n",
            digest.start_time, digest.end_time
        ));
    }
    md.push_str("\n## 会话\n");
    if cards.is_empty() {
        md.push_str("今天没有会话记录。\n");
    } else {
        for card in &cards {
            md.push('\n');
            md.push_str(&card_section(card));
        }
    }
    md.push_str("\n## 建议\n");
    for line in suggestions(&digest, &cards) {
        md.push_str(&format!("- {line}\n"));
    }

    Ok(WorkReport {
        period: "day".to_string(),
        date: day.to_string(),
        title: format!("工作日报 · {day}"),
        markdown: md,
        generated_at: now_millis(),
    })
}

fn build_week(days_back: usize) -> Result<WorkReport, String> {
    use chrono::{Duration, Local};
    let today = Local::now().date_naive();
    // 固定取最近 N 个自然日（从旧到新），避免把几个月前的历史文件算进「本周」。
    let days: Vec<String> = (0..days_back.max(1))
        .rev()
        .map(|offset| (today - Duration::days(offset as i64)).format("%Y-%m-%d").to_string())
        .collect();
    let mut digests: Vec<DayDigest> = Vec::new();
    let mut all_cards: Vec<TaskCard> = Vec::new();
    for day in &days {
        if let Ok(digest) = work_memory::digest(day) {
            if digest.events > 0 {
                digests.push(digest);
            }
        }
        if let Ok(mut cards) = task_card::cards_for_day(day) {
            all_cards.append(&mut cards);
        }
    }

    let total_minutes: u64 = digests.iter().map(|d| d.active_minutes).sum();
    let total_tools: usize = digests.iter().map(|d| d.tool_calls).sum();
    let total_failures: usize = digests.iter().map(|d| d.failures).sum();
    let range = format!(
        "{} ~ {}",
        days.first().cloned().unwrap_or_default(),
        days.last().cloned().unwrap_or_default()
    );

    let mut md = format!("# 工作周报 · {range}\n\n## 概览\n");
    md.push_str(&format!(
        "- 有记录的天数：{} 天\n- 累计在岗：{}\n- 工具调用：{} 次\n- 失败：{} 次\n",
        digests.len(),
        work_memory::human_minutes(total_minutes),
        total_tools,
        total_failures
    ));

    let mut project_minutes: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    for card in &all_cards {
        let name = if card.project.trim().is_empty() {
            "未命名项目".to_string()
        } else {
            card.project.clone()
        };
        *project_minutes.entry(name).or_insert(0) += card.minutes;
    }
    let mut projects: Vec<(String, u64)> = project_minutes.into_iter().collect();
    projects.sort_by(|a, b| b.1.cmp(&a.1));
    if !projects.is_empty() {
        md.push_str("\n## 项目\n");
        for (name, minutes) in projects.iter().take(5) {
            md.push_str(&format!("- {name}：{}\n", work_memory::human_minutes(*minutes)));
        }
    }

    md.push_str("\n## 每日\n");
    if digests.is_empty() {
        md.push_str("这一周没有工作记录。\n");
    } else {
        for digest in digests.iter().rev() {
            md.push_str(&format!(
                "- {}：{}，{} 个会话，失败 {} 次\n",
                digest.date,
                work_memory::human_minutes(digest.active_minutes),
                digest.sessions,
                digest.failures
            ));
        }
    }

    Ok(WorkReport {
        period: "week".to_string(),
        date: timeline::today(),
        title: format!("工作周报 · {range}"),
        markdown: md,
        generated_at: now_millis(),
    })
}

pub fn build(period: &str, day: Option<String>) -> Result<WorkReport, String> {
    match period {
        "week" => build_week(7),
        _ => build_day(&day.unwrap_or_else(timeline::today)),
    }
}

pub fn export(period: &str, day: Option<String>) -> Result<String, String> {
    let report = build(period, day)?;
    let dir = app_dir().join("reports");
    fs::create_dir_all(&dir).map_err(|e| format!("创建报告目录失败：{e}"))?;
    let name = format!("{}-{}.md", report.period, report.date);
    let path = dir.join(name);
    fs::write(&path, report.markdown.as_bytes()).map_err(|e| format!("写入报告失败：{e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// morning：昨天 + 近 7 天习惯；evening：今天收尾。
pub fn brief(kind: &str) -> String {
    let today = timeline::today();
    let yesterday = {
        use chrono::{Duration, Local};
        (Local::now().date_naive() - Duration::days(1))
            .format("%Y-%m-%d")
            .to_string()
    };
    if kind == "evening" {
        let digest = work_memory::digest(&today).unwrap_or_default();
        if digest.events == 0 {
            return String::new();
        }
        let cards = task_card::cards_for_day(&today).unwrap_or_default();
        let mut text = format!(
            "今天在岗 {}，{} 个会话，工具调用 {} 次。",
            work_memory::human_minutes(digest.active_minutes),
            digest.sessions,
            digest.tool_calls
        );
        if let Some(top) = digest.projects.first() {
            text.push_str(&format!("最常待的是「{}」。", top.name));
        }
        if let Some(line) = suggestions(&digest, &cards).first() {
            text.push_str(line);
        }
        text
    } else {
        let digest = work_memory::digest(&yesterday).unwrap_or_default();
        if digest.events == 0 {
            return String::new();
        }
        let profile = work_memory::profile(7);
        let mut text = format!(
            "昨天在岗 {}，{} 个会话。",
            work_memory::human_minutes(digest.active_minutes),
            digest.sessions
        );
        if !profile.summary.is_empty() {
            text.push_str(&profile.summary);
        }
        text
    }
}

/// 每天 09:30 推晨间简报、18:30 推下班收尾；错过时间点但仍在窗口内也会补一次。
/// 直接发前端事件，不写入时间线，避免污染工作统计。
pub fn spawn_brief_scheduler(app: AppHandle) {
    std::thread::spawn(move || {
        use chrono::{Local, Timelike};
        let mut last_morning = String::new();
        let mut last_evening = String::new();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            let now = Local::now();
            let today = now.format("%Y-%m-%d").to_string();
            let hm = now.hour() as u32 * 60 + now.minute() as u32;

            let mut kind = "";
            if hm >= 9 * 60 + 30 && hm < 10 * 60 && last_morning != today {
                last_morning = today.clone();
                kind = "morning";
            } else if hm >= 18 * 60 + 30 && hm < 19 * 60 && last_evening != today {
                last_evening = today.clone();
                kind = "evening";
            }
            if kind.is_empty() {
                continue;
            }

            let text = brief(kind);
            if text.trim().is_empty() {
                continue;
            }
            let status = if kind == "morning" { "晨间简报" } else { "下班收尾" };
            let event = AgentEvent {
                ts: now_millis(),
                provider: "dsh-pet".to_string(),
                kind: "notification".to_string(),
                status: status.to_string(),
                summary: text,
                attention: "glance".to_string(),
                severity: "info".to_string(),
                ..AgentEvent::default()
            };
            let app_handle = app.clone();
            let _ = app_handle.emit("agent-event", &event);
        }
    });
}

#[tauri::command]
pub fn work_report(period: Option<String>, day: Option<String>) -> Result<WorkReport, String> {
    build(period.as_deref().unwrap_or("day"), day)
}

#[tauri::command]
pub fn work_report_export(period: Option<String>, day: Option<String>) -> Result<String, String> {
    export(period.as_deref().unwrap_or("day"), day)
}

#[tauri::command]
pub fn work_brief(kind: Option<String>) -> String {
    brief(kind.as_deref().unwrap_or("morning"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_hub::AgentEvent;

    fn ev(ts: u64, kind: &str, project: &str) -> AgentEvent {
        AgentEvent {
            ts,
            provider: "claude-code".to_string(),
            kind: kind.to_string(),
            session_id: "s1".to_string(),
            project: project.to_string(),
            ..AgentEvent::default()
        }
    }

    #[test]
    fn suggestions_flag_failures() {
        let events = vec![
            ev(0, "session.start", "pet"),
            ev(60_000, "task.failed", "pet"),
        ];
        let digest = work_memory::digest_from(&events, "2026-10-20");
        let cards = task_card::cards_from(&events);
        let lines = suggestions(&digest, &cards);
        assert!(lines.iter().any(|l| l.contains("失败")));
    }

    #[test]
    fn day_report_contains_sections() {
        let report = build_day("1999-01-01").unwrap();
        assert!(report.markdown.contains("## 概览"));
        assert!(report.markdown.contains("## 建议"));
        assert!(report.title.contains("工作日报"));
    }

    #[test]
    fn export_writes_markdown_file() {
        let path = export("day", Some("1999-01-01".to_string())).unwrap();
        let file = std::path::Path::new(&path);
        assert!(file.exists(), "exported report missing: {path}");
        let text = std::fs::read_to_string(file).unwrap();
        assert!(text.contains("工作日报"));
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn week_uses_last_seven_calendar_days() {
        use chrono::{Duration, Local};
        let today = Local::now().date_naive();
        let start = today - Duration::days(6);
        let report = build_week(7).unwrap();
        assert!(report.title.contains(&start.format("%Y-%m-%d").to_string()));
        assert!(report.title.contains(&today.format("%Y-%m-%d").to_string()));
    }
}
