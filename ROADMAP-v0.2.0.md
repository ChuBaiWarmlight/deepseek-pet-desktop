# dsh-pet 下一版本（v0.2.0）迭代计划

> 状态：草案（规划）　|　覆盖范围：`dsh-pet-desktop`（桌宠桌面端）+ `dsh-pet-assets`（资源管理平台）
> 版本主题：**从单机宠物 → 可管理、可感知、可运营的宠物系统**

---

## 0. 现状快照（计划的事实依据）

**桌宠端 `dsh-pet-desktop`**

- 全屏透明窗口 + DOM 定位；鼠标穿透用「全窗口 `ignore_cursor_events` + Rust 16ms 轮询 + 前端 50ms 上报**矩形**命中区」（`src-tauri/src/window.rs` / `src/PetApp.tsx` 的 `reportHitRegions`）。
- AI：多模型配置（`save_model` / `delete_model` / `set_model_route`）、流式（`llm_stream` via Channel）、33 种 say 模式、温度矩阵。
- 数据：记忆（≤50 条）/ 日记（≤30）/ 聊天（≤20）、吃文件/回收站、原生备份对话框。
- 联动：DSH 桥（`dsh_check` / `dsh_context` / `dsh_taskboard`）、资源流式拉取 + sha256 缓存 + 预取、遥控命令轮询、系统感知（前台应用/电量/空闲）。

**管理平台 `dsh-pet-assets`**

- 资源管理（上传/删除/改元数据/重建清单/回收站/审计）+ scrypt 管理员登录 + SQLite WAL。
- 遥控命令仅 **8 种**（`play` / `say` / `sleep` / `wake` / `celebrate` / `stretch` / `focus` / `set_state`），生命周期 pending → delivered → done，60s 未回执重新入队。
- 桌宠访问（`/api/pet/poll`、`/api/pet/commands/:id/done`）**匿名**。

**关键缺口（本版要解决）**

1. 穿透是「矩形命中」而非「像素级 alpha 命中」，宠物透明边角仍挡桌面点击。
2. 触发频率/话痨程度是硬编码（`PetApp.tsx` 内 `300_000` / `0.5` / `45_000`）。
3. 平台只能「单向发命令 + 收到 done」，看不到桌宠任何状态。
4. 遥控命令匿名，本机任意进程可拉取/伪造回执。
5. 无 OTA、无自动化、无设备列表、无发布/回滚通道。

---

## 1. 版本目标与优先级

优先级：P0 = 本版必须；P1 = 本版尽量；P2 = 可顺延。

三条主线：

- **（A）桌宠体验打磨**：穿透、话痨控制、语音、记忆。
- **（B）平台升级**：从「资源仓库 + 8 种单向命令」→「设备管理 + 内容发布 + 自动化」中心。
- **（C）协同协议**：从「单向命令 + done 回执」→「双向状态同步」。

---

## 2. 桌宠端功能点（`dsh-pet-desktop`）

### D-01【P0】像素级点击穿透（替代矩形命中）　✅ 已实现（内接椭圆命中；纯矩形回退开关留待后续）

- **现状**：`set_hit_regions` 上报的是宠物 DOM 的 bounding box 矩形；640×360 透明 webm 四角透明区仍在矩形内，会挡住点击；面板命中区也是整块矩形。
- **目标**：透明处穿透、宠物/面板实体处可点。
- **改动点**：
  - `src-tauri/src/window.rs`：`HitRegion` 增加 `kind`（`rect` | `ellipse` | `polygon`），轮询线程命中判定从 `rect contains` 扩展为多边形/椭圆判定。
  - `src/PetApp.tsx` `reportHitRegions`：宠物本体改报「内接椭圆 / 缩小多边形」（取猫咪躯干近似轮廓），面板仍用矩形。
  - 设置面板加「穿透自检」开关，出问题时一键退回纯矩形模式。
- **验收**：宠物视频透明四角能点穿到桌面；点击猫咪本体能触发交互。

### D-02【P0】话痨/打扰控制做成配置

- **现状**：自动吐槽 `300s + 50% 概率`、环境类 `45s` 节流，均为 `PetApp.tsx` 写死常量。
- **目标**：用户可调「话痨程度」，支持勿扰时段。
- **改动点**：
  - `src/lib/constants.ts`：新增 `LS.talkativity`（0~100）、`LS.quietFrom` / `LS.quietTo`。
  - `src/PetApp.tsx`：`300_000` / `0.5` / `45_000` 改为按 `talkativity` 插值；新增勿扰时段判断，命中时环境类 `sayAmbient` 直接 return。
  - `src/components/SettingsPanel.tsx`：性格与提醒分区加「话痨程度」滑杆 + 安静时段输入。
- **验收**：拉满/拉低滑杆，自动吐槽频率明显变化；安静时段内不主动开口，交互类不受影响。

### D-03【P0】平台遥测上报（心跳 + 状态）　✅ 已实现（30s 心跳 + pet_devices + Pets 页；设备鉴权属 M-05 未做）

