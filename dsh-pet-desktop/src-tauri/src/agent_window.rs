//! 审批雷达的窗口聚焦：按标题 / 进程名把 Claude Code、ChatGPT(Codex) 等窗口拉到前台。
//! Claude Code 通常跑在终端或 VS Code 集成终端里，标题不一定包含 Claude，
//! 因此优先匹配项目目录和终端进程；找不到现有窗口时按 provider 启动对应应用。

use serde::Serialize;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusWindowResult {
    pub title: String,
    pub target: String,
    pub launched: bool,
    pub focused: bool,
}

#[derive(Debug, Clone, Default)]
struct FocusRequest {
    query: String,
    provider: String,
    cwd: String,
    project: String,
    session_id: String,
}

#[tauri::command]
pub fn focus_agent_window(
    app: AppHandle,
    query: String,
    provider: Option<String>,
    cwd: Option<String>,
    project: Option<String>,
    session_id: Option<String>,
) -> Result<FocusWindowResult, String> {
    let req = FocusRequest {
        query: query.trim().to_string(),
        provider: provider
            .unwrap_or_default()
            .trim()
            .to_lowercase()
            .replace('_', "-"),
        cwd: cwd.unwrap_or_default(),
        project: project.unwrap_or_default(),
        session_id: session_id.unwrap_or_default(),
    };
    if req.query.is_empty() && req.provider.is_empty() {
        return Err("缺少窗口标题关键字".into());
    }

    // 透明全屏桌宠会压住目标窗口，聚焦期间临时取消置顶。
    let overlay = app.get_webview_window("main");
    if let Some(win) = &overlay {
        let _ = win.set_always_on_top(false);
    }
    let result = platform_focus(&req);
    if let Some(win) = overlay {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1600));
            let _ = win.set_always_on_top(true);
        });
    }
    result
}

#[cfg(windows)]
fn platform_focus(req: &FocusRequest) -> Result<FocusWindowResult, String> {
    if let Some(window) = find_window(req) {
        let focused = activate_window(window.hwnd);
        crate::window::diag(&format!(
            "focus: query={:?} provider={} -> title={:?} process={} focused={}",
            req.query, req.provider, window.title, window.process, focused
        ));
        return Ok(FocusWindowResult {
            title: window.title,
            target: window.process,
            launched: false,
            focused,
        });
    }

    let (fallback_title, target) = launch_for(req)?;
    crate::window::diag(&format!(
        "focus: query={:?} provider={} not running, launched {}",
        req.query, req.provider, target
    ));
    if let Some(window) = wait_for_window(req, Duration::from_secs(6)) {
        let focused = activate_window(window.hwnd);
        return Ok(FocusWindowResult {
            title: window.title,
            target: window.process,
            launched: true,
            focused,
        });
    }
    Ok(FocusWindowResult {
        title: fallback_title,
        target,
        launched: true,
        focused: false,
    })
}

#[cfg(windows)]
fn provider_key(req: &FocusRequest) -> String {
    let provider = crate::agent_hub::normalize_provider(&req.provider);
    if provider != "generic" {
        return provider;
    }
    let query = req.query.to_lowercase();
    if query.contains("claude") {
        "claude-code".into()
    } else if query.contains("codex") || query.contains("chatgpt") || query.contains("gpt") {
        "chatgpt".into()
    } else if query.contains("cursor") {
        "cursor".into()
    } else {
        "generic".into()
    }
}

#[cfg(windows)]
struct WindowInfo {
    hwnd: isize,
    title: String,
    process: String,
    class: String,
}

#[cfg(windows)]
fn find_window(req: &FocusRequest) -> Option<WindowInfo> {
    let mut best: Option<(i32, WindowInfo)> = None;
    for window in collect_windows() {
        let score = score_window(&window, req);
        if score <= 0 {
            continue;
        }
        if best
            .as_ref()
            .map_or(true, |(best_score, _)| score > *best_score)
        {
            best = Some((score, window));
        }
    }
    best.map(|(_, window)| window)
}

