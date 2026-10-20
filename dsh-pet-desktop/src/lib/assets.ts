// 资源平台桥接（前端侧）：动态动画池 + 视频 URL 解析。
// 目标：桌宠的动画池不再只依赖内置 CAT，而是从平台 manifest 动态构建，
// 实现「上传即学会新动作」；视频优先走内置/缓存，平台新增动作走下载缓存。

import { bridge } from "./bridge";
import type { AssetsItem } from "./types";
import { CAT } from "./constants";

/** 动画池槽位结构（与 CAT 一致，但内容可被平台 manifest 覆盖）。 */
export interface AnimPool {
  idle: string;
  turn: string;
  moves: string[];
  clicks: string[];
  drag: string;
  sleep: string;
  wake: string;
  focus: string;
  celebrate: string;
  stretch: string;
  acts: string[];
}

/** 平台分类 → 桌宠动画槽位 映射。 */
const CATEGORY_TO_SLOT: Record<string, keyof AnimPool> = {
  idle: "idle",
  turn: "turn",
  move: "moves",
  click: "clicks",
  drag: "drag",
  sleep: "sleep",
  wake: "wake",
  focus: "focus",
  celebrate: "celebrate",
  stretch: "stretch",
  act: "acts",
};

/** 数组槽位（这些槽位可以有多个动画，随机选取）。 */
const ARRAY_SLOTS = new Set<keyof AnimPool>(["moves", "clicks", "acts"]);

/** 内置动画名集合（打进 exe 的离线兜底动画，永远用内置资源，不下载缓存）。
 *  为减小 exe 体积，仅保留核心状态循环 + 基础交互；其余动作走平台下载缓存。 */
const BUILTIN_NAMES = new Set<string>([
  CAT.idle,
  CAT.turn,
  CAT.drag,
  CAT.sleep,
  CAT.wake,
]);

/** 非内置动画解析失败时回退到的兜底动画（保证打进 exe 的 idle）。 */
export const FALLBACK_ANIM = CAT.idle;

/** 从平台 manifest items 构建动画池：内置 CAT 打底，平台资源按 category 覆盖/追加。 */
export function buildAnimPool(items: AssetsItem[]): AnimPool {
  const pool: AnimPool = {
    idle: CAT.idle,
    turn: CAT.turn,
    moves: [...CAT.moves],
    clicks: [...CAT.clicks],
    drag: CAT.drag,
    sleep: CAT.sleep,
    wake: CAT.wake,
    focus: CAT.focus,
    celebrate: CAT.celebrate,
    stretch: CAT.stretch,
    acts: [...CAT.acts],
  };

  // 按槽位收集平台资源名（去掉 .webm 后缀）
  const bySlot: Partial<Record<keyof AnimPool, string[]>> = {};
  for (const item of items) {
    const slot = CATEGORY_TO_SLOT[item.category];
    if (!slot) continue;
    const name = item.file.replace(/\.webm$/, "");
    if (!name) continue;
    (bySlot[slot] ||= []).push(name);
  }

  for (const slot of Object.keys(bySlot) as (keyof AnimPool)[]) {
    const names = bySlot[slot];
    if (!names || !names.length) continue;
    if (ARRAY_SLOTS.has(slot)) {
      const arr = pool[slot] as string[];
      for (const n of names) if (!arr.includes(n)) arr.push(n);
    } else {
      (pool[slot] as string) = names[0];
    }
  }

  return pool;
}

/** 判断动画名是否内置（内置动画直接用内置资源，不下载缓存）。 */
export function isBuiltinName(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}

/** 兜底动画的内置 URL（非内置动画解析失败时回退到这个，避免加载不存在的内置视频）。 */
function fallbackVideoUrl(): string {
  return `/assets/videos/${encodeURIComponent(FALLBACK_ANIM)}.webm`;
}

/** 解析动画名到可直接赋给 `<video src>` 的 URL。
 *  内置动画：直接用内置相对路径（不下载）；平台新增动作：走缓存（convertFileSrc）或下载；
 *  平台离线且未缓存时回退到兜底动画（idle），避免播放一个不存在的内置视频（否则会 404 → emoji 占位）。 */
export async function resolveVideoUrl(name: string): Promise<string> {
  if (BUILTIN_NAMES.has(name)) {
    return `/assets/videos/${encodeURIComponent(name)}.webm`;
  }
  try {
    const r = await bridge.assetsResolve(name);
    // builtin=true 表示非法名/未启用时回退内置；否则 path 是平台 HTTP URL（直接 src）
    return r.builtin ? fallbackVideoUrl() : r.path;
  } catch {
    return fallbackVideoUrl();
  }
}
