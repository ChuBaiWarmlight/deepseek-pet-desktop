// 动画目录 / 成就 / 节日 / 存储键 / 常量。

/** 动画目录（56 个内置/兜底动作名；平台 manifest 会追加新的同类素材）。 */
export const CAT = {
  idle: "待机呼吸休闲",
  turn: "东张西望",
  moves: ["螃蟹走路", "原地漂浮踏步", "原地左转奔跑"],
  clicks: ["点击回应 - 开心跃动", "点击回应 - 害羞惊讶", "点击回应 - 傲娇生气（侧身展示）"],
  drag: "被鼠标拖拽悬空反馈",
  sleep: "原地小憩沉眠",
  wake: "打瞌睡被惊醒",
  focus: "写代码",
  celebrate: "可爱宅舞",
  stretch: "超大伸懒腰",
  acts: [
    "被挠痒",
    "被落叶淹没",
    "被吓一跳（炸毛）",
    "吃Token",
    "吃白饭",
    "吃冰淇淋融化",
    "吃晚餐",
    "吃午餐",
    "吃早餐",
    "吹气球",
    "大口吃零食",
    "动物环绕",
    "堆雪人",
    "放风筝",
    "哈欠连天",
    "鲸鱼吐泡泡特效",
    "蓝鲸现世",
    "赖床打滚",
    "女仆屈膝礼仪",
    "轻快记录",
    "轻快摇摆舞",
    "深度思考碎碎念",
    "偷吃零食被抓住",
    "偷看工作",
    "玩水枪",
    "玩游戏气急败坏",
    "小幅度原地 360 度旋转展示",
    "小提琴演奏",
    "摇扇纳凉",
    "用鲸鱼尾巴拍打地面",
    "优雅女仆舞",
    "悠闲哼歌",
    "原地蹲下玩玩具汽车",
    "原地敲击桌面互动",
    "原地跳跃抓碎头顶物品",
    "原地重力下蹲压缩",
    "原地专心玩魔方",
    "任务失败",
    "无聊待机",
    "照镜子",
    "整体换装试色",
    "中秋赏月吃月饼",
  ],
} as const;

export interface Achievement {
  id: string;
  icon: string;
  name: string;
  desc: string;
  key: string;
  need: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "chat", icon: "💬", name: "打开话匣子", desc: "第一次和桌宠聊天", key: "chat", need: 1 },
  { id: "feed", icon: "🍩", name: "干饭人", desc: "第一次投喂", key: "feed", need: 1 },
  { id: "eat", icon: "🗑️", name: "大胃王", desc: "吃掉 10 个文件", key: "eat", need: 10 },
  { id: "poke", icon: "💢", name: "抗揍", desc: "被戳 50 次", key: "poke", need: 50 },
  { id: "pet", icon: "🖐️", name: "摸头杀", desc: "被摸 30 次", key: "pet", need: 30 },
  { id: "focus", icon: "🍅", name: "专注达人", desc: "完成一次番茄专注", key: "focus", need: 1 },
  { id: "night", icon: "🌙", name: "夜猫子", desc: "深夜还在陪它", key: "night", need: 1 },
  { id: "affinity", icon: "💖", name: "好感爆棚", desc: "好感度达到 100", key: "affinity", need: 100 },
  { id: "collector", icon: "🏅", name: "收藏家", desc: "解锁 5 个成就", key: "unlocked", need: 5 },
];

/** 关系成长 2.0：阶段解锁台词风格、专属动作与小装扮。 */
export interface RelationStage {
  id: string;
  min: number;
  name: string;
  emoji: string;
  accessory: string;
  action: string;
  line: string;
}

export const RELATION_STAGES: RelationStage[] = [
  { id: "stranger", min: 0, name: "陌生", emoji: "🌱", accessory: "", action: "被落叶淹没", line: "还不太熟，保持一点距离。" },
  { id: "familiar", min: 20, name: "熟悉", emoji: "🌿", accessory: "🎀", action: "动物环绕", line: "开始记住你的习惯了。" },
  { id: "friend", min: 40, name: "朋友", emoji: "💫", accessory: "⭐", action: "鲸鱼吐泡泡特效", line: "愿意主动分享今天的心情。" },
  { id: "close", min: 60, name: "亲密", emoji: "💗", accessory: "💗", action: "中秋赏月吃月饼", line: "会撒娇，也会认真听你说话。" },
  { id: "dependent", min: 80, name: "依赖", emoji: "🌙", accessory: "👑", action: "蓝鲸现世", line: "把你当成最重要的人。" },
];

export function relationStageFor(affinity: number): RelationStage {
  const value = Math.max(0, Math.min(100, affinity));
  let stage = RELATION_STAGES[0];
  for (const item of RELATION_STAGES) if (value >= item.min) stage = item;
  return stage;
}

export function nextRelationStage(affinity: number): RelationStage | null {
  const current = relationStageFor(affinity);
  return RELATION_STAGES.find((s) => s.min > current.min) ?? null;
}

export const FESTIVALS: Record<string, string> = {
  "01-01": "元旦",
  "02-14": "情人节",
  "05-01": "劳动节",
  "06-01": "儿童节",
  "10-01": "国庆节",
  "10-31": "万圣节",
  "12-24": "平安夜",
  "12-25": "圣诞节",
};

export const MEM_CATS: Record<string, string> = {
  goal: "🎯 目标",
  deadline: "⏰ 时间点",
  preference: "💗 喜好",
  event: "📌 事件",
};

