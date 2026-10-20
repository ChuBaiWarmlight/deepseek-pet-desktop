// 心情系统 2.0：把「摸头/投喂/聊天/任务/熬夜/长时间没人理」变成可过期的心情，
// 供行为调度器选动作、台词 prompt 调语气、状态面板展示。

export type MoodId =
  | "normal"
  | "happy"
  | "shy"
  | "curious"
  | "bored"
  | "tired"
  | "sad"
  | "angry";

export interface MoodMeta {
  label: string;
  emoji: string;
  /** 数值越高越优先，低优先级心情不会覆盖高优先级心情。 */
  rank: number;
  /** 事件心情的默认持续时间；基线心情为 0。 */
  ttlMs: number;
  /** 注入 say prompt 的语气提示。 */
  prompt: string;
}

export const MOOD_META: Record<MoodId, MoodMeta> = {
  normal: {
    label: "正常",
    emoji: "🙂",
    rank: 0,
    ttlMs: 0,
    prompt: "",
  },
  bored: {
    label: "无聊",
    emoji: "😑",
    rank: 10,
    ttlMs: 0,
    prompt: "你现在有点无聊，主人好一会儿没理你了，语气懒散一点，可以主动找点事做或小声抱怨。",
  },
  curious: {
    label: "好奇",
    emoji: "👀",
    rank: 20,
    ttlMs: 60_000,
    prompt: "你现在很好奇，想知道主人在忙什么，语气里带一点探头探脑的试探，但别太吵。",
  },
  shy: {
    label: "害羞",
    emoji: "😳",
    rank: 30,
    ttlMs: 90_000,
    prompt: "你现在有点害羞，被主人碰到时会嘴硬、躲闪，但藏不住开心，语气可以更软一点。",
  },
  tired: {
    label: "困倦",
    emoji: "😴",
    rank: 35,
    ttlMs: 300_000,
    prompt: "你现在很困、迷迷糊糊的，语气慵懒、带着困意，说话慢吞吞的，偶尔打个哈欠。",
  },
  happy: {
    label: "开心",
    emoji: "😊",
    rank: 40,
    ttlMs: 120_000,
    prompt: "你现在心情很好、有点开心，语气软一点、更愿意撒娇和露馅式地关心。",
  },
  sad: {
    label: "低落",
    emoji: "😢",
    rank: 60,
    ttlMs: 180_000,
    prompt: "你现在有点低落，语气没有平时那么冲，偶尔走神，但被关心时会嘴硬地说没事。",
  },
  angry: {
    label: "生气",
    emoji: "😤",
    rank: 70,
    ttlMs: 30_000,
    prompt: "你现在有点不耐烦、被主人惹毛了，语气更冲更傲娇，但别真的伤人。",
  },
};

const MOOD_IDS = Object.keys(MOOD_META) as MoodId[];

export function normalizeMood(value: string | null | undefined): MoodId {
  if (value === "sleepy") return "tired";
  return MOOD_IDS.includes(value as MoodId) ? (value as MoodId) : "normal";
}

export function moodMeta(value: string | null | undefined): MoodMeta {
  return MOOD_META[normalizeMood(value)];
}

export function moodPromptLine(value: string | null | undefined): string {
  return moodMeta(value).prompt;
}

const FALLBACK_BY_MOOD: Partial<Record<MoodId, string[]>> = {
  happy: ["哼，今天心情好，就多陪你一会儿。", "才、才没有因为你摸我而开心呢。", "算你今天表现不错，勉强夸你一下。"],
  shy: ["别、别一直摸啦……", "再看我，我就躲起来了。", "……只准摸一下，听见没有。"],
  curious: ["你在忙什么呀？让我看看。", "咦，这个是什么？", "你是不是又背着我偷偷努力。"],
  bored: ["好无聊……你就不能理我一下吗？", "再没人陪我，我就要睡着了。", "喂，忙完了没有啊。"],
  tired: ["哈啊……好困，我先眯一会儿。", "这么晚了，你也早点睡吧……", "眼皮好重，说话都慢半拍了。"],
  sad: ["……没事，我自己待会儿。", "今天不太想说话，你别管我。", "哼，失败一次而已，才没有难过。"],
  angry: ["哼，不理你了。", "再戳我一下试试？", "你今天是故意惹我生气的吧。"],
};

/** LLM 不可用时的兜底台词：至少让语气跟当前心情一致。 */
export function fallbackLineFor(value: string | null | undefined, random = Math.random()): string | null {
  const lines = FALLBACK_BY_MOOD[normalizeMood(value)];
  if (!lines || !lines.length) return null;
  return lines[Math.min(lines.length - 1, Math.floor(random * lines.length))] ?? lines[0];
}

/** M 对象只要求这两个字段，便于直接传入模块级状态。 */
export interface MoodState {
  mood: string;
  moodUntilMs: number;
}

export interface MoodContext {
  now: number;
  idleMs: number;
  sleeping: boolean;
}

export interface SetMoodOptions {
  now?: number;
  ttlMs?: number;
  force?: boolean;
}

/** 没有事件心情时，由时间和空闲时长推导基线心情。 */
export function baselineMood(ctx: MoodContext): MoodId {
  if (ctx.sleeping) return "normal";
  const hour = new Date(ctx.now).getHours();
  if (hour >= 23 || hour < 6) return "tired";
  // 3–8 分钟没互动时进入「无聊」；再久会自动睡觉，由 sleeping 接管。
  if (ctx.idleMs >= 3 * 60_000) return "bored";
  return "normal";
}

/** 过期定时心情 → 回退基线心情；结果写回 state，调用方无需再判断。 */
export function resolveMood(state: MoodState, ctx: MoodContext): MoodId {
  if (state.moodUntilMs > ctx.now) {
    const active = normalizeMood(state.mood);
    state.mood = active;
    return active;
  }
  if (state.moodUntilMs !== 0) state.moodUntilMs = 0;
  const baseline = baselineMood(ctx);
  state.mood = baseline;
  return baseline;
}

/** 事件心情：默认按时长过期，低优先级不会覆盖高优先级；force 用于摸头/投喂哄好。 */
export function applyMood(state: MoodState, next: MoodId, options: SetMoodOptions = {}): boolean {
  const mood = normalizeMood(next);
  if (mood === "normal") return false;
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? MOOD_META[mood].ttlMs;
  if (ttlMs <= 0) return false;
  const active = state.moodUntilMs > now ? normalizeMood(state.mood) : "normal";
  if (!options.force && MOOD_META[mood].rank < MOOD_META[active].rank) return false;
  state.mood = mood;
  state.moodUntilMs = now + ttlMs;
  return true;
}
