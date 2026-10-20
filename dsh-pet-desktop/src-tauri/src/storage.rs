//! 统一的“记忆与记录”持久化存储。
//!
//! 桌面版把 Web 版分散的「长期记忆(host 文件) + 心情日记(localStorage) + 聊天记录(localStorage)」
//! 合并到单文件 `~/.dsh-pet-desktop/records.json`，**原子写入**（tmp + rename），并由 Rust 侧
//! `tauri::State` 管理，命令间读写不竞态。
//!
//! 高频交互状态（宠物位置/缩放/好感度/毒舌/性格/成就计数/今日统计/标记）仍留在 WebView
//! localStorage（渲染期同步读写），不属于本存储，见前端 `lib/storage.ts`。

use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::config::{app_dir, write_atomic};

pub const MEMORY_MAX: usize = 50;
pub const DIARY_MAX: usize = 30;
pub const CHAT_MAX: usize = 20;
pub const REPORT_MAX: usize = 60;

/// 长期记忆条目（字段名与 Web 版保持一致，前端记忆面板直接复用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub content: String,
    pub category: String,
    pub date: String,
    pub created_at: u64,
    pub reminded_at: Option<u64>,
    /// 重要度（0~3）：deadline/goal 更高，偏好/事件较低；影响主动话题与回忆召回排序。
    #[serde(default)]
    pub importance: u32,
    /// 最近一次被回忆召回的时间戳（chat 相关性召回时打点）。
    #[serde(default)]
    pub last_recalled_at: Option<u64>,
}

/// 心情日记条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiaryEntry {
    pub date: String,
    pub text: String,
}

/// 聊天记录条目（role: user | assistant）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatTurn {
    pub role: String,
    pub text: String,
}

/// 每日陪伴报告（结构化字段 + 一段自然语言总结）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyReport {
    pub date: String,
    #[serde(default)]
    pub companion_secs: u64,
    #[serde(default)]
    pub stats: serde_json::Value,
    #[serde(default)]
    pub chat_summary: String,
    #[serde(default)]
    pub done_summary: String,
    #[serde(default)]
    pub tomorrow: String,
    #[serde(default)]
    pub mood: String,
    #[serde(default)]
    pub generated_at: u64,
}

/// 记录集：记忆 + 日记 + 聊天，三者同属“记忆块”，统一持久化。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Records {
    pub memories: Vec<Memory>,
    pub diary: Vec<DiaryEntry>,
    pub chat: Vec<ChatTurn>,
    #[serde(default)]
    pub reports: Vec<DailyReport>,
}

pub fn records_path() -> PathBuf {
    app_dir().join("records.json")
}

/// 记录存储：`tauri::State` 管理的共享状态（`RwLock` 包裹）。
pub struct RecordsStore {
    records: RwLock<Records>,
}

impl RecordsStore {
    pub fn load() -> Self {
        let path = records_path();
        let records = match fs::read_to_string(&path) {
            Ok(s) => match serde_json::from_str::<Records>(&s) {
                Ok(r) => r,
                Err(_) => {
                    // 解析失败：把损坏文件移到 .corrupt 保留现场，避免静默清空用户数据
                    let bad = path.with_extension("json.corrupt");
                    let _ = fs::rename(&path, &bad);
                    Records::default()
                }
            },
            Err(_) => Records::default(),
        };
        Self {
            records: RwLock::new(records),
        }
    }

    pub fn get(&self) -> Records {
        self.records.read().expect("records lock poisoned").clone()
    }

    /// 应用一次修改并持久化，返回修改后的记录集。
    pub fn update(&self, f: impl FnOnce(&mut Records)) -> Result<Records, String> {
        // 全程持有写锁，保证「读-改-写」原子，避免并发命令互相覆盖丢数据。
        let mut guard = self.records.write().expect("records lock poisoned");
        let mut records = guard.clone();
        f(&mut records);
        self.persist(&records)?;
        *guard = records.clone();
        Ok(records)
    }

    fn persist(&self, records: &Records) -> Result<(), String> {
        let json = serde_json::to_string(records).map_err(|e| format!("序列化失败：{e}"))?;
        write_atomic(&records_path(), json.as_bytes())
    }
}