#[cfg(windows)]
fn score_window(window: &WindowInfo, req: &FocusRequest) -> i32 {
    let title = window.title.to_lowercase();
    let process = window.process.to_lowercase();
    let class = window.class.to_lowercase();
    let query = req.query.trim().to_lowercase();
    let project = req.project.trim().to_lowercase();
    let cwd_leaf = Path::new(req.cwd.trim())
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let provider = provider_key(req);
    let terminal = is_terminal(&process, &title, &class);
    if provider == "claude-code" && !terminal {
        // Claude Code 只存在于终端 / IDE 集成终端里；Claude 桌面应用不是它。
        return 0;
    }
    let mut score = 0i32;

    if !query.is_empty() {
        if title == query {
            score += 140;
        } else if title.contains(&query) {
            score += 80;
        }
        if process.contains(&query) {
            score += 40;
        }
    }

    match provider.as_str() {
        "codex" | "chatgpt" => {
            if process.contains("chatgpt") || process.contains("codex") {
                score += 140;
            }
            if title.contains("chatgpt") || title.contains("codex") {
                score += 100;
            }
        }
        "claude-code" => {
            let project_match =
                (!project.is_empty() && project != "未命名项目" && title.contains(&project))
                    || (!cwd_leaf.is_empty() && title.contains(&cwd_leaf));
            let claude_match = title.contains("claude") || process.contains("claude");
            // Claude Code 是 CLI：只把标题里能对上 Claude / 项目的终端当成目标，
            // 不随便抢一个无关的 PowerShell / VS Code 窗口。
            if terminal && (claude_match || project_match) {
                score += 300;
            }
        }
        "cursor" => {
            if process.contains("cursor") {
                score += 140;
            }
            if process == "code.exe" || title.contains("visual studio code") {
                score += 70;
            }
        }
        _ => {}
    }

    if !project.is_empty() && project != "未命名项目" {
        if title.contains(&project) {
            score += 70;
        }
        if process.contains(&project) {
            score += 20;
        }
    }
    if !cwd_leaf.is_empty() && cwd_leaf != project && title.contains(&cwd_leaf) {
        score += 60;
    }

    score
}

#[cfg(windows)]
fn is_terminal(process: &str, title: &str, class: &str) -> bool {
    const PROCESSES: &[&str] = &[
        "windowsterminal.exe",
        "powershell.exe",
        "pwsh.exe",
        "cmd.exe",
        "conhost.exe",
        "wezterm-gui.exe",
        "alacritty.exe",
        "mintty.exe",
        "hyper.exe",
        "git-bash.exe",
        "bash.exe",
        "code.exe",
        "cursor.exe",
        "idea64.exe",
        "devenv.exe",
    ];
    const TITLES: &[&str] = &[
        "windows terminal",
        "powershell",
        "pwsh",
        "command prompt",
        "cmd.exe",
        "terminal",
        "终端",
        "visual studio code",
        "cursor",
    ];
    PROCESSES.contains(&process)
        || TITLES.iter().any(|needle| title.contains(needle))
        || class.contains("consolewindowclass")
}

#[cfg(windows)]
fn collect_windows() -> Vec<WindowInfo> {
    use winapi::shared::minwindef::{BOOL, LPARAM, TRUE};
    use winapi::shared::windef::HWND;
    use winapi::um::winuser::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible};

    struct Ctx {
        own_pid: u32,
        windows: Vec<WindowInfo>,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut Ctx);
        if IsWindowVisible(hwnd) == 0 {
            return TRUE;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 || pid == ctx.own_pid {
            return TRUE;
        }
        let title = window_title(hwnd);
        if title.trim().is_empty() || title == "Program Manager" {
            return TRUE;
        }
        ctx.windows.push(WindowInfo {
            hwnd: hwnd as isize,
            title,
            process: process_name(pid),
            class: window_class(hwnd),
        });
        TRUE
    }

    let mut ctx = Ctx {
        own_pid: std::process::id(),
        windows: Vec::new(),
    };
    unsafe {
        EnumWindows(Some(enum_proc), &mut ctx as *mut Ctx as LPARAM);
    }
    ctx.windows
}

#[cfg(windows)]
fn window_title(hwnd: winapi::shared::windef::HWND) -> String {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winapi::um::winuser::{GetWindowTextLengthW, GetWindowTextW};

    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if copied <= 0 {
            return String::new();
        }
        OsString::from_wide(&buf[..copied as usize])
            .to_string_lossy()
            .to_string()
    }
}

#[cfg(windows)]
fn window_class(hwnd: winapi::shared::windef::HWND) -> String {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winapi::um::winuser::GetClassNameW;

    unsafe {
        let mut buf = [0u16; 256];
        let copied = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if copied <= 0 {
            return String::new();
        }
        OsString::from_wide(&buf[..copied as usize])
            .to_string_lossy()
            .to_string()
    }
}

#[cfg(windows)]
fn process_name(pid: u32) -> String {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winapi::shared::minwindef::FALSE;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::winbase::QueryFullProcessImageNameW;
    use winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION;

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if handle.is_null() {
            return String::new();
        }
        let mut buf = vec![0u16; 2048];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
        CloseHandle(handle);
        if ok == 0 || size == 0 {
            return String::new();
        }
        let path = OsString::from_wide(&buf[..size as usize]);
        Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    }
}

