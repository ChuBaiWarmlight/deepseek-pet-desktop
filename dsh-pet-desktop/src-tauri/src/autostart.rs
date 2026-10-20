//! 开机自启：写入/删除 `HKCU\...\Run`（无需管理员）。

use tauri::State;

use crate::config::{Config, Store};

fn autolaunch() -> Result<auto_launch::AutoLaunch, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("获取可执行文件路径失败：{e}"))?;
    auto_launch::AutoLaunchBuilder::new()
        .set_app_name("dsh-pet-desktop")
        .set_app_path(&exe.to_string_lossy())
        .build()
        .map_err(|e| e.to_string())
}

/// 应用开机自启开关并同步到配置。命令与托盘菜单共用。
pub fn apply(store: &Store, enable: bool) -> Result<(), String> {
    let al = autolaunch()?;
    if enable {
        al.enable().map_err(|e| e.to_string())?;
    } else {
        al.disable().map_err(|e| e.to_string())?;
    }
    store.update(|c: &mut Config| c.auto_start = enable)?;
    Ok(())
}

#[tauri::command]
pub fn set_auto_start(state: State<'_, Store>, enable: bool) -> Result<bool, String> {
    apply(&state, enable)?;
    Ok(enable)
}

#[tauri::command]
pub fn get_auto_start(state: State<'_, Store>) -> Result<bool, String> {
    Ok(state.get().auto_start)
}
