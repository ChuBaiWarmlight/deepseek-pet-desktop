//! 网络地址规范化与校验。
//!
//! 配置/平台清单都来自用户或远端，绝不能用原始字符串直接拼 URL：
//! - 只允许 http/https；
//! - 必须有 host；
//! - 拒绝 userinfo / query / fragment（避免把凭据或异常片段带进请求）；
//! - 统一去掉尾部 `/`，后续路径拼接只走本模块。

use url::Url;

/// 校验并规范化一个 HTTP(S) base URL。
pub fn normalize_http_base(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("地址为空".into());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "地址格式无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("只支持 http/https 地址".into());
    }
    if parsed.host_str().map(str::is_empty).unwrap_or(true) {
        return Err("地址缺少主机名".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("地址不能包含账号密码".into());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("地址不能包含 query 或 fragment".into());
    }
    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

/// 校验失败时回退到可信默认值，用于读取历史配置。
pub fn normalize_http_base_or(raw: &str, fallback: &str) -> String {
    normalize_http_base(raw)
        .or_else(|_| normalize_http_base(fallback))
        .unwrap_or_else(|_| fallback.trim().trim_end_matches('/').to_string())
}

/// 在已校验的 base 上拼接固定 API 路径。
pub fn join_api(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path.trim_start_matches('/'))
}

