//! 资源平台桥接：探测平台、解析动画到本地缓存、预取与清空缓存。
//!
//! 目标（M2 + 热加载）：桌宠不再只读内置资源，而是：
//! 1. `assets_check`  —— 探测平台在线 + 拉取 manifest（含分类），前端据此动态构建动画池；
//! 2. `assets_resolve` —— 把动画名解析为本地可播放路径：缓存命中 → 平台下载 → 内置兜底；
//! 3. `assets_prefetch` —— 后台把 manifest 全部资源预取到缓存（首播不卡）；
//! 4. `assets_clear_cache` —— 清空缓存。

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config::{app_dir, write_atomic, Config, Store};
use crate::http;
use crate::net;

const BUILTIN_FALLBACK_ANIM: &str = "待机呼吸休闲";

/// 资源清单中的一条（与平台 `/api/manifest` 对齐）。
#[derive(Debug, Clone, Serialize)]
pub struct AssetsItem {
    pub file: String,
    pub name: String,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AssetsCheck {
    pub online: bool,
    pub version: Option<String>,
    pub items: Vec<AssetsItem>,
    pub diag: String,
}

/// `assets_resolve` 的返回值：`builtin=true` 时 `path` 是内置相对路径（前端直接 src）；
/// `builtin=false` 时 `path` 是缓存绝对路径（前端用 `convertFileSrc` 转 asset URL）。
#[derive(Debug, Serialize)]
pub struct AssetsResolve {
    pub path: String,
    pub builtin: bool,
}

#[derive(Deserialize)]
struct ManifestRaw {
    version: Option<String>,
    items: Option<Vec<ManifestItemRaw>>,
}

#[derive(Deserialize)]
struct ManifestItemRaw {
    file: Option<String>,
    name: Option<String>,
    category: Option<String>,
    sha256: Option<String>,
}

struct ManifestCache {
    base: String,
    fetched_at: Instant,
    items: Vec<AssetsItem>,
}

static MANIFEST_CACHE: OnceLock<Mutex<Option<ManifestCache>>> = OnceLock::new();

fn cache_slot() -> &'static Mutex<Option<ManifestCache>> {
    MANIFEST_CACHE.get_or_init(|| Mutex::new(None))
}

fn assets_base(cfg: &Config) -> Result<String, String> {
    net::normalize_http_base(&cfg.assets_url)
}

fn fallback_resolve() -> AssetsResolve {
    AssetsResolve {
        path: format!("/assets/videos/{}.webm", encode_uri_component(BUILTIN_FALLBACK_ANIM)),
        builtin: true,
    }
}

/// 资源缓存目录：`~/.dsh-pet-desktop/cache/assets/videos/`
pub fn cache_videos_dir() -> PathBuf {
    app_dir().join("cache").join("assets").join("videos")
}

/// 等价于 JS `encodeURIComponent`：保留 unreserved 字符，其余按 UTF-8 字节 `%XX` 编码。
fn encode_uri_component(s: &str) -> String {
    const KEEP: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()";
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        if KEEP.contains(&b) {
            out.push(b as char);
        } else {
            out.push('%');
            out.push_str(&format!("{b:02X}"));
        }
    }
    out
}

/// 校验动画名并拼出文件名（`{name}.webm`），拒绝路径穿越。
fn safe_file_name(name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.chars().any(|c| c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return None;
    }
    Some(format!("{name}.webm"))
}

fn safe_manifest_file(file: &str) -> Option<String> {
    let name = file.trim();
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.chars().any(|c| c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return None;
    }
    if !name.to_ascii_lowercase().ends_with(".webm") {
        return None;
    }
    Some(name.to_string())
}

async fn fetch_manifest(cfg: &Config) -> Result<(String, Vec<AssetsItem>), String> {
    let base = assets_base(cfg)?;
    let url = net::join_api(&base, "/api/manifest");
    let resp = http::client().get(&url).send().await.map_err(|e| format!("{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let raw = resp.json::<ManifestRaw>().await.map_err(|e| format!("解析失败：{e}"))?;
    let items: Vec<AssetsItem> = raw
        .items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| {
            let file = safe_manifest_file(i.file.as_deref().unwrap_or_default())?;
            let name = i
                .name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| file.trim_end_matches(".webm").to_string());
            let category = i
                .category
                .as_deref()
                .unwrap_or("act")
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                .take(24)
                .collect::<String>();
            Some(AssetsItem {
                file,
                name,
                category: if category.is_empty() { "act".into() } else { category },
                sha256: i.sha256.filter(|s| {
                    s.len() >= 16 && s.len() <= 128 && s.chars().all(|c| c.is_ascii_hexdigit())
                }),
            })
        })
        .collect();
    *cache_slot().lock().expect("manifest cache poisoned") = Some(ManifestCache {
        base,
        fetched_at: Instant::now(),
        items: items.clone(),
    });
    Ok((raw.version.unwrap_or_default(), items))
}

