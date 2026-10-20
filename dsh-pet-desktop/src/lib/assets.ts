// 资源平台桥接（前端侧）：动态动画池 + 视频 URL 解析。
// 目标：桌宠的动画池不再只依赖内置 CAT，而是从平台 manifest 动态构建，
// 实现「上传即学会新动作」；视频优先走内置/缓存，平台新增动作走下载缓存。

import { bridge } from "./bridge";
import type { AssetsItem } from "./types";
import { CAT } from "./constants";

/** 动画槽位（平台分类与桌宠行为共用的一套名字）。 */
export type AnimSlot =
  | "idle"
  | "turn"
  | "move"
  | "click"
  | "drag"
  | "sleep"
  | "wake"
  | "focus"
  | "celebrate"
  | "stretch"
  | "act";

/** 一个可播放动画及其被抽中的相对权重。 */
export interface AnimVariant {
  name: string;
  weight: number;
  /** 语义标签，格式 `key:value`，例如 `scene:work`、`mood:happy`、`cooldown:300`。 */
  tags: string[];
}

/** 动画池槽位结构（与 CAT 一致，但内容可被平台 manifest 覆盖）。
 *  `variants` 保存每个分类的全部候选，调度器按 weight 加权抽取；
 *  顶层字符串/数组保留为兼容字段，也是平台离线时的兜底。 */
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
  variants: Record<AnimSlot, AnimVariant[]>;
}

/** 平台分类 → 桌宠动画槽位 映射。 */
const CATEGORY_TO_SLOT: Record<string, AnimSlot> = {
  idle: "idle",
  turn: "turn",
  move: "move",
  click: "click",
  drag: "drag",
  sleep: "sleep",
  wake: "wake",
  focus: "focus",
  celebrate: "celebrate",
  stretch: "stretch",
  act: "act",
};

const SLOT_ORDER: AnimSlot[] = [
  "idle",
  "turn",
  "move",
  "click",
  "drag",
  "sleep",
  "wake",
  "focus",
  "celebrate",
  "stretch",
  "act",
];

function emptyVariants(): Record<AnimSlot, AnimVariant[]> {
  return {
    idle: [],
    turn: [],
    move: [],
    click: [],
    drag: [],
    sleep: [],
    wake: [],
    focus: [],
    celebrate: [],
    stretch: [],
    act: [],
  };
}

function primaryName(pool: AnimPool, slot: AnimSlot): string {
  switch (slot) {
    case "idle":
      return pool.idle;
    case "turn":
      return pool.turn;
    case "move":
      return pool.moves[0] ?? pool.idle;
    case "click":
      return pool.clicks[0] ?? pool.idle;
    case "drag":
      return pool.drag;
    case "sleep":
      return pool.sleep;
    case "wake":
      return pool.wake;
    case "focus":
      return pool.focus;
    case "celebrate":
      return pool.celebrate;
    case "stretch":
      return pool.stretch;
    case "act":
      return pool.acts[0] ?? pool.idle;
  }
}

function setPrimary(pool: AnimPool, slot: AnimSlot, name: string): void {
  switch (slot) {
    case "idle":
      pool.idle = name;
      break;
    case "turn":
      pool.turn = name;
      break;
    case "drag":
      pool.drag = name;
      break;
    case "sleep":
      pool.sleep = name;
      break;
    case "wake":
      pool.wake = name;
      break;
    case "focus":
      pool.focus = name;
      break;
    case "celebrate":
      pool.celebrate = name;
      break;
    case "stretch":
      pool.stretch = name;
      break;
    case "move":
    case "click":
    case "act":
      break;
  }
}

function addVariant(pool: AnimPool, slot: AnimSlot, name: string, weight = 100, tags: string[] = []): void {
  if (!name) return;
  const list = pool.variants[slot];
  const w = Number.isFinite(weight) ? Math.max(0, Math.min(1000, Math.round(weight))) : 100;
  const cleanTags = Array.isArray(tags)
    ? tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
  const existing = list.find((v) => v.name === name);
  if (existing) {
    existing.tags = mergeUnique(existing.tags, cleanTags);
    if (w > 0) existing.weight = w;
    return;
  }
  list.push({ name, weight: w, tags: cleanTags });
}

function mergeUnique(target: string[], names: string[]): string[] {
  for (const n of names) if (!target.includes(n)) target.push(n);
  return target;
}

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
    variants: emptyVariants(),
  };

  // 内置 CAT 先入池，保证平台离线时每个分类都有可播放的兜底。
  addVariant(pool, "idle", CAT.idle);
  addVariant(pool, "turn", CAT.turn);
  for (const n of CAT.moves) addVariant(pool, "move", n);
  for (const n of CAT.clicks) addVariant(pool, "click", n);
  addVariant(pool, "drag", CAT.drag);
  addVariant(pool, "sleep", CAT.sleep);
  addVariant(pool, "wake", CAT.wake);
  addVariant(pool, "focus", CAT.focus);
  addVariant(pool, "celebrate", CAT.celebrate);
  addVariant(pool, "stretch", CAT.stretch);
  for (const n of CAT.acts) addVariant(pool, "act", n);

  // 按槽位收集平台资源名（去掉 .webm 后缀）与权重。
  const bySlot: Partial<Record<AnimSlot, string[]>> = {};
  for (const item of items) {
    const slot = CATEGORY_TO_SLOT[item.category];
    if (!slot) continue;
    const name = item.file.replace(/\.webm$/i, "");
    if (!name) continue;
    addVariant(
      pool,
      slot,
      name,
      typeof item.weight === "number" ? item.weight : 100,
      Array.isArray(item.tags) ? item.tags : [],
    );
    (bySlot[slot] ||= []).push(name);
  }

  for (const slot of SLOT_ORDER) {
    const names = bySlot[slot];
    if (!names || !names.length) continue;
    if (slot === "move") pool.moves = mergeUnique(pool.moves, names);
    else if (slot === "click") pool.clicks = mergeUnique(pool.clicks, names);
    else if (slot === "act") pool.acts = mergeUnique(pool.acts, names);
    else setPrimary(pool, slot, names[0]);
  }

  return pool;
}

/** 按权重抽取一个动画；`exclude` 用于避免同一个动作连续播放。
 *  权重为 0 的变体视为停用；全部停用时回退到该槽位的主动画。 */
/** 从一组候选里按权重抽取；供调度器在上下文过滤后复用。 */
export function pickWeightedVariants(
  variants: AnimVariant[],
  fallback: string,
  exclude?: string,
  random = Math.random(),
): string {
  const available = variants.filter((v) => v.weight > 0);
  if (!available.length) return fallback;
  const candidates = exclude && available.length > 1 ? available.filter((v) => v.name !== exclude) : available;
  const total = candidates.reduce((sum, v) => sum + v.weight, 0);
  if (total <= 0) return fallback;
  let roll = Math.min(Math.max(random, 0), 0.999999999) * total;
  for (const v of candidates) {
    roll -= v.weight;
    if (roll < 0) return v.name;
  }
  return candidates[candidates.length - 1].name;
}

export function pickWeighted(
  pool: AnimPool,
  slot: AnimSlot,
  exclude?: string,
  random = Math.random(),
): string {
  return pickWeightedVariants(pool.variants[slot] || [], primaryName(pool, slot), exclude, random);
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
