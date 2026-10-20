//! 系统感知：前台应用 / 系统空闲 / 电量（Windows Win32 读取）。
//!
//! 纯后端 Win32 读取，不落盘、不回传；只把「主人正在看哪个应用 / 是否真离开电脑 /
//! 电量是否告急」三个低敏信号给前端，供桌宠吐槽与提醒。
//! 所有字段都可空：读取失败或非 Windows 时返回空，前端据此优雅降级。

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundApp {
    pub name: String,
    pub title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryStatus {
    pub percent: i32,
    pub on_ac: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    /// 系统空闲秒数（自最后一次键盘/鼠标输入起，`GetLastInputInfo`）。
    pub idle_secs: u64,
    /// 当前前台应用（进程名 + 窗口标题）；桌面/锁屏等无前台窗口时为 `None`。
    pub foreground: Option<ForegroundApp>,
    /// 电池状态；台式机/无电池（`BatteryLifePercent == 255`）时为 `None`。
    pub battery: Option<BatteryStatus>,
}

#[cfg(windows)]
mod imp {
    use super::{BatteryStatus, ForegroundApp, SystemSnapshot};

    use winapi::shared::minwindef::{DWORD, UINT};
    use winapi::shared::windef::HWND;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::sysinfoapi::GetTickCount;
    use winapi::um::winbase::{GetSystemPowerStatus, QueryFullProcessImageNameW, SYSTEM_POWER_STATUS};
    use winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION;
    use winapi::um::winuser::{
        GetForegroundWindow, GetLastInputInfo, GetWindowTextW, GetWindowThreadProcessId,
        LASTINPUTINFO,
    };

    pub fn snapshot() -> SystemSnapshot {
        SystemSnapshot {
            idle_secs: idle_secs(),
            foreground: foreground_app(),
            battery: battery(),
        }
    }

    fn idle_secs() -> u64 {
        unsafe {
            let mut lii = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as UINT,
                dwTime: 0,
            };
            if GetLastInputInfo(&mut lii) == 0 {
                return 0;
            }
            // dwTime 与 GetTickCount 均为「系统启动以来的毫秒数」，差值即空闲时长。
            let idle_ms = GetTickCount().wrapping_sub(lii.dwTime);
            (idle_ms / 1000) as u64
        }
    }

    fn foreground_app() -> Option<ForegroundApp> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return None;
            }
            let title = window_text(hwnd);
            let name = process_name(hwnd);
            // 既拿不到标题也拿不到进程名（如桌面/锁屏）时视为无前台应用。
            if name.is_empty() && title.is_empty() {
                return None;
            }
            Some(ForegroundApp { name, title })
        }
    }

    fn window_text(hwnd: HWND) -> String {
        unsafe {
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if len <= 0 {
                return String::new();
            }
            String::from_utf16_lossy(&buf[..len as usize])
        }
    }

    fn process_name(hwnd: HWND) -> String {
        unsafe {
            let mut pid: DWORD = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return String::new();
            }
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return String::new();
            }
            let mut buf = [0u16; 1024];
            let mut size: DWORD = buf.len() as DWORD;
            let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
            CloseHandle(handle);
            if ok == 0 {
                return String::new();
            }
            let path = String::from_utf16_lossy(&buf[..size as usize]);
            exe_stem(&path)
        }
    }

    /// 从 exe 全路径取友好进程名（去路径、去 .exe、首字母大写）。
    fn exe_stem(path: &str) -> String {
        let file = path
            .rsplit(|c: char| c == '\\' || c == '/')
            .next()
            .unwrap_or(path);
        let stem = file.trim_end_matches(".exe").trim_end_matches(".EXE");
        if stem.is_empty() {
            return String::new();
        }
        let mut chars = stem.chars();
        match chars.next() {
            Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
            None => String::new(),
        }
    }

    fn battery() -> Option<BatteryStatus> {
        unsafe {
            let mut sps: SYSTEM_POWER_STATUS = std::mem::zeroed();
            if GetSystemPowerStatus(&mut sps) == 0 {
                return None;
            }
            // 255 表示未知（台式机/无电池）。
            if sps.BatteryLifePercent == 255 {
                return None;
            }
            Some(BatteryStatus {
                percent: sps.BatteryLifePercent as i32,
                on_ac: sps.ACLineStatus == 1,
            })
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::SystemSnapshot;

    pub fn snapshot() -> SystemSnapshot {
        SystemSnapshot {
            idle_secs: 0,
            foreground: None,
            battery: None,
        }
    }
}

#[tauri::command]
pub fn system_snapshot() -> SystemSnapshot {
    imp::snapshot()
}