#[cfg(windows)]
fn activate_window(hwnd: isize) -> bool {
    use std::ptr;
    use winapi::shared::minwindef::{FALSE, TRUE};
    use winapi::shared::windef::HWND;
    use winapi::um::processthreadsapi::GetCurrentThreadId;
    use winapi::um::winuser::{
        keybd_event, AllowSetForegroundWindow, AttachThreadInput, BringWindowToTop,
        GetForegroundWindow, GetWindowThreadProcessId, IsIconic, SetActiveWindow, SetFocus,
        SetForegroundWindow, SetWindowPos, ShowWindowAsync, SwitchToThisWindow, ASFW_ANY,
        HWND_NOTOPMOST, HWND_TOPMOST, KEYEVENTF_KEYUP, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        SW_RESTORE, SW_SHOW, VK_MENU,
    };

    unsafe {
        let target = hwnd as HWND;
        if IsIconic(target) != 0 {
            ShowWindowAsync(target, SW_RESTORE);
        } else {
            ShowWindowAsync(target, SW_SHOW);
        }
        // 临时置顶再取消，能绕过一部分「窗口已在但被压在后面」的情况。
        SetWindowPos(
            target,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );
        SetWindowPos(
            target,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );
        BringWindowToTop(target);

        let foreground = GetForegroundWindow();
        if foreground == target {
            return true;
        }
        let current_thread = GetCurrentThreadId();
        let foreground_thread = if foreground.is_null() {
            0
        } else {
            GetWindowThreadProcessId(foreground, ptr::null_mut())
        };
        let target_thread = GetWindowThreadProcessId(target, ptr::null_mut());

        // Windows 前台锁：把当前线程接到前台线程上再抢焦点。
        let attached_foreground = foreground_thread != 0
            && foreground_thread != current_thread
            && AttachThreadInput(current_thread, foreground_thread, TRUE) != 0;
        AllowSetForegroundWindow(ASFW_ANY);
        let _ = SetForegroundWindow(target);
        if attached_foreground {
            AttachThreadInput(current_thread, foreground_thread, FALSE);
        }
        std::thread::sleep(Duration::from_millis(30));

        if GetForegroundWindow() != target {
            // 模拟一次 Alt 按键，解除 Windows 的前台锁定。
            keybd_event(VK_MENU as u8, 0, 0, 0);
            keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
            std::thread::sleep(Duration::from_millis(20));
            SwitchToThisWindow(target, TRUE);
            let _ = SetForegroundWindow(target);
        }

        if GetForegroundWindow() != target {
            let attached_target = target_thread != 0
                && target_thread != current_thread
                && AttachThreadInput(current_thread, target_thread, TRUE) != 0;
            SetActiveWindow(target);
            SetFocus(target);
            if attached_target {
                AttachThreadInput(current_thread, target_thread, FALSE);
            }
            let _ = SetForegroundWindow(target);
        }

        std::thread::sleep(Duration::from_millis(80));
        GetForegroundWindow() == target
    }
}

#[cfg(windows)]
fn wait_for_window(req: &FocusRequest, timeout: Duration) -> Option<WindowInfo> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        std::thread::sleep(Duration::from_millis(250));
        if let Some(window) = find_window(req) {
            return Some(window);
        }
        if std::time::Instant::now() >= deadline {
            return None;
        }
    }
}

#[cfg(windows)]
fn launch_for(req: &FocusRequest) -> Result<(String, String), String> {
    match provider_key(req).as_str() {
        "codex" | "chatgpt" => {
            if let Some(app_id) = find_start_app("ChatGPT|Codex") {
                launch_appx(&app_id)?;
                return Ok(("ChatGPT / Codex".into(), app_id));
            }
            if which("codex").is_some() {
                let title = launch_terminal(req, "codex", "Codex 终端")?;
                return Ok((title, "terminal".into()));
            }
            Err("没有找到 ChatGPT / Codex 桌面应用或 codex 命令".into())
        }
        "claude-code" => {
            let title = launch_terminal(req, "claude", "Claude Code 终端")?;
            Ok((title, "terminal".into()))
        }
        "cursor" => {
            if which("cursor").is_none() {
                return Err("没有找到 Cursor 窗口或 cursor 命令".into());
            }
            let mut cmd = Command::new("cmd.exe");
            cmd.args(["/C", "cursor"]);
            if Path::new(req.cwd.trim()).is_dir() {
                cmd.arg(req.cwd.trim());
            }
            cmd.spawn().map_err(|e| format!("启动 Cursor 失败：{e}"))?;
            Ok(("Cursor".into(), "cursor".into()))
        }
        _ => Err(format!("没有找到标题包含「{}」的窗口", req.query)),
    }
}

