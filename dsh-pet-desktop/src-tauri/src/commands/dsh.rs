//! DSH 桥接：探测在线状态、采集主人最近对话 / SSH / 任务感知。
//!
//! 仅当本机 DSH（默认 `http://127.0.0.1:3080`）在线时才启用这些特色功能。
//!
//! 已知缺口（需在 dsh-pet 插件侧补只读端点，见 DESIGN.md §7.3）：
//! - G1 任务看板：`dsh_taskboard` 目前返回“不可用”；
//! - G2 最近对话：`dsh_context` / `memory_work` 依赖 `/dsh-pet/api/context`。

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config::{Config, Store};
use crate::http;
use crate::net;

#[derive(Debug, Serialize)]
pub struct DshCheck {
    pub online: bool,
    pub event: Option<String>,
    pub ssh: Option<String>,
    pub busy: bool,
    pub diag: String,
}

#[derive(Debug, Serialize)]
pub struct DshContext {
    pub online: bool,
    pub lines: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DshTaskboard {
    pub online: bool,
    pub event: Option<TaskEvent>,
    pub diag: String,
}

#[derive(Debug, Serialize)]
pub struct TaskEvent {
    pub kind: String,
    pub title: String,
}

#[derive(Deserialize)]
struct CheckRaw {
    event: Option<String>,
    ssh: Option<String>,
    busy: Option<bool>,
}

#[derive(Deserialize)]
struct ContextRaw {
    lines: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct TaskboardRaw {
    online: Option<bool>,
    event: Option<TaskEventRaw>,
}

#[derive(Deserialize)]
struct TaskEventRaw {
    kind: Option<String>,
    title: Option<String>,
}

fn dsh_base(cfg: &Config) -> Result<String, String> {
    net::normalize_http_base(&cfg.dsh_url)
}

/// 探测 DSH 在线状态 + 最新活动（事件/SSH/忙碌）。移植 index.js `doCheck` 的返回语义。
/// 连续轮询 3 次（间隔 600ms）：1 次成功即在线，3 次都失败才判定离线，避免单次抖动误判。
pub async fn check(cfg: &Config) -> DshCheck {
    let mut last = DshCheck {
        online: false,
        event: None,
        ssh: None,
        busy: false,
        diag: String::new(),
    };
    for attempt in 0..3 {
        let result = check_once(cfg).await;
        if result.online {
            return result;
        }
        last = result;
        if attempt < 2 {
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        }
    }
    last
}

async fn check_once(cfg: &Config) -> DshCheck {
    let Ok(base) = dsh_base(cfg) else {
        return DshCheck { online: false, event: None, ssh: None, busy: false, diag: "invalid dsh url".into() };
    };
    let url = net::join_api(&base, "/dsh-pet/api/check");
    let resp = match http::client().get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            return DshCheck {
                online: false,
                event: None,
                ssh: None,
                busy: false,
                diag: format!("{e}"),
            }
        }
    };
    if !resp.status().is_success() {
        return DshCheck {
            online: false,
            event: None,
            ssh: None,
            busy: false,
            diag: format!("HTTP {}", resp.status()),
        };
    }
    match resp.json::<CheckRaw>().await {
        Ok(raw) => DshCheck {
            online: true,
            event: raw.event.filter(|s| !s.is_empty()),
            ssh: raw.ssh.filter(|s| !s.is_empty()),
            busy: raw.busy.unwrap_or(false),
            diag: "ok".into(),
        },
        Err(e) => DshCheck {
            online: false,
            event: None,
            ssh: None,
            busy: false,
            diag: format!("解析失败：{e}"),
        },
    }
}

/// 采集主人最近对话（缺口 G2：依赖 DSH 的 `/dsh-pet/api/context`）。不可用返回 `None`。
pub async fn fetch_context_lines(cfg: &Config) -> Option<Vec<String>> {
    let base = dsh_base(cfg).ok()?;
    let url = net::join_api(&base, "/dsh-pet/api/context");
    let resp = http::client().get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let raw = resp.json::<ContextRaw>().await.ok()?;
    raw.lines.filter(|l| !l.is_empty())
}

#[tauri::command]
pub async fn dsh_check(state: State<'_, Store>) -> Result<DshCheck, String> {
    let cfg = state.get();
    Ok(check(&cfg).await)
}

#[tauri::command]
pub async fn dsh_context(state: State<'_, Store>) -> Result<DshContext, String> {
    let cfg = state.get();
    match fetch_context_lines(&cfg).await {
        Some(lines) => Ok(DshContext { online: true, lines }),
        None => Ok(DshContext {
            online: false,
            lines: Vec::new(),
        }),
    }
}

#[tauri::command]
pub async fn dsh_taskboard(state: State<'_, Store>) -> Result<DshTaskboard, String> {
    let cfg = state.get();
    let Ok(base) = dsh_base(&cfg) else {
        return Ok(DshTaskboard { online: false, event: None, diag: "invalid dsh url".into() });
    };
    let url = net::join_api(&base, "/dsh-task-board/api/taskboard");
    let offline = |diag: String| DshTaskboard {
        online: false,
        event: None,
        diag,
    };
    let resp = match http::client().get(&url).send().await {
        Ok(r) => r,
        Err(e) => return Ok(offline(format!("{e}"))),
    };
    if !resp.status().is_success() {
        return Ok(offline(format!("HTTP {}", resp.status())));
    }
    match resp.json::<TaskboardRaw>().await {
        Ok(raw) => {
            let event = raw.event.and_then(|e| {
                let kind = e.kind.unwrap_or_default();
                if kind.is_empty() {
                    return None;
                }
                Some(TaskEvent {
                    kind,
                    title: e.title.unwrap_or_default(),
                })
            });
            Ok(DshTaskboard {
                online: raw.online.unwrap_or(false),
                event,
                diag: "ok".into(),
            })
        }
        Err(e) => Ok(offline(format!("解析失败：{e}"))),
    }
}