/** localStorage 键（仅高频交互状态；记忆/日记/聊天已迁 Rust）。 */
export const LS = {
  schema: "dsh.vpet.schema",
  state: "dsh.vpet.v1",
  achCounters: "dsh.vpet.ach.c",
  achUnlocked: "dsh.vpet.ach.u",
  day: "dsh.vpet.day",
  pendingYesterday: "dsh.vpet.day.pending",
  water: "dsh.vpet.water",
  festive: "dsh.vpet.festive",
  memDigest: "dsh.vpet.memdigest",
  review: "dsh.vpet.review",
  report: "dsh.vpet.report",
  relation: "dsh.vpet.relation",
} as const;

export const LS_SCHEMA_VERSION = 2;

/** 导出备份时打包的 localStorage 键。 */
export const LS_EXPORT_KEYS = [
  LS.state,
  LS.achCounters,
  LS.achUnlocked,
  LS.day,
  LS.pendingYesterday,
  LS.water,
  LS.festive,
  LS.memDigest,
  LS.review,
  LS.report,
  LS.relation,
] as const;

/** 宠物视频原始尺寸。 */
export const VIDEO_W = 640;
export const VIDEO_H = 360;

/** 内置主题：同一套 CSS 令牌换色，不额外下载资源。 */
export const THEMES = [
  {
    id: "strawberry",
    name: "草莓奶油",
    emoji: "🍓",
    colors: ["#ff5d8f", "#1fc4a4", "#9a7bf5"],
    aliases: ["sakura", "strawberry", "pink", "default", "草莓", "草莓奶油", "樱粉"],
  },
  {
    id: "mint",
    name: "薄荷苏打",
    emoji: "🌿",
    colors: ["#15b79e", "#ff9f5a", "#5b8def"],
    aliases: ["mint", "matcha", "teal", "green", "薄荷", "薄荷苏打", "抹茶"],
  },
  {
    id: "ocean",
    name: "海盐蓝",
    emoji: "🌊",
    colors: ["#3b82f6", "#14b8a6", "#8b5cf6"],
    aliases: ["ocean", "blue", "sea", "海盐", "海盐蓝", "海洋"],
  },
  {
    id: "lavender",
    name: "夜莓紫",
    emoji: "🌙",
    colors: ["#a855f7", "#ec4899", "#6366f1"],
    aliases: ["lavender", "purple", "night", "夜莓", "夜莓紫", "葡萄", "星夜"],
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/** 平台命令/旧配置里的主题标识 → 内置主题 id。 */
export function themeFromValue(value: unknown): ThemeId | null {
  const key = String(value ?? "").trim().toLowerCase();
  if (!key) return null;
  for (const theme of THEMES) {
    if (theme.id === key || theme.name.toLowerCase() === key) return theme.id;
    if (theme.aliases.some((alias) => alias.toLowerCase() === key)) return theme.id;
  }
  return null;
}

export type Period = "night" | "morning" | "afternoon" | "evening";

export function getPeriod(): Period {
  const h = new Date().getHours();
  if (h >= 23 || h < 6) return "night";
  if (h < 11) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

export function validScale(s: unknown): s is number {
  return typeof s === "number" && s >= 0.3 && s <= 1.2;
}

export function pick<T>(pool: readonly T[], exclude?: T): T | null {
  if (!pool || pool.length === 0) return null;
  let i = Math.floor(Math.random() * pool.length);
  if (exclude != null && pool.length > 1 && pool[i] === exclude) i = (i + 1) % pool.length;
  return pool[i];
}

/** 解析 HH:MM 为当日分钟数；非法返回 null。 */
export function parseHHMM(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 当前是否处于安静时段（支持 23:00 → 07:00 这类跨午夜区间）。 */
export function isQuietTime(from: string, to: string, now = new Date()): boolean {
  const a = parseHHMM(from);
  const b = parseHHMM(to);
  if (a === null || b === null || a === b) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

/** 主动吐槽的最小间隔：0 → 30 分钟，50 → 5 分钟，100 → 1 分钟。 */
export function ambientGapMs(talkativity: number): number {
  const v = Math.max(0, Math.min(100, talkativity));
  const ms = v <= 50 ? 30 - (v / 50) * 25 : 5 - ((v - 50) / 50) * 4;
  return ms * 60_000;
}

/** 主动搭话的最小间隔：0 → 90 分钟，50 → 25 分钟，100 → 6 分钟。 */
export function proactiveGapMs(talkativity: number): number {
  const v = Math.max(0, Math.min(100, talkativity));
  const ms = v <= 50 ? 90 - (v / 50) * 65 : 25 - ((v - 50) / 50) * 19;
  return ms * 60_000;
}

/** 话痨程度对应的随机开口概率（15% ~ 100%）。 */
export function ambientChance(talkativity: number): number {
  return 0.15 + (Math.max(0, Math.min(100, talkativity)) / 100) * 0.85;
}

const MEETING_ALWAYS = /zoom|webex|wemeet|voov|tencentmeeting|腾讯会议/i;
const MEETING_WITH_TITLE = /teams|dingtalk|feishu|lark|wechat|微信|钉钉|飞书|slack|discord/i;
const MEETING_TITLE_HINT = /(会议|通话|语音|视频聊天|meeting|call|huddle|voice\s*connected)/i;

/** 根据前台应用名/窗口标题判断是否处于会议或通话场景。 */
export function isMeetingForeground(name: string, title: string): boolean {
  const app = String(name || "");
  const win = String(title || "");
  if (!app) return false;
  if (MEETING_ALWAYS.test(app)) return true;
  return MEETING_WITH_TITLE.test(app) && MEETING_TITLE_HINT.test(win);
}
