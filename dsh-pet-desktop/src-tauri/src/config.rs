//! 应用配置：读写 `~/.dsh-pet-desktop/config.json`，并提供统一的应用数据目录。
//!
//! 目录约定（统一使用用户主目录，与 Web 版 `~/.dsh/dsh-pet/` 保持一致）：
//! - `~/.dsh-pet-desktop/config.json`  —— AI 配置（API Key 存 Windows Credential Manager）
//! - `~/.dsh-pet-desktop/records.json` —— 记忆/日记/聊天（见 `storage.rs`）
//! - `~/.dsh-pet-desktop/trash/`      —— 被“吃掉”的文件回收站

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tauri::State;

use crate::credentials;
use crate::net;

/// 配置结构版本。递增时必须在 `migrate_config` 中补兼容逻辑。
pub const CONFIG_SCHEMA_VERSION: u32 = 2;

/// 应用数据目录：`~/.dsh-pet-desktop/`
pub fn app_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".dsh-pet-desktop")
}

pub fn config_path() -> PathBuf {
    app_dir().join("config.json")
}

pub fn trash_dir() -> PathBuf {
    app_dir().join("trash")
}

/// 当前毫秒时间戳（记忆 id / createdAt 用，与 Web 版 `Date.now()` 对齐）
pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 生成设备唯一标识（首次运行生成并持久化，之后保持不变）。
pub fn generate_device_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    format!("pet-{nanos:x}-{pid:x}")
}

/// 原子写文件：先写唯一临时文件并 `sync_all`，再 `rename` 原子覆盖。
/// Windows 下 Rust `fs::rename` 已带 `MOVEFILE_REPLACE_EXISTING`，无需「先删后改」这类危险回退。
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("data");
    let tmp = path.with_file_name(format!(".{file_name}.{}.tmp", now_millis()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("写入临时文件失败：{e}"))?;
        f.write_all(data).map_err(|e| format!("写入临时文件失败：{e}"))?;
        f.sync_all().map_err(|e| format!("同步临时文件失败：{e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("原子重命名失败：{e}")
    })
}

fn default_base_url() -> String {
    "https://api.deepseek.com".into()
}

fn default_model() -> String {
    "deepseek-chat".into()
}

fn default_dsh_url() -> String {
    "http://127.0.0.1:3080".into()
}

fn default_assets_url() -> String {
    "http://127.0.0.1:8787".into()
}

fn default_assets_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// 配置结构版本（0/缺失 = 旧版）。
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default = "default_base_url")]
    #[serde(alias = "baseUrl")]
    pub base_url: String,
    /// 旧版明文密钥仅用于迁移；内存中供调用使用，永不序列化回磁盘。
    #[serde(default, skip_serializing)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_dsh_url")]
    #[serde(alias = "dshUrl")]
    pub dsh_url: String,
    #[serde(default)]
    #[serde(alias = "autoStart")]
    pub auto_start: bool,
    #[serde(default)]
    pub sound: bool,
    #[serde(default = "default_assets_url")]
    #[serde(alias = "assetsUrl")]
    pub assets_url: String,
    #[serde(default = "default_assets_enabled")]
    #[serde(alias = "assetsEnabled")]
    pub assets_enabled: bool,
    /// 自定义模型列表（每项含独立 base_url/api_key/model）
    #[serde(default)]
    pub models: Vec<ModelProfile>,
    /// say 短句用的模型 id（None = 回退 chat 模型/主模型）
    #[serde(default)]
    #[serde(alias = "sayModelId")]
    pub say_model_id: Option<String>,
    /// 聊天/日记/复盘用的模型 id（None = 用主模型 base_url/api_key/model）
    #[serde(default)]
    #[serde(alias = "chatModelId")]
    pub chat_model_id: Option<String>,
    /// 一次性位置重置标记：true 时前端启动即把宠物归位到右下角并清除本标记。
    #[serde(default)]
    #[serde(alias = "posReset")]
    pub pos_reset: bool,
    /// 设备唯一标识（首次运行时生成并持久化，用于平台遥测区分设备）。
    #[serde(default)]
    #[serde(alias = "deviceId")]
    pub device_id: String,
    /// 设备配对令牌（M-05）：平台「配对」生成，桌宠在 poll/done 时经 X-Device-Token 头回传。
    #[serde(default, skip_serializing)]
    #[serde(alias = "deviceToken")]
    pub device_token: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            base_url: default_base_url(),
            api_key: String::new(),
            model: default_model(),
            dsh_url: default_dsh_url(),
            auto_start: false,
            sound: false,
            assets_url: default_assets_url(),
            assets_enabled: default_assets_enabled(),
            models: Vec::new(),
            say_model_id: None,
            chat_model_id: None,
            pos_reset: false,
            device_id: String::new(),
            device_token: String::new(),
        }
    }
}

