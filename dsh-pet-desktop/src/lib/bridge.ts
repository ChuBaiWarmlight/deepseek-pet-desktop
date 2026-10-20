// Tauri 命令的类型化桥接层：前端唯一的 invoke 入口。
// 参数键名必须与 Rust 命令形参名一致（`req` / `enable` / `dx` / `dy` / `x` / `y` / `upd`）。

import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  AiConfig,
  AiConfigUpdate,
  AgentEvent,
  AgentEventInput,
  AgentHubInfo,
  TimelineSummary,
  WorkDayDigest,
  WorkFocusState,
  WorkProfile,
  WorkReport,
  WorkTaskCard,
  AssetsCheck,
  AssetsResolve,
  PetCommand,
  BackupOpenResult,
  BackupSaveResult,
  ChatListResponse,
  ChatTurn,
  ConnectionTest,
  DiaryEntry,
  DailyReport,
  DiaryListResponse,
  DshCheck,
  DshContext,
  DshTaskboard,
  DeviceInfo,
  FsResult,
  HitRegion,
  LlmResponse,
  LlmTask,
  Memory,
  MemoryListResponse,
  MemoryPickResponse,
  MemoryRecallResponse,
  MemoryResult,
  ModelProfileInput,
  ModelProfileView,
  ModelRouteInput,
  PetHeartbeat,
  Records,
  RecordsResult,
  ReportListResponse,
  SyncDownloadResult,
  SystemSnapshot,
  TrashListResponse,
  WorkArea,
} from "./types";

