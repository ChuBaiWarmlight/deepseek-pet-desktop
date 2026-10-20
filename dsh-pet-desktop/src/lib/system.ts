// 系统感知：前台应用 / 系统空闲 / 电量（Rust 侧 Win32 读取，失败时降级为 null）。
// 与 dsh.ts 一致：任何异常都返回 null，调用方自行回退到伪空闲等旧逻辑。

import { bridge } from "./bridge";
import type { SystemSnapshot } from "./types";

export async function pollSystem(): Promise<SystemSnapshot | null> {
  try {
    return await bridge.systemSnapshot();
  } catch {
    return null;
  }
}
