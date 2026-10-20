// 与 Rust 侧 DTO 一一对应的类型（IPC 边界统一 camelCase）。

export type LlmTask = "say" | "chat";

export interface ModelProfileView {
  id: string;
  label: string;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  model: string;
}

export interface ModelProfileInput {
  id?: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface ModelRouteInput {
  sayModelId?: string | null;
  chatModelId?: string | null;
}

export interface AiConfig {
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  model: string;
  dshUrl: string;
  autoStart: boolean;
  sound: boolean;
  assetsUrl: string;
  assetsEnabled: boolean;
  models: ModelProfileView[];
  sayModelId: string | null;
  chatModelId: string | null;
}

export interface AiConfigUpdate {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  dshUrl?: string;
  autoStart?: boolean;
  sound?: boolean;
  assetsUrl?: string;
  assetsEnabled?: boolean;
}

export interface DeviceInfo {
  deviceId: string;
  hasDeviceToken: boolean;
}

export interface LlmResponse {
  ok: boolean;
  text: string;
  diag: string;
}

export interface ConnectionTest {
  ok: boolean;
  latencyMs: number;
  diag: string;
}

export type MemoryCategory = "goal" | "deadline" | "preference" | "event";

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory | string;
  date: string;
  createdAt: number;
  remindedAt: number | null;
  /** 重要度 0~3：期限/目标更高，影响主动话题与回忆召回排序。 */
  importance?: number;
  /** 最近一次被回忆召回的时间戳。 */
  lastRecalledAt?: number | null;
}

export interface DiaryEntry {
  date: string;
  text: string;
}

export interface ChatTurn {
  role: "user" | "assistant" | string;
  text: string;
}

export interface Records {
  memories: Memory[];
  diary: DiaryEntry[];
  chat: ChatTurn[];
  reports?: DailyReport[];
}

export interface DailyReport {
  date: string;
  companionSecs: number;
  stats: Partial<DayStats> & Record<string, unknown>;
  chatSummary: string;
  doneSummary: string;
  tomorrow: string;
  mood: string;
  generatedAt: number;
}

export interface DshCheck {
  online: boolean;
  event: string | null;
  ssh: string | null;
  busy: boolean;
  diag: string;
}

export interface DshContext {
  online: boolean;
  lines: string[];
}

export interface TaskEvent {
  kind: string;
  title: string;
}

export interface DshTaskboard {
  online: boolean;
  event: TaskEvent | null;
  diag: string;
}

export interface AssetsItem {
  file: string;
  name: string;
  category: string;
  sha256?: string;
}

export interface AssetsCheck {
  online: boolean;
  version: string | null;
  items: AssetsItem[];
  diag: string;
}

export interface AssetsResolve {
  path: string;
  builtin: boolean;
}

export interface PetCommand {
  id: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface PetHeartbeat {
  name: string;
  affinity: number;
  sass: number;
  personality: number;
  mood: string;
  dshOnline: boolean;
  today: DayStats;
  scene?: string;
  stage?: string;
  companionSecs?: number;
}

export interface ForegroundApp {
  name: string;
  title: string;
}

export interface BatteryStatus {
  percent: number;
  onAc: boolean;
}

export interface SystemSnapshot {
  idleSecs: number;
  foreground: ForegroundApp | null;
  battery: BatteryStatus | null;
}

export interface TrashItem {
  name: string;
  original: string;
}

export interface FsResult {
  ok: boolean;
  removed: string;
  restored: string;
  diag: string;
}

export interface TrashListResponse {
  ok: boolean;
  items: TrashItem[];
}

export interface MemoryListResponse {
  ok: boolean;
  memories: Memory[];
}

export interface MemoryResult {
  ok: boolean;
  added: number;
  removed: number;
  count: number;
  diag: string;
}

export interface MemoryPickResponse {
  ok: boolean;
  memory: Memory | null;
}

export interface MemoryRecallResponse {
  ok: boolean;
  memories: Memory[];
}

export interface DiaryListResponse {
  ok: boolean;
  diary: DiaryEntry[];
}

export interface ChatListResponse {
  ok: boolean;
  chat: ChatTurn[];
}

export interface RecordsResult {
  ok: boolean;
  count: number;
  diag: string;
}

export interface BackupSaveResult {
  cancelled: boolean;
  path: string;
}

export interface BackupOpenResult {
  cancelled: boolean;
  name: string;
  content: string;
}

export interface ReportListResponse {
  ok: boolean;
  reports: DailyReport[];
}

export interface SyncDownloadResult {
  found: boolean;
  payload: string;
  updatedAt: number;
}

export interface HitRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 命中形状：rect = 矩形，ellipse = 内接椭圆（宠物本体用，透明边角可穿透）。 */
  kind?: "rect" | "ellipse";
}

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DayStats {
  date: string;
  chat: number;
  feed: number;
  pet: number;
  eat: number;
  poke: number;
  focusMin: number;
  taskDone: number;
  taskFailed: number;
  ssh: number;
  companionSecs: number;
}
