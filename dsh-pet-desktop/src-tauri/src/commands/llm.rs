//! OpenAI 兼容 chat/completions 调用。
//!
//! 前端 `lib/ai.js` 负责构建 system/user prompt（33 个 say 模式 + chat/diary/review），
//! 本模块只做“非流式对话 + 错误透传”，与 Web 版 `llm.stream` 的语义对齐。

use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use crate::config::Store;
use crate::http;
use crate::net;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRequest {
    pub system: String,
    pub user: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    /// 任务类型："say"（短句快模型）或其它（聊天/日记/复盘，走聊天模型）。
    #[serde(default)]
    pub task: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LlmResponse {
    pub ok: bool,
    pub text: String,
    pub diag: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTest {
    pub ok: bool,
    pub latency_ms: u64,
    pub diag: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
    temperature: f32,
    stream: bool,
}

#[derive(Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ChoiceMessage,
}

#[derive(Deserialize)]
struct ChoiceMessage {
    #[serde(default)]
    content: Option<String>,
}

/// SSE 流式分片：OpenAI 兼容 `stream:true` 下每个 `data:` 行的 JSON。
#[derive(Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
}

#[derive(Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: StreamDelta,
}

#[derive(Deserialize, Default)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
}

/// base_url 规范化：兼容 OpenAI 风格。
/// - 已含 `/chat/completions` → 原样；
/// - 已含 `/v1` → 追加 `/chat/completions`；
/// - 裸域名（如 `https://api.deepseek.com` / `https://ai-router.timevale.cn`）→ 追加 `/v1/chat/completions`。
fn normalize_base_url(raw: &str) -> Result<String, String> {
    let base = net::normalize_http_base(raw)?;
    if base.ends_with("/chat/completions") {
        Ok(base)
    } else if base.ends_with("/v1") {
        Ok(format!("{base}/chat/completions"))
    } else {
        Ok(format!("{base}/v1/chat/completions"))
    }
}

/// 非流式对话；始终返回 `LlmResponse`（`ok=false` 时 `diag` 携带可展示的错误）。
pub async fn complete(
    base_url: &str,
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
    max_tokens: u32,
    temperature: f32,
) -> LlmResponse {
    if api_key.trim().is_empty() {
        return LlmResponse {
            ok: false,
            text: String::new(),
            diag: "尚未配置 API Key，请在「AI 设置」里填写".into(),
        };
    }

    let url = match normalize_base_url(base_url) {
        Ok(url) => url,
        Err(e) => {
            return LlmResponse {
                ok: false,
                text: String::new(),
                diag: format!("Base URL 无效：{e}"),
            }
        }
    };
    let body = ChatRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage { role: "system", content: system.to_string() },
            ChatMessage { role: "user", content: user.to_string() },
        ],
        max_tokens,
        temperature,
        stream: false,
    };

    let resp = match http::client()
        .post(&url)
        .bearer_auth(api_key.trim())
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return LlmResponse {
                ok: false,
                text: String::new(),
                diag: format!("请求失败：{e}"),
            }
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return LlmResponse {
            ok: false,
            text: String::new(),
            diag: format!("HTTP {status}：{}", http::truncate(&body_text, 300)),
        };
    }

    match resp.json::<ChatResponse>().await {
        Ok(cr) => {
            let text = cr
                .choices
                .into_iter()
                .next()
                .map(|c| {
                    // 只取 content（真正的回答）。reasoning_content 是模型内部思考，
                    // 会回显提示词/指令，绝不能当作回复。
                    c.message.content.unwrap_or_default().trim().to_string()
                })
                .unwrap_or_default();
            if text.is_empty() {
                LlmResponse {
                    ok: false,
                    text: String::new(),
                    diag: "接口返回空内容".into(),
                }
            } else {
                LlmResponse {
                    ok: true,
                    text,
                    diag: format!("{base_url}/{model}"),
                }
            }
        }
        Err(e) => LlmResponse {
            ok: false,
            text: String::new(),
            diag: format!("响应解析失败：{e}"),
        },
    }
}

