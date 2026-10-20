//! 窗口控制：全屏透明窗口 + 鼠标穿透 + 工作区。
//!
//! 桌面版采用“全屏透明窗口 + DOM 定位”模型（对齐 Web 版行为）：
//! 窗口铺满整个虚拟桌面，宠物与面板都是窗口内的 DOM 元素（absolute 定位），
//! 拖拽只改 DOM 的 left/top（纯前端，无 IPC，因此不脱手、不卡顿）。
//! 窗口默认鼠标穿透，Rust 轮询全局鼠标位置，悬停在宠物/面板交互区时临时关闭穿透。

use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State};

/// 追加一行诊断日志到 `~/.dsh-pet-desktop/diag.log`（排查桌宠不显示用）。
pub fn diag(msg: &str) {
    let dir = crate::config::app_dir();
    let _ = std::fs::create_dir_all(&dir);
    let line = format!("{} {}\n", crate::config::now_millis(), msg);
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("diag.log"))
    {
        let _ = f.write_all(line.as_bytes());
        let _ = f.flush();
    }
}

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())
}

#[derive(Serialize)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// 虚拟桌面包围盒（窗口覆盖区域；前端坐标以窗口左上角为原点，即此包围盒左上角）。
#[derive(Clone, Copy)]
struct Desktop {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

/// 命中区形状：`rect` = 矩形；`ellipse` = 以其 bounding box 为外接矩形取内接椭圆。
/// 前端把宠物本体上报为 ellipse，透明边角即可穿透到桌面；面板/菜单仍用 rect。
#[derive(Clone, Copy, serde::Deserialize, serde::Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum HitKind {
    #[default]
    Rect,
    Ellipse,
}

/// 前端上报的交互区（物理像素，窗口坐标系）。
#[derive(Clone, Copy, serde::Deserialize, serde::Serialize)]
pub struct HitRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub kind: HitKind,
}

/// 交互区集合（共享给穿透轮询线程）。
#[derive(Default)]
pub struct HitRegions(Arc<Mutex<Vec<HitRegion>>>);

/// 所有显示器组成的虚拟桌面包围盒（支持多屏、副屏负坐标）。
fn virtual_desktop(app: &AppHandle) -> Result<Desktop, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    for m in monitors {
        let p = m.position();
        let s = m.size();
        x0 = x0.min(p.x);
        y0 = y0.min(p.y);
        x1 = x1.max(p.x + s.width as i32);
        y1 = y1.max(p.y + s.height as i32);
    }
    if x0 == i32::MAX {
        return Err("未检测到显示器".to_string());
    }
    Ok(Desktop {
        x: x0,
        y: y0,
        width: (x1 - x0).max(1),
        height: (y1 - y0).max(1),
    })
}

/// 启动时把窗口铺满整个虚拟桌面，并启动穿透轮询线程。
pub fn setup_fullscreen(app: &AppHandle) -> Result<(), String> {
    let desktop = virtual_desktop(app)?;
    let win = main_window(app)?;
    diag(&format!(
        "setup: desktop={}x{} at {},{}",
        desktop.width, desktop.height, desktop.x, desktop.y
    ));
    win.set_position(PhysicalPosition::new(desktop.x, desktop.y))
        .map_err(|e| e.to_string())?;
    win.set_size(PhysicalSize::new(desktop.width as u32, desktop.height as u32))
        .map_err(|e| e.to_string())?;
    let actual = win.outer_size().map(|s| format!("{}x{}", s.width, s.height)).unwrap_or_default();
    diag(&format!(
        "setup: after resize actual={} scale={:?} visible={:?}",
        actual,
        win.scale_factor().ok(),
        win.is_visible().ok()
    ));
    // 尺寸/位置就位后再显示，避免启动时先闪现小窗口。
    win.show().map_err(|e| e.to_string())?;
    // 初始默认穿透；轮询线程会根据鼠标位置动态切换。
    win.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
    diag("setup: show + ignore_cursor_events(true) ok");

    // 穿透轮询：鼠标悬停在交互区时关闭穿透，否则穿透。
    let hit_regions = app.state::<HitRegions>().inner().0.clone();
    let win2 = win.clone();
    let mut last_hit = false;
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(16));
        let Ok(pos) = win2.cursor_position() else { continue };
        let hit = {
            let regs = match hit_regions.lock() {
                Ok(g) => g,
                Err(_) => continue,
            };
            regs.iter().any(|r| match r.kind {
                HitKind::Ellipse => {
                    if r.width <= 0.0 || r.height <= 0.0 {
                        return false;
                    }
                    let cx = r.x + r.width / 2.0;
                    let cy = r.y + r.height / 2.0;
                    let nx = (pos.x - cx) / (r.width / 2.0);
                    let ny = (pos.y - cy) / (r.height / 2.0);
                    nx * nx + ny * ny <= 1.0
                }
                HitKind::Rect => {
                    pos.x >= r.x && pos.x <= r.x + r.width && pos.y >= r.y && pos.y <= r.y + r.height
                }
            })
        };
        if hit != last_hit {
            last_hit = hit;
            let _ = win2.set_ignore_cursor_events(!hit);
        }
    });

    Ok(())
}

/// 前端上报交互区（宠物 + 面板的物理像素 bounding box，窗口坐标系）。
#[tauri::command]
pub fn set_hit_regions(state: State<'_, HitRegions>, regions: Vec<HitRegion>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = regions;
    Ok(())
}

/// 前端诊断日志落盘（排查桌宠不显示：视频加载/播放/位置等）。
#[tauri::command]
pub fn diag_log(msg: String) {
    diag(&msg);
}

/// 主显示器的工作区（逻辑像素，与前端 CSS 坐标系一致）。
/// 物理像素除以窗口 DPI scale（1.5 等），否则宠物 left/top 会偏移到屏幕外被裁切。
#[tauri::command]
pub async fn get_work_area(app: AppHandle) -> Result<WorkArea, String> {
    let desktop = virtual_desktop(&app)?;
    let win = main_window(&app)?;
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    // 默认位置固定用主显示器（用户主看的屏），避免鼠标落在副屏时宠物跑到副屏。
    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "未检测到主显示器".to_string())?;
    let area = monitor.work_area();
    let result = WorkArea {
        x: ((area.position.x - desktop.x) as f64 / scale).round() as i32,
        y: ((area.position.y - desktop.y) as f64 / scale).round() as i32,
        width: (area.size.width as f64 / scale).round() as i32,
        height: (area.size.height as f64 / scale).round() as i32,
    };
    Ok(result)
}