- **现状**：只 `pet_poll`（拉命令）/`pet_done`（回执），平台看不到桌宠。
- **目标**：桌宠定期上报状态，平台可见。
- **改动点**：
  - `src-tauri/src/commands/pet.rs`：新增 `pet_heartbeat`（`version`、`online`、`affinity/sass/personality/mood`、`todayStats`、`dsHealth.online`、`model` 摘要），由前端 30s 定时器调用；`pet_poll` 请求带设备标识。
  - `src/lib/bridge.ts` + `src/lib/types.ts`：加 `petHeartbeat` 与心跳 DTO。
- **验收**：管理平台能看到桌宠在线状态与关键数值。

### D-04【P1】TTS 语音（可选开关）　✅ 已实现（WebView2 Web Speech API，本地离线）

- **现状**：WebAudio 音效之外，已支持系统语音朗读。
- **目标**：气泡台词可朗读，默认关。
- **实现**：
  - `src/lib/voice.ts`：`primeVoices()` / `speak()` / `stopSpeaking()`，优先中文音色并清理 Markdown/emoji。
  - `src/PetApp.tsx`：主动互动与聊天回复按开关朗读，主动吐槽可单独开启；安静时段/会议静音优先。
  - `src/components/SettingsPanel.tsx`：「语音朗读」分区，支持启用、主动吐槽朗读、语速 0.6–1.6x、音色选择和试听。
  - 平台 `tts` 命令直接触发朗读，不依赖本地「启用语音」开关；`notify` 仍只显示气泡。
- **验收**：开启后气泡文本可朗读；静音/勿扰时不读。

### D-05【P1】OTA 自更新

- **现状**：版本写死 `0.1.0`，升级靠手动重装。
- **目标**：从平台拉新版本安装包，提示后更新。
- **改动点**：
  - 平台发布通道见 M-03；`src-tauri/src/commands/update.rs`（新）：`check_update` 拉 `GET /api/release/latest`，比对版本，下载后校验 hash + 备份旧 exe + 替换（复用 `tauri-plugin-updater` 或自实现）。
  - 托盘菜单加「检查更新」。
- **验收**：平台发布新版本后，桌宠提示可更新并完成替换，失败可回滚。

### D-06【P1】人格/记忆增强　✅ 已实现（importance/lastRecalledAt + 相关度召回 memory_recall + 聊天长期画像注入）

- **现状**：记忆 ≤50 条、4 类、`memory_pick` 按「未提醒/日期/新建」排序；聊天上下文留 20 条。
- **目标**：让宠物更「记得住、认得人」。
- **改动点**：
  - `src-tauri/src/commands/memory.rs`：记忆加 `importance` / `lastRecalledAt`；`memory_pick` 改为「相关度优先」（关键词命中 + 时间衰减）；聊天回忆触发词命中时注入更多相关记忆。
  - `src/lib/ai.ts`：chat system 增加「长期画像摘要」（从记忆聚合主人偏好/日程/喜恶的滚动摘要）。
- **验收**：聊到相关话题时宠物能引用更贴切的旧记忆。

### D-07【P2】性能与稳定性

- **现状**：全局 `mousemove`、`reportHitRegions` 50ms、Rust 穿透轮询 16ms、十几个 `setInterval`。
- **改动点**：`mousemove` 用 rAF 节流；`reportHitRegions` 只在命中区实际变化时上报（脏标记）；崩溃自动重启 + `diag.log` 滚动清理；AI 请求统一超时/重试。
- **验收**：长时间运行 CPU 占用下降，异常可自愈。

### D-08【P1】主题换肤　✅ 已实现

- **目标**：同一套桌宠资源支持多套视觉主题，并可由平台下发切换。
- **实现**：`src/lib/constants.ts` 定义草莓奶油/薄荷苏打/海盐蓝/夜莓紫 4 套主题；`src/pet.css` 通过 CSS 令牌换色；设置页「外观与主题」可选择，右键菜单「换主题」可快速轮换。
- **持久化**：主题写入主状态，重启恢复。
- **平台命令**：`skin` 支持 `theme` / `skin` / `name` / `id` / `value` 字段及中英文别名。
- **验收**：切换后所有面板/菜单/气泡同步变色；重启保持；平台 `skin` 命令可切换。

---

## 3. 管理平台功能点（`dsh-pet-assets`）

### M-01【P0】设备列表 + 状态中心

- **现状**：只有 `pet_commands` 表，无设备概念。
- **改动点**：
  - `lib/db.js`：新增 `pet_devices` 表（`id/device_id/name/version/last_seen/status/affinity/sass/personality/mood/model/dsh_online/today_json`）。
  - `server.mjs`：新增 `POST /api/pet/heartbeat`（匿名但需 device token，见 M-05）、`GET /api/pets`、`GET /api/pets/:id`。
  - `src/views/`：新增 `Pets.vue`（设备卡片：在线灯、版本、好感度条、今日互动、DSH/AI 状态、最后心跳）；`AdminLayout.vue` 侧边栏加「宠物」入口。
- **验收**：桌宠上线后出现在列表并实时刷新；离线显示灰灯 + 最后心跳时间。

### M-02【P0】遥控命令增强（命令类型 + 批量 + 定时）

