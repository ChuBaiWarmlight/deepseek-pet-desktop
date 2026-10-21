//! 开机自启：写入/删除 `HKCU\...\Run`（无需管理员）。
//!
//! Windows 使用带引号的完整命令行（`"path" --autostart`），避免路径含空格时
//! 被 Shell 拆错参数；`--autostart` 也用于启动日志区分“登录拉起”和“手动打开”。

use std::path::{Path, PathBuf};

use tauri::State;

use crate::config::{Config, Store};

const APP_NAME: &str = "dsh-pet-desktop";
const AUTOSTART_ARG: &str = "--autostart";

#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const STARTUP_APPROVED_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

fn exe_path() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("获取可执行文件路径失败：{e}"))
}

/// Windows `Run` 项的规范命令行：路径始终加引号，并附带自启标记。
fn startup_command_for(exe: &Path) -> String {
    format!("\"{}\" {}", exe.display(), AUTOSTART_ARG)
}

fn startup_command() -> Result<String, String> {
    Ok(startup_command_for(&exe_path()?))
}

/// 当前进程是否由登录自启拉起（只用于诊断，不影响应用行为）。
pub fn is_autostart_launch() -> bool {
    std::env::args_os().skip(1).any(|arg| arg == AUTOSTART_ARG)
}

#[cfg(any(windows, test))]
fn startup_approval_enabled(bytes: &[u8]) -> Option<bool> {
    if bytes.len() < 8 {
        return None;
    }
    // 任务管理器启用：02 00 00 00 + 8 个 0；禁用：03 00 00 00 + 时间戳。
    Some(bytes.iter().rev().take(8).all(|byte| *byte == 0))
}

#[cfg(windows)]
mod platform {
    use super::{
        startup_approval_enabled, startup_command, APP_NAME, RUN_KEY, STARTUP_APPROVED_KEY,
    };
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::{RegKey, RegValue};

    const STARTUP_APPROVED_ENABLED: [u8; 12] = [
        0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];

    fn current_command() -> Result<Option<String>, String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run = match hkcu.open_subkey_with_flags(RUN_KEY, KEY_READ) {
            Ok(key) => key,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("读取开机自启注册表失败：{e}")),
        };
        match run.get_value::<String, _>(APP_NAME) {
            Ok(command) => Ok(Some(command)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("读取开机自启命令行失败：{e}")),
        }
    }

    fn approved_state() -> Option<bool> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let raw = hkcu
            .open_subkey_with_flags(STARTUP_APPROVED_KEY, KEY_READ)
            .ok()?
            .get_raw_value(APP_NAME)
            .ok()?;
        startup_approval_enabled(&raw.bytes)
    }

    /// 任务管理器里被用户主动禁用时，应用必须尊重它，不能下次启动又偷偷打开。
    pub fn explicitly_disabled() -> bool {
        approved_state() == Some(false)
    }

    pub fn is_enabled() -> Result<bool, String> {
        Ok(current_command()?.is_some() && approved_state().unwrap_or(true))
    }

    /// 只在启动项缺失或命令行过期时重写；返回是否发生了修复。
    pub fn ensure_registered() -> Result<bool, String> {
        let desired = startup_command()?;
        if current_command()?.as_deref() == Some(desired.as_str()) {
            return Ok(false);
        }
        write_enabled()?;
        Ok(true)
    }

    fn write_enabled() -> Result<(), String> {
        let command = startup_command()?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (run, _) = hkcu
            .create_subkey(RUN_KEY)
            .map_err(|e| format!("写入开机自启注册表失败：{e}"))?;
        run.set_value(APP_NAME, &command)
            .map_err(|e| format!("写入开机自启命令行失败：{e}"))?;

        // StartupApproved 不存在时 Windows 默认启用，创建失败不应阻断自启。
        if let Ok((approved, _)) = hkcu.create_subkey(STARTUP_APPROVED_KEY) {
            let _ = approved.set_raw_value(
                APP_NAME,
                &RegValue {
                    vtype: winreg::enums::RegType::REG_BINARY,
                    bytes: STARTUP_APPROVED_ENABLED.to_vec(),
                },
            );
        }
        Ok(())
    }

    pub fn set_enabled(enable: bool) -> Result<(), String> {
        if enable {
            return write_enabled();
        }

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(run) = hkcu.open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE) {
            match run.delete_value(APP_NAME) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("删除开机自启注册表失败：{e}")),
            }
        }
        if let Ok(approved) = hkcu.open_subkey_with_flags(STARTUP_APPROVED_KEY, KEY_SET_VALUE) {
            let _ = approved.delete_value(APP_NAME);
        }
        Ok(())
    }
}

