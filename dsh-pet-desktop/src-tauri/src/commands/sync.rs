//! 多设备记忆同步：桌面端只上传/下载密文，密钥由前端根据同步码派生。

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config::Store;
use crate::http;
use crate::net;

const MAX_PAYLOAD: usize = 1_500_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncUploadRequest {
    pub code: String,
    pub payload: String,
    pub updated_at: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDownloadResult {
    pub found: bool,
    pub payload: String,
    pub updated_at: u64,
}

fn validate_code(code: &str) -> Result<String, String> {
    let code = code.trim().to_string();
    if code.chars().count() < 16 || code.chars().count() > 512 {
        return Err("同步码长度需在 16~512 个字符之间".into());
    }
    Ok(code)
}

fn base(state: &State<'_, Store>) -> Result<String, String> {
    net::normalize_http_base(&state.get().assets_url)
}

#[tauri::command]
pub async fn sync_upload(
    state: State<'_, Store>,
    req: SyncUploadRequest,
) -> Result<u64, String> {
    let code = validate_code(&req.code)?;
    if req.payload.is_empty() || req.payload.len() > MAX_PAYLOAD {
        return Err("同步数据为空或超过 1.5MB".into());
    }
    let url = net::join_api(&base(&state)?, "/api/pet/sync");
    let updated_at = req.updated_at.unwrap_or_else(crate::config::now_millis);
    let body = serde_json::json!({
        "code": code,
        "payload": req.payload,
        "updatedAt": updated_at,
    });
    let resp = http::client()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("同步上传失败：{e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("同步上传失败：HTTP {status} {}", http::truncate(&text, 200)));
    }
    Ok(updated_at)
}

#[tauri::command]
pub async fn sync_download(
    state: State<'_, Store>,
    code: String,
) -> Result<SyncDownloadResult, String> {
    let code = validate_code(&code)?;
    let url = net::join_api(&base(&state)?, "/api/pet/sync");
    let resp = http::client()
        .get(&url)
        .header("X-Sync-Code", code)
        .send()
        .await
        .map_err(|e| format!("同步下载失败：{e}"))?;
    if resp.status().as_u16() == 404 {
        return Ok(SyncDownloadResult {
            found: false,
            payload: String::new(),
            updated_at: 0,
        });
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("同步下载失败：HTTP {status} {}", http::truncate(&text, 200)));
    }
    let raw: serde_json::Value = resp.json().await.map_err(|e| format!("同步响应无效：{e}"))?;
    Ok(SyncDownloadResult {
        found: true,
        payload: raw.get("payload").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        updated_at: raw.get("updatedAt").and_then(|v| v.as_u64()).unwrap_or(0),
    })
}