/// 流式对话：以 `stream:true` 请求，把每个 `delta.content` 分片经 `Channel` 逐条推给前端。
/// 出错时返回 `Err`（已推送的分片会保留在前端侧）；连接成功但流为空时也返回 `Err`。
async fn stream_complete(
    base_url: &str,
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
    max_tokens: u32,
    temperature: f32,
    channel: Channel<String>,
) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("尚未配置 API Key，请在「AI 设置」里填写".into());
    }

    let url = normalize_base_url(base_url).map_err(|e| format!("Base URL 无效：{e}"))?;
    let body = ChatRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage { role: "system", content: system.to_string() },
            ChatMessage { role: "user", content: user.to_string() },
        ],
        max_tokens,
        temperature,
        stream: true,
    };

    let mut resp = match http::client()
        .post(&url)
        .bearer_auth(api_key.trim())
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return Err(format!("请求失败：{e}")),
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}：{}", http::truncate(&body_text, 300)));
    }

    // 逐块读取 SSE；用字节缓冲，仅在收到完整行后再解码，避免多字节 UTF-8（中文）
    // 被 chunk 边界截断成乱码。
    let mut buf: Vec<u8> = Vec::new();
    let mut sent_any = false;
    loop {
        let chunk = match resp.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return Err(format!("流读取失败：{e}")),
        };
        buf.extend_from_slice(&chunk);

        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line: String = String::from_utf8_lossy(&line_bytes).trim().to_string();
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                if let Ok(stream_chunk) = serde_json::from_str::<StreamChunk>(data) {
                    if let Some(choice) = stream_chunk.choices.into_iter().next() {
                        // 只取 content（真正的回答）；reasoning_content 是模型内部思考，
                        // 会回显提示词/指令，直接跳过，绝不当作回复推给前端。
                        let content = choice.delta.content.unwrap_or_default();
                        if !content.is_empty() {
                            sent_any = true;
                            channel.send(content).map_err(|e| format!("推送流数据失败：{e}"))?;
                        }
                    }
                }
            }
        }
    }

    if sent_any {
        Ok(())
    } else {
        Err("接口未返回流式内容".into())
    }
}

#[tauri::command]
pub async fn llm_stream(
    channel: Channel<String>,
    state: State<'_, Store>,
    req: LlmRequest,
) -> Result<(), String> {
    let cfg = state.get();
    let (base_url, api_key, model) = crate::config::resolve_model(&cfg, req.task.as_deref().unwrap_or("chat"));
    stream_complete(
        &base_url,
        &api_key,
        &model,
        &req.system,
        &req.user,
        req.max_tokens.unwrap_or(512),
        req.temperature.unwrap_or(0.9),
        channel,
    )
    .await
}

#[tauri::command]
pub async fn llm_complete(state: State<'_, Store>, req: LlmRequest) -> Result<LlmResponse, String> {
    let cfg = state.get();
    let (base_url, api_key, model) = crate::config::resolve_model(&cfg, req.task.as_deref().unwrap_or("chat"));
    let resp = complete(
        &base_url,
        &api_key,
        &model,
        &req.system,
        &req.user,
        req.max_tokens.unwrap_or(512),
        req.temperature.unwrap_or(0.9),
    )
    .await;
    Ok(resp)
}

#[tauri::command]
pub async fn test_ai_connection(state: State<'_, Store>) -> Result<ConnectionTest, String> {
    let cfg = state.get();
    let (base_url, api_key, model) = crate::config::resolve_model(&cfg, "chat");
    let start = Instant::now();
    let r = complete(&base_url, &api_key, &model, "你是连接测试助手。", "请只回复两个字：正常", 64, 0.0).await;
    let latency_ms = start.elapsed().as_millis() as u64;
    Ok(ConnectionTest {
        ok: r.ok,
        latency_ms,
        diag: r.diag,
    })
}
