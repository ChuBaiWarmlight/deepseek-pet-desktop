//! 长期记忆：抽取 / 合并 / 增删 / 导入 / 回忆。
//!
//! 移植自 Web 版 `index.js` 的 `runExtraction / parseMemories / loadMemory / saveMemory /
//! pickMemory / markMemory / doDeleteMemory / doAddMemory / doImportMemory`，但存储从
//! `~/.dsh/dsh-pet/memory.json` 改为统一记录存储 `~/.dsh-pet-desktop/records.json`（`storage.rs`）。

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::llm;
use crate::config::{now_millis, Config, Store};
use crate::storage::{ChatTurn, Memory, RecordsStore, MEMORY_MAX};

/// LLM 抽取返回的原始条目（字段为 content/category/date，无时间戳）。
#[derive(Debug, Deserialize)]
struct FoundMemory {
    content: String,
    category: String,
    date: String,
}

#[derive(Debug, Deserialize)]
pub struct MemoryExtractRequest {
    pub history: Vec<ChatTurn>,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MemoryAddRequest {
    pub content: String,
    pub category: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MemoryDeleteRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct MemoryImportRequest {
    pub memories: Vec<Memory>,
}

#[derive(Serialize)]
pub struct MemoryListResponse {
    pub ok: bool,
    pub memories: Vec<Memory>,
}

#[derive(Serialize)]
pub struct MemoryResult {
    pub ok: bool,
    pub added: usize,
    pub removed: usize,
    pub count: usize,
    pub diag: String,
}

#[derive(Serialize)]
pub struct MemoryPickResponse {
    pub ok: bool,
    pub memory: Option<Memory>,
}

const CATEGORIES: [&str; 4] = ["goal", "deadline", "preference", "event"];

fn validate_category(cat: &str) -> String {
    if CATEGORIES.contains(&cat) {
        cat.to_string()
    } else {
        "event".to_string()
    }
}

/// 按分类给定初始重要度：期限 > 目标 > 偏好 ≈ 事件。
fn importance_for(cat: &str) -> u32 {
    match cat {
        "deadline" => 3,
        "goal" => 2,
        _ => 1,
    }
}

/// 重要度 + 新近度 的综合评分（新近的、重要的记忆得分更高）。
fn score_memory(m: &Memory, now: u64) -> i64 {
    let age = now.saturating_sub(m.created_at);
    let recency = if age < 86_400_000 {
        40
    } else if age < 7 * 86_400_000 {
        25
    } else if age < 30 * 86_400_000 {
        10
    } else {
        0
    };
    recency + (m.importance as i64) * 15
}

/// 剥离 markdown 代码块，取首个 JSON 数组（与 index.js `parseMemories` 对齐）。
fn parse_memories(text: &str) -> Vec<FoundMemory> {
    let mut t = text.trim().to_string();
    t = t.replace("```json", "").replace("```", "");
    let (Some(s), Some(e)) = (t.find('['), t.rfind(']')) else {
        return Vec::new();
    };
    if e <= s {
        return Vec::new();
    }
    serde_json::from_str::<Vec<FoundMemory>>(&t[s..=e]).unwrap_or_default()
}

/// 内容归一化（去空白 + 小写），用于去重。
fn norm(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_lowercase()
}

/// 抽取 + 去重 + 入库，返回新增条数。移植 index.js `runExtraction`。
async fn run_extraction(
    cfg: &Config,
    store: &RecordsStore,
    lines: &str,
    name: Option<&str>,
) -> Result<usize, String> {
    if lines.trim().is_empty() {
        return Ok(0);
    }
    let system = "你是一个信息抽取助手。你要从对话/工作内容中抽取「值得长期记住」的事实，只输出严格的 JSON 数组，不要任何解释、不要 markdown 代码块。";
    let name_hint = match name {
        Some(n) if !n.trim().is_empty() => format!("（桌宠的名字是「{}」）", n.trim()),
        _ => String::new(),
    };
    let user = format!(
        "下面是主人和桌宠最近的对话/工作内容：\n{lines}\n{name_hint}\n\n请抽取值得长期记住的信息（目标/计划、时间节点、喜好偏好、重要事件）。每条一个对象，字段：{{\"content\":\"一句话事实\",\"category\":\"goal|deadline|preference|event\",\"date\":\"YYYY-MM-DD 或空字符串\"}}。没有可记的就输出 []。只输出 JSON 数组本身。"
    );

    // 512 对推理模型不够（思维链会吃掉 token 导致 JSON 为空），给足余量；模型输出完即停。
    let (base_url, api_key, model) = crate::config::resolve_model(cfg, "chat");
    let resp = llm::complete(&base_url, &api_key, &model, system, &user, 7680, 0.3).await;
    if !resp.ok {
        return Err(resp.diag);
    }

    let found = parse_memories(&resp.text);
    if found.is_empty() {
        return Ok(0);
    }

    let now = now_millis();
    let mut added = 0usize;
    store.update(|records| {
        let mut seen: HashSet<String> = records
            .memories
            .iter()
            .map(|m| norm(&m.content))
            .collect();
        for item in &found {
            let content: String = item.content.trim().chars().take(120).collect();
            if content.is_empty() {
                continue;
            }
            let key = norm(&content);
            if seen.contains(&key) {
                continue;
            }
            seen.insert(key);
            let cat = validate_category(&item.category);
            let importance = importance_for(&cat);
            records.memories.insert(
                0,
                Memory {
                    id: format!("m{now}-{added}"),
                    content,
                    category: cat,
                    date: item.date.chars().take(10).collect(),
                    created_at: now,
                    reminded_at: None,
                    importance,
                    last_recalled_at: None,
                },
            );
            added += 1;
        }
        records.memories.truncate(MEMORY_MAX);
    })?;
    Ok(added)
}

/// 挑选一条记忆用于 proactive 主动话题：优先「未提醒」，再按「期限临近 > 重要度+新近度」排序。
fn pick_memory(list: &[Memory]) -> Option<Memory> {
    let now = now_millis();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut candidates: Vec<&Memory> = list.iter().filter(|m| m.reminded_at.is_none()).collect();
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by(|a, b| {
        let af = if !a.date.is_empty() && a.date >= today { 0 } else { 1 };
        let bf = if !b.date.is_empty() && b.date >= today { 0 } else { 1 };
        af.cmp(&bf)
            .then(score_memory(b, now).cmp(&score_memory(a, now)))
    });
    candidates.first().map(|m| (*m).clone())
}

#[tauri::command]
pub async fn memory_list(store: State<'_, RecordsStore>) -> Result<MemoryListResponse, String> {
    let memories = store.get().memories;
    Ok(MemoryListResponse { ok: true, memories })
}

#[tauri::command]
pub async fn memory_extract(
    state: State<'_, Store>,
    store: State<'_, RecordsStore>,
    req: MemoryExtractRequest,
) -> Result<MemoryResult, String> {
    let cfg = state.get();
    // 与 index.js extractMemories：取最近 12 条，映射为“桌宠/主人：内容”
    let lines: Vec<String> = req
        .history
        .iter()
        .filter(|h| !h.text.trim().is_empty())
        .rev()
        .take(12)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|h| {
            let who = if h.role == "assistant" { "桌宠" } else { "主人" };
            let text: String = h.text.trim().chars().take(200).collect();
            format!("{who}：{text}")
        })
        .collect();

    if lines.is_empty() {
        return Ok(MemoryResult {
            ok: true,
            added: 0,
            removed: 0,
            count: 0,
            diag: "no history".into(),
        });
    }
    match run_extraction(&cfg, &store, &lines.join("\n"), req.name.as_deref()).await {
        Ok(added) => Ok(MemoryResult {
            ok: true,
            added,
            removed: 0,
            count: 0,
            diag: "ok".into(),
        }),
        Err(diag) => Ok(MemoryResult {
            ok: false,
            added: 0,
            removed: 0,
            count: 0,
            diag,
        }),
    }
}

#[tauri::command]
pub async fn memory_add(
    store: State<'_, RecordsStore>,
    req: MemoryAddRequest,
) -> Result<MemoryResult, String> {
    let content: String = req.content.trim().chars().take(120).collect();
    if content.is_empty() {
        return Ok(MemoryResult {
            ok: false,
            added: 0,
            removed: 0,
            count: 0,
            diag: "empty content".into(),
        });
    }
    let now = now_millis();
    let cat = validate_category(req.category.as_deref().unwrap_or("event"));
    let importance = importance_for(&cat);
    store.update(|records| {
        records.memories.insert(
            0,
            Memory {
                id: format!("m{now}"),
                content,
                category: cat,
                date: req.date.unwrap_or_default().chars().take(10).collect(),
                created_at: now,
                reminded_at: None,
                importance,
                last_recalled_at: None,
            },
        );
        records.memories.truncate(MEMORY_MAX);
    })?;
    Ok(MemoryResult {
        ok: true,
        added: 1,
        removed: 0,
        count: 0,
        diag: "ok".into(),
    })
}

#[tauri::command]
pub async fn memory_delete(
    store: State<'_, RecordsStore>,
    req: MemoryDeleteRequest,
) -> Result<MemoryResult, String> {
    let id = req.id.trim();
    if id.is_empty() {
        return Ok(MemoryResult {
            ok: false,
            added: 0,
            removed: 0,
            count: 0,
            diag: "empty id".into(),
        });
    }
    let mut removed = 0usize;
    store.update(|records| {
        let before = records.memories.len();
        records.memories.retain(|m| m.id != id);
        removed = before - records.memories.len();
    })?;
    Ok(MemoryResult {
        ok: true,
        added: 0,
        removed,
        count: 0,
        diag: "ok".into(),
    })
}

#[tauri::command]
pub async fn memory_import(
    store: State<'_, RecordsStore>,
    req: MemoryImportRequest,
) -> Result<MemoryResult, String> {
    let now = now_millis();
    let cleaned: Vec<Memory> = req
        .memories
        .into_iter()
        .filter(|m| !m.content.trim().is_empty())
        .enumerate()
        .map(|(i, m)| Memory {
            id: if m.id.is_empty() {
                format!("m{now}-{i}")
            } else {
                m.id
            },
            content: m.content.trim().chars().take(120).collect(),
            category: validate_category(&m.category),
            date: m.date.chars().take(10).collect(),
            created_at: if m.created_at > 0 { m.created_at } else { now },
            reminded_at: m.reminded_at,
            importance: if m.importance > 0 { m.importance } else { importance_for(&validate_category(&m.category)) },
            last_recalled_at: m.last_recalled_at,
        })
        .take(MEMORY_MAX)
        .collect();
    let count = cleaned.len();
    store.update(|records| {
        records.memories = cleaned;
    })?;
    Ok(MemoryResult {
        ok: true,
        added: 0,
        removed: 0,
        count,
        diag: "ok".into(),
    })
}

/// 工作记忆：从 DSH 采集最近对话并抽取。依赖 DSH 暴露 `/dsh-pet/api/context`（缺口 G2），
/// 未提供上下文时优雅降级为“无新增”。
#[tauri::command]
pub async fn memory_work(
    state: State<'_, Store>,
    store: State<'_, RecordsStore>,
) -> Result<MemoryResult, String> {
    let cfg = state.get();
    let lines = crate::commands::dsh::fetch_context_lines(&cfg).await;
    let Some(lines) = lines else {
        return Ok(MemoryResult {
            ok: true,
            added: 0,
            removed: 0,
            count: 0,
            diag: "DSH 上下文不可用".into(),
        });
    };
    match run_extraction(&cfg, &store, &lines.join("\n"), None).await {
        Ok(added) => Ok(MemoryResult {
            ok: true,
            added,
            removed: 0,
            count: 0,
            diag: "ok".into(),
        }),
        Err(diag) => Ok(MemoryResult {
            ok: false,
            added: 0,
            removed: 0,
            count: 0,
            diag,
        }),
    }
}

/// 取一条未提醒的记忆（proactive 主动话题注入用）。
#[tauri::command]
pub async fn memory_pick(store: State<'_, RecordsStore>) -> Result<MemoryPickResponse, String> {
    let memory = pick_memory(&store.get().memories);
    Ok(MemoryPickResponse { ok: true, memory })
}

/// 标记某条记忆已提醒。
#[tauri::command]
pub async fn memory_mark(
    store: State<'_, RecordsStore>,
    req: MemoryDeleteRequest,
) -> Result<MemoryResult, String> {
    let id = req.id.trim();
    if id.is_empty() {
        return Ok(MemoryResult {
            ok: false,
            added: 0,
            removed: 0,
            count: 0,
            diag: "empty id".into(),
        });
    }
    let now = now_millis();
    store.update(|records| {
        if let Some(m) = records.memories.iter_mut().find(|m| m.id == id) {
            m.reminded_at = Some(now);
        }
    })?;
    Ok(MemoryResult {
        ok: true,
        added: 0,
        removed: 0,
        count: 0,
        diag: "ok".into(),
    })
}

#[derive(Debug, Deserialize)]
pub struct MemoryRecallRequest {
    pub query: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Serialize)]
