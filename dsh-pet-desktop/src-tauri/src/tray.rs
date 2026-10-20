//! 系统托盘：显示/隐藏、AI 设置、打开记忆本、开机自启、退出。
//!
//! “设置/记忆本”这类需要打开前端面板的动作，通过 `tray-command` 事件通知前端。

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示/隐藏", true, None::<&str>)?;
    let show_pet = MenuItem::with_id(app, "show-pet", "显示桌宠", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "AI 设置", true, None::<&str>)?;
    let diary = MenuItem::with_id(app, "diary", "打开日记本", true, None::<&str>)?;
    let memory = MenuItem::with_id(app, "memory", "打开记忆本", true, None::<&str>)?;
    let autostart = MenuItem::with_id(app, "autostart", "开机自启", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &show_pet, &settings, &diary, &memory, &autostart, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("dsh-pet-desktop")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
            "show-pet" => {
                // 确保窗口可见，并通知前端把「隐藏状态」置回显示（还原桌宠本体）。
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                let _ = app.emit("tray-command", "show-pet");
            }
            "settings" => {
                let _ = app.emit("tray-command", "settings");
            }
            "diary" => {
                let _ = app.emit("tray-command", "diary");
            }
            "memory" => {
                let _ = app.emit("tray-command", "memory");
            }
            "autostart" => {
                let state = app.state::<crate::config::Store>();
                let enabled = !state.get().auto_start;
                let _ = crate::autostart::apply(&state, enabled);
            }
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}