/// 供前端展示的配置视图：api_key 只回掩码，绝不把明文送回前端。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    pub base_url: String,
    pub has_api_key: bool,
    pub api_key_masked: String,
    pub model: String,
    pub dsh_url: String,
    pub auto_start: bool,
    pub sound: bool,
    pub assets_url: String,
    pub assets_enabled: bool,
    pub models: Vec<ModelProfileView>,
    pub say_model_id: Option<String>,
    pub chat_model_id: Option<String>,
}

impl From<&Config> for ConfigView {
    fn from(cfg: &Config) -> Self {
        let key = cfg.api_key.trim();
        let masked = mask_key(key);
        Self {
            base_url: cfg.base_url.clone(),
            has_api_key: !key.is_empty(),
            api_key_masked: masked,
            model: cfg.model.clone(),
            dsh_url: cfg.dsh_url.clone(),
            auto_start: cfg.auto_start,
            sound: cfg.sound,
            assets_url: cfg.assets_url.clone(),
            assets_enabled: cfg.assets_enabled,
            models: cfg.models.iter().map(ModelProfileView::from).collect(),
            say_model_id: cfg.say_model_id.clone(),
            chat_model_id: cfg.chat_model_id.clone(),
        }
    }
}

/// 掩码显示：保留前 3 位与后 4 位（如 `sk-***abcd`），短 key 全掩。
fn mask_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 8 {
        return "••••••••".to_string();
    }
    let head: String = chars.iter().take(3).collect();
    let tail: String = chars.iter().skip(chars.len() - 4).collect();
    format!("{head}***{tail}")
}

/// 一个可配置的模型（独立 base_url/api_key/model）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfile {
    pub id: String,
    pub label: String,
    #[serde(alias = "baseUrl")]
    pub base_url: String,
    #[serde(default, skip_serializing)]
    pub api_key: String,
    pub model: String,
}

/// 供前端展示的模型视图：api_key 只回掩码。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfileView {
    pub id: String,
    pub label: String,
    pub base_url: String,
    pub has_api_key: bool,
    pub api_key_masked: String,
    pub model: String,
}

impl From<&ModelProfile> for ModelProfileView {
    fn from(p: &ModelProfile) -> Self {
        let key = p.api_key.trim();
        Self {
            id: p.id.clone(),
            label: p.label.clone(),
            base_url: p.base_url.clone(),
            has_api_key: !key.is_empty(),
            api_key_masked: mask_key(key),
            model: p.model.clone(),
        }
    }
}

/// 新增/编辑模型（api_key 为空 = 不修改，编辑时保留原 key）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfileInput {
    pub id: Option<String>,
    pub label: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
}

/// 设置 say/chat 模型路由（空字符串或 null = 清空该路由）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRouteInput {
    pub say_model_id: Option<String>,
    pub chat_model_id: Option<String>,
}

