//! Tauri 命令模块：按业务域拆分。
//! 说明：`config / window / autostart / tray` 属于基础设施，放在 `src/` 顶层；本目录是业务命令。

pub mod assets;
pub mod backup;
pub mod dsh;
pub mod fs;
pub mod llm;
pub mod memory;
pub mod pet;
pub mod records;
pub mod sync;
