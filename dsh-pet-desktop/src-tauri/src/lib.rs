//! dsh-pet-desktop 库入口：注册模块、管理共享状态、装配 Tauri 应用。

mod autostart;
mod commands;
mod config;
mod credentials;
mod http;
mod net;
mod storage;
mod system;
mod tray;
mod window;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 共享状态：AI 配置 + 记忆/日记/聊天记录 + 交互区（穿透轮询用）
        .manage(config::Store::load())
        .manage(storage::RecordsStore::load())
        .manage(window::HitRegions::default())
        .setup(|app| {
            window::setup_fullscreen(app.handle())?;
            tray::setup_tray(app.handle())?;
            // 允许 asset 协议访问资源缓存目录（convertFileSrc 播放缓存视频）
            app.asset_protocol_scope()
                .allow_directory(config::app_dir().join("cache").join("assets").join("videos"), true)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // config
            config::get_ai_config,
            config::set_ai_config,
            config::save_model,
            config::delete_model,
            config::set_model_route,
            // 一次性位置重置（前端启动时消费 pos_reset 标记）
            config::consume_pos_reset,
            // 设备配对（M-05）
            config::get_device_info,
            config::set_device_token,
            // assets (资源平台桥接)
            commands::assets::assets_check,
            commands::assets::assets_resolve,
            commands::assets::assets_prefetch,
            commands::assets::assets_clear_cache,
            // pet (遥控命令)
            commands::pet::pet_poll,
            commands::pet::pet_done,
            commands::pet::pet_heartbeat,
            // llm
            commands::llm::llm_complete,
            commands::llm::llm_stream,
            commands::llm::test_ai_connection,
            // memory
            commands::memory::memory_list,
            commands::memory::memory_extract,
            commands::memory::memory_add,
            commands::memory::memory_delete,
            commands::memory::memory_import,
            commands::memory::memory_work,
            commands::memory::memory_pick,
            commands::memory::memory_mark,
            commands::memory::memory_recall,
            // records (diary / chat / export-import)
            commands::records::diary_list,
            commands::records::diary_write,
            commands::records::chat_list,
            commands::records::chat_set,
            commands::records::chat_clear,
            commands::records::records_export,
            commands::records::records_import,
            commands::records::report_list,
            commands::records::report_save,
            commands::backup::backup_save,
            commands::backup::backup_open,
            commands::backup::report_export_png,
            commands::sync::sync_upload,
            commands::sync::sync_download,
            // dsh
            commands::dsh::dsh_check,
            commands::dsh::dsh_context,
            commands::dsh::dsh_taskboard,
            // fs
            commands::fs::eat_file,
            commands::fs::trash_list,
            commands::fs::restore_file,
            commands::fs::purge_file,
            // window
            window::set_hit_regions,
            window::get_work_area,
            window::diag_log,
            // system
            system::system_snapshot,
            // autostart
            autostart::set_auto_start,
            autostart::get_auto_start,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
