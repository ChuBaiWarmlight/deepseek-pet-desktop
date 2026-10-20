//! 记录集命令：心情日记 + 聊天记录 + 整包导出/导入。
//!
//! 日记/聊天与长期记忆同属“记忆块”，统一走 `storage::RecordsStore`（单文件原子落盘），
//! 取代 Web 版的 localStorage（`dsh.vpet.diary` / `dsh.vpet.chat`）。

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::storage::{
    ChatTurn, DailyReport, DiaryEntry, Records, RecordsStore, CHAT_MAX, DIARY_MAX, REPORT_MAX,
};

#[derive(Debug, Deserialize)]
pub struct DiaryWriteRequest {
    pub date: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct ChatSetRequest {
    pub history: Vec<ChatTurn>,
}

#[derive(Debug, Deserialize)]
pub struct RecordsImportRequest {
    pub memories: Vec<crate::storage::Memory>,
    pub diary: Vec<DiaryEntry>,
    pub chat: Vec<ChatTurn>,
    #[serde(default)]
    pub reports: Vec<DailyReport>,
}

#[derive(Serialize)]
pub struct DiaryListResponse {
    pub ok: bool,
    pub diary: Vec<DiaryEntry>,
}

#[derive(Serialize)]
pub struct ChatListResponse {
    pub ok: bool,
    pub chat: Vec<ChatTurn>,
}

#[derive(Serialize)]
pub struct ReportListResponse {
    pub ok: bool,
    pub reports: Vec<DailyReport>,
}

#[derive(Deserialize)]
pub struct ReportSaveRequest {
    pub report: DailyReport,
}

#[derive(Serialize)]
pub struct RecordsResult {
    pub ok: bool,
    pub count: usize,
    pub diag: String,
}

#[tauri::command]
pub async fn diary_list(store: State<'_, RecordsStore>) -> Result<DiaryListResponse, String> {
    let diary = store.get().diary;
    Ok(DiaryListResponse { ok: true, diary })
}

/// 写当天日记。多次手动记录会合并在同一篇日记中，避免后一次覆盖前一次。
#[tauri::command]
pub async fn diary_write(
    store: State<'_, RecordsStore>,
    req: DiaryWriteRequest,
) -> Result<RecordsResult, String> {
    let date = req.date.trim().to_string();
    let text: String = req.text.trim().chars().take(1200).collect();
    if text.is_empty() {
        return Ok(RecordsResult {
            ok: false,
            count: 0,
            diag: "empty text".into(),
        });
    }
    store.update(|records| {
        if let Some(existing) = records.diary.iter_mut().find(|d| d.date == date) {
            if existing.text != text {
                existing.text = format!("{}\n\n{}", existing.text, text)
                    .chars()
                    .take(2400)
                    .collect();
            }
            return;
        }
        records.diary.insert(0, DiaryEntry { date, text });
        records.diary.truncate(DIARY_MAX);
    })?;
    Ok(RecordsResult {
        ok: true,
        count: 0,
        diag: "ok".into(),
    })
}

#[tauri::command]
pub async fn chat_list(store: State<'_, RecordsStore>) -> Result<ChatListResponse, String> {
    let chat = store.get().chat;
    Ok(ChatListResponse { ok: true, chat })
}

/// 整体替换聊天记录（前端已裁剪到最近 N 条）。
#[tauri::command]
pub async fn chat_set(
    store: State<'_, RecordsStore>,
    req: ChatSetRequest,
) -> Result<RecordsResult, String> {
    let history: Vec<ChatTurn> = req
        .history
        .into_iter()
        .filter(|h| !h.text.trim().is_empty())
        .map(|h| ChatTurn {
            role: if h.role == "assistant" {
                "assistant".to_string()
            } else {
                "user".to_string()
            },
            text: h.text.trim().to_string(),
        })
        .collect();
    store.update(|records| {
        records.chat = history;
    })?;
    Ok(RecordsResult {
        ok: true,
        count: 0,
        diag: "ok".into(),
    })
}

#[tauri::command]
pub async fn chat_clear(store: State<'_, RecordsStore>) -> Result<RecordsResult, String> {
    store.update(|records| {
        records.chat.clear();
    })?;
    Ok(RecordsResult {
        ok: true,
        count: 0,
        diag: "ok".into(),
    })
}

#[tauri::command]
pub async fn report_list(store: State<'_, RecordsStore>) -> Result<ReportListResponse, String> {
    Ok(ReportListResponse {
        ok: true,
        reports: store.get().reports,
    })
}

/// 保存/覆盖某日陪伴报告（按日期唯一），只保留最近 REPORT_MAX 天。
#[tauri::command]
pub async fn report_save(
    store: State<'_, RecordsStore>,
    req: ReportSaveRequest,
) -> Result<RecordsResult, String> {
    let mut report = req.report;
    report.date = report.date.trim().chars().take(10).collect();
    if report.date.is_empty() {
        return Err("报告日期不能为空".into());
    }
    report.chat_summary = report.chat_summary.chars().take(600).collect();
    report.done_summary = report.done_summary.chars().take(600).collect();
    report.tomorrow = report.tomorrow.chars().take(400).collect();
    report.mood = report.mood.chars().take(400).collect();
    if report.generated_at == 0 {
        report.generated_at = crate::config::now_millis();
    }
    store.update(|records| {
        records.reports.retain(|r| r.date != report.date);
        records.reports.push(report);
        records.reports.sort_by(|a, b| b.date.cmp(&a.date));
        records.reports.truncate(REPORT_MAX);
    })?;
    Ok(RecordsResult {
        ok: true,
        count: 0,
        diag: "ok".into(),
    })
}

/// 整包导出（供前端备份：与 localStorage 键合并成一份备份文件）。
#[tauri::command]
pub async fn records_export(store: State<'_, RecordsStore>) -> Result<Records, String> {
    Ok(store.get())
}

/// 整包导入（备份还原）。
#[tauri::command]
pub async fn records_import(
    store: State<'_, RecordsStore>,
    req: RecordsImportRequest,
) -> Result<RecordsResult, String> {
    let now = crate::config::now_millis();
    let records = Records {
        memories: req
            .memories
            .into_iter()
            .filter(|m| !m.content.trim().is_empty())
            .map(|m| crate::storage::Memory {
                id: if m.id.is_empty() {
                    format!("m{now}-import")
                } else {
                    m.id
                },
                content: m.content.trim().chars().take(120).collect(),
                category: m.category,
                date: m.date.chars().take(10).collect(),
                created_at: if m.created_at > 0 { m.created_at } else { now },
                reminded_at: m.reminded_at,
                importance: m.importance,
                last_recalled_at: m.last_recalled_at,
            })
            .take(crate::storage::MEMORY_MAX)
            .collect(),
        diary: req
            .diary
            .into_iter()
            .map(|d| DiaryEntry {
                date: d.date.trim().to_string(),
                text: d.text.trim().to_string(),
            })
            .take(DIARY_MAX)
            .collect(),
        chat: req
            .chat
            .into_iter()
            .map(|c| ChatTurn {
                role: if c.role == "assistant" {
                    "assistant".to_string()
                } else {
                    "user".to_string()
                },
                text: c.text.trim().to_string(),
            })
            .take(CHAT_MAX)
            .collect(),
        reports: req
            .reports
            .into_iter()
            .filter(|r| !r.date.trim().is_empty())
            .map(|r| DailyReport {
                date: r.date.trim().chars().take(10).collect(),
                companion_secs: r.companion_secs.min(86400 * 365),
                stats: r.stats,
                chat_summary: r.chat_summary.chars().take(600).collect(),
                done_summary: r.done_summary.chars().take(600).collect(),
                tomorrow: r.tomorrow.chars().take(400).collect(),
                mood: r.mood.chars().take(400).collect(),
                generated_at: r.generated_at,
            })
            .take(REPORT_MAX)
            .collect(),
    };
    let count = records.memories.len() + records.diary.len() + records.chat.len() + records.reports.len();
    store.update(|r| {
        *r = records;
    })?;
    Ok(RecordsResult {
        ok: true,
        count,
        diag: "ok".into(),
    })
}
