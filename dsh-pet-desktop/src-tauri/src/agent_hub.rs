//! 本机 AI 工作搭子事件总线。
//!
//! Claude Code / Codex / DSH / 任意脚本都可以向 `127.0.0.1:<port>/api/events`
//! POST 一条统一事件；桌宠把它转成动画、气泡和审批提醒。
//! 只监听回环地址，并要求 `X-Pet-Token`，不暴露到局域网。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::config::{app_dir, now_millis, write_atomic};

const HUB_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 17777;
const PORT_TRIES: u16 = 10;
const MAX_BODY: usize = 256 * 1024;
const MAX_RECENT: usize = 200;

static EVENT_SEQ: AtomicU64 = AtomicU64::new(1);

/// 统一事件。字段全部可选，适配器只需要提供 provider + kind + 少量上下文。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub ts: u64,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default, alias = "session_id")]
    pub session_id: String,
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub summary: String,
    /// info / success / warning / error
    #[serde(default)]
    pub severity: String,
    /// silent / glance / interrupt
    #[serde(default)]
    pub attention: String,
    #[serde(default, alias = "window_title")]
    pub window_title: String,
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHubInfo {
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub token: String,
    pub endpoint: String,
    pub recent_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct HubFile {
    #[serde(default)]
    port: u16,
    #[serde(default)]
    token: String,
}

struct HubInner {
    token: String,
    port: AtomicU16,
    running: AtomicBool,
    recent: Mutex<VecDeque<AgentEvent>>,
}

/// `tauri::State` 管理的句柄；内部用 Arc，方便把同一份状态移进监听线程。
#[derive(Clone)]
pub struct AgentHub {
    inner: Arc<HubInner>,
}

impl AgentHub {
    pub fn load() -> Self {
        let path = hub_file_path();
        let saved = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<HubFile>(&s).ok())
            .unwrap_or_default();
        let token = if saved.token.trim().len() >= 16 {
            saved.token.trim().to_string()
        } else {
            generate_token()
        };
        let port = if saved.port >= 1024 { saved.port } else { DEFAULT_PORT };
        let hub = Self {
            inner: Arc::new(HubInner {
                token,
                port: AtomicU16::new(port),
                running: AtomicBool::new(false),
                recent: Mutex::new(VecDeque::new()),
            }),
        };
        hub.persist();
        hub
    }

    pub fn info(&self) -> AgentHubInfo {
        let port = self.port();
        AgentHubInfo {
            running: self.inner.running.load(Ordering::SeqCst),
            host: HUB_HOST.to_string(),
            port,
            token: self.inner.token.clone(),
            endpoint: format!("http://{HUB_HOST}:{port}/api/events"),
            recent_count: self.inner.recent.lock().map(|q| q.len()).unwrap_or(0),
        }
    }

    pub fn port(&self) -> u16 {
        self.inner.port.load(Ordering::SeqCst)
    }

    /// 绑定回环端口并启动 HTTP 监听线程；端口被占用时自动向后顺延。
    pub fn start(&self, app: AppHandle) -> Result<u16, String> {
        if self.inner.running.load(Ordering::SeqCst) {
            return Ok(self.port());
        }
        let preferred = self.port().max(1024);
        let mut last_err = String::new();
        for offset in 0..PORT_TRIES {
            let port = preferred.saturating_add(offset);
            match TcpListener::bind((HUB_HOST, port)) {
                Ok(listener) => {
                    self.inner.port.store(port, Ordering::SeqCst);
                    self.inner.running.store(true, Ordering::SeqCst);
                    self.persist();
                    let hub = self.clone();
                    std::thread::spawn(move || {
                        for incoming in listener.incoming() {
                            match incoming {
                                Ok(stream) => {
                                    let app = app.clone();
                                    let hub = hub.clone();
                                    std::thread::spawn(move || handle_connection(stream, &app, &hub));
                                }
                                Err(e) => {
                                    crate::window::diag(&format!("agent hub accept failed: {e}"));
                                }
                            }
                        }
                    });
                    return Ok(port);
                }
                Err(e) => last_err = e.to_string(),
            }
        }
        Err(format!("无法绑定本机事件端口 {preferred}..{}：{last_err}", preferred + PORT_TRIES - 1))
    }

    pub fn recent(&self, limit: usize) -> Vec<AgentEvent> {
        let q = match self.inner.recent.lock() {
            Ok(q) => q,
            Err(_) => return Vec::new(),
        };
        q.iter().take(limit.clamp(1, MAX_RECENT)).cloned().collect()
    }

    pub fn ingest(&self, app: &AppHandle, event: AgentEvent) -> Result<AgentEvent, String> {
        let event = normalize_event(event)?;
        if let Ok(mut q) = self.inner.recent.lock() {
            q.push_front(event.clone());
            q.truncate(MAX_RECENT);
        }
        let _ = app.emit("agent-event", &event);
        Ok(event)
    }

    fn persist(&self) {
        let file = HubFile {
            port: self.port(),
            token: self.inner.token.clone(),
        };
        if let Ok(json) = serde_json::to_vec_pretty(&file) {
            if let Err(e) = write_atomic(&hub_file_path(), &json) {
                crate::window::diag(&format!("agent hub persist failed: {e}"));
            }
        }
    }
}