- **现状**：8 种命令、单条下发、无定时。
- **改动点**：
  - `lib/pet.js`：`COMMAND_TYPES` 扩展 `config`（改配置）、`skin`（换肤）、`reboot`、`notify`（推消息）、`tts`（让它说话）。
  - 新增 `pet_schedules` 表（`cron/type/payload/enabled/last_run`）+ `lib/schedule.js`：按 cron 触发生成命令（如每天 10 点 `notify` 提醒喝水）。
  - `src/views/Console.vue`：命令面板加「批量下发（选设备）」「定时任务列表」。
- **验收**：能对指定设备下发新命令；定时任务按点触达。

### M-03【P1】发布通道（资源版本 + 桌宠 OTA）

- **现状**：manifest 有 `version` 但无发布/回滚；无桌宠安装包托管。
- **改动点**：
  - `lib/manifest.js` + `lib/db.js`：`resources` 加 `draft` 状态；`POST /api/release`（草稿→发布，生成新 version，记录快照）、`POST /api/rollback`。
  - 新增 `releases` 表 + `/api/release/latest` + `/api/release/{version}/artifact`（托管桌宠 exe/NSIS）。
- **验收**：资源改动先入草稿、点发布才生效；桌宠能拉到最新安装包。

### M-04【P1】资源编辑器增强

- **现状**：仅 `.webm`、≤5MB 上传，改 category/tags/name。
- **改动点**：
  - `lib/resources.js`：上传时用 `ffprobe` 解析时长/分辨率/**是否含 alpha 通道**写入元数据；大小上限可配置；支持拖拽排序、批量下线。
  - `src/views/Library.vue`：卡片显示时长/分辨率/alpha 徽标，支持排序与批量操作。
- **验收**：上传后自动带时长/alpha 元数据；列表可按字段排序。

### M-05【P0】设备鉴权（收口匿名遥控）

- **现状**：`/api/pet/poll`、`/api/pet/commands/:id/done` 匿名，本机任何进程都能拉命令。
- **改动点**：
  - 首次配对：桌宠启动生成 `device_id`，平台控制台点「配对」生成 `device_token`（一次性展示，写入桌宠 `config.json`）。
  - `server.mjs`：`/api/pet/*` 改为校验 `X-Device-Token`（sha256 哈希存 `pet_devices`），失败 401。
- **验收**：无 token 的 `/api/pet/poll` 返回 401；配对后正常。

### M-06【P2】多用户/角色 + 审计增强 + 监控告警

- **改动点**：`users` 加 `role`（admin/operator/viewer）；operator 可发命令不可改资源；审计支持按动作/用户/时间导出 CSV；`/api/health` 加磁盘/DB 状态；桌宠离线超阈值时平台日志告警。

---

## 4. 协同协议升级（两端都要改）

| 能力 | 桌宠端 | 平台端 |
|---|---|---|
| 心跳/状态 | `pet_heartbeat`（30s） | `POST /api/pet/heartbeat` + `pet_devices` |
| 设备身份 | `config.json` 存 `device_id` / `device_token` | 配对 + token 校验 |
| 命令扩展 | `execCmd` 增 `config/skin/reboot/notify/tts` | `COMMAND_TYPES` + 批量 + 定时 |
| OTA | `check_update` | `releases` 表 + `/api/release/*` |

---

## 5. 里程碑（按依赖排序）

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **V1** | D-02 话痨配置 + D-01 穿透优化 | 滑杆生效；透明区可穿透 |
| **V2** | M-05 设备鉴权 + M-01 设备状态中心 + D-03 心跳 | 平台看到桌宠在线与状态；匿名拉命令 401 |
| **V3** | M-02 命令增强 + 定时 + 批量 | 定时命令触达；批量下发可用 |
| **V4** | M-03 发布通道 + D-05 OTA | 平台发布 → 桌宠更新 |
| **V5** | D-04 TTS ✅ + D-06 记忆增强 ✅ + D-08 主题换肤 ✅ + M-04 资源编辑器 | 语音可选；记忆更贴切；主题可换；资源带元数据 |
| **V6** | D-07 性能 + M-06 权限/告警 | 长跑稳定；权限/告警可用 |

---

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 像素级穿透（D-01）复杂度高 | 先做「内接椭圆/缩小多边形」近似，保留纯矩形回退开关；不一步到位做 WM_NCHITTEST |
| 设备 token 明文存 config | 只存哈希比对、`config.json` 0600、token 仅配对时展示一次 |
| OTA 静默替换 exe 失败损坏 | 先下载到临时目录 + 校验 hash + 备份旧 exe + 失败回滚 |
| 心跳/命令接口被本机其它进程滥用 | 全部走 device token + 命令幂等（已 delivered 不重放） |
| 平台单点（Node 进程） | 保持 `install-service.ps1` 自启；监控告警提示服务未启动 |

---

## 7. 本版 DoD（一句话）

> 桌宠可被平台「看到、管到、更新到」：透明穿透更干净、话痨可调、能说话（可选）、能 OTA；平台从「资源仓库 + 8 种单向命令」升级为「设备管理 + 内容发布 + 自动化」中心，且遥控访问有鉴权。
