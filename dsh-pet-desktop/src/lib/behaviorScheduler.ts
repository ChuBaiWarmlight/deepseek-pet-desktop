// 统一行为调度器：所有动画/主动开口先经过同一套优先级，不再由各定时器各自 roll。
// 优先级（高 → 低）：睡觉 > 专注 > DSH 事件 > 用户交互 > 环境随机。
//
// v0.3 起，动画选择在原始权重之上叠加「时间 / 场景 / 心情 / 冷却」评分：
// - 素材没有语义标签时系数恒为 1，完全保持旧行为；
// - 所有候选都被压到 0 时回退到加权随机，保证任何情况下都能选出动画。

import { pickWeighted, type AnimPool, type AnimSlot, type AnimVariant } from "./assets";

export type SceneMode = "auto" | "work" | "rest" | "dnd";
export type BehaviorPriority = "sleep" | "focus" | "dsh" | "interaction" | "ambient";
export type TimeSlice = "morning" | "day" | "evening" | "night";

export interface BehaviorSnapshot {
  now: number;
  sleeping: boolean;
  focus: boolean;
  busy: boolean;
  hidden: boolean;
  muted: boolean;
  quiet: boolean;
  meeting: boolean;
  sceneMode: SceneMode;
  /** 当前心情（normal / angry / happy / sad / tired ...），影响动作评分。 */
  mood: string;
}

export interface AnimationContext {
  now?: number;
  mood?: string;
  focus?: boolean;
  sceneMode?: SceneMode;
}

export interface BehaviorDecision {
  priority: BehaviorPriority;
  allowAmbientSpeech: boolean;
  allowAmbientAnimation: boolean;
  allowParticles: boolean;
  allowProactiveVoice: boolean;
  reason: string;
}

const PRIORITY_LABEL: Record<BehaviorPriority, string> = {
  sleep: "睡觉",
  focus: "专注",
  dsh: "DSH 事件",
  interaction: "用户交互",
  ambient: "环境随机",
};

/** 调度器最近一次抽中结果，便于日志/设置页观察「为什么播这个」。 */
export interface PickInfo {
  slot: AnimSlot;
  name: string;
  score: number;
  tags: string[];
}

const SEMANTIC_KEYS = new Set(["time", "scene", "mood"]);
const TIME_MATCH = 1.6;
const TIME_MISS = 0.12;
const SCENE_MATCH = 1.8;
const SCENE_MISS = 0.18;
const MOOD_MATCH = 1.8;
const MOOD_MISS = 0.5;
/** 冷却期内把权重压到几乎为 0，但仍保留极小概率，避免候选池被清空。 */
const COOLDOWN_FACTOR = 0.02;
/** 上一次刚播过的动作只降权、不硬排除；否则两个候选会退化成 50/50 轮流。 */
const REPEAT_FACTOR = 0.5;
const DEFAULT_COOLDOWN_MS: Partial<Record<AnimSlot, number>> = {
  act: 45_000,
  move: 45_000,
  celebrate: 120_000,
};

export function priorityLabel(priority: BehaviorPriority): string {
  return PRIORITY_LABEL[priority];
}

export function sceneLabel(mode: SceneMode): string {
  if (mode === "work") return "工作";
  if (mode === "rest") return "休息";
  if (mode === "dnd") return "勿扰";
  return "自动";
}

export function timeSliceOf(now: number): TimeSlice {
  const hour = new Date(now).getHours();
  if (hour >= 6 && hour < 10) return "morning";
  if (hour >= 10 && hour < 18) return "day";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

export function timeSliceLabel(slice: TimeSlice): string {
  if (slice === "morning") return "早晨";
  if (slice === "day") return "白天";
  if (slice === "evening") return "晚上";
  return "深夜";
}

function timeTokensOf(now: number): Set<string> {
  const tokens = new Set<string>([timeSliceOf(now)]);
  const day = new Date(now).getDay();
  tokens.add(day === 0 || day === 6 ? "weekend" : "weekday");
  return tokens;
}

function sceneTokensOf(ctx: AnimationContext, now: number): Set<string> {
  const tokens = new Set<string>();
  const mode = ctx.sceneMode ?? "auto";
  if (mode === "work" || ctx.focus) tokens.add("work");
  if (mode === "rest" || mode === "dnd") tokens.add("rest");
  if (timeSliceOf(now) === "night") tokens.add("night");
  const hour = new Date(now).getHours();
  if ((hour >= 7 && hour <= 9) || (hour >= 11 && hour <= 13) || (hour >= 17 && hour <= 19)) {
    tokens.add("meal");
  }
  return tokens;
}

function tagValues(tags: string[], key: string): string[] {
  const prefix = `${key}:`;
  return tags.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length));
}

