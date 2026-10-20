// 统一行为调度器：所有动画/主动开口先经过同一套优先级，不再由各定时器各自 roll。
// 优先级（高 → 低）：睡觉 > 专注 > DSH 事件 > 用户交互 > 环境随机。

import type { AnimPool } from "./assets";

export type SceneMode = "auto" | "work" | "rest" | "dnd";
export type BehaviorPriority = "sleep" | "focus" | "dsh" | "interaction" | "ambient";

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

export function priorityLabel(priority: BehaviorPriority): string {
  return PRIORITY_LABEL[priority];
}

export function sceneLabel(mode: SceneMode): string {
  if (mode === "work") return "工作";
  if (mode === "rest") return "休息";
  if (mode === "dnd") return "勿扰";
  return "自动";
}

export class BehaviorScheduler {
  private lastInteractionAt = 0;
  private dshUntil = 0;

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

  animationFor(pool: AnimPool, priority: BehaviorPriority, sceneMode: SceneMode, random = Math.random()):
    | { name: string; durMs: number }
    | null {
    if (priority === "sleep") return { name: pool.sleep, durMs: 15_000 };
    if (priority === "focus") return { name: pool.focus, durMs: 8_000 };
    if (priority === "dsh") return { name: pool.turn, durMs: 5_000 };
    if (priority === "interaction") return { name: pool.idle, durMs: 5_000 };

    if (sceneMode === "work") {
      return random < 0.7 ? { name: pool.focus, durMs: 9_000 } : { name: pool.idle, durMs: 14_000 };
    }
    if (sceneMode === "dnd") return { name: pool.idle, durMs: 18_000 };
    if (sceneMode === "rest") {
      return random < 0.74
        ? { name: pool.idle, durMs: 16_000 + Math.random() * 6_000 }
        : { name: pool.sleep, durMs: 18_000 };
    }

    const roll = random;
    if (roll < 0.62) return { name: pool.idle, durMs: 10_000 + random * 6_000 };
    if (roll < 0.76) return { name: pool.turn, durMs: 8_000 };
    if (roll < 0.94 && pool.acts.length > 0) {
      return { name: pool.acts[Math.floor(random * pool.acts.length)], durMs: 8_000 + random * 4_000 };
    }
    if (pool.moves.length > 0) {
      return { name: pool.moves[Math.floor(random * pool.moves.length)], durMs: 10_000 };
    }
    return { name: pool.idle, durMs: 12_000 };
  }
}

