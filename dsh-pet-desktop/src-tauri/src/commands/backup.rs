//! 原生备份文件选择与读写。
//!
//! 备份内容仍由前端组装（其中包括 WebView localStorage），但文件选择和磁盘 I/O
//! 由系统原生对话框完成，避免 WebView 下载/上传行为在桌面端不一致。

use std::fs;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

const BACKUP_MAX_BYTES: usize = 5 * 1024 * 1024;
const PNG_MAX_BYTES: usize = 12 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSaveRequest {
    pub content: String,
    pub suggested_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSaveResult {
    pub cancelled: bool,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOpenResult {
    pub cancelled: bool,
    pub name: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PngSaveRequest {
    pub data_url: String,
    pub suggested_name: String,
}

#[tauri::command]
pub async fn backup_save(req: BackupSaveRequest) -> Result<BackupSaveResult, String> {
    // 阻塞的 rfd 对话框 + 磁盘 IO 移到后台线程，避免卡住 Tauri 主线程/事件循环。
    tauri::async_runtime::spawn_blocking(move || {
        if req.content.len() > BACKUP_MAX_BYTES {
            return Err("备份内容超过 5MB，已取消写入".to_string());
        }
        let suggested_name = req.suggested_name.trim();
        let path = rfd::FileDialog::new()
            .add_filter("桌宠备份", &["json"])
            .set_file_name(if suggested_name.is_empty() {
                "dsh-pet-backup.json"
            } else {
                suggested_name
            })
            .save_file();
        let Some(path) = path else {
            return Ok(BackupSaveResult {
                cancelled: true,
                path: String::new(),
            });
        };
        fs::write(&path, req.content).map_err(|e| format!("写入备份失败：{e}"))?;
        Ok(BackupSaveResult {
            cancelled: false,
            path: path.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|e| format!("后台任务失败：{e}"))?
}

#[tauri::command]
pub async fn backup_open() -> Result<BackupOpenResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = rfd::FileDialog::new()
            .add_filter("桌宠备份", &["json"])
            .pick_file();
        let Some(path) = path else {
            return Ok(BackupOpenResult {
                cancelled: true,
                name: String::new(),
                content: String::new(),
            });
        };
        let bytes = fs::read(&path).map_err(|e| format!("读取备份失败：{e}"))?;
        if bytes.len() > BACKUP_MAX_BYTES {
            return Err("备份文件超过 5MB，已拒绝读取".to_string());
        }
        let content = String::from_utf8(bytes).map_err(|_| "备份文件不是 UTF-8 JSON".to_string())?;
        Ok(BackupOpenResult {
            cancelled: false,
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default(),
            content,
        })
    })
    .await
    .map_err(|e| format!("后台任务失败：{e}"))?
}

/// 保存前端 Canvas 生成的分享卡 PNG（base64 data URL）。
#[tauri::command]
pub async fn report_export_png(req: PngSaveRequest) -> Result<BackupSaveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let encoded = req
            .data_url
            .strip_prefix("data:image/png;base64,")
            .ok_or_else(|| "分享卡不是 PNG data URL".to_string())?;
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| "分享卡 PNG 解码失败".to_string())?;
        if bytes.is_empty() || bytes.len() > PNG_MAX_BYTES {
            return Err("分享卡图片过大或为空".into());
        }
        let suggested = req.suggested_name.trim();
        let path = rfd::FileDialog::new()
            .add_filter("PNG 图片", &["png"])
            .set_file_name(if suggested.is_empty() {
                "dsh-pet-report.png"
            } else {
                suggested
            })
            .save_file();
        let Some(path) = path else {
            return Ok(BackupSaveResult {
                cancelled: true,
                path: String::new(),
            });
        };
        fs::write(&path, bytes).map_err(|e| format!("写入分享卡失败：{e}"))?;
        Ok(BackupSaveResult {
            cancelled: false,
            path: path.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|e| format!("后台任务失败：{e}"))?
}