fn normalize_id(s: Option<&str>) -> Option<String> {
    s.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// 按任务解析实际使用的模型：`say` → 短句模型（回退 chat/主模型），其余 → 聊天模型（回退主模型）。
/// 返回 trim 后的 `(base_url, api_key, model)`。
pub fn resolve_model(cfg: &Config, task: &str) -> (String, String, String) {
    let id = if task == "say" {
        cfg.say_model_id.as_deref().or(cfg.chat_model_id.as_deref())
    } else {
        cfg.chat_model_id.as_deref()
    };
    if let Some(id) = id {
        if let Some(p) = cfg.models.iter().find(|m| m.id == id) {
            let base_url = p.base_url.trim();
            let model = p.model.trim();
            // 只有 base_url 与 model 都完整才采用该路由模型；否则回退主模型，
            // 避免路由指向一个半成品配置（缺 base_url/api_key）导致「连接不到模型」。
            if !base_url.is_empty() && !model.is_empty() {
                if let Ok(clean) = net::normalize_http_base(base_url) {
                    return (clean, p.api_key.trim().to_string(), model.to_string());
                }
            }
        }
    }
    (
        net::normalize_http_base_or(&cfg.base_url, &default_base_url()),
        cfg.api_key.trim().to_string(),
        cfg.model.trim().to_string(),
    )
}

/// 可被前端提交的配置更新（api_key 为空 = 不修改）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigUpdate {
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub dsh_url: Option<String>,
    pub auto_start: Option<bool>,
    pub sound: Option<bool>,
    pub assets_url: Option<String>,
    pub assets_enabled: Option<bool>,
}

/// 配置存储：`tauri::State` 管理的共享状态（`RwLock` 包裹，读写线程安全）。
pub struct Store {
    cfg: RwLock<Config>,
}

impl Store {
    pub fn load() -> Self {
        let path = config_path();
        let mut cfg = match fs::read_to_string(&path) {
            Ok(s) => match serde_json::from_str::<Config>(&s) {
                Ok(c) => c,
                Err(_) => {
                    // 解析失败：把损坏文件移到 .corrupt 保留现场，避免静默重置配置（含 API Key）
                    let bad = path.with_extension("json.corrupt");
                    let _ = fs::rename(&path, &bad);
                    Config::default()
                }
            },
            Err(_) => Config::default(),
        };
        let mut dirty = migrate_config(&mut cfg);
        match hydrate_secrets(&mut cfg) {
            Ok(changed) => dirty |= changed,
            Err(e) => {
                // 凭据服务异常时仍允许本次运行使用内存中的旧配置，但不落盘覆盖，
                // 避免把尚未迁移的明文密钥直接丢掉。
                crate::window::diag(&format!("credential migrate failed: {e}"));
                dirty = false;
            }
        }
        let store = Self {
            cfg: RwLock::new(cfg),
        };
        if dirty {
            if let Err(e) = store.persist(&store.get()) {
                crate::window::diag(&format!("config migrate persist failed: {e}"));
            }
        }
        store
    }

    pub fn get(&self) -> Config {
        self.cfg
            .read()
            .expect("config lock poisoned")
            .clone()
    }

    /// 应用一次修改并持久化到磁盘，返回修改后的配置。
    pub fn update(&self, f: impl FnOnce(&mut Config)) -> Result<Config, String> {
        // 全程持有写锁，保证「读-改-写」原子。
        let mut guard = self.cfg.write().expect("config lock poisoned");
        let mut cfg = guard.clone();
        f(&mut cfg);
        self.persist(&cfg)?;
        *guard = cfg.clone();
        Ok(cfg)
    }

    /// 同 `update`，但闭包可返回一个派生值（如新建/编辑后的模型视图），全程持写锁保证原子。
    pub fn update_ret<T>(&self, f: impl FnOnce(&mut Config) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.cfg.write().expect("config lock poisoned");
        let mut cfg = guard.clone();
        let ret = f(&mut cfg)?;
        self.persist(&cfg)?;
        *guard = cfg;
        Ok(ret)
    }

    fn persist(&self, cfg: &Config) -> Result<(), String> {
        let json = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败：{e}"))?;
        write_atomic(&config_path(), json.as_bytes())
    }
}

