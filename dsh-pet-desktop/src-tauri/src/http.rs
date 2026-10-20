//! 共享 HTTP 客户端：LLM 调用与 DSH 桥接共用一个连接池。

use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Client;

/// 全局单例 HTTP 客户端（30s 总超时 / 2s 连接超时）。
/// 连接超时缩短到 2s：本机 DSH 连接拒绝是即时返回，超时只在网络不通时触发，
/// 避免 DSH 重试 3 次 × 5s 拖到 15s 才判定离线。
pub fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(2))
            .build()
            .expect("failed to build HTTP client")
    })
}

/// 截断长字符串（用于把错误响应/诊断信息塞进前端气泡）。
pub fn truncate(s: &str, max_chars: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let head: String = s.chars().take(max_chars).collect();
        format!("{head}…")
    }
}