pub struct MemoryRecallResponse {
    pub ok: bool,
    pub memories: Vec<Memory>,
}

/// 取字符串的相邻双字（bigram）集合，用于中文关键词重叠判定。
fn bigrams(s: &str) -> HashSet<String> {
    let chars: Vec<char> = s.chars().collect();
    let mut set = HashSet::new();
    for w in chars.windows(2) {
        set.insert(w.iter().collect::<String>());
    }
    set
}

/// 相关性召回：bigram 重叠 + 单字重叠 + 重要度/新近度 综合排序，取前 limit 条。
fn recall_memories(list: &[Memory], query: &str, limit: usize) -> Vec<Memory> {
    let q = query.trim();
    if q.is_empty() {
        return Vec::new();
    }
    let qb = bigrams(q);
    let qc: HashSet<char> = q.chars().collect();
    let now = now_millis();
    let mut scored: Vec<(i64, Memory)> = list
        .iter()
        .map(|m| {
            let cb = bigrams(&m.content);
            let overlap = qb.iter().filter(|b| cb.contains(*b)).count() as i64;
            let char_overlap = m.content.chars().filter(|c| qc.contains(c)).count() as i64;
            let score = overlap * 100 + char_overlap * 2 + score_memory(m, now);
            (score, m.clone())
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().take(limit).map(|(_, m)| m).collect()
}

/// 按关键词召回相关记忆（聊天回忆触发时用），并给召回的记忆打点 last_recalled_at。
#[tauri::command]
pub async fn memory_recall(
    store: State<'_, RecordsStore>,
    req: MemoryRecallRequest,
) -> Result<MemoryRecallResponse, String> {
    let limit = req.limit.unwrap_or(5).clamp(1, 20);
    let query = req.query.trim().to_string();
    let mut recalled = recall_memories(&store.get().memories, &query, limit);
    if !recalled.is_empty() {
        let ids: Vec<String> = recalled.iter().map(|m| m.id.clone()).collect();
        let now = now_millis();
        store.update(|records| {
            for m in records.memories.iter_mut() {
                if ids.contains(&m.id) {
                    m.last_recalled_at = Some(now);
                }
            }
        })?;
        for m in recalled.iter_mut() {
            m.last_recalled_at = Some(now);
        }
    }
    Ok(MemoryRecallResponse {
        ok: true,
        memories: recalled,
    })
}