/// 把历史配置规范化到当前 schema，并返回是否有字段变化。
fn migrate_config(cfg: &mut Config) -> bool {
    let original = serde_json::to_string(cfg).unwrap_or_default();
    cfg.base_url = net::normalize_http_base_or(&cfg.base_url, &default_base_url());
    cfg.dsh_url = net::normalize_http_base_or(&cfg.dsh_url, &default_dsh_url());
    cfg.assets_url = net::normalize_http_base_or(&cfg.assets_url, &default_assets_url());
    if cfg.model.trim().is_empty() {
        cfg.model = default_model();
    }
    if cfg.device_id.trim().is_empty() {
        cfg.device_id = generate_device_id();
    }
    for p in &mut cfg.models {
        p.base_url = net::normalize_http_base_or(&p.base_url, &default_base_url());
        if p.id.trim().is_empty() {
            p.id = format!("m{}", now_millis());
        }
    }
    // 路由指向不存在的模型时清空，避免升级后一直回退到半成品配置。
    if cfg.say_model_id.as_deref().is_some_and(|id| !cfg.models.iter().any(|m| m.id == id)) {
        cfg.say_model_id = None;
    }
    if cfg.chat_model_id.as_deref().is_some_and(|id| !cfg.models.iter().any(|m| m.id == id)) {
        cfg.chat_model_id = None;
    }
    cfg.schema_version = CONFIG_SCHEMA_VERSION;
    // skip_serializing 字段不参与比较；结构版本/URL/设备 id 的变化足以表示 dirty。
    serde_json::to_string(cfg).unwrap_or_default() != original
}

/// 旧版明文密钥迁移到 Credential Manager；返回是否发生了迁移。
fn hydrate_secrets(cfg: &mut Config) -> Result<bool, String> {
    let mut changed = false;
    let main = cfg.api_key.trim().to_string();
    if !main.is_empty() {
        credentials::set("ai", "main", &main)?;
        cfg.api_key = main;
        changed = true;
    } else if let Some(key) = credentials::get("ai", "main")? {
        cfg.api_key = key;
    }

    for p in &mut cfg.models {
        let key = p.api_key.trim().to_string();
        if !key.is_empty() {
            credentials::set("model", &p.id, &key)?;
            p.api_key = key;
            changed = true;
        } else if let Some(saved) = credentials::get("model", &p.id)? {
            p.api_key = saved;
        }
    }

    let token = cfg.device_token.trim().to_string();
    if !token.is_empty() {
        credentials::set("device", "token", &token)?;
        cfg.device_token = token;
        changed = true;
    } else if let Some(saved) = credentials::get("device", "token")? {
        cfg.device_token = saved;
    }
    Ok(changed)
}

/// 读取 AI 配置（api_key 只回掩码）。
#[tauri::command]
pub fn get_ai_config(state: State<'_, Store>) -> Result<ConfigView, String> {
    Ok(ConfigView::from(&state.get()))
}

/// 更新 AI 配置；`api_key` 为空表示不修改，`base_url/model/dsh_url` 做 trim。
#[tauri::command]
pub fn set_ai_config(state: State<'_, Store>, upd: ConfigUpdate) -> Result<ConfigView, String> {
    let auto_start = upd.auto_start;
    let base_url = upd
        .base_url
        .as_deref()
        .map(net::normalize_http_base)
        .transpose()?;
    let dsh_url = upd
        .dsh_url
        .as_deref()
        .map(net::normalize_http_base)
        .transpose()?;
    let assets_url = upd
        .assets_url
        .as_deref()
        .map(net::normalize_http_base)
        .transpose()?;
    if let Some(key) = upd.api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        credentials::set("ai", "main", key)?;
    }
    state.update(|c| {
        if let Some(v) = &base_url {
            c.base_url = v.clone();
        }
        if let Some(v) = &upd.api_key {
            if !v.trim().is_empty() {
                c.api_key = v.trim().to_string();
            }
        }
        if let Some(v) = &upd.model {
            c.model = v.trim().to_string();
        }
        if let Some(v) = &dsh_url {
            c.dsh_url = v.clone();
        }
        if let Some(v) = upd.sound {
            c.sound = v;
        }
        if let Some(v) = &assets_url {
            c.assets_url = v.clone();
        }
        if let Some(v) = upd.assets_enabled {
            c.assets_enabled = v;
        }
    })?;
    // auto_start 单独走 autostart::apply：写注册表 + 同步配置，避免只写 flag 不生效的陷阱
    if let Some(enable) = auto_start {
        crate::autostart::apply(&state, enable)?;
    }
    Ok(ConfigView::from(&state.get()))
}