#[cfg(windows)]
fn launch_terminal(req: &FocusRequest, command: &str, label: &str) -> Result<String, String> {
    let cwd = if Path::new(req.cwd.trim()).is_dir() {
        Some(req.cwd.trim().to_string())
    } else {
        None
    };
    let has_command = which(command).is_some();
    let session = safe_session(req).filter(|_| command == "claude");

    if let Some(terminal) = which("wt.exe").or_else(|| which("WindowsTerminal.exe")) {
        let mut cmd = Command::new(terminal);
        if let Some(dir) = &cwd {
            cmd.args(["-d", dir]);
        }
        cmd.args(["cmd.exe", "/k"]);
        if has_command {
            cmd.arg(command);
            if let Some(session_id) = session {
                cmd.args(["--resume", session_id]);
            }
        }
        match cmd.spawn() {
            Ok(_) => return Ok(label.into()),
            Err(error) => {
                // WindowsApps 里的 wt.exe 是应用执行别名，CreateProcess 可能拒绝；
                // 不直接返回，继续尝试 PowerShell 窗口。
                crate::window::diag(&format!("focus: windows terminal spawn failed: {error}"));
            }
        }
    }

    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoLogo", "-NoExit"]);
    if let Some(dir) = &cwd {
        cmd.current_dir(dir);
    }
    if has_command {
        let mut line = command.to_string();
        if let Some(session_id) = session {
            line.push_str(&format!(" --resume {session_id}"));
        }
        cmd.args(["-Command", &line]);
    }
    cmd.spawn()
        .map_err(|e| format!("启动 PowerShell 失败：{e}"))?;
    Ok(label.into())
}

#[cfg(windows)]
fn safe_session(req: &FocusRequest) -> Option<&str> {
    let session = req.session_id.trim();
    if session.is_empty() || session.len() > 128 {
        return None;
    }
    session
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        .then_some(session)
}

#[cfg(windows)]
fn which(name: &str) -> Option<std::path::PathBuf> {
    let output = Command::new("where.exe").arg(name).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    if line.is_empty() {
        None
    } else {
        Some(std::path::PathBuf::from(line))
    }
}

#[cfg(windows)]
fn find_start_app(pattern: &str) -> Option<String> {
    let script = format!(
        "$a = Get-StartApps | Where-Object {{ $_.Name -match '{}' }} | Select-Object -First 1 -ExpandProperty AppID; if ($a) {{ [Console]::Out.Write($a) }}",
        pattern
    );
    let output = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &script,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let app_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if app_id.is_empty() {
        None
    } else {
        Some(app_id)
    }
}

#[cfg(windows)]
fn launch_appx(app_id: &str) -> Result<(), String> {
    Command::new("explorer.exe")
        .arg(format!("shell:AppsFolder\\{app_id}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("启动桌面应用失败：{e}"))
}

#[cfg(not(windows))]
fn platform_focus(_req: &FocusRequest) -> Result<FocusWindowResult, String> {
    Err("当前平台暂不支持自动聚焦窗口".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn request(provider: &str, query: &str, project: &str) -> FocusRequest {
        FocusRequest {
            query: query.into(),
            provider: provider.into(),
            project: project.into(),
            ..Default::default()
        }
    }

    fn window(title: &str, process: &str) -> WindowInfo {
        WindowInfo {
            hwnd: 0,
            title: title.into(),
            process: process.into(),
            class: String::new(),
        }
    }

    #[test]
    fn codex_prefers_chatgpt_desktop_over_browser() {
        let req = request("codex", "Codex", "esign_6.0");
        let desktop = score_window(&window("ChatGPT", "chatgpt.exe"), &req);
        let browser = score_window(&window("GitHub - Google Chrome", "chrome.exe"), &req);
        assert!(desktop > browser);
    }

    #[test]
    fn claude_code_prefers_project_terminal() {
        let req = request("claude-code", "Claude", "design-web");
        let terminal = score_window(
            &window("design-web - Windows Terminal", "windowsterminal.exe"),
            &req,
        );
        let random = score_window(&window("PowerShell", "windowsterminal.exe"), &req);
        assert!(terminal > random);
        assert!(terminal > 0);
    }

    #[test]
    fn unrelated_window_is_ignored() {
        let req = request("codex", "Codex", "esign_6.0");
        assert_eq!(
            score_window(&window("calculator", "calculator.exe"), &req),
            0
        );
    }

    #[test]
    fn claude_code_ignores_unrelated_terminal() {
        let req = request("claude-code", "Claude", "design-web");
        assert_eq!(
            score_window(&window("PowerShell", "windowsterminal.exe"), &req),
            0
        );
    }

    #[test]
    fn claude_desktop_is_not_treated_as_claude_code() {
        let req = request("claude-code", "Claude", "design-web");
        assert_eq!(score_window(&window("Claude", "claude.exe"), &req), 0);
    }
}