/// 使用短时缓存读取 manifest；资源解析失败时由调用方回退内置 idle。
async fn ensure_manifest(cfg: &Config) -> Result<(String, Vec<AssetsItem>), String> {
    let base = assets_base(cfg)?;
    if let Some(cache) = cache_slot().lock().expect("manifest cache poisoned").as_ref() {
        if cache.base == base && cache.fetched_at.elapsed() < Duration::from_secs(60) {
            return Ok((String::new(), cache.items.clone()));
        }
    }
    fetch_manifest(cfg).await
}

fn versioned_asset_url(base: &str, file: &str, sha256: Option<&str>) -> String {
    let base_url = format!(
        "{}/assets/videos/{}",
        base.trim_end_matches('/'),
        encode_uri_component(file)
    );
    match sha256.filter(|s| !s.is_empty()) {
        Some(sha) => format!("{base_url}?v={}", encode_uri_component(sha)),
        None => base_url,
    }
}

async fn download(cfg: &Config, file: &str) -> Result<PathBuf, String> {
    let file = safe_manifest_file(file).ok_or_else(|| "非法资源文件名".to_string())?;
    let base = assets_base(cfg)?;
    let url = versioned_asset_url(&base, &file, None);
    let resp = http::client().get(&url).send().await.map_err(|e| format!("{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("读取失败：{e}"))?;
    let dir = cache_videos_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败：{e}"))?;
    let dest = dir.join(&file);
    write_atomic(&dest, bytes.as_ref())?;
    Ok(dest)
}

/// 解析动画名到可直接赋给 `<video src>` 的 URL。
/// 内置动画走内置相对路径；非内置动画直接返回平台 HTTP URL（标准跨域视频播放，
/// 绕过 asset 协议 / 缓存 / Blob 在 WebView2 视频元素上的兼容问题）。
#[tauri::command]
pub async fn assets_resolve(state: State<'_, Store>, name: String) -> Result<AssetsResolve, String> {
    let cfg = state.get();
    let Some(_file) = safe_file_name(&name) else {
        return Ok(fallback_resolve());
    };
    if !cfg.assets_enabled {
        return Ok(fallback_resolve());
    }
    // 不在当前 manifest 里的动作（离线、旧缓存、拼写错误）一律回退内置 idle，
    // 绝不拼一个可能 404 的远端 URL。
    let (_, items) = match ensure_manifest(&cfg).await {
        Ok(v) => v,
        Err(_) => return Ok(fallback_resolve()),
    };
    let item = items.iter().find(|i| {
        i.name == name || i.file.eq_ignore_ascii_case(&format!("{name}.webm"))
    });
    let Some(item) = item else {
        return Ok(fallback_resolve());
    };
    let base = match assets_base(&cfg) {
        Ok(v) => v,
        Err(_) => return Ok(fallback_resolve()),
    };
    Ok(AssetsResolve {
        path: versioned_asset_url(&base, &item.file, item.sha256.as_deref()),
        builtin: false,
    })
}

/// 探测平台在线并拉取 manifest（含分类），供前端动态构建动画池。
#[tauri::command]
pub async fn assets_check(state: State<'_, Store>) -> Result<AssetsCheck, String> {
    let cfg = state.get();
    if !cfg.assets_enabled {
        return Ok(AssetsCheck {
            online: false,
            version: None,
            items: Vec::new(),
            diag: "disabled".into(),
        });
    }
    match fetch_manifest(&cfg).await {
        Ok((version, items)) => Ok(AssetsCheck {
            online: true,
            version: Some(version),
            items,
            diag: "ok".into(),
        }),
        Err(e) => Ok(AssetsCheck {
            online: false,
            version: None,
            items: Vec::new(),
            diag: e,
        }),
    }
}

/// 后台预取 manifest 全部资源到缓存，返回成功缓存的数量。
#[tauri::command]
pub async fn assets_prefetch(state: State<'_, Store>) -> Result<usize, String> {
    let cfg = state.get();
    if !cfg.assets_enabled {
        return Err("资源平台未启用".into());
    }
    let (_, items) = fetch_manifest(&cfg).await?;
    let mut ok = 0usize;
    for item in items {
        let cached = cache_videos_dir().join(&item.file);
        if cached.is_file() {
            ok += 1;
            continue;
        }
        if download(&cfg, &item.file).await.is_ok() {
            ok += 1;
        }
    }
    Ok(ok)
}

/// 清空本地资源缓存。
#[tauri::command]
pub fn assets_clear_cache() -> Result<(), String> {
    let dir = cache_videos_dir();
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("清空缓存失败：{e}"))?;
    }
    Ok(())
}
