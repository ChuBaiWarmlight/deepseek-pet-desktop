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
use tauri::{AppHandle, Emitter, Manager, State};

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
    /// 短期去重：同一 provider/session/kind/status/summary/window/data 在 2 秒内只收一次。
    seen: Mutex<HashMap<String, u64>>,
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
                seen: Mutex::new(HashMap::new()),
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
        // 去重：hook 重试或重复上报时，2 秒内的同一条事件不再入队。
        // data 参与 key，避免同一工具在两秒内处理不同文件时被误吞。
        let dedup_key = format!(
            "{}|{}|{}|{}|{}|{}|{}",
            event.provider,
            event.session_id,
            event.kind,
            event.status,
            event.summary,
            event.window_title,
            serde_json::to_string(&event.data).unwrap_or_default()
        );
        if let Ok(mut seen) = self.inner.seen.lock() {
            // 用「收到事件的时间」判断重复，而不是事件自带的时间戳：
            // 导入历史事件时不会把不同时间的两条误判成重复。
            let now = now_millis();
            if let Some(prev) = seen.get(&dedup_key) {
                if now.saturating_sub(*prev) < 2_000 {
                    return Ok(event);
                }
            }
            seen.insert(dedup_key, now);
            if seen.len() > 512 {
                seen.retain(|_, ts| now.saturating_sub(*ts) < 60_000);
            }
        }
        if let Some(focus) = app.try_state::<crate::work_focus::WorkFocus>() {
            focus.observe(app, &event);
        }
        if let Err(e) = crate::timeline::append(&event) {
            crate::window::diag(&format!("timeline append failed: {e}"));
        }
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
        405 => "Method Not Allowed",
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
    if path_only == "/mcp" && req.method == "GET" {
        let _ = respond(&mut stream, 405, &json!({"ok": false, "error": "MCP 只接受 POST"}).to_string());
        return;
    }
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
        ("POST", "/api/focus/reset") => {
            if let Some(focus) = app.try_state::<crate::work_focus::WorkFocus>() {
                focus.reset();
            }
            Ok(json!({"ok": true}))
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
        ("POST", "/mcp") => {
            let parsed: Value = match serde_json::from_slice(&req.body) {
                Ok(v) => v,
                Err(e) => {
                    let _ = respond(&mut stream, 400, &json!({"ok": false, "error": format!("invalid json: {e}")}).to_string());
                    return;
                }
            };
            Ok(mcp_handle(app, hub, &parsed))
        }
        _ => {
            let _ = respond(&mut stream, 404, &json!({"ok": false, "error": "not found"}).to_string());
            return;
        }
    };

    match result {
        Ok(body) if body.is_null() => {
            let _ = respond(&mut stream, 204, "");
        }
        Ok(body) => {
            let _ = respond(&mut stream, 200, &body.to_string());
        }
        Err(e) => {
            let _ = respond(&mut stream, 400, &json!({"ok": false, "error": e}).to_string());
        }
    }
}

fn mcp_tools() -> Value {
    json!([
        {
            "name": "report_event",
            "description": "向桌宠报告一条工作事件（任意 AI 工具都可以调用）",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "description": "事件类型，如 tool.start / approval.requested / task.done" },
                    "provider": { "type": "string", "description": "claude-code / codex / cursor / generic" },
                    "status": { "type": "string" },
                    "summary": { "type": "string" },
                    "project": { "type": "string" },
                    "sessionId": { "type": "string" },
                    "attention": { "type": "string", "enum": ["silent", "glance", "interrupt"] },
                    "severity": { "type": "string", "enum": ["info", "success", "warning", "error"] }
                },
                "required": ["kind"]
            }
        },
        {
            "name": "work_summary",
            "description": "查询某天的工作摘要与最近 7 天习惯",
            "inputSchema": {
                "type": "object",
                "properties": { "day": { "type": "string", "description": "YYYY-MM-DD，默认今天" } }
            }
        },
        {
            "name": "work_task_cards",
            "description": "查询某天的任务卡：项目、工具分布、涉及文件",
            "inputSchema": {
                "type": "object",
                "properties": { "day": { "type": "string", "description": "YYYY-MM-DD，默认今天" } }
            }
        },
        {
            "name": "work_report",
            "description": "生成工作日报或周报（Markdown）",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "period": { "type": "string", "enum": ["day", "week"] },
                    "day": { "type": "string", "description": "YYYY-MM-DD，默认今天" }
                }
            }
        },
        {
            "name": "work_focus",
            "description": "查询当前是否在专注工作、连续了多久、是否该休息",
            "inputSchema": { "type": "object", "properties": {} }
        }
    ])
}

fn mcp_text(value: Value) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&value).unwrap_or_default()
        }],
        "isError": false
    })
}

fn mcp_call(app: &AppHandle, hub: &AgentHub, params: &Value) -> Result<Value, (i64, String)> {
    let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let day = args
        .get("day")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match name {
        "report_event" => {
            let event: AgentEvent = serde_json::from_value(args)
                .map_err(|e| (-32602, format!("invalid arguments: {e}")))?;
            let stored = hub.ingest(app, event).map_err(|e| (-32602, e))?;
            Ok(mcp_text(json!(stored)))
        }
        "work_summary" => {
            let day = day.unwrap_or_else(crate::timeline::today);
            let digest = crate::work_memory::digest(&day).map_err(|e| (-32603, e))?;
            let profile = crate::work_memory::profile(7);
            let text = crate::work_memory::text(7);
            Ok(mcp_text(json!({
                "day": day,
                "digest": digest,
                "profile": profile,
                "text": text
            })))
        }
        "work_task_cards" => {
            let day = day.unwrap_or_else(crate::timeline::today);
            let cards = crate::task_card::cards_for_day(&day).map_err(|e| (-32603, e))?;
            Ok(mcp_text(json!({ "day": day, "cards": cards })))
        }
        "work_report" => {
            let period = args.get("period").and_then(|v| v.as_str()).unwrap_or("day");
            let report = crate::work_report::build(period, day).map_err(|e| (-32603, e))?;
            Ok(mcp_text(json!(report)))
        }
        "work_focus" => {
            let state = app.state::<crate::work_focus::WorkFocus>().state();
            Ok(mcp_text(json!(state)))
        }
        _ => Err((-32602, format!("unknown tool: {name}"))),
    }
}

fn mcp_handle(app: &AppHandle, hub: &AgentHub, req: &Value) -> Value {
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let params = req.get("params").cloned().unwrap_or_else(|| json!({}));

    // JSON-RPC 通知没有 id，规范要求不返回响应体。
    if req.get("id").is_none() || req.get("id") == Some(&Value::Null) {
        return Value::Null;
    }

    let result: Result<Value, (i64, String)> = match method {
        "initialize" => {
            let version = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("2024-11-05");
            Ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": {
                    "name": "dsh-pet-desktop",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }))
        }
        "notifications/initialized" | "initialized" | "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": mcp_tools() })),
        "tools/call" => mcp_call(app, hub, &params),
        _ => Err((-32601, format!("method not found: {method}"))),
    };

    match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err((code, message)) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message }
        }),
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
