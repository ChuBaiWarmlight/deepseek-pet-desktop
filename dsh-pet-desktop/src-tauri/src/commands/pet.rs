//! 桌宠遥控：轮询平台下发的命令并回执。
//!
//! 桌宠每 N 秒 `pet_poll` 拉取待执行命令（`/api/pet/poll`），执行后 `pet_done` 回执。
//! 平台离线 / 未启用时静默返回空，不打断桌宠正常动画链。

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::config::{resolve_model, Config, Store};
use crate::http;
use crate::net;

#[derive(Debug, Serialize, Deserialize)]
pub struct PetCommand {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct PollRaw {
    commands: Option<Vec<PetCommand>>,
}

/// 心跳上报的宠物状态负载（前端 30s 调一次，Rust 补充 device_id 与版本）。
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatPayload {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub affinity: f64,
    #[serde(default)]
    pub sass: f64,
    #[serde(default)]
    pub personality: f64,
    #[serde(default)]
    pub mood: String,
    #[serde(default)]
    pub dsh_online: bool,
    #[serde(default)]
    pub today: serde_json::Value,
    #[serde(default)]
    pub scene: String,
    #[serde(default)]
    pub stage: String,
    #[serde(default)]
    pub companion_secs: u64,
}

fn assets_base(cfg: &Config) -> Result<String, String> {
    net::normalize_http_base(&cfg.assets_url)
}

/// 设备配对令牌头（M-05）：未配对（token 为空）时不附带，平台会对 poll/done 拒绝。
fn device_token_header(cfg: &Config) -> Option<(&'static str, String)> {
    let token = cfg.device_token.trim();
    if token.is_empty() {
        None
    } else {
        Some(("X-Device-Token", token.to_string()))
    }
}

/// 轮询平台待执行命令；任何失败都返回空列表（静默降级，不抛错）。
#[tauri::command]
pub async fn pet_poll(state: State<'_, Store>) -> Result<Vec<PetCommand>, String> {
    let cfg = state.get();
    if !cfg.assets_enabled {
        return Ok(Vec::new());
    }
    let Ok(base) = assets_base(&cfg) else {
        return Ok(Vec::new());
    };
    let url = net::join_api(&base, "/api/pet/poll");
    let mut req = http::client().get(&url);
    if let Some((k, v)) = device_token_header(&cfg) {
        req = req.header(k, v);
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };
    if !resp.status().is_success() {
        return Ok(Vec::new());
    }
    match resp.json::<PollRaw>().await {
        Ok(raw) => Ok(raw.commands.unwrap_or_default()),
        Err(_) => Ok(Vec::new()),
    }
}

/// 回执命令已完成。
#[tauri::command]
pub async fn pet_done(state: State<'_, Store>, id: i64) -> Result<bool, String> {
    let cfg = state.get();
    let Ok(base) = assets_base(&cfg) else {
        return Ok(false);
    };
    let url = net::join_api(&base, &format!("/api/pet/commands/{id}/done"));
    let mut req = http::client().post(&url);
    if let Some((k, v)) = device_token_header(&cfg) {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| format!("{e}"))?;
    Ok(resp.status().is_success())
}

/// 上报桌宠心跳/状态到平台（静默，失败不影响桌宠运行）。
#[tauri::command]
pub async fn pet_heartbeat(
    app: AppHandle,
    state: State<'_, Store>,
    payload: HeartbeatPayload,
) -> Result<(), String> {
    let mut cfg = state.get();
    if !cfg.assets_enabled {
        return Ok(());
    }
    // 首次运行生成并持久化设备 id；已有 id 时不写盘，避免 30s 心跳反复重写配置。
    if cfg.device_id.trim().is_empty() {
        cfg = state.update_ret(|c| {
            if c.device_id.trim().is_empty() {
                c.device_id = crate::config::generate_device_id();
            }
            Ok(c.clone())
        })?;
    }
    let device_id = cfg.device_id.clone();
    let version = app.package_info().version.to_string();
    let (_, _, model) = resolve_model(&cfg, "chat");
    let body = serde_json::json!({
        "deviceId": device_id,
        "name": payload.name,
        "version": version,
        "affinity": payload.affinity,
        "sass": payload.sass,
        "personality": payload.personality,
        "mood": payload.mood,
        // 平台展示的必须是实际路由到的模型，不能由前端传空串覆盖。
        "model": model,
        "dshOnline": payload.dsh_online,
        "today": payload.today,
        "scene": payload.scene,
        "stage": payload.stage,
        "companionSecs": payload.companion_secs,
    });
    let Ok(base) = assets_base(&cfg) else {
        return Ok(());
    };
    let url = net::join_api(&base, "/api/pet/heartbeat");
    let mut req = http::client().post(&url);
    if let Some((k, v)) = device_token_header(&cfg) {
        req = req.header(k, v);
    }
    let _ = req.json(&body).send().await;
    Ok(())
}