/// 新增或编辑一个模型（id 为空 = 新增），返回其视图。
#[tauri::command]
pub fn save_model(state: State<'_, Store>, req: ModelProfileInput) -> Result<ModelProfileView, String> {
    let label = req.label.trim().to_string();
    let base_url = net::normalize_http_base(&req.base_url)?;
    let model = req.model.trim().to_string();
    if label.is_empty() {
        return Err("模型显示名不能为空".into());
    }
    if base_url.is_empty() || model.is_empty() {
        return Err("Base URL 和模型名不能为空".into());
    }
    let id = req
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    state.update_ret(|c| {
        if let Some(id) = id {
            // 编辑：找到并更新（api_key 为空 = 保留原 key）
            let Some(p) = c.models.iter_mut().find(|m| m.id == id) else {
                return Err("要编辑的模型不存在".to_string());
            };
            p.label = label.clone();
            p.base_url = base_url.clone();
            p.model = model.clone();
            if let Some(k) = req.api_key.as_deref() {
                if !k.trim().is_empty() {
                    credentials::set("model", &p.id, k.trim())?;
                    p.api_key = k.trim().to_string();
                }
            }
            Ok(ModelProfileView::from(&*p))
        } else {
            // 新增
            let id = format!("m{}", now_millis());
            let key = req.api_key.as_deref().map(str::trim).unwrap_or("").to_string();
            if !key.is_empty() {
                credentials::set("model", &id, &key)?;
            }
            c.models.push(ModelProfile {
                id,
                label,
                base_url,
                api_key: key,
                model,
            });
            Ok(ModelProfileView::from(c.models.last().unwrap()))
        }
    })
}

/// 删除一个模型，并清理指向它的路由。
#[tauri::command]
pub fn delete_model(state: State<'_, Store>, id: String) -> Result<(), String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("缺少模型 id".into());
    }
    state.update(|c| {
        c.models.retain(|m| m.id != id);
        if c.say_model_id.as_deref() == Some(id.as_str()) {
            c.say_model_id = None;
        }
        if c.chat_model_id.as_deref() == Some(id.as_str()) {
            c.chat_model_id = None;
        }
    })?;
    let _ = credentials::delete("model", &id);
    Ok(())
}

/// 设置 say/chat 模型路由（空值 = 清空，回退到主模型）。
#[tauri::command]
pub fn set_model_route(state: State<'_, Store>, req: ModelRouteInput) -> Result<(), String> {
    state.update(|c| {
        c.say_model_id = normalize_id(req.say_model_id.as_deref());
        c.chat_model_id = normalize_id(req.chat_model_id.as_deref());
    })?;
    Ok(())
}

/// 读取并清除一次性「位置重置」标记：返回 true 表示本次启动应把宠物归位到右下角。
#[tauri::command]
pub fn consume_pos_reset(state: State<'_, Store>) -> Result<bool, String> {
    crate::window::diag("consume_pos_reset: called");
    let mut reset = false;
    state.update(|c| {
        reset = c.pos_reset;
        c.pos_reset = false;
    })?;
    crate::window::diag(&format!("consume_pos_reset: reset={reset}"));
    Ok(reset)
}

/// 设备配对信息视图：device_id 可展示，token 只回「是否已设置」不泄漏明文。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub device_id: String,
    pub has_device_token: bool,
}

/// 读取设备 id 与配对状态（首次调用时生成并持久化 device_id）。
#[tauri::command]
pub fn get_device_info(state: State<'_, Store>) -> Result<DeviceInfo, String> {
    state.update_ret(|c| {
        if c.device_id.trim().is_empty() {
            c.device_id = crate::config::generate_device_id();
        }
        Ok(DeviceInfo {
            device_id: c.device_id.clone(),
            has_device_token: !c.device_token.trim().is_empty(),
        })
    })
}

/// 写入/清除设备配对令牌（空字符串 = 清除配对）。
#[tauri::command]
pub fn set_device_token(state: State<'_, Store>, token: String) -> Result<DeviceInfo, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        credentials::delete("device", "token")?;
    } else {
        credentials::set("device", "token", &token)?;
    }
    state.update_ret(|c| {
        if c.device_id.trim().is_empty() {
            c.device_id = crate::config::generate_device_id();
        }
        c.device_token = token;
        Ok(DeviceInfo {
            device_id: c.device_id.clone(),
            has_device_token: !c.device_token.trim().is_empty(),
        })
    })
}