export const bridge = {
  // ---------- config ----------
  getAiConfig: () => invoke<AiConfig>("get_ai_config"),
  setAiConfig: (upd: AiConfigUpdate) => invoke<AiConfig>("set_ai_config", { upd }),
  saveModel: (req: ModelProfileInput) => invoke<ModelProfileView>("save_model", { req }),
  deleteModel: (id: string) => invoke<void>("delete_model", { id }),
  setModelRoute: (req: ModelRouteInput) => invoke<void>("set_model_route", { req }),
  consumePosReset: () => invoke<boolean>("consume_pos_reset"),
  getDeviceInfo: () => invoke<DeviceInfo>("get_device_info"),
  setDeviceToken: (token: string) => invoke<DeviceInfo>("set_device_token", { token }),

  // ---------- llm ----------
  llmComplete: (system: string, user: string, maxTokens?: number, temperature?: number, task: LlmTask = "chat") =>
    invoke<LlmResponse>("llm_complete", { req: { system, user, maxTokens, temperature, task } }),
  llmStream: (
    system: string,
    user: string,
    onChunk: (chunk: string) => void,
    maxTokens?: number,
    temperature?: number,
    task: LlmTask = "chat",
  ) => {
    const channel = new Channel<string>(onChunk);
    return invoke<void>("llm_stream", { channel, req: { system, user, maxTokens, temperature, task } });
  },
  testAiConnection: () => invoke<ConnectionTest>("test_ai_connection"),

  // ---------- memory ----------
  memoryList: () => invoke<MemoryListResponse>("memory_list"),
  memoryExtract: (history: ChatTurn[], name?: string) =>
    invoke<MemoryResult>("memory_extract", { req: { history, name } }),
  memoryAdd: (content: string, category?: string, date?: string) =>
    invoke<MemoryResult>("memory_add", { req: { content, category, date } }),
  memoryDelete: (id: string) => invoke<MemoryResult>("memory_delete", { req: { id } }),
  memoryImport: (memories: Memory[]) =>
    invoke<MemoryResult>("memory_import", { req: { memories } }),
  memoryWork: () => invoke<MemoryResult>("memory_work"),
  memoryPick: () => invoke<MemoryPickResponse>("memory_pick"),
  memoryMark: (id: string) => invoke<MemoryResult>("memory_mark", { req: { id } }),
  memoryRecall: (query: string, limit?: number) =>
    invoke<MemoryRecallResponse>("memory_recall", { req: { query, limit } }),

  // ---------- records (diary / chat / backup) ----------
  diaryList: () => invoke<DiaryListResponse>("diary_list"),
  diaryWrite: (date: string, text: string) =>
    invoke<RecordsResult>("diary_write", { req: { date, text } }),
  chatList: () => invoke<ChatListResponse>("chat_list"),
  chatSet: (history: ChatTurn[]) => invoke<RecordsResult>("chat_set", { req: { history } }),
  chatClear: () => invoke<RecordsResult>("chat_clear"),
  recordsExport: () => invoke<Records>("records_export"),
  recordsImport: (memories: Memory[], diary: DiaryEntry[], chat: ChatTurn[], reports: DailyReport[] = []) =>
    invoke<RecordsResult>("records_import", { req: { memories, diary, chat, reports } }),
  reportList: () => invoke<ReportListResponse>("report_list"),
  reportSave: (report: DailyReport) => invoke<RecordsResult>("report_save", { req: { report } }),
  backupSave: (content: string, suggestedName: string) =>
    invoke<BackupSaveResult>("backup_save", { req: { content, suggestedName } }),
  backupOpen: () => invoke<BackupOpenResult>("backup_open"),
  reportExportPng: (dataUrl: string, suggestedName: string) =>
    invoke<BackupSaveResult>("report_export_png", { req: { dataUrl, suggestedName } }),
  syncUpload: (code: string, payload: string, updatedAt?: number) =>
    invoke<number>("sync_upload", { req: { code, payload, updatedAt } }),
  syncDownload: (code: string) => invoke<SyncDownloadResult>("sync_download", { code }),

  // ---------- dsh ----------
  dshCheck: () => invoke<DshCheck>("dsh_check"),
  dshContext: () => invoke<DshContext>("dsh_context"),
  dshTaskboard: () => invoke<DshTaskboard>("dsh_taskboard"),

  // ---------- agent hub（Claude Code / Codex / 通用工作事件） ----------
  agentHubInfo: () => invoke<AgentHubInfo>("agent_hub_info"),
  agentRecent: (limit?: number) => invoke<AgentEvent[]>("agent_recent", { limit }),
  agentEmit: (event: AgentEventInput) => invoke<AgentEvent>("agent_emit", { event }),
  focusAgentWindow: (query: string) => invoke<string>("focus_agent_window", { query }),
  agentTimeline: (day?: string, limit?: number) => invoke<AgentEvent[]>("agent_timeline", { day, limit }),
  agentTimelineSummary: (day?: string) => invoke<TimelineSummary>("agent_timeline_summary", { day }),
  agentTimelineDays: (limit?: number) => invoke<string[]>("agent_timeline_days", { limit }),
  workMemoryDigest: (day?: string) => invoke<WorkDayDigest>("work_memory_digest", { day }),
  workMemoryProfile: (days?: number) => invoke<WorkProfile>("work_memory_profile", { days }),
  workMemoryText: (days?: number) => invoke<string>("work_memory_text", { days }),
  workFocusState: () => invoke<WorkFocusState>("work_focus_state"),
  workTaskCards: (day?: string) => invoke<WorkTaskCard[]>("work_task_cards", { day }),
  workReport: (period?: "day" | "week", day?: string) => invoke<WorkReport>("work_report", { period, day }),
  workReportExport: (period?: "day" | "week", day?: string) => invoke<string>("work_report_export", { period, day }),
  workBrief: (kind?: "morning" | "evening") => invoke<string>("work_brief", { kind }),

  // ---------- assets (资源平台桥接) ----------
  assetsCheck: () => invoke<AssetsCheck>("assets_check"),
  assetsResolve: (name: string) => invoke<AssetsResolve>("assets_resolve", { name }),
  assetsPrefetch: () => invoke<number>("assets_prefetch"),
  assetsClearCache: () => invoke<void>("assets_clear_cache"),

  // ---------- pet (遥控命令) ----------
  petPoll: () => invoke<PetCommand[]>("pet_poll"),
  petDone: (id: number) => invoke<boolean>("pet_done", { id }),
  petHeartbeat: (payload: PetHeartbeat) => invoke<void>("pet_heartbeat", { payload }),

  // ---------- system ----------
  systemSnapshot: () => invoke<SystemSnapshot>("system_snapshot"),

  // ---------- fs ----------
  eatFile: (path: string) => invoke<FsResult>("eat_file", { req: { path } }),
  trashList: () => invoke<TrashListResponse>("trash_list"),
  restoreFile: (name: string) => invoke<FsResult>("restore_file", { req: { name } }),
  purgeFile: (name: string) => invoke<FsResult>("purge_file", { req: { name } }),

  // ---------- window ----------
  setHitRegions: (regions: HitRegion[]) => invoke<void>("set_hit_regions", { regions }),
  getWorkArea: () => invoke<WorkArea>("get_work_area"),
  diagLog: (msg: string) => invoke<void>("diag_log", { msg }),

  // ---------- autostart ----------
  setAutoStart: (enable: boolean) => invoke<boolean>("set_auto_start", { enable }),
  getAutoStart: () => invoke<boolean>("get_auto_start"),
};