function hasSemanticTag(tags: string[]): boolean {
  return tags.some((tag) => SEMANTIC_KEYS.has(tag.split(":", 1)[0]));
}

function contextFactor(
  tags: string[],
  key: string,
  tokens: Set<string>,
  matchFactor: number,
  missFactor: number,
): number {
  const values = tagValues(tags, key);
  if (!values.length) return 1;
  return values.some((value) => tokens.has(value)) ? matchFactor : missFactor;
}

function cooldownMsOf(variant: AnimVariant, slot: AnimSlot): number {
  const raw = tagValues(variant.tags ?? [], "cooldown")[0];
  if (raw !== undefined) {
    const secs = Number(raw);
    if (Number.isFinite(secs)) return Math.max(0, Math.min(3600, secs)) * 1000;
  }
  return DEFAULT_COOLDOWN_MS[slot] ?? 0;
}

interface ScoreContext {
  now: number;
  time: Set<string>;
  scene: Set<string>;
  mood: Set<string>;
  playedAt: Map<string, number>;
}

function scoreVariant(variant: AnimVariant, slot: AnimSlot, ctx: ScoreContext): number {
  if (!(variant.weight > 0)) return 0;
  let score = variant.weight;
  const tags = variant.tags ?? [];
  if (hasSemanticTag(tags)) {
    score *= contextFactor(tags, "time", ctx.time, TIME_MATCH, TIME_MISS);
    score *= contextFactor(tags, "scene", ctx.scene, SCENE_MATCH, SCENE_MISS);
    score *= contextFactor(tags, "mood", ctx.mood, MOOD_MATCH, MOOD_MISS);
  }
  const cooldown = cooldownMsOf(variant, slot);
  if (cooldown > 0) {
    const last = ctx.playedAt.get(variant.name);
    if (last !== undefined && ctx.now - last < cooldown) score *= COOLDOWN_FACTOR;
  }
  return score;
}

export class BehaviorScheduler {
  private lastInteractionAt = 0;
  private dshUntil = 0;
  private lastPick: Partial<Record<AnimSlot, string>> = {};
  private playedAt = new Map<string, number>();
  private lastInfo: PickInfo | null = null;

  get lastPickInfo(): PickInfo | null {
    return this.lastInfo;
  }

  /** 按上下文评分后抽取一个动画；无标签素材走原加权随机。 */
  private pick(pool: AnimPool, slot: AnimSlot, context: AnimationContext, rng: () => number): string {
    const variants = pool.variants[slot] ?? [];
    const now = context.now ?? Date.now();
    if (!variants.length) {
      const name = pickWeighted(pool, slot, this.lastPick[slot], rng());
      this.lastPick[slot] = name;
      this.lastInfo = { slot, name, score: 0, tags: [] };
      return name;
    }

    const scoreCtx: ScoreContext = {
      now,
      time: timeTokensOf(now),
      scene: sceneTokensOf(context, now),
      mood: new Set([(context.mood ?? "normal").toLowerCase()]),
      playedAt: this.playedAt,
    };
    const scored = variants
      .filter((variant) => variant.weight > 0)
      .map((variant) => ({ variant, score: scoreVariant(variant, slot, scoreCtx) }));
    const positive = scored.filter((item) => item.score > 0);
    if (!positive.length) {
      const name = pickWeighted(pool, slot, this.lastPick[slot], rng());
      this.lastPick[slot] = name;
      this.lastInfo = { slot, name, score: 0, tags: [] };
      return name;
    }

    const previous = this.lastPick[slot];
    const candidates = previous
      ? positive.map((item) => (item.variant.name === previous ? { ...item, score: item.score * REPEAT_FACTOR } : item))
      : positive;
    const total = candidates.reduce((sum, item) => sum + item.score, 0);
    let roll = Math.min(Math.max(rng(), 0), 0.999999999) * total;
    let chosen = candidates[candidates.length - 1];
    for (const item of candidates) {
      roll -= item.score;
      if (roll < 0) {
        chosen = item;
        break;
      }
    }

    const name = chosen.variant.name;
    this.lastPick[slot] = name;
    this.playedAt.set(name, now);
    this.lastInfo = { slot, name, score: chosen.score, tags: chosen.variant.tags ?? [] };
    return name;
  }

