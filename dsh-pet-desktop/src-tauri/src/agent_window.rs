//! 审批雷达的窗口聚焦：按标题关键字把 Claude Code / Codex 等窗口拉到前台。
//! Claude Code 通常跑在 Windows Terminal / PowerShell 里，标题不含 Claude，
//! 因此找不到时按终端类窗口回退；聚焦期间临时取消桌宠置顶，避免透明层压住目标。

use std::time::Duration;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn focus_agent_window(app: AppHandle, query: String) -> Result<String, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("缺少窗口标题关键字".into());
    }
    let overlay = app.get_webview_window("main");
    if let Some(win) = &overlay {
        let _ = win.set_always_on_top(false);
    }
    let result = platform_focus(query);
    if let Some(win) = overlay {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1200));
            let _ = win.set_always_on_top(true);
        });
    }
    result
}

#[cfg(windows)]
fn platform_focus(query: &str) -> Result<String, String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winapi::shared::minwindef::{BOOL, FALSE, LPARAM, TRUE};
    use winapi::shared::windef::HWND;
    use winapi::um::winuser::{
        AllowSetForegroundWindow, AttachThreadInput, BringWindowToTop, EnumWindows,
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsIconic, IsWindowVisible, SetActiveWindow, SetForegroundWindow, SetWindowPos, ShowWindow,
        ASFW_ANY, HWND_TOP, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW,
    };

    struct Search<'a> {
        needle: String,
        found: Option<String>,
        own_pid: u32,
        _marker: std::marker::PhantomData<&'a str>,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam as *mut Search<'_>);
        if IsWindowVisible(hwnd) == 0 {
            return TRUE;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == search.own_pid {
            return TRUE;
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return TRUE;
        }
        let mut buf = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if copied <= 0 {
            return TRUE;
        }
        let title = OsString::from_wide(&buf[..copied as usize])
            .to_string_lossy()
            .to_string();
        if title.trim().is_empty() || title == "Program Manager" {
            return TRUE;
        }
        if title.to_lowercase().contains(&search.needle) {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            } else {
                ShowWindow(hwnd, SW_SHOW);
            }
            // Windows 默认禁止后台进程抢前台；AttachThreadInput 先接到当前前台线程，
            // 再 SetForegroundWindow，成功率明显更高。
            let fg = GetForegroundWindow();
            let fg_thread = if fg.is_null() {
                0
            } else {
                GetWindowThreadProcessId(fg, std::ptr::null_mut())
            };
            let target_thread = GetWindowThreadProcessId(hwnd, std::ptr::null_mut());
            let attached = fg_thread != 0 && target_thread != 0 && fg_thread != target_thread;
            if attached {
                AttachThreadInput(fg_thread, target_thread, 1);
            }
            AllowSetForegroundWindow(ASFW_ANY);
            SetWindowPos(
                hwnd,
                HWND_TOP,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
            SetActiveWindow(hwnd);
            if attached {
                AttachThreadInput(fg_thread, target_thread, 0);
            }
            search.found = Some(title);
            return FALSE;
        }
        TRUE
    }

    let q = query.to_lowercase();
    let mut candidates = vec![q.clone()];
    if q.contains("claude") {
        candidates.extend(
            ["windows terminal", "powershell", "cmd", "terminal", "终端"]
                .iter()
                .map(|s| s.to_string()),
        );
    } else if q.contains("codex") {
        candidates.extend(
            ["codex", "chatgpt", "windows terminal", "powershell", "terminal", "终端"]
                .iter()
                .map(|s| s.to_string()),
        );
    } else if q.contains("chatgpt") {
        candidates.extend(["chatgpt", "chrome", "edge", "浏览器"].iter().map(|s| s.to_string()));
    } else if q.contains("cursor") {
        candidates.extend(["cursor", "visual studio code", "vscode"].iter().map(|s| s.to_string()));
    }
    candidates.dedup();

    for needle in candidates {
        let mut search = Search {
            needle,
            found: None,
            own_pid: std::process::id(),
            _marker: std::marker::PhantomData,
        };
        unsafe {
            EnumWindows(Some(enum_proc), &mut search as *mut Search<'_> as LPARAM);
        }
        if let Some(title) = search.found {
            return Ok(title);
        }
    }
    Err(format!("没有找到标题包含「{query}」或终端类窗口"))
}

#[cfg(not(windows))]
fn platform_focus(_query: &str) -> Result<String, String> {
    Err("当前平台暂不支持自动聚焦窗口".into())
}
