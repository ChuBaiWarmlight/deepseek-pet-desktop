// DSH 桥接：探测在线状态、采集最近对话、任务看板感知。
// 仅当本机 DSH（默认 http://127.0.0.1:3080）在线时可用，离线时优雅降级。

import { bridge } from "./bridge";
import type { DshCheck, TaskEvent } from "./types";

export async function pollDsh(): Promise<DshCheck | null> {
  try {
    return await bridge.dshCheck();
  } catch {
    return null;
  }
}

export async function pollTaskboard(): Promise<TaskEvent | null> {
  try {
    const r = await bridge.dshTaskboard();
    return r.event;
  } catch {
    return null;
  }
}

/** 采集主人最近对话（供 say 上下文；缺口 G2 未补齐时返回空）。 */
export async function fetchRecentContext(): Promise<string[]> {
  try {
    const r = await bridge.dshContext();
    return r.online ? r.lines : [];
  } catch {
    return [];
  }
}