  noteInteraction(now = Date.now()): void {
    this.lastInteractionAt = now;
  }

  noteDshEvent(now = Date.now(), ttlMs = 12_000): void {
    this.dshUntil = Math.max(this.dshUntil, now + ttlMs);
  }

  decision(s: BehaviorSnapshot): BehaviorDecision {
    let priority: BehaviorPriority = "ambient";
    let reason = "ambient";
    if (s.sleeping) {
      priority = "sleep";
      reason = "sleeping";
    } else if (s.focus) {
      priority = "focus";
      reason = "focus-timer";
    } else if (s.busy || s.now < this.dshUntil) {
      priority = "dsh";
      reason = "dsh-active";
    } else if (s.now - this.lastInteractionAt < 8_000) {
      priority = "interaction";
      reason = "recent-interaction";
    } else if (s.sceneMode === "work") {
      priority = "focus";
      reason = "scene-work";
    }

    const blocked = s.hidden || s.muted || s.quiet || s.meeting || s.sceneMode === "dnd";
    return {
      priority,
      allowAmbientSpeech: !blocked && priority !== "sleep" && priority !== "focus",
      allowAmbientAnimation: !s.hidden,
      allowParticles: !s.hidden && !s.meeting && s.sceneMode !== "dnd",
      allowProactiveVoice: !blocked && priority !== "sleep" && priority !== "focus",
      reason,
    };
  }

  shouldAmbientSpeak(
    decision: BehaviorDecision,
    talkativity: number,
    chanceFactor: number,
    random = Math.random(),
  ): boolean {
    if (!decision.allowAmbientSpeech) return false;
    const base = 0.15 + (Math.max(0, Math.min(100, talkativity)) / 100) * 0.85;
    const factor = Math.max(0, Math.min(2, chanceFactor));
    return random < base * factor;
  }

  animationFor(
    pool: AnimPool,
    priority: BehaviorPriority,
    sceneMode: SceneMode,
    context: AnimationContext = {},
    rng: () => number = Math.random,
  ): { name: string; durMs: number; slot: AnimSlot } | null {
    const ctx: AnimationContext = { ...context, sceneMode };
    const now = ctx.now ?? Date.now();
    const night = timeSliceOf(now) === "night";

    if (priority === "sleep") return { name: this.pick(pool, "sleep", ctx, rng), durMs: 15_000, slot: "sleep" };
    if (priority === "focus") return { name: this.pick(pool, "focus", ctx, rng), durMs: 8_000, slot: "focus" };
    if (priority === "dsh") return { name: this.pick(pool, "turn", ctx, rng), durMs: 5_000, slot: "turn" };
    if (priority === "interaction") return { name: this.pick(pool, "idle", ctx, rng), durMs: 5_000, slot: "idle" };

    if (sceneMode === "work") {
      return rng() < 0.7
        ? { name: this.pick(pool, "focus", ctx, rng), durMs: 9_000, slot: "focus" }
        : { name: this.pick(pool, "idle", ctx, rng), durMs: 14_000, slot: "idle" };
    }
    if (sceneMode === "dnd") return { name: this.pick(pool, "idle", ctx, rng), durMs: 18_000, slot: "idle" };
    if (sceneMode === "rest") {
      return rng() < 0.74
        ? { name: this.pick(pool, "idle", ctx, rng), durMs: 16_000 + rng() * 6_000, slot: "idle" }
        : { name: this.pick(pool, "sleep", ctx, rng), durMs: 18_000, slot: "sleep" };
    }

    const roll = rng();
    if (roll < 0.62) {
      const base = night ? 16_000 : 10_000;
      return { name: this.pick(pool, "idle", ctx, rng), durMs: base + rng() * 6_000, slot: "idle" };
    }
    if (roll < 0.76) return { name: this.pick(pool, "turn", ctx, rng), durMs: 8_000, slot: "turn" };
    if (roll < 0.94 && pool.acts.length > 0) {
      return { name: this.pick(pool, "act", ctx, rng), durMs: 8_000 + rng() * 4_000, slot: "act" };
    }
    if (pool.moves.length > 0) return { name: this.pick(pool, "move", ctx, rng), durMs: 10_000, slot: "move" };
    return { name: this.pick(pool, "idle", ctx, rng), durMs: 12_000, slot: "idle" };
  }
}
