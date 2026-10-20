//! 吃文件 / 回收站：真实文件系统操作。
//!
//! 回收站目录 `~/.dsh-pet-desktop/trash/` + `manifest.json`（映射“新名 → 原路径”），
//! 移植自 Web 版 `index.js` 的 `doEatFile / doTrash / doRestore / doPurge`。
//! 桌面版通过 Tauri 拖放拿到**真实路径**，比 Web 版“按文件名搜索”更可靠。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config::{now_millis, trash_dir, write_atomic, Store};

/// 单次「吃掉」文件的大小上限（512MB）：跨盘移动会退化为 copy，超大文件会卡死并占用双倍磁盘。
const EAT_MAX_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct EatFileRequest {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct FileNameRequest {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct FsResult {
    pub ok: bool,
    pub removed: String,
    pub restored: String,
    pub diag: String,
}

#[derive(Debug, Serialize)]
pub struct TrashListResponse {
    pub ok: bool,
    pub items: Vec<TrashItem>,
}

#[derive(Debug, Serialize)]
pub struct TrashItem {
    pub name: String,
    pub original: String,
}

fn manifest_path() -> PathBuf {
    trash_dir().join("manifest.json")
}

fn load_manifest() -> HashMap<String, String> {
    fs::read_to_string(manifest_path())
        .ok()
        .and_then(|s| serde_json::from_str::<HashMap<String, String>>(&s).ok())
        .unwrap_or_default()
}

fn save_manifest(m: &HashMap<String, String>) -> Result<(), String> {
    fs::create_dir_all(trash_dir()).map_err(|e| format!("创建回收站失败：{e}"))?;
    let json = serde_json::to_string(m).map_err(|e| format!("序列化清单失败：{e}"))?;
    write_atomic(&manifest_path(), json.as_bytes())
}

/// 校验“回收站内的条目名”不含路径分隔/上级目录（防路径穿越）。
fn valid_trash_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && name != "."
        && name != ".."
        && !name.contains("..")
}

/// 移动普通文件。`rename` 在跨磁盘/移动设备时会失败，退化为 copy + delete；
/// 删除源文件失败时会清理副本，保证不会把一次“投喂”变成意外复制。
fn move_file(source: &Path, destination: &Path) -> Result<(), String> {
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            fs::copy(source, destination)
                .map_err(|copy_error| format!("移动失败：{rename_error}；跨磁盘复制也失败：{copy_error}"))?;
            if let Err(remove_error) = fs::remove_file(source) {
                let _ = fs::remove_file(destination);
                return Err(format!("复制后无法移除原文件，已撤销副本：{remove_error}"));
            }
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn eat_file(_state: State<'_, Store>, req: EatFileRequest) -> Result<FsResult, String> {
    let src = PathBuf::from(req.path.trim());
    if !src.is_file() {
        return Ok(FsResult {
            ok: false,
            removed: String::new(),
            restored: String::new(),
            diag: "文件不存在或不是普通文件".into(),
        });
    }

    // 大小护栏：拒绝把超大文件整体搬进回收站（跨盘会 copy，几 GB 会卡死 + 占双倍磁盘）
    let size = src.metadata().map(|m| m.len()).unwrap_or(0);
    if size > EAT_MAX_BYTES {
        return Ok(FsResult {
            ok: false,
            removed: String::new(),
            restored: String::new(),
            diag: format!("文件过大（{}MB），为保护磁盘已拒绝吃掉", size / 1024 / 1024),
        });
    }

    let file_name = src
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let trash_name = format!("{}-{}", now_millis(), file_name);

    fs::create_dir_all(trash_dir()).map_err(|e| format!("创建回收站失败：{e}"))?;
    let dest = trash_dir().join(&trash_name);

    let mut manifest = load_manifest();
    move_file(&src, &dest)?;
    manifest.insert(trash_name.clone(), src.to_string_lossy().to_string());
    if let Err(error) = save_manifest(&manifest) {
        let _ = move_file(&dest, &src);
        return Err(error);
    }

    Ok(FsResult {
        ok: true,
        removed: src.to_string_lossy().to_string(),
        restored: String::new(),
        diag: "ok".into(),
    })
}

#[tauri::command]
pub async fn trash_list(_state: State<'_, Store>) -> Result<TrashListResponse, String> {
    let manifest = load_manifest();
    let mut items: Vec<TrashItem> = manifest
        .into_iter()
        .map(|(name, original)| TrashItem { name, original })
        .collect();
    // 新名带时间戳前缀，降序 = 最新在前
    items.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(TrashListResponse { ok: true, items })
}

#[tauri::command]
pub async fn restore_file(
    _state: State<'_, Store>,
    req: FileNameRequest,
) -> Result<FsResult, String> {
    let name = req.name.trim();
    if !valid_trash_name(name) {
        return Ok(FsResult {
            ok: false,
            removed: String::new(),
            restored: String::new(),
            diag: "无效文件名".into(),
        });
    }
    let mut manifest = load_manifest();
    let Some(original) = manifest.get(name).cloned() else {
        return Ok(FsResult {
            ok: false,
            removed: String::new(),
            restored: String::new(),
            diag: "回收站里没有这个文件".into(),
        });
    };

    let src = trash_dir().join(name);
    let dest = Path::new(&original);
    // 恢复前检查：目标路径已被占用时不覆盖，避免静默覆盖新文件
    if dest.exists() {
        return Ok(FsResult {
            ok: false,
            removed: String::new(),
            restored: original,
            diag: "原路径已被其他文件占用，为避免覆盖已取消恢复".into(),
        });
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    move_file(&src, dest)?;
    manifest.remove(name);
    if let Err(error) = save_manifest(&manifest) {
        let _ = move_file(dest, &src);
        return Err(error);
    }

    Ok(FsResult {
        ok: true,
        removed: String::new(),
        restored: original,
        diag: "ok".into(),
    })
}

#[tauri::command]
pub async fn purge_file(
    _state: State<'_, Store>,
    req: FileNameRequest,
) -> Result<FsResult, String> {
    let name = req.name.trim();
    if !valid_trash_name(name) {
        return Ok(FsResult {
            ok: false,
            removed: String::new(),
            restored: String::new(),
            diag: "无效文件名".into(),
        });
    }
    let mut manifest = load_manifest();
    let Some(original) = manifest.get(name).cloned() else {
        return Ok(FsResult {
            ok: false,
            removed: String::new(),
            restored: String::new(),
            diag: "回收站里没有这个文件".into(),
        });
    };

    manifest.remove(name);
    save_manifest(&manifest)?;
    if let Err(error) = fs::remove_file(trash_dir().join(name)) {
        manifest.insert(name.to_string(), original.clone());
        let _ = save_manifest(&manifest);
        return Err(format!("删除失败：{error}"));
    }

    Ok(FsResult {
        ok: true,
        removed: String::new(),
        restored: original,
        diag: "ok".into(),
    })
}
