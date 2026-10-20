// PetApp：桌宠本体 + 交互 + 面板 + 定时器。移植自 client.js，适配桌面窗口模型。
//
// 窗口模型：窗口即画布，宠物锚定窗口左下角；拖拽宠物 = 移动系统窗口；面板打开时放大窗口。
// 数据分层：高频交互状态存 localStorage，记忆/日记/聊天存 Rust 侧 records.json。

import React, { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import * as ai from "./lib/ai";
import { beep } from "./lib/audio";
import { bridge } from "./lib/bridge";
import { decryptJson, encryptJson, looksEncrypted } from "./lib/crypto";
import {
  ACHIEVEMENTS,
  FESTIVALS,
  LS,
  LS_EXPORT_KEYS,
  RELATION_STAGES,
  THEMES,
  VIDEO_H,
  VIDEO_W,
  ambientGapMs,
  fmtClock,
  getPeriod,
  isMeetingForeground,
  isQuietTime,
  parseHHMM,
  proactiveGapMs,
  relationStageFor,
  themeFromValue,
  todayStr,
  validScale,
} from "./lib/constants";
import type { Achievement, ThemeId } from "./lib/constants";
import { buildAnimPool, isBuiltinName, resolveVideoUrl, FALLBACK_ANIM, type AnimPool } from "./lib/assets";
import {
  BehaviorScheduler,
  sceneLabel,
  type BehaviorSnapshot,
  type SceneMode,
} from "./lib/behaviorScheduler";
import { fetchRecentContext, pollDsh, pollTaskboard } from "./lib/dsh";
import { pollSystem } from "./lib/system";
import { renderReportCard } from "./lib/reportCard";
import { loadJson, saveJson } from "./lib/storage";
import { clamp, pick2 } from "./lib/utils";
import { primeVoices, speak, stopSpeaking } from "./lib/voice";
import type {
  ChatTurn,
  DailyReport,
  DayStats,
  DiaryEntry,
  DshCheck,
  HitRegion,
  Memory,
  PetCommand,
  Records,
  SystemSnapshot,
  TrashItem,
} from "./lib/types";
import { ChatPanel } from "./components/ChatPanel";
import { DailyReportPanel } from "./components/DailyReportPanel";
import { DiaryPanel } from "./components/DiaryPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { PetStage } from "./components/PetStage";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusPanel } from "./components/StatusPanel";

interface Particle {
  id: number;
  x: number; // 水平位置：相对窗口宽度的百分比（8~92）
  y: number; // 垂直起始偏移（px，向上推）
  emoji: string;
  dot: boolean;
  color: string;
  size: number;
  delay: number; // 动画延迟 ms，错落飘起
}

interface Bubble {
  text: string;
  ts: number;
}

interface BackupBlob {
  exportedAt?: string;
  local?: Record<string, unknown>;
  records?: Partial<Records>;
}

// ---------------------------------------------------------------------------
// 模块级可变状态（仅一个 PetApp 实例，等价于原 client.js 的 module-level let）
// ---------------------------------------------------------------------------
const M = {
  petPos: { x: 0, y: 0 }, // 宠物在窗口内的位置（left/top，窗口坐标系 = 虚拟桌面坐标系）
  workArea: { x: 0, y: 0, width: 1280, height: 720 },
  petW: 320, // 宠物当前渲染尺寸（随 scale 变化，用于拖拽 clamp）
  petH: 180,
  facing: -1 as -1 | 1,
  movePlan: null as { name: string; targetX: number; startedAt: number; leadMs: number } | null,
  pressInfo: null as
    | { id: number; x: number; y: number; t: number; moved: boolean; isLong: boolean; lastR: number; dir: number; revs: number }
    | null,
  curDurMs: 2400,
  strokeState: null as { revs: number; lastDir: number; startTs: number; lastX: number } | null,
  lastSayMs: 0,
  lastAmbientSayMs: 0,
  lastClickMs: 0,
  muted: false,
  soundOn: false,
  voiceOn: false,
  voiceRate: 1,
  voiceName: "",
  voiceAmbient: false,
  theme: "strawberry" as ThemeId,
  sceneMode: "auto" as SceneMode,
  hidden: false,
  idleSinceMs: Date.now(),
  mouseX: 0,
  mouseY: 0,
  lastCareMs: 0,
  lastSitRemindMs: 0,
  sleeping: false,
  focusFlag: false,
  focusEndsAt: 0,
  focusStartMs: 0,
  busyFlag: false,
  system: null as SystemSnapshot | null,
  lastApp: "",
  lastAppTeaseMs: 0,
  lastBatteryMs: 0,
  appTeaseOn: true,
  batteryOn: true,
  talkativity: 50,
  quietOn: true,
  quietFrom: "23:00",
  quietTo: "07:00",
  sceneMuteOn: true,
  sceneMute: false,
  reportBusy: false,
  reportDate: "",
  relationStageId: "stranger",
  seenExecs: {} as Record<string, boolean>,
  taskBaselineDone: 0,
  affinity: 50,
  sass: 60,
  mood: "normal" as string,
  moodUntilMs: 0,
  pokeCount: 0,
  lastPokeMs: 0,
  eggClickCount: 0,
  eggClickMs: 0,
  pendingYesterday: null as DayStats | null,
  clickTimer: null as ReturnType<typeof setTimeout> | null,
  period: "afternoon" as ReturnType<typeof getPeriod>,
  greeted: {} as Record<string, boolean>,
  name: "",
  personality: 50,
  birthday: "",
  lastProactiveMs: 0,
  memPendingCount: 0,
  memExtracting: false,
  reviewBusy: false,
  lastFestiveDate: "",
  lastWaterMs: 0,
  lastOvertimeMs: 0,
  memDigestDate: "",
  reviewDate: "",
  pressStart: { x: 0, y: 0 },
  dragging: false,
  heartbeatTicks: 0,
  lastHeartbeatErrMs: 0,
  lastAnimLogMs: 0,
  assetsOnline: false,
};

const FALLBACK_LINES = [
  "哼，才不是想理你。",
  "又怎么了，笨蛋。",
  "……真是拿你没办法。",
  "本小姐今天心情不错，勉强理你一下。",
  "看什么看，还不快去干活。",
];

const FALLBACK_SRC = `/assets/videos/${encodeURIComponent(FALLBACK_ANIM)}.webm`;
const SCENE_MODES: SceneMode[] = ["auto", "work", "rest", "dnd"];

// 真实系统空闲毫秒（优先 GetLastInputInfo；系统不可用时回退到「上次碰宠物」的旧逻辑）。
function effectiveIdleMs(): number {
  return M.system ? M.system.idleSecs * 1000 : Date.now() - M.idleSinceMs;
}

/** 安静时段/会议场景只拦截主动开口，用户主动交互不受影响。 */
function proactiveSpeechBlocked(): boolean {
  return (M.quietOn && isQuietTime(M.quietFrom, M.quietTo)) || M.sceneMute || M.sceneMode === "dnd";
}

let pidSeq = 0;
const nextPid = () => ++pidSeq;

export function PetApp() {
  // ---- React 状态（渲染可见） ----
  const [animSrc, setAnimSrc] = useState<string>("/assets/videos/" + encodeURIComponent("待机呼吸休闲") + ".webm");
  const resolveSeq = useRef(0);
  const catRef = useRef<AnimPool>(buildAnimPool([]));
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoFailed, setVideoFailed] = useState(false); // 视频加载/播放失败时降级为 emoji 占位
  const [assetsOnline, setAssetsOnline] = useState(false);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [bubbleDisp, setBubbleDisp] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [memOpen, setMemOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [diaryList, setDiaryList] = useState<DiaryEntry[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportMsg, setReportMsg] = useState("");
  const [selectedReportDate, setSelectedReportDate] = useState(todayStr());
  const [relationStageId, setRelationStageId] = useState("stranger");
  const [memList, setMemList] = useState<Memory[]>([]);
  const [achCounters, setAchCounters] = useState<Record<string, number>>({});
  const [achUnlocked, setAchUnlocked] = useState<Record<string, number>>({});
  const [achToast, setAchToast] = useState<Achievement | null>(null);
  const [scale, setScale] = useState<number>(0.5);
  const [dayStats, setDayStats] = useState<DayStats>(emptyDayStats());
  const [focusSecs, setFocusSecs] = useState(0);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [dsHealth, setDsHealth] = useState<DshCheck | null>(null);
  const [system, setSystem] = useState<SystemSnapshot | null>(null);
  const [waterOn, setWaterOn] = useState(true);
  const [soundOn, setSoundOn] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceRate, setVoiceRate] = useState(1);
  const [voiceName, setVoiceName] = useState("");
  const [voiceAmbient, setVoiceAmbient] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(() => {
    const saved = loadJson<{ theme?: unknown }>(LS.state, {});
    return themeFromValue(saved.theme) ?? "strawberry";
  });
  const [sceneMode, setSceneMode] = useState<SceneMode>("auto");
  const [talkativity, setTalkativity] = useState(50);
  const [quietOn, setQuietOn] = useState(true);
  const [quietFrom, setQuietFrom] = useState("23:00");
  const [quietTo, setQuietTo] = useState("07:00");
  const [sceneMuteOn, setSceneMuteOn] = useState(true);
  const [testMsg, setTestMsg] = useState("");
  const [dataMsg, setDataMsg] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [petPos, setPetPos] = useState(() => ({
    // 占位：hydrate 后会按工作区 + 上次保存的位置覆盖
    x: Math.max(0, window.innerWidth - 320 - 8),
    y: Math.max(0, window.innerHeight - 180 - 8),
  }));
  const [hydrated, setHydrated] = useState(false);
  const [stateVersion, setStateVersion] = useState(0);
  const [focusEndsAt, setFocusEndsAt] = useState<number | null>(null);
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({
    base: true,
    ai: true,
    appearance: false,
    voice: false,
    pet: false,
    data: false,
    sync: false,
    device: false,
  });

  const anchorRef = useRef<HTMLDivElement | null>(null);
  const refreshState = useCallback(() => setStateVersion((v) => v + 1), []);
  const schedulerRef = useRef(new BehaviorScheduler());
  const behaviorSnapshot = useCallback(
    (): BehaviorSnapshot => ({
      now: Date.now(),
      sleeping: M.sleeping,
      focus: M.focusFlag,
      busy: M.busyFlag,
      hidden: M.hidden,
      muted: M.muted,
      quiet: M.quietOn && isQuietTime(M.quietFrom, M.quietTo),
      meeting: M.sceneMute,
      sceneMode: M.sceneMode,
    }),
    [],
  );
  const behaviorDecision = useCallback(
    () => schedulerRef.current.decision(behaviorSnapshot()),
    [behaviorSnapshot],
  );

  // 挂载/卸载诊断：release 版前端崩溃时用于确认 React 树是否被整体卸载。
  useEffect(() => {
    void bridge.diagLog("PetApp mounted").catch(() => {});
    return () => {
      stopSpeaking();
      void bridge.diagLog("PetApp unmounted").catch(() => {});
    };
  }, []);

  // -------------------------------------------------------------------------
  // 基础工具
  // -------------------------------------------------------------------------
  const saveMainState = useCallback(() => {
    saveJson(LS.state, {
      pos: M.petPos,
      scale,
      muted: M.muted,
      hidden: M.hidden,
      affinity: M.affinity,
      sass: M.sass,
      name: M.name,
      birthday: M.birthday,
      waterOn,
      voiceOn: M.voiceOn,
      voiceRate: M.voiceRate,
      voiceName: M.voiceName,
      voiceAmbient: M.voiceAmbient,
      theme: M.theme,
      sceneMode: M.sceneMode,
      personality: M.personality,
      appTeaseOn: M.appTeaseOn,
      batteryOn: M.batteryOn,
      talkativity: M.talkativity,
      quietOn: M.quietOn,
      quietFrom: M.quietFrom,
      quietTo: M.quietTo,
      sceneMuteOn: M.sceneMuteOn,
    });
  }, [scale, waterOn]);

  const setScaleSafe = useCallback(
    (s: number) => {
      const v = validScale(s) ? s : 0.5;
      setScale(v);
    },
    [],
  );

  const setSoundOnSafe = useCallback((on: boolean) => {
    setSoundOn(on);
    M.soundOn = on;
  }, []);

  const setHiddenSafe = useCallback((h: boolean) => {
    M.hidden = h;
    if (h) stopSpeaking();
    setMenuOpen(false);
    refreshState();
  }, [refreshState]);

  const setMutedSafe = useCallback((m: boolean) => {
    M.muted = m;
    if (m) stopSpeaking();
    refreshState();
  }, [refreshState]);

  const setSceneModeSafe = useCallback((mode: SceneMode) => {
    if (mode !== "auto" && mode !== "work" && mode !== "rest" && mode !== "dnd") return;
    M.sceneMode = mode;
    setSceneMode(mode);
    if (mode === "dnd") stopSpeaking();
    setBubble({ text: `场景已切换到「${sceneLabel(mode)}」`, ts: Date.now() });
    refreshState();
  }, [refreshState]);

  const applyTheme = useCallback((id: ThemeId) => {
    M.theme = id;
    setTheme(id);
    refreshState();
  }, [refreshState]);

  // 交互区上报：收集宠物/菜单/面板/气泡的物理像素 bounding box，供 Rust 穿透轮询判断
  const lastRegionsKey = useRef("");
  const reportHitRegions = useCallback(() => {
    const scale = window.devicePixelRatio || 1;
    // 宠物本体用内接椭圆命中区：透明四角/边缘可点穿到桌面，只有中心躯体拦截点击；
    // 面板/菜单/气泡等仍用矩形，保证文字与按钮可点。
    const selectors: { sel: string; kind: "rect" | "ellipse" }[] = [
      { sel: ".dsh-vpet-anchor", kind: "ellipse" },
      { sel: ".dsh-vpet-menu", kind: "rect" },
      { sel: ".dsh-vpet-settings", kind: "rect" },
      { sel: ".dsh-vpet-status", kind: "rect" },
      { sel: ".dsh-vpet-chat", kind: "rect" },
      { sel: ".dsh-vpet-diarypanel", kind: "rect" },
      { sel: ".dsh-vpet-mempanel", kind: "rect" },
      { sel: ".dsh-vpet-reportpanel", kind: "rect" },
      { sel: ".dsh-vpet-bubble", kind: "rect" },
      { sel: ".dsh-vpet-restore", kind: "rect" },
    ];
    const regions: HitRegion[] = [];
    for (const { sel, kind } of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        regions.push({
          x: Math.round(r.left * scale),
          y: Math.round(r.top * scale),
          width: Math.round(r.width * scale),
          height: Math.round(r.height * scale),
          kind,
        });
      });
    }
    const key = JSON.stringify(regions);
    if (key === lastRegionsKey.current) return; // 未变化时跳过 IPC
    lastRegionsKey.current = key;
    void bridge.setHitRegions(regions).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(reportHitRegions, 50);
    return () => clearInterval(t);
  }, [reportHitRegions]);

  // -------------------------------------------------------------------------
  // 粒子 / 成就 / 每日统计
  // -------------------------------------------------------------------------
  const spawnParticles = useCallback((emojis: string[], count: number, colors: string[]) => {
    const arr: Particle[] = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        id: nextPid(),
        x: 8 + Math.random() * 84, // 8~92%，全宽分布（与 Web 版一致）
        y: Math.random() * 30,
        emoji: emojis[Math.floor(Math.random() * emojis.length)],
        dot: Math.random() < 0.45,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 12 + Math.random() * 14, // 12~26px，更大更明显
        delay: Math.random() * 450, // 0~450ms 错落
      });
    }
    setParticles((p) => [...p, ...arr]);
    setTimeout(() => {
      const ids = new Set(arr.map((p) => p.id));
      setParticles((p) => p.filter((x) => !ids.has(x.id)));
    }, 2400); // 给 delay + 1.8s 动画留足时间
  }, []);

  const unlockAch = useCallback(
    (a: Achievement) => {
      setAchUnlocked((u) => {
        if (u[a.id]) return u; // 幂等：已解锁跳过，避免重复计数/递归
        let next = { ...u, [a.id]: Date.now() };
        // 解锁满 5 个时一并解锁「收藏家」（元成就），在函数式更新内判断，避免过期闭包重复触发
        if (Object.keys(next).length >= 5 && !next["collector"]) {
          const collector = ACHIEVEMENTS.find((x) => x.id === "collector");
          next = { ...next, collector: Date.now() };
          if (collector) setTimeout(() => setAchToast(collector), 1200);
        }
        saveJson(LS.achUnlocked, next);
        return next;
      });
      setAchToast(a);
      ai_adjustPersonality(0.5);
      sayRef.current("achievement", `${a.icon} ${a.name}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [achUnlocked],
  );

  const bumpAch = useCallback((key: string, n = 1) => {
    setAchCounters((c) => {
      const val = (c[key] || 0) + n;
      const next = { ...c, [key]: val };
      saveJson(LS.achCounters, next);
      const target = ACHIEVEMENTS.find((a) => a.key === key);
      if (target && val >= target.need && !achUnlocked[target.id]) unlockAch(target);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [achUnlocked]);

  const bumpDay = useCallback((field: Exclude<keyof DayStats, "date">, n = 1) => {
    setDayStats((d) => {
      if (d.date !== todayStr()) {
        // 跨天：暂存昨日统计，供写日记用（避免「先交互再写日记」丢昨日数据）
        M.pendingYesterday = { ...d };
        saveJson(LS.pendingYesterday, M.pendingYesterday);
      }
      const base = d.date !== todayStr() ? emptyDayStats() : d;
      const next = { ...base, [field]: (base[field] || 0) + n };
      saveJson(LS.day, next);
      return next;
    });
  }, []);

  function ai_adjustPersonality(delta: number) {
    M.personality = clamp(M.personality + delta, 0, 100);
  }

  // 深夜陪伴成就：夜间互动时触发
  function touchNight() {
    if (getPeriod() === "night") bumpAch("night", 1);
  }

  // 好感爆棚成就：好感度达到 100 时触发（好感度不是计数，单独检查；unlockAch 幂等）
  function checkAffinityAch() {
    if (M.affinity >= 100) {
      const a = ACHIEVEMENTS.find((x) => x.id === "affinity");
      if (a) unlockAch(a);
    }
  }

  // -------------------------------------------------------------------------
  // 说话（LLM）
  // -------------------------------------------------------------------------
  const say = useCallback(
    async (mode: string, topic?: string, ambient = false) => {
      const now = Date.now();
      if (mode !== "wake" && mode !== "focus-done" && now - M.lastSayMs < 1500) return;
      M.lastSayMs = now;

      let recent = "";
      try {
        recent = (await fetchRecentContext()).join("\n");
      } catch {
        recent = "";
      }

      const memory =
        mode === "proactive"
          ? await (async () => {
              try {
                const r = await bridge.memoryPick();
                return r.memory;
              } catch {
                return null;
              }
            })()
          : null;

      const prompt = ai.buildSayPrompt({
        mode,
        topic,
        affinity: M.affinity,
        sass: M.sass,
        mood: M.mood,
        name: M.name,
        personality: M.personality,
        recent,
        memory: memory?.content ?? null,
        relation:
          RELATION_STAGES.find((stage) => stage.id === M.relationStageId)?.name ??
          relationStageFor(M.affinity).name,
      });

      let acc = "";
      try {
        // 短句改流式：首字即显，不等完整生成；max_tokens 降到 300（一句话 200 字用不着 7680）
        setBubble({ text: "…", ts: Date.now() });
        await bridge.llmStream(
          prompt.system,
          prompt.user,
          (chunk) => {
            acc += chunk;
            setBubble({ text: acc.slice(0, 160), ts: Date.now() });
          },
          300,
          prompt.temperature,
          "say",
        );
      } catch {
        /* 流式失败：有分片就保留，否则下面回退 */
      }
      const finalText = acc.trim()
        ? acc.trim().slice(0, 160)
        : FALLBACK_LINES[Math.floor(Math.random() * FALLBACK_LINES.length)];
      if (acc.trim()) {
        if (memory) void bridge.memoryMark(memory.id).catch(() => {});
      } else {
        setBubble({ text: finalText, ts: Date.now() });
      }
      // 语音只朗读最终一句，避免流式分片反复开口。主动吐槽默认不朗读，可在设置里单独开启。
      if (
        M.voiceOn &&
        !M.muted &&
        !M.hidden &&
        (!ambient || M.voiceAmbient) &&
        !(ambient && proactiveSpeechBlocked())
      ) {
        speak(finalText, { rate: M.voiceRate, voiceName: M.voiceName });
      }
    },
    [],
  );
  const sayRef = useRef(say);
  sayRef.current = say;

  // 主动/环境类吐槽统一节流：多个触发器（自动、DSH 事件、任务、前台应用、主动搭话等）
  // 短时间内不叠成一串气泡；交互类（点击/抚摸/投喂/拖拽/聊天）仍直接走 say() 保持即时反馈。
  const sayAmbient = useCallback(
    (mode: string, topic?: string) => {
      if (proactiveSpeechBlocked()) return;
      if (!behaviorDecision().allowAmbientSpeech) return;
      const now = Date.now();
      if (now - M.lastAmbientSayMs < ambientGapMs(M.talkativity)) return;
      M.lastAmbientSayMs = now;
      void say(mode, topic, true);
    },
    [behaviorDecision, say],
  );
  const sayAmbientRef = useRef(sayAmbient);
  sayAmbientRef.current = sayAmbient;

  // -------------------------------------------------------------------------
  // 动画链
  // -------------------------------------------------------------------------
  const playAnim = useCallback((rawName: string, durMs?: number) => {
    // 平台离线时不再尝试非内置动画：直接走内置兜底，避免每个动作都 404 后闪回。
    const name = !isBuiltinName(rawName) && !M.assetsOnline ? FALLBACK_ANIM : rawName;
    const seq = ++resolveSeq.current;
    setVideoFailed(false);
    if (isBuiltinName(name)) {
      // 内置：立即用内置路径，无需二次解析
      setAnimSrc(`/assets/videos/${encodeURIComponent(name)}.webm`);
    } else {
      // 非内置：保持当前动画直到新 URL 解析完成再切换，避免拖动瞬间先闪回待机。
      // （解析失败时 resolveVideoUrl 自身会返回兜底动画。）
      resolveVideoUrl(name)
        .then((url) => {
          if (resolveSeq.current !== seq) return;
          const now = Date.now();
          if (now - M.lastAnimLogMs > 10_000) {
            M.lastAnimLogMs = now;
            void bridge.diagLog(`anim ${name} -> ${url}`).catch(() => {});
          }
          setAnimSrc(url);
        })
        .catch(() => {
          if (resolveSeq.current !== seq) return;
          setAnimSrc(`/assets/videos/${encodeURIComponent(FALLBACK_ANIM)}.webm`);
        });
    }
    M.curDurMs = durMs ?? 2400;
  }, []);

  const handleVideoFailure = useCallback(
    (src: string) => {
      void bridge.diagLog(`video fail src=${src}`).catch(() => {});
      // 平台离线/HTTP 视频被 WebView 拒绝时，先回退到打进 exe 的待机动画；
      // 只有连内置待机也加载失败时才显示静态海报，避免无限重试闪回。
      if (src !== FALLBACK_SRC) {
        void bridge.diagLog(`video fallback -> ${FALLBACK_SRC}`).catch(() => {});
        playAnim(FALLBACK_ANIM, M.curDurMs);
      } else {
        setVideoFailed(true);
      }
    },
    [playAnim],
  );

  const chainNext = useCallback(() => {
    if (M.sleeping) {
      playAnim(catRef.current.sleep, 15000);
      return;
    }
    if (effectiveIdleMs() > 8 * 60 * 1000) {
      M.sleeping = true;
      playAnim(catRef.current.sleep, 15000);
      return;
    }
    // 所有动画都由统一调度器决定：睡觉/专注/DSH/交互/场景/环境随机使用同一优先级。
    const decision = behaviorDecision();
    const next = schedulerRef.current.animationFor(
      catRef.current,
      decision.priority,
      M.sceneMode,
    );
    if (!next) return;
    if (decision.priority === "ambient" && M.sceneMode === "auto") {
      // 走动动作随机换朝向；待机/动作保持原朝向。
      if (next.name !== catRef.current.idle && next.name !== catRef.current.turn) {
        M.facing = Math.random() < 0.5 ? -1 : 1;
      }
    }
    playAnim(next.name, next.durMs);
  }, [behaviorDecision, playAnim]);

  /** 好感度变化统一入口：同时检查关系阶段升级，阶段只升不降。 */
  const changeAffinity = useCallback(
    (delta: number) => {
      M.affinity = clamp(M.affinity + delta, 0, 100);
      const potential = relationStageFor(M.affinity);
      const current = RELATION_STAGES.find((stage) => stage.id === M.relationStageId) ?? RELATION_STAGES[0];
      if (potential.min > current.min) {
        M.relationStageId = potential.id;
        setRelationStageId(potential.id);
        saveJson(LS.relation, { stageId: potential.id, unlockedAt: Date.now() });
        setBubble({
          text: `${potential.emoji} 关系进入「${potential.name}」：${potential.line}`,
          ts: Date.now(),
        });
        playAnim(potential.action, 6000);
        sayRef.current("relation-up", `${potential.name}：${potential.line}`);
      }
      checkAffinityAch();
      refreshState();
    },
    [playAnim, refreshState],
  );

  // -------------------------------------------------------------------------
  // 交互（点击 / 拖拽 / 抚摸 / 长按）
  // -------------------------------------------------------------------------
  const wakeUp = useCallback(() => {
    if (!M.sleeping) return;
    M.sleeping = false;
    playAnim(catRef.current.wake, 2200);
    spawnParticles(["💤", "✨"], 5, ["#a0c4ff", "#ffd6a5"]);
    beep("wake", { soundOn: M.soundOn, muted: M.muted });
    sayRef.current("wake");
  }, [playAnim, spawnParticles]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // 仅左键进入交互；右键交给 contextmenu，避免误触发拖窗/跳到右下角
      schedulerRef.current.noteInteraction();
      setMenuOpen(false); // 开始拖动/点击宠物时收起菜单，避免菜单滚动条与面板滚动条同时出现
      wakeUp();
      // WebView2 的系统语音列表需要一次用户手势才会加载，提前预热供设置页使用。
      primeVoices();
      // 用户第一次点宠物时顺带恢复视频播放（部分 WebView2 环境需要一次用户手势）。
      const v = videoRef.current;
      if (v && v.paused) {
        const p = v.play() as unknown as Promise<void> | undefined;
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
      M.idleSinceMs = Date.now();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      M.pressInfo = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: Date.now(),
        moved: false,
        isLong: false,
        lastR: 0,
        dir: 0,
        revs: 0,
      };
      M.pressStart = { ...M.petPos };
    },
    [wakeUp],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (M.pressInfo) {
        const pi = M.pressInfo;
        const dx = e.clientX - pi.x;
        const dy = e.clientY - pi.y;
        if (Math.abs(dx) + Math.abs(dy) > 6 && !pi.moved) {
          pi.moved = true;
          pi.dir = dx >= 0 ? 1 : -1;
          M.strokeState = null;
          playAnim(catRef.current.drag, 6000);
          M.dragging = true;
          return;
        }
        if (pi.moved && M.dragging) {
          // 纯 DOM 拖拽：更新宠物 left/top，clamp 到整个虚拟桌面（覆盖所有显示器）。
          // 窗口铺满虚拟桌面，window.innerWidth/innerHeight 即全桌面 CSS 边界；
          // 若用 M.workArea 会锁死在主显示器，导致拖不到副屏。
          const edge = 8;
          const cx = clamp(
            Math.round(M.pressStart.x + (e.clientX - pi.x)),
            edge,
            Math.max(edge, window.innerWidth - M.petW - edge),
          );
          const cy = clamp(
            Math.round(M.pressStart.y + (e.clientY - pi.y)),
            edge,
            Math.max(edge, window.innerHeight - M.petH - edge),
          );
          M.petPos = { x: cx, y: cy };
          if (anchorRef.current) {
            anchorRef.current.style.left = cx + "px";
            anchorRef.current.style.top = cy + "px";
          }
          return;
        }
        return;
      }

      // 抚摸检测（未按下的悬停左右来回滑，对齐 Web 版）：水平来回滑动 ≥2 次
      const now = Date.now();
      if (!M.strokeState || now - M.strokeState.startTs > 2000) {
        M.strokeState = { revs: 0, lastDir: 0, startTs: now, lastX: e.clientX };
        return;
      }
      const dx = e.clientX - M.strokeState.lastX;
      if (Math.abs(dx) < 12) return;
      const dir = dx >= 0 ? 1 : -1;
      if (M.strokeState.lastDir !== 0 && dir !== M.strokeState.lastDir) {
        M.strokeState.revs += 1;
        M.strokeState.startTs = now;
      }
      M.strokeState.lastDir = dir;
      M.strokeState.lastX = e.clientX;
      if (M.strokeState.revs >= 2) {
        M.strokeState = null;
        M.idleSinceMs = Date.now();
        const clickAnim = pick2(catRef.current.clicks);
        playAnim(clickAnim, 2600);
        changeAffinity(2);
        touchNight();
        ai_adjustPersonality(0.5);
        beep("pet", { soundOn: M.soundOn, muted: M.muted });
        bumpAch("pet");
        bumpDay("pet");
        sayRef.current("pet", "摸");
      }
    },
    [changeAffinity, playAnim, bumpAch, bumpDay],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const pi = M.pressInfo;
      M.pressInfo = null;
      if (!pi) return;
      if (pi.moved) {
        if (M.dragging) {
          M.dragging = false;
          setPetPos(M.petPos); // 同步 React state，触发位置持久化
          // 拖拽结束反馈（对齐 Web 版：AI + 音效 + 粒子 + 性格微降）
          beep("drag", { soundOn: M.soundOn, muted: M.muted });
          spawnParticles(["💨"], 6, ["#bdb2ff", "#c3f0ca", "#a0c4ff"]);
          ai_adjustPersonality(-0.5);
          sayRef.current("drag");
        }
        playAnim(catRef.current.idle, 2400);
        refreshState();
        return;
      }
      if (pi.isLong) {
        playAnim(catRef.current.idle, 2400);
        return;
      }
      // 单击/双击/连戳：双击不先触发单击（延迟单击到 350ms 双击窗口之后），连戳用滑动窗口计数
      const now = Date.now();
      const dt = now - M.lastClickMs;
      M.lastClickMs = now;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const ry = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;

      // 连戳彩蛋：滑动窗口（每次点击都更新 eggClickMs，对齐 Web 版，否则固定 3s 窗口内凑不满 10 下）
      const nowEgg = Date.now();
      M.eggClickCount = nowEgg - M.eggClickMs < 3000 ? M.eggClickCount + 1 : 1;
      M.eggClickMs = nowEgg;

      // 双击：350ms 内第二次点击，取消待执行的单击
      if (dt < 350 && M.clickTimer) {
        clearTimeout(M.clickTimer);
        M.clickTimer = null;
        playAnim(catRef.current.celebrate, 3400);
        beep("celebrate", { soundOn: M.soundOn, muted: M.muted });
        sayRef.current("double-click");
        return;
      }

      if (M.eggClickCount >= 10) {
        M.eggClickCount = 0;
        M.eggClickMs = nowEgg;
        playAnim("原地左转奔跑", 3000);
        spawnParticles(["💢", "💥", "🔥"], 8, ["#ff6b6b", "#ffd93d"]);
        sayRef.current("egg-poke");
        return;
      }

      const hour = new Date().getHours();
      if (hour >= 2 && hour < 4) {
        sayRef.current("egg-night");
        return;
      }

      // 延迟到双击窗口结束后再执行单击效果，避免双击先触发一次单击
      M.clickTimer = setTimeout(() => {
        M.clickTimer = null;
        if (ry < 0.33) {
          // 摸头
          playAnim(catRef.current.clicks[1], 2600);
          changeAffinity(2);
          touchNight();
          ai_adjustPersonality(0.5);
          beep("pet", { soundOn: M.soundOn, muted: M.muted });
          bumpAch("pet");
          bumpDay("pet");
          sayRef.current("pet", "摸头");
        } else if (ry > 0.67) {
          // 摸尾巴
          playAnim("原地左转奔跑", 2600);
          changeAffinity(2);
          touchNight();
          ai_adjustPersonality(0.5);
          beep("pet", { soundOn: M.soundOn, muted: M.muted });
          bumpAch("pet");
          bumpDay("pet");
          sayRef.current("pet", "摸尾巴");
        } else {
          // 戳身体
          const clickAnim = pick2(catRef.current.clicks);
          playAnim(clickAnim, 2400);
          changeAffinity(-1);
          touchNight();
          beep("click", { soundOn: M.soundOn, muted: M.muted });
          M.pokeCount += 1;
          bumpAch("poke");
          bumpDay("poke");
          if (M.pokeCount % 4 === 0) {
            M.mood = "angry";
            M.moodUntilMs = Date.now() + 30_000;
          }
          sayRef.current("roast");
        }
        refreshState();
      }, 350);
    },
    [changeAffinity, playAnim, bumpAch, bumpDay, spawnParticles, refreshState],
  );

  // 长按定时
  useEffect(() => {
    const t = setInterval(() => {
      if (M.pressInfo && !M.pressInfo.moved && !M.pressInfo.isLong && Date.now() - M.pressInfo.t >= 600) {
        M.pressInfo.isLong = true;
        playAnim(catRef.current.stretch, 3000);
        beep("longpress", { soundOn: M.soundOn, muted: M.muted });
        sayRef.current("long-press");
      }
    }, 200);
    return () => clearInterval(t);
  }, [playAnim]);

  // -------------------------------------------------------------------------
  // 菜单 / 投喂 / 专注
  // -------------------------------------------------------------------------
  // 打开某面板时关闭其余面板（避免右上角重叠）
  const openPanel = useCallback((key: "settings" | "status" | "chat" | "diary" | "mem" | "report") => {
    setMenuOpen(false);
    setSettingsOpen(key === "settings");
    setStatusOpen(key === "status");
    setChatOpen(key === "chat");
    setDiaryOpen(key === "diary");
    setMemOpen(key === "mem");
    setReportOpen(key === "report");
  }, []);

  // 桌面宠物同一时间只保留一个浮层：菜单与面板互斥，避免两个滚动条叠在一起。
  const closePanels = useCallback(() => {
    setSettingsOpen(false);
    setStatusOpen(false);
    setChatOpen(false);
    setDiaryOpen(false);
    setMemOpen(false);
    setReportOpen(false);
  }, []);

  const doFeed = useCallback(() => {
    setMenuOpen(false);
    playAnim("大口吃零食", 3000);
    changeAffinity(3);
    touchNight();
    ai_adjustPersonality(0.5);
    beep("feed", { soundOn: M.soundOn, muted: M.muted });
    bumpAch("feed");
    bumpDay("feed");
    sayRef.current("feed");
    refreshState();
  }, [changeAffinity, playAnim, bumpAch, bumpDay, refreshState]);

  const startFocus = useCallback(() => {
    setMenuOpen(false);
    M.focusFlag = true;
    M.focusStartMs = Date.now();
    M.focusEndsAt = M.focusStartMs + 25 * 60_000;
    setFocusEndsAt(M.focusEndsAt);
    setFocusSecs(25 * 60);
    playAnim(catRef.current.focus, 5000);
    sayRef.current("focus-start");
  }, [playAnim]);

  const resetPosition = useCallback(async () => {
    setMenuOpen(false);
    try {
      const wa = await bridge.getWorkArea();
      const x = clamp(wa.x + wa.width - M.petW - 8, wa.x, wa.x + wa.width - M.petW);
      const y = clamp(wa.y + wa.height - M.petH - 8, wa.y, wa.y + wa.height - M.petH);
      M.petPos = { x, y };
      setPetPos({ x, y });
      if (anchorRef.current) {
        anchorRef.current.style.left = x + "px";
        anchorRef.current.style.top = y + "px";
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  // -------------------------------------------------------------------------
  // 聊天
  // -------------------------------------------------------------------------
  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    schedulerRef.current.noteInteraction();
    setChatInput("");
    setChatLoading(true);
    const userTurn: ChatTurn = { role: "user", text };
    const next = [...chatHistory, userTurn];
    setChatHistory(next);
    let acc = "";
    try {
      const allMemories = (await bridge.memoryList()).memories;
      // 回忆触发词命中时做相关性召回；否则仅靠全量记忆聚合的长期画像。
      let recalled: Memory[] = [];
      if (ai.RECALL_RE.test(text)) {
        try {
          recalled = (await bridge.memoryRecall(text, 5)).memories;
        } catch {
          recalled = [];
        }
      }
      const prompt = ai.buildChatPrompt({
        text,
        history: next,
        name: M.name,
        personality: M.personality,
        memories: allMemories,
        recalled,
      });
      // 先挂一个空助手气泡，随后逐字流式填充
      setChatHistory([...next, { role: "assistant", text: "" }]);
      await bridge.llmStream(
        prompt.system,
        prompt.messages.map((m) => `${m.role === "assistant" ? "桌宠" : "主人"}：${m.text}`).join("\n"),
        (chunk) => {
          acc += chunk;
          setChatHistory((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", text: acc };
            return copy;
          });
        },
        1024,
        0.9,
        "chat",
      );
    } catch {
      // 流式失败也继续：下方用已收到的分片或随机回复兜底
    }
    const reply: ChatTurn = {
      role: "assistant",
      text: acc.trim() ? acc.trim().slice(0, 160) : FALLBACK_LINES[Math.floor(Math.random() * FALLBACK_LINES.length)],
    };
    const final = [...next, reply].slice(-20);
    setChatHistory(final);
    void bridge.chatSet(final).catch(() => {});
    bumpAch("chat");
    bumpDay("chat");
    // 每 3 次聊天抽一次记忆
    M.memPendingCount += 1;
    if (M.memPendingCount >= 3 && !M.memExtracting) {
      M.memPendingCount = 0;
      M.memExtracting = true;
      void bridge
        .memoryExtract(final, M.name)
        .then(() => {
          M.memExtracting = false;
        })
        .catch(() => {
          M.memExtracting = false;
        });
    }
    setChatLoading(false);
  }, [chatInput, chatLoading, chatHistory, bumpAch, bumpDay]);

  // -------------------------------------------------------------------------
  // 日记 / 记忆
  // -------------------------------------------------------------------------
  const writeDiary = useCallback(
    async (date: string, stats: DayStats): Promise<boolean> => {
      const prompt = ai.buildDiaryPrompt({ name: M.name, date, stats });
      try {
        const r = await bridge.llmComplete(prompt.system, prompt.user, 512, 0.85, "chat");
        if (r.ok && r.text) {
          await bridge.diaryWrite(date, r.text.slice(0, 400));
          const list = await bridge.diaryList();
          setDiaryList(list.diary);
          return true;
        }
      } catch {
        /* 忽略 */
      }
      return false;
    },
    [],
  );

  const reportInputRef = useRef({ dayStats, chatHistory, diaryList });
  reportInputRef.current = { dayStats, chatHistory, diaryList };
  const yesterdayBusyRef = useRef(false);

  const refreshReports = useCallback(async () => {
    const list = await bridge.reportList();
    setReports(list.reports);
    return list.reports;
  }, []);

  /** 应用跨夜关闭时补一份昨日报告；只写本地统计兜底，避免启动时阻塞模型调用。 */
  const saveMissedReport = useCallback(
    async (stats: DayStats) => {
      if (!stats.date || stats.date === todayStr()) return;
      const list = await bridge.reportList();
      if (list.reports.some((item) => item.date === stats.date)) return;
      const report: DailyReport = {
        date: stats.date,
        companionSecs: Math.max(0, stats.companionSecs || 0),
        stats: { ...stats } as DailyReport["stats"],
        ...fallbackReportSections(stats),
        generatedAt: Date.now(),
      };
      await bridge.reportSave(report);
      await refreshReports();
    },
    [refreshReports],
  );

  const generateDailyReport = useCallback(async () => {
    if (M.reportBusy) return;
    M.reportBusy = true;
    setReportBusy(true);
    setReportMsg("正在整理今天的陪伴记录…");
    const date = todayStr();
    const input = reportInputRef.current;
    const stats = { ...input.dayStats, date };
    const companionSecs = Math.max(0, stats.companionSecs || 0);
    const recentChat = input.chatHistory
      .slice(-12)
      .map((turn) => `${turn.role === "assistant" ? "桌宠" : "主人"}：${turn.text}`)
      .join("\n");
    const diary = input.diaryList.find((entry) => entry.date === date)?.text ?? "";
    let generated: ReportSections | null = null;
    try {
      const prompt = ai.buildDailyReportPrompt({
        name: M.name,
        date,
        companionSecs,
        stats,
        recentChat,
        diary,
      });
      const result = await bridge.llmComplete(prompt.system, prompt.user, 900, 0.75, "chat");
      if (result.ok && result.text) generated = parseReportSections(result.text);
    } catch {
      generated = null;
    }
    const sections = generated ?? fallbackReportSections(stats);
    const report: DailyReport = {
      date,
      companionSecs,
      stats,
      ...sections,
      generatedAt: Date.now(),
    };
    try {
      await bridge.reportSave(report);
      const list = await refreshReports();
      M.reportDate = date;
      saveJson(LS.report, date);
      setSelectedReportDate(date);
      setReportMsg(generated ? `已生成 ${date} 的报告` : `已用本地统计生成 ${date} 的报告`);
      if (!reportOpen) {
        setBubble({ text: "📊 今天的陪伴报告写好了，右键菜单「报告」可以查看。", ts: Date.now() });
      }
      if (!list.some((item) => item.date === date)) setReportMsg("报告已保存，但列表刷新失败");
    } catch (error) {
      setReportMsg(`报告生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      M.reportBusy = false;
      setReportBusy(false);
    }
  }, [refreshReports, reportOpen]);

  const collectBackup = useCallback(async (): Promise<BackupBlob> => {
    const local: Record<string, unknown> = {};
    for (const key of LS_EXPORT_KEYS) {
      const value = loadJson<unknown>(key, null);
      if (value != null) local[key] = value;
    }
    const records = await bridge.recordsExport();
    return { exportedAt: new Date().toISOString(), local, records };
  }, []);

  const applyBackupData = useCallback(
    async (blob: BackupBlob, mergeRecords: boolean) => {
      if (!blob || typeof blob !== "object") throw new Error("备份格式无效");
      if (blob.local && typeof blob.local === "object") {
        for (const key of LS_EXPORT_KEYS) {
          if (blob.local[key] != null) saveJson(key, blob.local[key]);
        }
      }
      const incoming = blob.records && typeof blob.records === "object" ? blob.records : {};
      let memories = Array.isArray(incoming.memories) ? incoming.memories : [];
      let diary = Array.isArray(incoming.diary) ? incoming.diary : [];
      let chat = Array.isArray(incoming.chat) ? incoming.chat : [];
      let reportList = Array.isArray(incoming.reports) ? incoming.reports : [];
      if (mergeRecords) {
        const current = await bridge.recordsExport();
        memories = mergeByKey(current.memories, memories, (item) => item.id);
        diary = mergeByKey(current.diary, diary, (item) => item.date).sort((a, b) => b.date.localeCompare(a.date));
        reportList = mergeByKey(current.reports ?? [], reportList, (item) => item.date).sort((a, b) => b.date.localeCompare(a.date));
        chat = mergeChat(current.chat, chat);
      }
      await bridge.recordsImport(memories, diary, chat, reportList);
      setMemList((await bridge.memoryList()).memories);
      setDiaryList((await bridge.diaryList()).diary);
      setChatHistory((await bridge.chatList()).chat);
      await refreshReports();
      refreshState();
    },
    [refreshReports, refreshState],
  );

  const exportBackup = useCallback(
    async (secret?: string) => {
      setDataMsg(secret ? "正在生成加密备份…" : "正在打开保存位置…");
      const blob = await collectBackup();
      const content = secret ? await encryptJson(blob, secret) : JSON.stringify(blob);
      return bridge.backupSave(
        content,
        secret ? `dsh-pet-backup-${todayStr()}.enc.json` : `dsh-pet-backup-${todayStr()}.json`,
      );
    },
    [collectBackup],
  );

  const importBackup = useCallback(
    async (secret?: string) => {
      setDataMsg("正在选择备份文件…");
      const result = await bridge.backupOpen();
      if (result.cancelled) return { cancelled: true, name: result.name };
      let blob: BackupBlob;
      if (looksEncrypted(result.content)) {
        if (!secret) throw new Error("这是加密备份，请先输入备份密码");
        blob = await decryptJson<BackupBlob>(result.content, secret);
      } else {
        const parsed: unknown = JSON.parse(result.content);
        if (!parsed || typeof parsed !== "object") throw new Error("备份格式无效");
        blob = parsed as BackupBlob;
      }
      await applyBackupData(blob, false);
      return { cancelled: false, name: result.name };
    },
    [applyBackupData],
  );

  const uploadSync = useCallback(
    async (code: string) => {
      const value = code.trim();
      if (value.length < 16) throw new Error("同步码至少 16 位");
      setSyncBusy(true);
      setSyncMsg("正在加密并上传…");
      try {
        const blob = await collectBackup();
        const encrypted = await encryptJson(blob, value);
        const updatedAt = await bridge.syncUpload(value, encrypted, Date.now());
        setSyncMsg(`已上传到资源平台（${new Date(updatedAt).toLocaleTimeString()}）`);
      } finally {
        setSyncBusy(false);
      }
    },
    [collectBackup],
  );

  const downloadSync = useCallback(
    async (code: string) => {
      const value = code.trim();
      if (value.length < 16) throw new Error("同步码至少 16 位");
      setSyncBusy(true);
      setSyncMsg("正在下载并合并…");
      try {
        const remote = await bridge.syncDownload(value);
        if (!remote.found || !remote.payload) {
          setSyncMsg("这个同步码还没有上传过数据");
          return;
        }
        const blob = await decryptJson<BackupBlob>(remote.payload, value);
        await applyBackupData(blob, true);
        setSyncMsg("已合并远端数据，正在重新加载…");
        setTimeout(() => window.location.reload(), 900);
      } finally {
        setSyncBusy(false);
      }
    },
    [applyBackupData],
  );

  // -------------------------------------------------------------------------
  // 吃文件（拖放）
  // -------------------------------------------------------------------------
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let wv: ReturnType<typeof getCurrentWebview> | undefined;
    try {
      wv = getCurrentWebview();
    } catch {
      wv = undefined; // 非 Tauri 环境（如普通浏览器打开 devUrl）或 API 不可用时跳过拖放监听
    }
    if (!wv) return;
    wv.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths ?? [];
        if (paths.length === 0) return;
        void Promise.all(paths.map((path) => bridge.eatFile(path).then((result) => ({ path, result })))).then((results) => {
          const eaten = results.filter(({ result }) => result.ok);
          if (eaten.length === 0) {
            setBubble({ text: "只能投喂普通文件，文件夹和不可访问的项目不会被移动。", ts: Date.now() });
            return;
          }
          const firstName = eaten[0].path.split(/[\\/]/).pop() || eaten[0].path;
          playAnim("吃Token", 2400);
          spawnParticles(["🫧", "💫"], Math.min(8, eaten.length + 3), ["#a0c4ff", "#bdb2ff"]);
          beep("eat", { soundOn: M.soundOn, muted: M.muted });
          bumpAch("eat", eaten.length);
          bumpDay("eat", eaten.length);
          sayRef.current("eat-file", eaten.length > 1 ? `${firstName} 等 ${eaten.length} 个文件` : firstName);
        }).catch(() => {
          setBubble({ text: "这次投喂没有完成，文件仍保留在原位置。", ts: Date.now() });
        });
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [playAnim, spawnParticles, bumpAch, bumpDay]);

  // -------------------------------------------------------------------------
  // 宠物尺寸同步（缩放）；窗口已全屏，无需 resize
  // -------------------------------------------------------------------------
  useEffect(() => {
    M.petW = Math.round(VIDEO_W * scale);
    M.petH = Math.round(VIDEO_H * scale);
  }, [scale]);

  // -------------------------------------------------------------------------
  // 初始化：加载持久化状态
  // -------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const wa = await bridge.getWorkArea();
        M.workArea = { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
      } catch {
        /* 获取工作区失败时沿用默认值 */
      }

      const st = loadJson<Record<string, unknown>>(LS.state, {});
      const sc = validScale(st.scale) ? (st.scale as number) : 0.5;
      setScale(sc);
      M.petW = Math.round(VIDEO_W * sc);
      M.petH = Math.round(VIDEO_H * sc);
      // 宠物位置：优先恢复上次保存的位置（当前语义「宠物左上角」，见 saveMainState 的 pos）。
      // clamp 兜底到当前工作区，避免显示器/分辨率变化后宠物跑到屏幕外；无有效 pos 时回退右下角。
      const fallbackPos = {
        x: M.workArea.x + M.workArea.width - M.petW - 8,
        y: M.workArea.y + M.workArea.height - M.petH - 8,
      };
      // 一次性位置重置（配置 pos_reset 标记）：本次启动忽略保存的位置，直接回右下角。
      let resetPos = false;
      try {
        resetPos = await bridge.consumePosReset();
        bridge.diagLog("hydration consumePosReset -> " + resetPos).catch(() => {});
      } catch (e) {
        bridge.diagLog("hydration consumePosReset error: " + String(e)).catch(() => {});
      }
      const savedPos = st.pos as { x?: unknown; y?: unknown } | undefined;
      let pp = fallbackPos;
      if (
        !resetPos &&
        savedPos &&
        typeof savedPos.x === "number" &&
        typeof savedPos.y === "number" &&
        Number.isFinite(savedPos.x) &&
        Number.isFinite(savedPos.y)
      ) {
        pp = {
          x: clamp(Math.round(savedPos.x), M.workArea.x, M.workArea.x + M.workArea.width - M.petW),
          y: clamp(Math.round(savedPos.y), M.workArea.y, M.workArea.y + M.workArea.height - M.petH),
        };
      }
      M.petPos = pp;
      setPetPos(pp);
      M.affinity = typeof st.affinity === "number" ? (st.affinity as number) : 50;
      const relationSaved = loadJson<{ stageId?: unknown }>(LS.relation, {});
      const relationStored = RELATION_STAGES.find((stage) => stage.id === relationSaved.stageId);
      const relationPotential = relationStageFor(M.affinity);
      const relationBase = relationStored ?? relationPotential;
      M.relationStageId = relationBase.id;
      setRelationStageId(relationBase.id);
      saveJson(LS.relation, { stageId: relationBase.id, unlockedAt: relationStored ? undefined : Date.now() });
      if (relationStored && relationPotential.min > relationStored.min) {
        // 旧版本升级后第一次达到新阶段：稍等 UI/资源就绪再播放解锁动作。
        setTimeout(() => changeAffinity(0), 4000);
      }
      M.sass = typeof st.sass === "number" ? (st.sass as number) : 60;
      M.personality = typeof st.personality === "number" ? (st.personality as number) : 50;
      M.name = typeof st.name === "string" ? (st.name as string).slice(0, 12) : "";
      const rawBday = typeof st.birthday === "string" ? (st.birthday as string) : "";
      M.birthday = /^\d{4}-\d{2}-\d{2}$/.test(rawBday) ? rawBday : rawBday ? `2000-${rawBday}` : "";
      M.muted = !!st.muted;
      M.voiceOn = !!st.voiceOn;
      setVoiceOn(M.voiceOn);
      M.voiceRate = typeof st.voiceRate === "number" ? clamp(st.voiceRate, 0.6, 1.6) : 1;
      setVoiceRate(M.voiceRate);
      M.voiceName = typeof st.voiceName === "string" ? st.voiceName : "";
      setVoiceName(M.voiceName);
      M.voiceAmbient = !!st.voiceAmbient;
      setVoiceAmbient(M.voiceAmbient);
      M.theme = themeFromValue(st.theme) ?? "strawberry";
      setTheme(M.theme);
      M.sceneMode =
        st.sceneMode === "work" || st.sceneMode === "rest" || st.sceneMode === "dnd"
          ? st.sceneMode
          : "auto";
      setSceneMode(M.sceneMode);
      setWaterOn(st.waterOn === undefined ? true : !!st.waterOn);
      M.appTeaseOn = st.appTeaseOn === undefined ? true : !!st.appTeaseOn;
      M.batteryOn = st.batteryOn === undefined ? true : !!st.batteryOn;
      M.talkativity = typeof st.talkativity === "number" ? clamp(st.talkativity, 0, 100) : 50;
      setTalkativity(M.talkativity);
      M.quietOn = st.quietOn === undefined ? true : !!st.quietOn;
      setQuietOn(M.quietOn);
      M.quietFrom =
        typeof st.quietFrom === "string" && parseHHMM(st.quietFrom) !== null ? st.quietFrom : "23:00";
      setQuietFrom(M.quietFrom);
      M.quietTo = typeof st.quietTo === "string" && parseHHMM(st.quietTo) !== null ? st.quietTo : "07:00";
      setQuietTo(M.quietTo);
      M.sceneMuteOn = st.sceneMuteOn === undefined ? true : !!st.sceneMuteOn;
      setSceneMuteOn(M.sceneMuteOn);
      // 桌宠隐藏状态不跨启动持久化：每次启动都直接显示宠物。
      // （此前持久化 hidden=true 会导致“桌宠不显示”——用户点过“隐藏”后，下次启动只剩
      //  极小的 🐾 恢复按钮，且托盘“显示/隐藏”只切换原生窗口可见性、无法还原宠物。）
      M.hidden = false;

      setAchCounters(loadJson<Record<string, number>>(LS.achCounters, {}));
      setAchUnlocked(loadJson<Record<string, number>>(LS.achUnlocked, {}));
      // 跨夜启动时先把昨日统计隔离到 pendingYesterday，今日从空统计开始；
      // pending 同时落 localStorage，避免跨夜交互后立即退出导致昨日数据丢失。
      const persistedPending = normalizeDayStats(loadJson<unknown>(LS.pendingYesterday, null));
      const persistedDay = normalizeDayStats(loadJson<unknown>(LS.day, null));
      const yesterday =
        persistedPending.date < todayStr()
          ? persistedPending
          : persistedDay.date < todayStr()
            ? persistedDay
            : null;
      if (yesterday) {
        M.pendingYesterday = yesterday;
        saveJson(LS.pendingYesterday, yesterday);
        const fresh = emptyDayStats();
        saveJson(LS.day, fresh);
        setDayStats(fresh);
      } else {
        setDayStats(persistedDay);
      }
      M.lastFestiveDate = loadJson<string>(LS.festive, "");
      M.lastWaterMs = loadJson<number>(LS.water, 0);
      M.memDigestDate = loadJson<string>(LS.memDigest, "");
      M.reviewDate = loadJson<string>(LS.review, "");

      try {
        const chat = await bridge.chatList();
        setChatHistory(chat.chat);
      } catch {}
      try {
        const diary = await bridge.diaryList();
        setDiaryList(diary.diary);
      } catch {}
      try {
        const mem = await bridge.memoryList();
        setMemList(mem.memories);
      } catch {}
      try {
        const reportList = await bridge.reportList();
        setReports(reportList.reports);
        const todayReport = reportList.reports.find((item) => item.date === todayStr());
        if (todayReport) {
          M.reportDate = todayReport.date;
          saveJson(LS.report, todayReport.date);
          setSelectedReportDate(todayReport.date);
        } else if (reportList.reports[0]) {
          setSelectedReportDate(reportList.reports[0].date);
        }
      } catch {}

      // 首句
      setTimeout(() => {
        if (Date.now() - M.idleSinceMs > 3 * 60 * 1000) sayAmbientRef.current("lonely");
        else sayAmbientRef.current("auto");
      }, 4000);
      setHydrated(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 托盘命令（设置 / 记忆本 / 显示桌宠）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("tray-command", (e) => {
      const cmd = e.payload;
      if (cmd === "settings") openPanel("settings");
      else if (cmd === "diary") openPanel("diary");
      else if (cmd === "memory") openPanel("mem");
      else if (cmd === "show-pet") setHiddenSafe(false);
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [openPanel, setHiddenSafe]);

  // -------------------------------------------------------------------------
  // 定时器（全部）
  // -------------------------------------------------------------------------
  // 动画链
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      timer = setTimeout(() => {
        // 拖拽期间保持拖拽动画，避免动画链到期后把拖拽动作覆盖成待机造成闪回。
        if (!M.hidden && !M.dragging && !M.pressInfo?.moved) chainNext();
        tick();
      }, M.curDurMs);
    };
    tick();
    return () => clearTimeout(timer);
  }, [chainNext]);

  // 主动 say（60s 检查，按「话痨程度」决定开口概率；最小间隔由 sayAmbient 统一节流）
  useEffect(() => {
    const t = setInterval(() => {
      const decision = behaviorDecision();
      if (!schedulerRef.current.shouldAmbientSpeak(decision, M.talkativity, 1)) return;
      if (effectiveIdleMs() > 3 * 60 * 1000) sayAmbientRef.current("lonely");
      else sayAmbientRef.current("auto");
    }, 60_000);
    return () => clearInterval(t);
  }, [behaviorDecision]);

  // DSH 检测（15s）
  useEffect(() => {
    let baseline = 0;
    const t = setInterval(() => {
      if (M.hidden) return; // 隐藏时不轮询 DSH，省网络/CPU
      void pollDsh().then((r) => {
        if (!r) {
          setDsHealth(null);
          M.busyFlag = false;
          return;
        }
        setDsHealth(r);
        M.busyFlag = r.busy;
        if (r.event || r.busy) schedulerRef.current.noteDshEvent();
        if (!M.muted && !M.hidden && !M.sleeping && !M.focusFlag) {
          if (r.event === "assistant") sayAmbientRef.current("assistant");
          else if (r.event === "user") sayAmbientRef.current("user");
          else if (r.ssh) {
            sayAmbientRef.current("ssh", r.ssh);
            bumpDay("ssh");
          }
        }
      });
      void pollTaskboard().then((ev) => {
        if (ev) {
          schedulerRef.current.noteDshEvent();
          if (ev.kind === "done") {
            baseline += 1;
            bumpDay("taskDone");
            sayAmbientRef.current("task-done", ev.title);
          } else if (ev.kind === "failed") {
            bumpDay("taskFailed");
            sayAmbientRef.current("task-failed", ev.title);
          }
        }
      });
    }, 15_000);
    return () => clearInterval(t);
  }, [bumpDay]);

  // 资源平台：启动时拉 manifest 动态构建动画池（上传即学会新动作）+ 定期探测在线状态。
  // 离线时 playAnim 会直接使用内置动画，避免视频 404 造成的闪烁。
  useEffect(() => {
    let alive = true;
    const check = () => {
      void bridge
        .assetsCheck()
        .then((r) => {
          if (!alive) return;
          M.assetsOnline = !!r.online;
          setAssetsOnline(M.assetsOnline);
          if (r.online && r.items.length) catRef.current = buildAnimPool(r.items);
        })
        .catch(() => {
          if (!alive) return;
          M.assetsOnline = false;
          setAssetsOnline(false);
        });
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // 遥控命令执行器：把平台下发的命令翻译成本地动作
  const execCmd = useCallback(
    async (cmd: PetCommand) => {
      const p = cmd.payload || {};
      switch (cmd.type) {
        case "play":
          if (typeof p.anim === "string" && p.anim) playAnim(p.anim);
          break;
        case "say":
          if (typeof p.text === "string" && p.text) {
            setBubble({ text: p.text.slice(0, 160), ts: Date.now() });
          }
          break;
        case "sleep":
          M.sleeping = true;
          playAnim(catRef.current.sleep, 4000);
          break;
        case "wake":
          wakeUp();
          break;
        case "celebrate":
          playAnim(catRef.current.celebrate, 3400);
          break;
        case "stretch":
          playAnim(catRef.current.stretch, 3000);
          break;
        case "focus":
          playAnim(catRef.current.focus, 5000);
          break;
        case "set_state": {
          const key = p.key;
          const value = p.value;
          if (key === "muted") {
            M.muted = !!value;
            if (M.muted) stopSpeaking();
            refreshState();
          }
          else if (key === "soundOn") M.soundOn = !!value;
          break;
        }
        case "notify":
          if (typeof p.text === "string" && p.text) {
            setBubble({ text: p.text.slice(0, 200), ts: Date.now() });
          }
          break;
        case "tts":
          if (typeof p.text === "string" && p.text) {
            const text = p.text.slice(0, 200);
            setBubble({ text, ts: Date.now() });
            // 遥控 TTS 不依赖本地「启用语音」开关；仍尊重安静模式与隐藏状态。
            if (!M.muted && !M.hidden) {
              const rate = typeof p.rate === "number" ? clamp(p.rate, 0.6, 1.6) : M.voiceRate;
              const voiceName = typeof p.voice === "string" ? p.voice : M.voiceName;
              primeVoices();
              speak(text, { rate, voiceName });
            }
          }
          break;
        case "reboot":
          window.location.reload();
          break;
        case "config": {
          const key = p.key;
          const value = p.value;
          if (key === "sound") {
            void bridge.setAiConfig({ sound: !!value }).catch(() => {});
          } else if (key === "autoStart") {
            void bridge.setAutoStart(!!value).catch(() => {});
          } else if (key === "muted") {
            M.muted = !!value;
            if (M.muted) stopSpeaking();
            refreshState();
          } else if (key === "soundOn") {
            M.soundOn = !!value;
          }
          break;
        }
        case "skin":
          {
            const next = themeFromValue(p.theme ?? p.skin ?? p.name ?? p.id ?? p.value);
            if (next) {
              applyTheme(next);
              const info = THEMES.find((t) => t.id === next);
              setBubble({ text: `🎨 已切换主题：${info?.emoji ?? ""}${info?.name ?? next}`, ts: Date.now() });
            } else {
              void bridge.diagLog("cmd skin: " + JSON.stringify(p)).catch(() => {});
            }
          }
          break;
      }
    },
    [playAnim, wakeUp, refreshState, applyTheme],
  );

  // 遥控命令轮询（5s）：从平台拉命令 → 执行 → 回执
  useEffect(() => {
    const t = setInterval(() => {
      if (M.hidden) return; // 隐藏时不轮询
      void bridge
        .petPoll()
        .then((cmds) => {
          for (const cmd of cmds) {
            void execCmd(cmd).catch(() => {});
            void bridge.petDone(cmd.id).catch(() => {});
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [execCmd]);

  // 平台遥测心跳（30s）：上报好感度/性格/情绪/今日统计/DSH 在线状态，供平台设备列表展示。
  // 用 ref 保存最新 dayStats/dsHealth，避免状态频繁变化反复重建定时器。
  const heartbeatRef = useRef<{ dayStats: DayStats; dshOnline: boolean }>({
    dayStats,
    dshOnline: !!dsHealth?.online,
  });
  heartbeatRef.current = { dayStats, dshOnline: !!dsHealth?.online };
  useEffect(() => {
    const beat = () => {
      if (M.hidden) return; // 隐藏时不心跳
      const tick = ++M.heartbeatTicks;
      if (tick <= 3 || tick % 20 === 0) {
        void bridge.diagLog(`heartbeat tick #${tick}`).catch(() => {});
      }
      const s = heartbeatRef.current;
      void bridge
        .petHeartbeat({
          name: M.name,
          affinity: Math.round(M.affinity),
          sass: Math.round(M.sass),
          personality: Math.round(M.personality),
          mood: M.mood,
          dshOnline: s.dshOnline,
          today: s.dayStats,
          scene: M.sceneMode,
          stage: relationStageFor(M.affinity).name,
          companionSecs: s.dayStats.companionSecs,
        })
        .catch((e) => {
          const now = Date.now();
          if (now - M.lastHeartbeatErrMs > 5 * 60_000) {
            M.lastHeartbeatErrMs = now;
            void bridge.diagLog(`heartbeat failed: ${String(e)}`).catch(() => {});
          }
        });
    };
    beat();
    const t = setInterval(beat, 30_000);
    return () => clearInterval(t);
  }, []);

  // 系统感知轮询（3s，更实时）：前台应用切换吐槽 + 真空闲 + 低电量提醒
  useEffect(() => {
    const t = setInterval(() => {
      if (M.hidden) return;
      void pollSystem().then((s) => {
        if (!s) return;
        M.system = s;
        setSystem(s);
        const now = Date.now();
        // 前台应用切换 → 吐槽（按进程名判断，切换浏览器标签不触发；1min 冷却，更实时）
        const app = s.foreground;
        const appName = app && app.name ? app.name : "";
        const meeting = !!app && M.sceneMuteOn && isMeetingForeground(app.name, app.title);
        if (meeting !== M.sceneMute) {
          M.sceneMute = meeting;
          void bridge
            .diagLog(`scene mute=${meeting} app=${appName} title=${app ? app.title : ""}`)
            .catch(() => {});
        }
        const appChanged = appName !== "" && appName !== M.lastApp;
        if (appName !== "") M.lastApp = appName; // 始终记录当前前台应用，保证每次切换都能识别
        if (
          M.appTeaseOn &&
          appChanged &&
          now - M.lastAppTeaseMs > 1 * 60 * 1000 &&
          !M.muted &&
          !M.sleeping &&
          !M.focusFlag
        ) {
          M.lastAppTeaseMs = now;
          sayAmbientRef.current("app", appName);
        }
        // 低电量提醒（30min 冷却；插电/充电时不提醒）
        if (
          M.batteryOn &&
          s.battery &&
          !s.battery.onAc &&
          s.battery.percent < 20 &&
          now - M.lastBatteryMs > 30 * 60 * 1000 &&
          !M.muted
        ) {
          M.lastBatteryMs = now;
          sayAmbientRef.current("battery-low", s.battery.percent + "%");
        }
      });
    }, 3_000);
    return () => clearInterval(t);
  }, []);

  // 久坐提醒（60s 检查）
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - M.lastSitRemindMs < 50 * 60 * 1000) return;
      if (M.muted || M.hidden || M.sleeping || M.focusFlag) return;
      if (proactiveSpeechBlocked()) return;
      M.lastSitRemindMs = Date.now();
      playAnim(catRef.current.stretch, 3000);
      sayRef.current("sitting");
    }, 60_000);
    return () => clearInterval(t);
  }, [playAnim]);

  // 关心（5min 检查）
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - M.lastCareMs < 40 * 60 * 1000) return;
      if (M.muted || M.hidden || M.sleeping || M.focusFlag) return;
      if (proactiveSpeechBlocked()) return;
      M.lastCareMs = Date.now();
      sayRef.current("tired");
    }, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  // 环境粒子（7s）
  useEffect(() => {
    const t = setInterval(() => {
      const decision = behaviorDecision();
      if (!decision.allowParticles) return;
      if (Math.random() < 0.65) spawnParticles(["✨"], 1, ["#ffd6a5", "#fff"]);
    }, 7000);
    return () => clearInterval(t);
  }, [behaviorDecision, spawnParticles]);

  // 昼夜 / 时段问候（60s）
  useEffect(() => {
    const doPeriod = () => {
      const p = getPeriod();
      if (M.period !== p) {
        M.period = p;
        if (p === "night") {
          M.sleeping = true;
          playAnim(catRef.current.sleep, 4000);
        } else if (M.sleeping) {
          wakeUp();
        }
        if (!M.greeted[p]) {
          M.greeted[p] = true;
          if (!M.muted && !M.hidden && !proactiveSpeechBlocked()) {
            if (p === "morning") sayRef.current("good-morning");
            else if (p === "afternoon") sayRef.current("good-afternoon");
            else if (p === "evening") sayRef.current("good-evening");
            else sayRef.current("good-night");
          }
        }
      }
    };
    doPeriod();
    const t = setInterval(doPeriod, 60_000);
    return () => clearInterval(t);
  }, [playAnim, wakeUp]);

  // 生日/节日（60s）
  useEffect(() => {
    const check = () => {
      const today = todayStr();
      if (M.lastFestiveDate === today) return;
      M.lastFestiveDate = today;
      saveJson(LS.festive, today);
      const mmdd = today.slice(5);
      if (!M.hidden && !proactiveSpeechBlocked()) {
        if (M.birthday && M.birthday.slice(5) === mmdd) sayRef.current("birthday");
        else if (FESTIVALS[mmdd]) sayRef.current("festival", FESTIVALS[mmdd]);
      }
    };
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  // 喝水提醒（5min）
  useEffect(() => {
    const t = setInterval(() => {
      if (!waterOn || M.muted || M.hidden || M.sleeping || M.focusFlag) return;
      if (proactiveSpeechBlocked()) return;
      const h = new Date().getHours();
      if (h < 8 || h >= 23) return;
      if (Date.now() - M.lastWaterMs < 60 * 60 * 1000) return;
      M.lastWaterMs = Date.now();
      saveJson(LS.water, M.lastWaterMs);
      spawnParticles(["💧"], 4, ["#a0c4ff", "#8ecae6"]);
      sayRef.current("water");
    }, 5 * 60_000);
    return () => clearInterval(t);
  }, [waterOn, spawnParticles]);

  // 加班提醒（10min）
  useEffect(() => {
    const t = setInterval(() => {
      const h = new Date().getHours();
      if (h < 22 && h >= 5) return;
      if (M.muted || M.hidden || M.sleeping || M.focusFlag) return;
      if (proactiveSpeechBlocked()) return;
      if (!M.busyFlag) return;
      if (Date.now() - M.lastOvertimeMs < 60 * 60 * 1000) return;
      M.lastOvertimeMs = Date.now();
      sayRef.current("overtime");
    }, 10 * 60_000);
    return () => clearInterval(t);
  }, []);

  // 主动话题（60s）
  useEffect(() => {
    const t = setInterval(() => {
      if (M.muted || M.hidden || M.sleeping || M.focusFlag) return;
      if (proactiveSpeechBlocked()) return;
      if (effectiveIdleMs() < 6 * 60 * 1000) return;
      if (Date.now() - M.lastProactiveMs < proactiveGapMs(M.talkativity)) return;
      M.lastProactiveMs = Date.now();
      sayAmbientRef.current("proactive");
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // 工作记忆（15min 间隔，DSH 在线时）。lastWork 用 ref 保存，避免 effect 因 dsHealth
  // 每 15s 变化而重建时被重置，导致「15min 抽取」永不触发。
  const lastWorkRef = useRef(Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      const h = new Date().getHours();
      const today = todayStr();
      if (h >= 8 && h < 23 && Date.now() - lastWorkRef.current >= 15 * 60 * 1000) {
        lastWorkRef.current = Date.now();
        if (dsHealth?.online) {
          void bridge.memoryWork().then((r) => {
            if (r.added > 0) setBubble({ text: "🧠 记住你刚才在做的事：" + r.added + " 件", ts: Date.now() });
          });
        }
      }
      if (h >= 20 && M.memDigestDate !== today && dsHealth?.online) {
        M.memDigestDate = today;
        saveJson(LS.memDigest, today);
        void bridge.memoryWork().then(() => {
          setBubble({ text: "🌙 睡前把今天的记忆整理了一下", ts: Date.now() });
        });
      }
    }, 60_000);
    return () => clearInterval(t);
  }, [dsHealth]);

  // 每日陪伴报告（≥21 点自动生成，已有当天报告则跳过）
  useEffect(() => {
    const t = setInterval(() => {
      const h = new Date().getHours();
      const today = todayStr();
      if (h >= 21 && M.reportDate !== today && !M.reportBusy) void generateDailyReport();
    }, 60_000);
    return () => clearInterval(t);
  }, [generateDailyReport]);

  // 陪伴时长：窗口可见且桌宠未隐藏时，每分钟累计一次。
  useEffect(() => {
    const t = setInterval(() => {
      if (M.hidden || document.visibilityState === "hidden") return;
      bumpDay("companionSecs", 60);
    }, 60_000);
    return () => clearInterval(t);
  }, [bumpDay]);

  // 打开报告面板时刷新历史，并保证有一个可查看的日期。
  useEffect(() => {
    if (!reportOpen) return;
    void refreshReports()
      .then((list) => {
        if (list.length === 0) return;
        if (!list.some((item) => item.date === selectedReportDate)) {
          setSelectedReportDate(list[0].date);
        }
      })
      .catch((error) => setReportMsg(`读取报告失败：${String(error)}`));
  }, [refreshReports, reportOpen, selectedReportDate]);

  // 跨天：给昨天写日记 + 重置今日统计。优先写 bumpDay 暂存的昨日统计（先交互后写日记也不丢数据），
  // 写成功才重置；失败保留下个 tick 重试。昨日的陪伴报告也会用本地统计兜底补生成。
  useEffect(() => {
    const tick = () => {
      const prevStats = M.pendingYesterday ?? (dayStats.date < todayStr() ? dayStats : null);
      if (!prevStats || prevStats.date >= todayStr() || yesterdayBusyRef.current) return;
      yesterdayBusyRef.current = true;
      void (async () => {
        try {
          // 报告和日记都成功后再清 pending；任一步失败保留下个 tick / 下次启动重试。
          try {
            await saveMissedReport(prevStats);
          } catch {
            return;
          }
          let diaryOk = false;
          try {
            diaryOk = await writeDiary(prevStats.date, prevStats);
          } catch {
            diaryOk = false;
          }
          if (!diaryOk) return;
          M.pendingYesterday = null;
          localStorage.removeItem(LS.pendingYesterday);
          setDayStats((d) => {
            if (d.date < todayStr()) {
              const fresh = emptyDayStats();
              saveJson(LS.day, fresh);
              return fresh;
            }
            return d;
          });
        } finally {
          yesterdayBusyRef.current = false;
        }
      })();
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [dayStats, saveMissedReport, writeDiary]);

  // 番茄倒计时（1s）
  useEffect(() => {
    if (!focusEndsAt) return;
    const t = setInterval(() => {
      const remain = Math.ceil((focusEndsAt - Date.now()) / 1000);
      setFocusSecs(Math.max(0, remain));
      if (remain <= 0) {
        M.focusFlag = false;
        M.focusEndsAt = 0;
        setFocusEndsAt(null);
        bumpDay("focusMin", 25);
        bumpAch("focus");
        playAnim(catRef.current.celebrate, 3400);
        sayRef.current("focus-done");
      }
    }, 1000);
    return () => clearInterval(t);
  }, [focusEndsAt, playAnim, bumpDay, bumpAch]);

  // 气泡打字机（22ms）：仅「从无气泡 → 有气泡」第一次逐字；流式分片/连续触发时直接整段替换，
  // 避免每个分片都清空重打造成的「一下显示一下消失」闪烁。
  const bubbleShownRef = useRef(false);
  useEffect(() => {
    if (!bubble) {
      bubbleShownRef.current = false;
      setBubbleDisp("");
      return;
    }
    if (bubbleShownRef.current) {
      setBubbleDisp(bubble.text);
      return;
    }
    bubbleShownRef.current = true;
    setBubbleDisp("");
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setBubbleDisp(bubble.text.slice(0, i));
      if (i >= bubble.text.length) clearInterval(t);
    }, 22);
    return () => clearInterval(t);
  }, [bubble]);

  // 气泡自动消失（12s）
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(null), 12_000);
    return () => clearTimeout(t);
  }, [bubble]);

  // 成就 toast 消失（3.5s）
  useEffect(() => {
    if (!achToast) return;
    const t = setTimeout(() => setAchToast(null), 3500);
    return () => clearTimeout(t);
  }, [achToast]);

  // 状态持久化
  useEffect(() => {
    if (!hydrated) return;
    saveMainState();
  }, [hydrated, scale, waterOn, stateVersion, saveMainState]);

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------
  const vw = VIDEO_W * scale;
  const vh = VIDEO_H * scale;
  const relationStage =
    RELATION_STAGES.find((stage) => stage.id === relationStageId) ?? relationStageFor(M.affinity);
  const relationNext = RELATION_STAGES.find((stage) => stage.min > relationStage.min) ?? null;

  // 桌宠贴近屏幕上沿时，气泡改到身体下方弹出，避免顶出窗口导致「对话框不显示」。
  const bubbleFlipDown = bubble !== null && petPos.y < 200;
  // 菜单同理：上方空间不足时向下展开，右侧空间不足时改为右对齐。
  const menuFlipDown = petPos.y < 320;
  const menuFlipLeft = petPos.x + 330 > window.innerWidth - 8;
  // 面板打开时贴在宠物左侧；空间不足由 usePanelDrag 自动翻到右侧并钳制在屏内。
  const panelAnchor = { x: petPos.x, y: petPos.y, w: M.petW, h: M.petH };

  return (
    <div
      className="dsh-vpet-root"
      data-theme={theme}
      onMouseMove={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        M.mouseX = e.clientX - r.left;
        M.mouseY = e.clientY - r.top;
      }}
    >
      {/* 宠物本体 */}
      {!M.hidden ? (
        <div
          ref={anchorRef}
          className={"dsh-vpet-anchor" + (M.pressInfo?.moved ? " dsh-vpet-dragging" : "")}
          style={{ width: vw, height: vh, left: petPos.x, top: petPos.y }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            if (!M.pressInfo) return; // 无按压状态时不打断当前动画
            M.pressInfo = null;
            M.strokeState = null;
            M.dragging = false;
            playAnim(catRef.current.idle, 2400);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (M.sleeping) wakeUp();
            setBubble(null); // 菜单与气泡同位置，避免重叠
            closePanels(); // 右键菜单是唯一浮层，避免面板与菜单滚动条同时出现
            setMenuOpen((v) => !v);
          }}
        >
          {videoFailed ? (
            <div className="dsh-vpet-fallback" style={{ width: vw, height: vh }}>
              <img
                src="/pet-poster.png"
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
              />
            </div>
          ) : (
            <PetStage
              src={animSrc}
              width={vw}
              height={vh}
              facing={M.facing}
              activeVideoRef={videoRef}
              onFailure={handleVideoFailure}
            />
          )}
          {menuOpen && (
            <div
              className={
                "dsh-vpet-menu" +
                (menuFlipDown ? " dsh-vpet-menu-down" : "") +
                (menuFlipLeft ? " dsh-vpet-menu-left" : "")
              }
              onPointerDown={(e) => e.stopPropagation()}
              onPointerMove={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <div className="dsh-vpet-menu-item" onClick={doFeed}>🍩 投喂</div>
              <div className="dsh-vpet-menu-item" onClick={() => openPanel("chat")}>💬 聊天</div>
              <div className="dsh-vpet-menu-item" onClick={() => openPanel("status")}>📊 状态</div>
              <div className="dsh-vpet-menu-item" onClick={() => openPanel("diary")}>📔 日记</div>
              <div className="dsh-vpet-menu-item" onClick={() => openPanel("report")}>📊 报告</div>
              <div className="dsh-vpet-menu-item" onClick={() => openPanel("mem")}>🧠 记忆</div>
              <div className="dsh-vpet-menu-sep" />
              <div className="dsh-vpet-menu-item" onClick={startFocus}>🍅 专注 25min</div>
              <div
                className="dsh-vpet-menu-item"
                onClick={() => {
                  const index = SCENE_MODES.indexOf(M.sceneMode);
                  setSceneModeSafe(SCENE_MODES[(index + 1) % SCENE_MODES.length]);
                  setMenuOpen(false);
                }}
              >
                🎬 场景：{sceneLabel(M.sceneMode)}
              </div>
              <div
                className="dsh-vpet-menu-item"
                onClick={() => {
                  const index = THEMES.findIndex((t) => t.id === M.theme);
                  const next = THEMES[(index + 1) % THEMES.length];
                  applyTheme(next.id);
                  setMenuOpen(false);
                  setBubble({ text: `🎨 已切换主题：${next.emoji} ${next.name}`, ts: Date.now() });
                }}
              >
                🎨 换主题
              </div>
              <div className="dsh-vpet-menu-item" onClick={resetPosition}>🧭 回到右下角</div>
              <div className="dsh-vpet-menu-item" onClick={() => setMutedSafe(!M.muted)}>
                {M.muted ? "🔇 安静模式开" : "🔔 安静模式"}
              </div>
              <div className="dsh-vpet-menu-sep" />
              <div className="dsh-vpet-menu-item" onClick={() => openPanel("settings")}>⚙️ 设置</div>
              <div className="dsh-vpet-menu-item" onClick={() => setHiddenSafe(true)}>🙈 隐藏</div>
            </div>
          )}
          {bubble && bubbleDisp && (
            <div className={"dsh-vpet-bubble" + (bubbleFlipDown ? " dsh-vpet-bubble-down" : "")}>{bubbleDisp}</div>
          )}
          {M.focusFlag && (
            <div className="dsh-vpet-focusbadge">🍅 {fmtClock(focusSecs)}</div>
          )}
          {relationStage.accessory && (
            <div className="dsh-vpet-accessory" title={`关系阶段：${relationStage.name}`}>
              {relationStage.accessory}
            </div>
          )}
          {/* 粒子（相对宠物本体，不随全屏窗口漂移） */}
          {particles.map((p) =>
            p.dot ? (
              <span
                key={p.id}
                className="dsh-vpet-particle dsh-vpet-particle-dot"
                style={{
                  left: p.x + "%",
                  bottom: "12%",
                  marginBottom: p.y,
                  animationDelay: p.delay + "ms",
                  width: p.size,
                  height: p.size,
                  background: p.color,
                  boxShadow: "0 0 8px " + p.color,
                }}
              />
            ) : (
              <span
                key={p.id}
                className="dsh-vpet-particle dsh-vpet-particle-emoji"
                style={{
                  left: p.x + "%",
                  bottom: "12%",
                  marginBottom: p.y,
                  animationDelay: p.delay + "ms",
                  fontSize: p.size,
                }}
              >
                {p.emoji}
              </span>
            ),
          )}
        </div>
      ) : (
        <button className="dsh-vpet-restore" onClick={() => setHiddenSafe(false)} title="点击显示桌宠">
          <span className="dsh-vpet-restore-icon">🐾</span>
          <span className="dsh-vpet-restore-text">显示桌宠</span>
        </button>
      )}

      {/* 成就 toast */}
      {achToast && (
        <div className="dsh-vpet-achtoast">
          <span className="dsh-vpet-achtoast-icon">{achToast.icon}</span>
          <span>成就解锁：{achToast.name}</span>
        </div>
      )}

      {/* 设置面板 */}
      {settingsOpen && (
        <SettingsPanel
          scale={scale}
          setScale={setScaleSafe}
          soundOn={soundOn}
          setSoundOn={setSoundOnSafe}
          voiceOn={voiceOn}
          setVoiceOn={(b) => {
            M.voiceOn = b;
            setVoiceOn(b);
            if (!b) stopSpeaking();
            refreshState();
          }}
          voiceRate={voiceRate}
          setVoiceRate={(v) => {
            M.voiceRate = clamp(v, 0.6, 1.6);
            setVoiceRate(M.voiceRate);
            refreshState();
          }}
          voiceName={voiceName}
          setVoiceName={(v) => {
            M.voiceName = v;
            setVoiceName(v);
            refreshState();
          }}
          voiceAmbient={voiceAmbient}
          setVoiceAmbient={(b) => {
            M.voiceAmbient = b;
            setVoiceAmbient(b);
            refreshState();
          }}
          theme={theme}
          setTheme={applyTheme}
          waterOn={waterOn}
          setWaterOn={setWaterOn}
          name={M.name}
          setName={(n) => {
            M.name = n.slice(0, 12);
            refreshState();
          }}
          birthday={M.birthday}
          setBirthday={(b) => {
            M.birthday = b;
            refreshState();
          }}
          sass={M.sass}
          setSass={(v) => {
            M.sass = clamp(v, 0, 100);
            refreshState();
          }}
          talkativity={talkativity}
          setTalkativity={(v) => {
            M.talkativity = clamp(v, 0, 100);
            setTalkativity(M.talkativity);
            refreshState();
          }}
          quietOn={quietOn}
          setQuietOn={(b) => {
            M.quietOn = b;
            setQuietOn(b);
            refreshState();
          }}
          quietFrom={quietFrom}
          setQuietFrom={(v) => {
            M.quietFrom = v;
            setQuietFrom(v);
            refreshState();
          }}
          quietTo={quietTo}
          setQuietTo={(v) => {
            M.quietTo = v;
            setQuietTo(v);
            refreshState();
          }}
          sceneMuteOn={sceneMuteOn}
          setSceneMuteOn={(b) => {
            M.sceneMuteOn = b;
            if (!b) M.sceneMute = false;
            setSceneMuteOn(b);
            refreshState();
          }}
          sceneMode={sceneMode}
          setSceneMode={setSceneModeSafe}
          personality={M.personality}
          affinity={M.affinity}
          appTeaseOn={M.appTeaseOn}
          setAppTeaseOn={(b) => {
            M.appTeaseOn = b;
            refreshState();
          }}
          batteryOn={M.batteryOn}
          setBatteryOn={(b) => {
            M.batteryOn = b;
            refreshState();
          }}
          sectionsOpen={sectionsOpen}
          setSectionsOpen={setSectionsOpen}
          trashItems={trashItems}
          refreshTrash={async () => setTrashItems((await bridge.trashList()).items)}
          onRestore={async (name) => {
            await bridge.restoreFile(name);
            setTrashItems((await bridge.trashList()).items);
          }}
          onPurge={async (name) => {
            await bridge.purgeFile(name);
            setTrashItems((await bridge.trashList()).items);
          }}
          testMsg={testMsg}
          dataMsg={dataMsg}
          onTest={async () => {
            setTestMsg("测试中…");
            const r = await bridge.testAiConnection();
            if (r.ok) {
              setTestMsg(`连接成功（${r.latencyMs}ms）`);
            } else {
              const clean = (r.diag || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
              const short = clean.length > 120 ? clean.slice(0, 120) + "…" : clean;
              setTestMsg(`连接失败：${short || "未知错误"}`);
            }
          }}
          onExport={async () => {
            try {
              const result = await exportBackup();
              setDataMsg(result.cancelled ? "已取消导出" : `已导出到 ${result.path}`);
            } catch (error) {
              setDataMsg(`导出失败：${String(error)}`);
            }
          }}
          onImport={async () => {
            try {
              const result = await importBackup();
              if (result.cancelled) {
                setDataMsg("已取消导入");
                return;
              }
              setDataMsg(`已导入 ${result.name}，正在重新加载…`);
              setTimeout(() => window.location.reload(), 900);
            } catch (error) {
              setDataMsg(`导入失败：${error instanceof Error ? error.message : String(error)}`);
            }
          }}
          onExportEncrypted={async (password) => {
            try {
              const result = await exportBackup(password);
              setDataMsg(result.cancelled ? "已取消加密导出" : `已加密导出到 ${result.path}`);
            } catch (error) {
              setDataMsg(`加密导出失败：${error instanceof Error ? error.message : String(error)}`);
            }
          }}
          onImportEncrypted={async (password) => {
            try {
              const result = await importBackup(password);
              if (result.cancelled) {
                setDataMsg("已取消加密导入");
                return;
              }
              setDataMsg(`已解密导入 ${result.name}，正在重新加载…`);
              setTimeout(() => window.location.reload(), 900);
            } catch (error) {
              setDataMsg(`加密导入失败：${error instanceof Error ? error.message : String(error)}`);
            }
          }}
          syncMsg={syncMsg}
          syncBusy={syncBusy}
          onSyncUpload={async (code) => {
            try {
              await uploadSync(code);
            } catch (error) {
              setSyncMsg(`同步上传失败：${error instanceof Error ? error.message : String(error)}`);
            }
          }}
          onSyncDownload={async (code) => {
            try {
              await downloadSync(code);
            } catch (error) {
              setSyncMsg(`同步下载失败：${error instanceof Error ? error.message : String(error)}`);
            }
          }}
          onClose={() => setSettingsOpen(false)}
          anchor={panelAnchor}
        />
      )}

      {/* 状态面板 */}
      {statusOpen && (
        <StatusPanel
          affinity={M.affinity}
          sass={M.sass}
          mood={M.mood}
          personality={M.personality}
          relationStage={relationStage}
          relationNext={relationNext}
          assetsOnline={assetsOnline}
          dayStats={dayStats}
          achCounters={achCounters}
          achUnlocked={achUnlocked}
          dsHealth={dsHealth}
          system={system}
          onClose={() => setStatusOpen(false)}
          anchor={panelAnchor}
        />
      )}

      {/* 聊天面板 */}
      {chatOpen && (
        <ChatPanel
          history={chatHistory}
          input={chatInput}
          setInput={setChatInput}
          loading={chatLoading}
          onSend={sendChat}
          onClose={() => setChatOpen(false)}
          anchor={panelAnchor}
        />
      )}

      {/* 日记面板 */}
      {diaryOpen && (
        <DiaryPanel
          list={diaryList}
          onWrite={async (text) => {
            await bridge.diaryWrite(todayStr(), text);
            setDiaryList((await bridge.diaryList()).diary);
          }}
          onClose={() => setDiaryOpen(false)}
          anchor={panelAnchor}
        />
      )}

      {/* 记忆面板 */}
      {memOpen && (
        <MemoryPanel
          list={memList}
          onAdd={async (content, category, date) => {
            await bridge.memoryAdd(content, category, date);
            setMemList((await bridge.memoryList()).memories);
          }}
          onDelete={async (id) => {
            await bridge.memoryDelete(id);
            setMemList((await bridge.memoryList()).memories);
          }}
          onClose={() => setMemOpen(false)}
          anchor={panelAnchor}
        />
      )}

      {/* 每日陪伴报告 */}
      {reportOpen && (
        <DailyReportPanel
          reports={reports}
          selectedDate={selectedReportDate}
          busy={reportBusy}
          message={reportMsg}
          onSelect={setSelectedReportDate}
          onGenerate={generateDailyReport}
          onExport={async (report) => {
            try {
              const dataUrl = renderReportCard(report, M.name);
              const result = await bridge.reportExportPng(dataUrl, `dsh-pet-report-${report.date}.png`);
              setReportMsg(result.cancelled ? "已取消导出" : `分享卡已保存到 ${result.path}`);
            } catch (error) {
              setReportMsg(`导出分享卡失败：${error instanceof Error ? error.message : String(error)}`);
            }
          }}
          onClose={() => setReportOpen(false)}
          anchor={panelAnchor}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

interface ReportSections {
  chatSummary: string;
  doneSummary: string;
  tomorrow: string;
  mood: string;
}

/** 远端同键覆盖本地；用于同步时合并记忆/日记/报告。 */
function mergeByKey<T>(local: T[], remote: T[], keyOf: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of local) map.set(keyOf(item), item);
  for (const item of remote) map.set(keyOf(item), item);
  return Array.from(map.values());
}

/** 聊天没有稳定 id：按 role + text 去重后保留最后 20 条。 */
function mergeChat(local: ChatTurn[], remote: ChatTurn[]): ChatTurn[] {
  const seen = new Set<string>();
  const merged: ChatTurn[] = [];
  for (const turn of [...local, ...remote]) {
    const key = `${turn.role}\u0000${turn.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(turn);
  }
  return merged.slice(-20);
}

/** 模型偶尔会包 markdown 代码块或在 JSON 前后加解释，这里只提取第一个 JSON 对象。 */
function parseReportSections(text: string): ReportSections | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const pick = (key: string, max: number) =>
      typeof value[key] === "string" ? (value[key] as string).trim().slice(0, max) : "";
    const sections = {
      chatSummary: pick("chatSummary", 160),
      doneSummary: pick("doneSummary", 160),
      tomorrow: pick("tomorrow", 120),
      mood: pick("mood", 160),
    };
    return Object.values(sections).some(Boolean) ? sections : null;
  } catch {
    return null;
  }
}

/** 模型不可用时的确定性兜底：仍然给出一份可保存、可分享的本地报告。 */
function fallbackReportSections(stats: DayStats): ReportSections {
  const companion = Math.max(0, Math.round(stats.companionSecs / 60));
  return {
    chatSummary:
      stats.chat > 0
        ? `今天和我聊了 ${stats.chat} 次，虽然话不算多，但每次都有认真听。`
        : "今天没怎么聊天，不过我一直都在旁边看着你。",
    doneSummary:
      stats.taskDone > 0 || stats.focusMin > 0
        ? `完成了 ${stats.taskDone} 个任务，专注了 ${stats.focusMin} 分钟；${stats.taskFailed > 0 ? `还有 ${stats.taskFailed} 个任务失败了，明天再看看。` : "效率还算勉强过得去。"}`
        : "今天没有记录到明显的工作成果，先好好休息也算一种完成。",
    tomorrow:
      stats.focusMin < 30
        ? "明天先挑一件最重要的事，认真做满一个番茄钟，别再磨蹭了。"
        : "明天保持今天的节奏，但记得中间起来喝水、活动一下。",
    mood: companion > 0 ? `今天陪了你 ${companion} 分钟。哼，别以为我很在意。` : "哼，今天也算勉强陪你过完了。",
  };
}

function emptyDayStats(): DayStats {
  return {
    date: todayStr(),
    chat: 0,
    feed: 0,
    pet: 0,
    eat: 0,
    poke: 0,
    focusMin: 0,
    taskDone: 0,
    taskFailed: 0,
    ssh: 0,
    companionSecs: 0,
  };
}

/** 读取旧版统计时补齐新增字段，避免 undefined 参与运算或展示。 */
function normalizeDayStats(raw: unknown): DayStats {
  if (!raw || typeof raw !== "object") return emptyDayStats();
  const value = raw as Record<string, unknown>;
  const date = typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    ? value.date
    : todayStr();
  const number = (key: string, max = Number.MAX_SAFE_INTEGER) => {
    const n = value[key];
    return typeof n === "number" && Number.isFinite(n) ? clamp(Math.round(n), 0, max) : 0;
  };
  return {
    date,
    chat: number("chat"),
    feed: number("feed"),
    pet: number("pet"),
    eat: number("eat"),
    poke: number("poke"),
    focusMin: number("focusMin"),
    taskDone: number("taskDone"),
    taskFailed: number("taskFailed"),
    ssh: number("ssh"),
    companionSecs: number("companionSecs"),
  };
}