fn hub_file_path() -> std::path::PathBuf {
    app_dir().join("agent-hub.json")
}

fn generate_token() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let now = now_millis();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let mut a = DefaultHasher::new();
    (now, nanos, pid, "dsh-pet-agent-a").hash(&mut a);
    let mut b = DefaultHasher::new();
    (nanos, now, pid, "dsh-pet-agent-b").hash(&mut b);
    format!("{:016x}{:016x}", a.finish(), b.finish())
}

fn normalize_provider(raw: &str) -> String {
    let p = raw.trim().to_lowercase().replace('_', "-");
    match p.as_str() {
        "" => "generic".into(),
        "claude" | "claudecode" | "claude-code-cli" => "claude-code".into(),
        "openai" | "chat-gpt" | "chatgpt-desktop" => "chatgpt".into(),
        "codex-cli" | "openai-codex" => "codex".into(),
        "cursor-ai" => "cursor".into(),
        "deepseek-harness" => "dsh".into(),
        _ => p,
    }
}

fn normalize_kind(raw: &str) -> String {
    raw.trim().to_lowercase().replace('_', ".")
}

fn normalize_severity(raw: &str) -> String {
    match raw.trim().to_lowercase().as_str() {
        "ok" | "pass" | "passed" | "success" | "succeeded" => "success".into(),
        "fail" | "failed" | "failure" | "error" => "error".into(),
        "warn" | "warning" => "warning".into(),
        "info" | "" => "info".into(),
        other => other.into(),
    }
}

fn default_attention(kind: &str, severity: &str) -> &'static str {
    match kind {
        "approval.requested" | "task.failed" | "error" => "interrupt",
        "test.result" | "build.result" if severity == "error" => "interrupt",
        "test.result" | "build.result" | "task.done" | "turn.completed" | "notification" => "glance",
        "session.start" | "session.end" | "prompt.submitted" | "assistant.thinking" | "assistant.message"
        | "tool.start" | "tool.end" => "silent",
        _ => "glance",
    }
}

fn default_status(kind: &str, severity: &str) -> String {
    match kind {
        "session.start" => "已开始".into(),
        "session.end" => "已结束".into(),
        "prompt.submitted" => "收到新任务".into(),
        "assistant.thinking" => "思考中".into(),
        "assistant.message" => "正在回复".into(),
        "tool.start" => "正在调用工具".into(),
        "tool.end" => "工具完成".into(),
        "approval.requested" => "等待确认".into(),
        "approval.resolved" => "已确认".into(),
        "test.result" => if severity == "error" { "测试失败".into() } else { "测试通过".into() },
        "build.result" => if severity == "error" { "构建失败".into() } else { "构建通过".into() },
        "task.done" | "turn.completed" => "任务完成".into(),
        "task.failed" => "任务失败".into(),
        "notification" => "有新的提醒".into(),
        _ => String::new(),
    }
}

fn provider_window_default(provider: &str) -> String {
    match provider {
        "claude-code" => "Claude".into(),
        "codex" => "Codex".into(),
        "chatgpt" => "ChatGPT".into(),
        "cursor" => "Cursor".into(),
        "dsh" => "DSH".into(),
        _ => String::new(),
    }
}

fn normalize_event(mut event: AgentEvent) -> Result<AgentEvent, String> {
    event.provider = normalize_provider(&event.provider);
    event.kind = normalize_kind(&event.kind);
    if event.kind.is_empty() {
        return Err("事件缺少 kind".into());
    }
    if event.id.trim().is_empty() {
        event.id = format!("ev-{}-{}", now_millis(), EVENT_SEQ.fetch_add(1, Ordering::Relaxed));
    }
    if event.ts == 0 {
        event.ts = now_millis();
    }
    event.severity = normalize_severity(&event.severity);
    if let Some(ok) = event.data.get("ok").and_then(Value::as_bool) {
        if !ok {
            event.severity = "error".into();
        }
    }
    if event.status.trim().is_empty() {
        event.status = default_status(&event.kind, &event.severity);
    }
    if event.summary.trim().is_empty() {
        event.summary = if event.title.trim().is_empty() {
            event.status.clone()
        } else {
            event.title.clone()
        };
    }
    if event.window_title.trim().is_empty() {
        event.window_title = provider_window_default(&event.provider);
    }
    let attention = event.attention.trim().to_lowercase();
    event.attention = match attention.as_str() {
        "silent" | "glance" | "interrupt" => attention,
        _ => default_attention(&event.kind, &event.severity).into(),
    };
    Ok(event)
}

struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let n = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("连接提前关闭".into());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_bytes(&buf, b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > 64 * 1024 {
            return Err("请求头过大".into());
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let first = lines.next().unwrap_or_default();
    let mut first_parts = first.split_whitespace();
    let method = first_parts.next().unwrap_or_default().to_uppercase();
    let path = first_parts.next().unwrap_or("/").to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }
    let content_length = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_BODY {
        return Err("请求体过大".into());
    }
    let body_start = header_end + 4;
    while buf.len() < body_start + content_length {
        let n = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let body = buf
        .get(body_start..(body_start + content_length).min(buf.len()))
        .unwrap_or_default()
        .to_vec();
    Ok(HttpRequest { method, path, headers, body })
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn query_param(path: &str, key: &str) -> Option<String> {
    let (_, query) = path.split_once('?')?;
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        if k == key {
            Some(v.to_string())
        } else {
            None
        }
    })
}

fn token_ok(expected: &str, provided: &str) -> bool {
    if expected.len() != provided.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in expected.as_bytes().iter().zip(provided.as_bytes()) {
        diff |= a ^ b;
    }
    diff == 0
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "Internal Server Error",
    }
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type, x-pet-token\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n\r\n{}",
        reason(status),
        body.as_bytes().len(),
        body
    );
    stream.write_all(response.as_bytes()).map_err(|e| e.to_string())
}

fn handle_connection(mut stream: TcpStream, app: &AppHandle, hub: &AgentHub) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let req = match read_request(&mut stream) {
        Ok(req) => req,
        Err(e) => {
            let _ = respond(&mut stream, 400, &json!({"ok": false, "error": e}).to_string());
            return;
        }
    };
    if req.method == "OPTIONS" {
        let _ = respond(&mut stream, 204, "");
        return;
    }
    let path_only = req.path.split('?').next().unwrap_or("/");
    if path_only != "/health" {
        let provided = req
            .headers
            .get("x-pet-token")
            .cloned()
            .or_else(|| query_param(&req.path, "token"))
            .unwrap_or_default();
        if !token_ok(&hub.inner.token, &provided) {
            let _ = respond(&mut stream, 401, &json!({"ok": false, "error": "invalid token"}).to_string());
            return;
        }
    }

    let result: Result<Value, String> = match (req.method.as_str(), path_only) {
        ("GET", "/health") => Ok(json!({
            "ok": true,
            "app": "dsh-pet-desktop",
            "version": env!("CARGO_PKG_VERSION"),
            "port": hub.port(),
        })),
        ("GET", "/api/status") => Ok(json!({
            "ok": true,
            "hub": hub.info(),
            "last": hub.recent(1).into_iter().next(),
        })),
        ("GET", "/api/recent") => {
            let limit = query_param(&req.path, "limit")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(50);
            Ok(json!({"ok": true, "events": hub.recent(limit)}))
        }
        ("POST", "/api/events") | ("POST", "/api/manual") => {
            let parsed: Value = match serde_json::from_slice(&req.body) {
                Ok(v) => v,
                Err(e) => {
                    let _ = respond(&mut stream, 400, &json!({"ok": false, "error": format!("invalid json: {e}")}).to_string());
                    return;
                }
            };
            let items = if let Some(arr) = parsed.get("events").and_then(Value::as_array) {
                arr.clone()
            } else if let Some(arr) = parsed.as_array() {
                arr.clone()
            } else {
                vec![parsed]
            };
            let mut ids = Vec::new();
            for item in items {
                let event: AgentEvent = match serde_json::from_value(item) {
                    Ok(e) => e,
                    Err(e) => {
                        let _ = respond(&mut stream, 400, &json!({"ok": false, "error": format!("invalid event: {e}")}).to_string());
                        return;
                    }
                };
                match hub.ingest(app, event) {
                    Ok(e) => ids.push(e.id),
                    Err(e) => {
                        let _ = respond(&mut stream, 400, &json!({"ok": false, "error": e}).to_string());
                        return;
                    }
                }
            }
            Ok(json!({"ok": true, "count": ids.len(), "ids": ids}))
        }
        _ => {
            let _ = respond(&mut stream, 404, &json!({"ok": false, "error": "not found"}).to_string());
            return;
        }
    };

    match result {
        Ok(body) => {
            let _ = respond(&mut stream, 200, &body.to_string());
        }
        Err(e) => {
            let _ = respond(&mut stream, 400, &json!({"ok": false, "error": e}).to_string());
        }
    }
}

#[tauri::command]
pub fn agent_hub_info(state: State<'_, AgentHub>) -> AgentHubInfo {
    state.info()
}

#[tauri::command]
pub fn agent_recent(state: State<'_, AgentHub>, limit: Option<usize>) -> Vec<AgentEvent> {
    state.recent(limit.unwrap_or(50))
}

#[tauri::command]
pub fn agent_emit(app: AppHandle, state: State<'_, AgentHub>, event: AgentEvent) -> Result<AgentEvent, String> {
    state.ingest(&app, event)
}