#[cfg(not(windows))]
fn autolaunch() -> Result<auto_launch::AutoLaunch, String> {
    let exe = exe_path()?;
    auto_launch::AutoLaunchBuilder::new()
        .set_app_name(APP_NAME)
        .set_app_path(&exe.to_string_lossy())
        .set_args(&[AUTOSTART_ARG])
        .build()
        .map_err(|e| e.to_string())
}

/// 应用开机自启开关并同步到配置。命令与托盘菜单共用。
pub fn apply(store: &Store, enable: bool) -> Result<(), String> {
    #[cfg(windows)]
    platform::set_enabled(enable)?;
    #[cfg(not(windows))]
    {
        let al = autolaunch()?;
        if enable {
            al.enable().map_err(|e| e.to_string())?;
        } else {
            al.disable().map_err(|e| e.to_string())?;
        }
    }

    // 写到系统后再校验一次，避免“配置显示已开启、注册表实际没生效”。
    let actual = is_enabled().unwrap_or(enable);
    if actual != enable {
        return Err(format!(
            "开机自启状态未生效（期望 {enable}，实际 {actual}）"
        ));
    }
    store.update(|c: &mut Config| c.auto_start = enable)?;
    Ok(())
}

/// 读取系统真实状态；读取异常时由调用方回退到配置值并留诊断日志。
pub fn is_enabled() -> Result<bool, String> {
    #[cfg(windows)]
    {
        platform::is_enabled()
    }
    #[cfg(not(windows))]
    {
        autolaunch()?.is_enabled().map_err(|e| e.to_string())
    }
}

/// 应用启动时自检：配置开启但注册表缺失/命令行旧格式时修复一次。
///
/// 如果用户在任务管理器里主动禁用，则保留禁用状态，不覆盖用户选择。
pub fn reconcile(store: &Store) {
    #[cfg(not(windows))]
    {
        let _ = store;
        return;
    }

    if !store.get().auto_start {
        return;
    }
    if platform::explicitly_disabled() {
        crate::window::diag("autostart: disabled in Task Manager; keeping user choice");
        return;
    }
    match platform::ensure_registered() {
        Ok(true) => crate::window::diag("autostart: startup command repaired"),
        Ok(false) => crate::window::diag("autostart: startup command verified"),
        Err(e) => crate::window::diag(&format!("autostart: repair failed: {e}")),
    }
}

#[tauri::command]
pub fn set_auto_start(state: State<'_, Store>, enable: bool) -> Result<bool, String> {
    apply(&state, enable)?;
    Ok(enable)
}

#[tauri::command]
pub fn get_auto_start(state: State<'_, Store>) -> Result<bool, String> {
    match is_enabled() {
        Ok(enabled) => Ok(enabled),
        Err(e) => {
            crate::window::diag(&format!("autostart: read failed: {e}"));
            Ok(state.get().auto_start)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_command_quotes_path_and_marks_autostart() {
        let command = startup_command_for(Path::new(r"C:\Program Files\dsh pet\pet.exe"));
        assert_eq!(command, r#""C:\Program Files\dsh pet\pet.exe" --autostart"#);
    }

    #[test]
    fn task_manager_enabled_blob_is_recognized() {
        assert_eq!(
            startup_approval_enabled(&[
                0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            ]),
            Some(true)
        );
    }

    #[test]
    fn task_manager_disabled_blob_is_recognized() {
        assert_eq!(
            startup_approval_enabled(&[
                0x03, 0x00, 0x00, 0x00, 0x80, 0x4a, 0x3c, 0x2a, 0x10, 0x00, 0x00, 0x00,
            ]),
            Some(false)
        );
    }

    #[test]
    fn malformed_approval_blob_is_ignored() {
        assert_eq!(startup_approval_enabled(&[0x02, 0x00]), None);
    }
}
