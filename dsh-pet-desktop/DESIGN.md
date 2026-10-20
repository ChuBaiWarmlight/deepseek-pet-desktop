# dsh-pet-desktop 详细设计文档

> 把 DSH Web GUI 桌宠（dsh-pet）1:1 复刻为独立 Windows 桌面应用（Tauri exe）。
> AI 走 OpenAI 兼容接口（设置里填 base URL + key + 模型）；DSH 特色功能（工作记忆/任务/SSH 感知）连回 DSH 才启用。

---

## 0. 现状盘点与代码资产（本文档的事实依据）

在动手前先对齐三个真实存在的代码资产，本设计的所有「1:1 复刻」都以此为准。

| 资产 | 路径 | 角色 |
|---|---|---|
| **dsh-pet 插件（源）** | `E:\deepseek-harness-student\dsh-pet` | **唯一业务逻辑来源**。`package/lib/client.js`（1866 行，前端全部 UI/交互/状态/定时器）+ `package/lib/index.js`（865 行，后端 LLM/记忆/吃文件/DSH 感知）+ 51 段透明 webm 动画 |
| **dsh-pet-standalone（原生原型）** | `E:\esign_5.3\dsh-pet-standalone` | 已用 **Rust + 纯 Win32** 解决最难的原生难题：VP9+alpha webm 解码（libvpx 静态链接）、`UpdateLayeredWindow` 透明分层窗口、`WM_NCHITTEST` 像素级鼠标穿透、托盘、开机自启、素材内嵌打包（~36MB 单 exe、零运行时依赖）。**但无 AI、无面板、无完整交互** |
| **dsh-pet-desktop（本工程）** | `E:\deepseek-harness-student\dsh-pet-desktop` | 目标：完整桌面端（AI 对话 + 全交互 + 全面板） |

**关键事实（已实测核对）**

- 动画素材：`E:\esign_5.3\dsh-pet-standalone\assets\videos\` 下 **51 个 640×360 透明 webm（VP9 + alpha）**，共 12291 帧（原生原型 `decode_check` 实测）。
- 环境：Node `v22.12.0` ✅、Rust `1.94.1` ✅、WebView2 ✅；全局 `tauri` CLI **未装**（用 npm `@tauri-apps/cli` devDependency，无需全局）。
- 前端业务量：client.js 含 **33 个 LLM 模式 + 9 成就 + 4 情绪 + 3 档性格 + 15+ 定时器 + 8 类面板 + 粒子/音效**，远多于「桌宠动画」四个字能概括的范围——这是本文档要补齐的核心。

**技术路线再确认**：本工程沿用 §2 的 **Tauri 2.x + React** 决策（UI/交互/状态可复用 80%，面板类 UI 用 Win32 手写代价极高）。原生原型 `dsh-pet-standalone` 不废弃，作为**两个去风险参照**：
1. 其 **VP9+alpha 解码管线**（`src/webm.rs` / `src/vpx.rs` / `src/clip.rs`）是 WebView2 渲染 alpha 视频失败时的兜底方案（见 §13 风险 R0）；
2. 其 **窗口/穿透/托盘/自启/素材打包** 的实现细节（`src/win32.rs` / `src/tray.rs` / `src/autostart.rs` / `build.rs`）作为 Tauri 侧对应能力的行为基准。

---

## 1. 项目概述

| 项 | 内容 |
|---|---|
| 目标 | 独立 exe 桌面宠物，复刻 dsh-pet 全部功能 + 接入 AI 对话 |
| 形态 | 透明无边框、置顶、鼠标穿透的桌面挂件，配系统托盘 |
| AI | OpenAI 兼容 chat/completions（支持 DeepSeek / OpenAI / 中转站） |
| DSH 联动 | 通过 HTTP 连回本机 DSH（127.0.0.1:3080），在线才启用特色功能 |
| 技术栈 | Tauri 2.x（Rust + WebView） + React（复用现有 client.js 逻辑） |

**原则**：现有 `client.js`（~1866 行）的 UI/交互/状态逻辑 80% 直接移植，不重写业务逻辑；现有 `index.js`（~865 行）的 prompt 模板与记忆逻辑 100% 移植，仅把「DSH 的 llm/agents 服务」替换为「OpenAI 兼容接口 + DSH HTTP 桥」。

---

## 2. 技术选型

| 决策 | 选择 | 理由 |
|---|---|---|
| 框架 | **Tauri 2.x** | 体积小（~10MB 骨架）、内存低、Rust 后端原生能力强 |
| 前端 | React 18（无 JSX 构建前的逻辑直接复用） | 现有 client.js 就是 React.createElement |
| 打包 | `@tauri-apps/cli`（npm devDependency）+ NSIS | 生成 Windows 安装包 + 绿色版 exe |
| HTTP | Rust `reqwest` | 后端代理 LLM 与 DSH，规避 CORS、保护 key |
| 视频渲染 | WebView2 `<video>`（首选）\| 原生原型 libvpx 管线（兜底） | VP9+alpha 在 WebView2 的透明渲染需**先行验证**，见 R0 |
| 存储 | localStorage（前端状态）+ 配置文件（Rust）+ 文件系统（回收站/记忆） | 分层，见 §9 |

**环境依赖**（已实测）：Node `22.12.0` ✅、Rust `1.94.1` ✅、WebView2 ✅；全局 `tauri` CLI 未装 → 用 npm `@tauri-apps/cli` 作 devDependency，`pnpm tauri dev/build`。

---

## 3. 总体架构

```
┌─────────────────────────── 前端 (WebView / React) ───────────────────────────┐
│  PetApp（移植 client.js）                                                    │
│  ├─ 桌宠本体 + 51 动画链 + 粒子 + 视线 + 昼夜 + 情绪 + 性格 + 成就            │
│  ├─ 交互（点击/双击/长按/抚摸/拖拽/投喂/吃文件/聊天/右键菜单）                  │
│  ├─ 面板（设置/状态/日记/记忆/聊天）                                            │
│  ├─ 定时器（喝水/久坐/加班/生日节日/主动话题/工作记忆/睡前沉淀/昼夜）            │
│  └─ lib/ai.ts · lib/dsh.ts · lib/storage.ts · lib/audio.ts · lib/constants.ts · lib/bridge.ts │
│        │ invoke()  (JSON 跨进程)                                              │
└────────┼─────────────────────────────────────────────────────────────────────┘
         ▼
┌─────────────────────────── Rust 后端 (tauri commands) ───────────────────────┐
│  commands/llm.rs    → OpenAI 兼容 chat/completions（非流式 v1，可扩展 SSE）     │
│  commands/memory.rs → 长期记忆：抽取/合并/增删/导入/回忆（写 records.json）       │
│  commands/records.rs→ 日记/聊天/导出导入（写 records.json）                      │
│  commands/dsh.rs    → 代理 http://127.0.0.1:3080/dsh-pet/api/* + 上下文采集    │
│  commands/fs.rs     → 吃文件/回收站/恢复/彻底删除（真实文件系统）                 │
│  config.rs          → 读写 ~/.dsh-pet-desktop/config.json（base/key/model）    │
│  storage.rs         → 统一记录存储 RecordsStore（RwLock，原子写 tmp+rename）     │
│  http.rs            → reqwest 客户端（连接池/超时/截断）                          │
│  tray.rs            → 系统托盘（显示/隐藏/设置/记忆/自启/退出）                    │
│  autostart.rs       → auto-launch 开机自启                                      │
│  window.rs          → 透明/置顶/穿透/移动/resize 窗口                             │
└───────────────────────────────────────────────────────────────────────────────┘
```

**核心数据流**：前端 lib/ai.js 构建 system/user prompt（移植 index.js 的 33 个 say 模式 + chat/diary/review 模板）→ `invoke('llm_complete', {system, user, max_tokens, temperature})` → Rust 请求 OpenAI → 返回文本 → 前端处理展示。DSH 特色功能：前端定时器 `invoke('dsh_check'/'dsh_context')` 探测并采集 → 触发对应 say 模式或 `memory_work`。

**职责边界（关键）**

| 逻辑 | 归属 | 说明 |
|---|---|---|
| 33 个 say 模式 / chat / diary / review 的 prompt 模板 | 前端 `lib/ai.js` | 静态模板，从 index.js `doSay/doChat/doDiary/doReview` 逐字移植 |
| 记忆抽取/合并/去重/增删/导入/回忆 | Rust `commands/memory.rs` | 从 index.js `runExtraction/parseMemories/loadMemory/saveMemory/pickMemory/markMemory/doDeleteMemory/doAddMemory/doImportMemory` 移植；记忆统一落盘 `~/.dsh-pet-desktop/records.json`（见 §9，更耐用、无 5MB 上限、key 不落前端） |
| 日记/聊天读写 | Rust `commands/records.rs` | Web 版散在 localStorage，桌面版收敛进 `records.json`（`diary`/`chat` 两个字段），原子写 |
| 主人最近对话/SSH/任务感知的上下文采集 | Rust `commands/dsh.rs` | 从 index.js `gatherContext/findLatestMessage/findLatestSshCall` 移植，仅 DSH 在线可用 |

---

## 4. 目录结构（与已实现代码一致）

```
dsh-pet-desktop/
├── DESIGN.md
├── package.json                  # 前端依赖 + @tauri-apps/cli + @tauri-apps/api
├── vite.config.ts
├── tsconfig.json                 # strict + jsx:react-jsx + noUnusedLocals/Parameters
├── index.html
├── public/
│   └── assets/videos/            # 51 段 webm（public/ 原样进 dist，供 <video> 与 Tauri 嵌入）
├── src/                          # 前端（TypeScript + JSX，模块化）
│   ├── main.tsx                  # React 挂载（无 StrictMode，避免双定时器）
│   ├── PetApp.tsx                # PetApp 主组件（状态/交互/定时器，不含面板 UI）
│   ├── pet.css                   # 样式（从 client.js CSS 移植，fixed→absolute）
│   ├── vite-env.d.ts
│   ├── components/               # 面板 UI（每类面板一个文件，窗口内可拖拽）
│   │   ├── PanelHead.tsx         # 面板标题栏（拖拽 + 关闭）
│   │   ├── SettingsPanel.tsx     # 设置（4 分区）+ AI 配置 + 回收站
│   │   ├── StatusPanel.tsx       # 状态（好感/毒舌/情绪/统计/成就）
│   │   ├── ChatPanel.tsx         # 聊天
│   │   ├── DiaryPanel.tsx        # 日记
│   │   └── MemoryPanel.tsx       # 记忆本
│   ├── hooks/
│   │   └── usePanelDrag.ts       # 面板窗口内拖拽 hook
│   └── lib/
│       ├── types.ts              # 共享 DTO 类型（Memory/ChatTurn/DiaryEntry/Records/DayStats/...）
│       ├── constants.ts          # CAT 51 动画、9 成就、8 节日、LS 键、WINDOW/VIDEO 尺寸
│       ├── utils.ts              # 通用工具（clamp/pick2）
│       ├── storage.ts            # localStorage 读写（loadJson/saveJson）
│       ├── bridge.ts             # typed invoke 封装（精确 arg-key 契约）
│       ├── ai.ts                 # 33 say 模式 + chat/diary/review prompt 构建 + 温度矩阵
│       ├── audio.ts              # WebAudio 音效合成（beep 8 种）
│       └── dsh.ts                # DSH 轮询/任务/上下文桥接
├── src-tauri/
│   ├── Cargo.toml                # lib 名 dsh_pet_desktop_lib
│   ├── tauri.conf.json           # 透明/无边框/置顶/动态尺寸/托盘/NSIS
│   ├── build.rs
│   ├── capabilities/default.json # core:default + window 权限
│   ├── icons/                    # 由 pnpm tauri icon 生成
│   └── src/
│       ├── main.rs
│       ├── lib.rs                # 模块声明 + 33 命令注册 + manage(Store/RecordsStore)
│       ├── config.rs             # ~/.dsh-pet-desktop/config.json
│       ├── storage.rs            # ~/.dsh-pet-desktop/records.json（统一记忆/日记/聊天，原子写）
│       ├── http.rs               # reqwest 客户端（rustls-tls）+ 超时/截断
│       ├── window.rs             # 穿透/移动/定位/resize/工作区
│       ├── autostart.rs          # auto-launch 开机自启
│       ├── tray.rs               # 系统托盘
│       └── commands/
│           ├── mod.rs
│           ├── llm.rs            # OpenAI 兼容 chat/completions + 连接测试
│           ├── memory.rs         # 记忆抽取/合并/增删/导入/回忆（写 records.json → memories）
│           ├── records.rs        # 日记/聊天/导出导入（写 records.json → diary/chat）
│           ├── dsh.rs            # DSH 桥接 + 上下文采集
│           └── fs.rs             # 吃文件/回收站
```

---

## 5. 窗口与桌面交互设计

### 5.1 窗口属性（tauri.conf.json）

```json
{
  "windows": [{
    "transparent": true,
    "decorations": false,
    "alwaysOnTop": true,
    "skipTaskbar": true,
    "resizable": false,
    "width": 360,
    "height": 300,
    "shadow": false
  }]
}
```

> 窗口即画布：宠物锚定**左下角（8px）**；气泡/菜单/面板是窗口内绝对定位 DOM。窗口尺寸**动态 resize**（见 §5.2），默认（无面板）仅容纳宠物本体+气泡；面板打开时 `invoke('resize_window')` 放大到 ≥720×520。

### 5.2 尺寸策略与点击穿透

- **动态尺寸**：无面板时窗口 = 宠物可视尺寸（`640×scale × 360×scale`）+ 边距；任一面板打开时放大到 `max(宠物尺寸+边距, 720×520)`，关闭全部面板再缩回。宠物锚左下角，resize 不跳位。
- **点击穿透**：v1 窗口**始终可交互（不穿透）**，靠「无面板时窗口尽可能小」来最小化遮挡。`set_clickthrough` 命令已保留但默认不用。
- **已知限制（R9）**：Tauri `set_ignore_cursor_events` 是**全窗口**开关，做不到原生原型 `WM_NCHITTEST` 的**逐像素 alpha 穿透**。要做到「透明处穿透、宠物处可点」需原生窗口消息（Win32 分层窗口 + hit-test），列为后续增强；v1 用小窗口 + 动态 resize 近似替代。

### 5.3 拖拽移动

- 宠物本体可拖动：前端 `pointerdown/move/up` 计算位移，`invoke('set_window_position', {x, y})`（绝对坐标，用缓存的窗口起始位置 + 位移钳制）。
- 位移钳制：`clamp` 用 `invoke('get_work_area')` 返回的**多屏虚拟桌面边界 `{x,y,width,height}`**（遍历 `available_monitors` 取并集，支持副屏负坐标），宠物可在所有显示器间拖拽、不拖出桌面。
- 菜单「回到右下角」→ `invoke('set_window_position')` 复位到虚拟桌面右下角。
- 面板窗口内可拖拽：标题栏按住即拖（`usePanelDrag`，首次拖拽从 right 定位切到 left/top 并钳制在窗口内）。

### 5.4 系统托盘

- 菜单：显示/隐藏、AI 设置、打开日记本、打开记忆本、开机自启（切换）、退出（设置/日记/记忆通过 `tray-command` 事件通知前端开面板）。
- 开机自启：Rust 用 `auto-launch` crate 写 `HKCU\...\Run`（无需管理员）；对照原生原型 `src/autostart.rs`。

---

## 6. 前端模块设计（移植 client.js）

### 6.1 移植策略

| 原 client.js 部分 | 处理方式 |
|---|---|
| 模块级状态（pos/sass/affinity/personality/mood…，见 §6.3） | 原样保留（module-level let） |
| React 状态 + 组件渲染（VideoPet + 8 类面板） | 原样保留（React.createElement） |
| CSS 字符串 + `ctx.effect` 注入 | 改为直接 `<style>` 引入 pet.css（内容逐字复制） |
| `fetchJson('/dsh-pet/api/...')` | 替换为 `invoke('...')`（映射见 §7.1） |
| `timer.interval/timeout`（DSH service） | 替换为浏览器 `setInterval/setTimeout` 封装（lib/storage.js 提供） |
| `window.__ModuleLoader__.load` 入口 | 改为标准 `ReactDOM.createRoot` 挂载 |
| webm 视频路径 `/dsh-pet/video/{anim}.webm` | 改为本地 assets 打包路径 `assets/videos/{anim}.webm` |
| `detectTaskEvent()` 读 `dsh.taskBoard.v1` | 改为 `invoke('dsh_taskboard')`（需 DSH 桥新增端点，见 §7.3 缺口 G1） |
| `localStorage` 键 | 全部原样复用（见 §9） |

### 6.2 动画目录（CAT，51 段，必须完整复制）

动画链概率（`chainNext`）：睡眠优先 → 空闲>8min 且不忙则入睡 → 否则 `roll<0.30` 待机 / `<0.40` 转向（10%）/ `<0.80` 随机动作（40%）/ 其余移动（20%，向鼠标方向走，`leadMs=2000/tailMs=2000`）。

| 槽位 | 动画名 |
|---|---|
| idle | 待机呼吸休闲 |
| turn | 东张西望 |
| moves（3） | 螃蟹走路、原地漂浮踏步、原地左转奔跑 |
| clicks（3） | 点击回应 - 开心跃动、点击回应 - 害羞惊讶、点击回应 - 傲娇生气（侧身展示） |
| drag | 被鼠标拖拽悬空反馈 |
| sleep | 原地小憩沉眠 |
| wake | 打瞌睡被惊醒 |
| focus | 写代码 |
| celebrate | 可爱宅舞 |
| stretch | 超大伸懒腰 |
| acts（40，随机动作池） | 被落叶淹没、被吓一跳（炸毛）、吃Token、吃白饭、吃冰淇淋融化、吃晚餐、吃午餐、吃早餐、吹气球、大口吃零食、动物环绕、堆雪人、放风筝、哈欠连天、鲸鱼吐泡泡特效、蓝鲸现世、女仆屈膝礼仪、轻快记录、轻快摇摆舞、深度思考碎碎念、偷吃零食被抓住、玩水枪、玩游戏气急败坏、小幅度原地 360 度旋转展示、小提琴演奏、摇扇纳凉、用鲸鱼尾巴拍打地面、优雅女仆舞、悠闲哼歌、原地蹲下玩玩具汽车、原地敲击桌面互动、原地跳跃抓碎头顶物品、原地重力下蹲压缩、原地专心玩魔方、照镜子、整体换装试色、中秋赏月吃月饼 |

> 注：acts 池与具名槽位有重叠（sleep/focus/celebrate/stretch/wake/原地左转奔跑/螃蟹走路 同时出现在 acts），实际**唯一文件共 51 个**。打包时以「文件名」为键，不按槽位去重。

### 6.3 状态模型（module-level let，全部保留）

| 变量 | 默认/范围 | 说明 |
|---|---|---|
| `posRef {x,y}` | {0,0} | 相对右下角偏移，钳制在工作区内 |
| `facingRef` | -1 | 朝向（-1 左 / 1 右），随鼠标/移动翻转 |
| `scale` | 0.5（0.3~1.2） | 缩放，视频 640×360 等比缩放 |
| `affinityFlag` | 50（0~100） | 好感度：摸+2 / 戳-1 / 拖-2 / 喂+3（在 prompt 构建侧调整） |
| `sassFlag` | 60（0~100） | 毒舌程度，映射 temperature（§8.3） |
| `personalityFlag` | 50（0~100） | 长期性格：≥70 撒娇黏人 / ≥35 标准傲娇 / else 高冷傲娇；每次互动 ±0.5 |
| `moodRef` + `moodUntilMs` | normal | 临时情绪 happy/angry/sleepy/normal，超时回落 |
| `nameFlag` | ''（≤12） | 宠物名 |
| `birthdayFlag` | ''（MM-DD） | 生日 |
| `mutedFlag` / `soundOn` / `hiddenFlag` | false/false/false | 静音 / 音效开关（默认关）/ 隐藏 |
| `sleepingFlag` | false | 夜间或 8min 空闲入睡 |
| `focusFlag` + `focusEndsAt` + `focusStartMs` | — | 番茄专注 25min |
| `busyFlag` | false | DSH 最近 5min 有活动（桥接） |
| `seenExecs` + `taskBaselineDone` | {} | 任务看板已结算执行去重 |
| 计数类 | — | pokeCount/lastPokeMs/eggClickCount/eggClickMs/lastCareMs/lastSitRemindMs/lastProactiveMs/memPendingCount/memExtracting/reviewBusy/lastSayMs/lastClickMs |

### 6.4 交互模型（手势 → 动画 → 台词 → 成就）

| 手势 | 触发条件 | 动作 | say 模式 | 副作用 |
|---|---|---|---|---|
| 唤醒 | 睡眠中点击 | 打瞌睡被惊醒 | wake | 粒子💤✨、音效 wake |
| 长按 | 按住 ≥600ms 未移动 | 超大伸懒腰 | long-press | 音效 longpress |
| 拖拽 | 移动 >6px | 被鼠标拖拽悬空反馈 | drag | 性格-0.5、粒子💨、音效 drag |
| 抚摸 | 水平来回滑动 ≥2 次 | 随机 clicks | pet | 好感+2、性格+0.5、摸次数+1 |
| 单击·摸头 | 点击且 `ry<0.33` | 点击回应 - 害羞惊讶 | pet（摸头） | 同上 |
| 单击·摸尾巴 | 点击且 `ry>0.67` | 原地左转奔跑 | pet（摸尾巴） | 同上 |
| 单击·戳身体 | 点击且 `0.33≤ry≤0.67` | 随机 clicks | roast | 好感-1、戳次数+1、连戳4次→angry |
| 双击 | 两次点击 <350ms | 可爱宅舞 | double-click | 音效 celebrate |
| 连戳彩蛋 | 3s 内 ≥10 次点击 | 原地左转奔跑 | egg-poke | 粒子💢💥🔥 |
| 凌晨彩蛋 | 2~4 点点击 | — | egg-night | — |
| 说喜欢彩蛋 | 聊天含 喜欢/爱你/么么哒 | 点击回应 - 害羞惊讶 | egg-love | 粒子💕 |
| 投喂 | 右键菜单「投喂」 | 大口吃零食 | feed | 好感+3、喂次数+1 |
| 吃文件 | 拖文件到宠物（非穿透时） | 吃Token → 成功可爱宅舞 | eat-file | 吃次数+1、音效 eat |
| 右键 | 右键点击 | 菜单 | — | — |
| 专注 | 菜单「开始专注 25min」 | 写代码 | focus-start / focus-done | 番茄成就 |

### 6.5 成就系统（9 个，`ach.c` 计数 / `ach.u` 解锁）

| id | 图标 | 名称 | 触发 |
|---|---|---|---|
| chat | 💬 | 打开话匣子 | 聊天 1 次 |
| feed | 🍩 | 干饭人 | 投喂 1 次 |
| eat | 🗑️ | 大胃王 | 吃文件 10 次 |
| poke | 💢 | 抗揍 | 被戳 50 次 |
| pet | 🖐️ | 摸头杀 | 被摸 30 次 |
| focus | 🍅 | 专注达人 | 完成 1 次番茄 |
| night | 🌙 | 夜猫子 | 深夜陪它 1 次 |
| affinity | 💖 | 好感爆棚 | 好感度达 100 |
| collector | 🏅 | 收藏家 | 解锁 5 个成就 |

### 6.6 粒子 / 音效

- **粒子**：`spawnParticles(emojis, count, colors)`，45% 概率渲染圆点（CSS `dsh-vpet-rise` 上浮动画），其余 emoji；2400ms 自动清理。
- **音效**：`lib/audio.js` 移植 client.js `tone/beep/ensureEcho/getAudio`（WebAudio 振荡器 + 0.3s 回声延迟）。`beep` 种类：click/pet/feed/celebrate/longpress/eat/wake/drag。默认 `soundOn=false`，`muted` 时全静默。

### 6.7 定时器清单（完整，`timer.interval` → `setInterval`）

| # | 周期 | 条件 | 动作 |
|---|---|---|---|
| 1 | 40ms | movePlan 存在 | 动画移动插值更新位置 |
| 2 | 首 4s / 每 100s | — | 主动 say（idle>3min→lonely，否则 auto） |
| 3 | 15s | DSH 在线 | `dsh_check` + `dsh_taskboard`：busy/event/ssh/任务结算 → 对应 say |
| 4 | 60s 检查 | 距上次 >50min | 伸懒腰 + sitting（久坐提醒） |
| 5 | 5min 检查 | 距上次 >40min | tired（关心） |
| 6 | 7s | 65% 概率 | 环境粒子 ✨ |
| 7 | mousemove | — | 视线朝向 + 倾斜 `--dsh-tilt` |
| 8 | 60s | 时段切换 | 昼夜问候 + 夜间入睡/清晨唤醒 |
| 9 | 60s | 跨天 | rollDay + 触发昨日日记 |
| 10 | 60s | 当天首次 | 生日/节日祝福 |
| 11 | 5min | 8~23 点、1h 冷却 | 喝水提醒 |
| 12 | 10min | 22~5 点、busy、1h 冷却 | 加班提醒 overtime |
| 13 | 60s | 空闲>6min、25min 冷却 | 主动话题 proactive（可带记忆） |
| 14 | 60s | 8~23 点、15min 间隔 | 工作记忆抽取 `memory_work` |
| 15 | 60s | ≥20 点首次 | 睡前记忆沉淀 `memory_work` |
| 16 | 60s | ≥21 点首次 | 生成今日复盘 review |
| 17 | 1s | focusing | 番茄倒计时 |
| 18 | 22ms | bubble 存在 | 打字机逐字显示 |
| 19 | 3.5s / 12s | achToast / bubble | 自动消失 |

### 6.8 面板清单（8 类，全部 1:1）

设置（4 折叠分区：基础/性格与提醒/养成/数据）、状态、心情日记、记忆本、聊天、右键菜单、气泡、成就 toast。样式类名（`dsh-vpet-*`）与布局逐字复用 pet.css。

### 6.9 关键差异点（相对 Web 版）

- **AI 调用**：`say/chat/diary/review` 的 prompt 构建保留在 `lib/ai.js`，统一 `invoke('llm_complete')`；记忆抽取/合并移到 Rust `memory.rs`（见 §0 职责边界）。
- **吃文件**：Tauri `onDragDropEvent` 拿**真实文件路径** → `invoke('eat_file', {path})` → Rust 直接移动（比 Web 版按文件名搜索更可靠）；若拖放不提供路径则回退到按文件名+大小在「桌面/下载/文档」搜索（保留 index.js `doEatFile` 逻辑）。
- **DSH 桥接**：`lib/dsh.js` 定期 `invoke('dsh_check')` 探测 DSH 在线；在线才启动工作记忆/任务/SSH 感知定时器。
- **视频**：本地 `assets/videos/*.webm` 直接 `<video>`，不再走 `/dsh-pet/video/` 路由（VP9+alpha 透明性需 R0 先行验证）。

---

## 7. Rust 后端模块设计

### 7.1 命令总览（Tauri Commands，映射原 host 端点）

| 命令 | 输入 | 输出 | 对应原端点 / 说明 |
|---|---|---|---|
| `llm_complete` | `{system, user, max_tokens, temperature}` | `{ok, text, diag}` | 新：OpenAI 兼容对话（替代 `llm.stream`） |
| `test_ai_connection` | — | `{ok, latency_ms, diag}` | 新：设置面板「测试连接」小探测 |
| `get_ai_config` / `set_ai_config` | `{base_url, api_key?, model, dsh_url, auto_start, sound}` | `{ok, ...}` | 读写 AI 配置（api_key 空=不改） |
| `dsh_check` | — | `{online, event, ssh, busy, diag}` | `GET /dsh-pet/api/check` |
| `dsh_context` | — | `{online, lines}` | 新：采集主人最近对话（供 say 上下文） |
| `dsh_taskboard` | — | `{online, event}` | 缺口 G1：任务结算感知（需 DSH 桥补端点） |
| `memory_list` | — | `{ok, memories}` | `GET /dsh-pet/api/memory` |
| `memory_extract` | `{history, name}` | `{ok, added, diag}` | `POST /dsh-pet/api/memory`（抽取，写 records.json） |
| `memory_add` | `{content, category, date}` | `{ok}` | `POST /dsh-pet/api/memory/add` |
| `memory_delete` | `{id}` | `{ok, removed}` | `POST /dsh-pet/api/memory/delete` |
| `memory_import` | `{memories}` | `{ok, count}` | `POST /dsh-pet/api/memory/import` |
| `memory_work` | — | `{ok, added, diag}` | `POST /dsh-pet/api/memory/work`（含上下文采集） |
| `memory_pick` | — | `{ok, memory}` | 取一条未提醒记忆（proactive 注入） |
| `memory_mark` | `{id}` | `{ok}` | 标记记忆已提醒 |
| `diary_list` / `diary_write` | `{date, text}` | `{ok, diary}` | 日记（records.json → diary，同天覆盖） |
| `chat_list` / `chat_set` / `chat_clear` | `{chat}` | `{ok, chat}` | 聊天（records.json → chat，留 20 条） |
| `records_export` / `records_import` | `{memories, diary, chat}` | `{ok}` | 统一备份记忆+日记+聊天 |
| `eat_file` | `{path}` | `{ok, removed, diag}` | `POST /dsh-pet/api/eat-file`（改真实路径） |
| `trash_list` | — | `{ok, items}` | `GET /dsh-pet/api/trash` |
| `restore_file` | `{name}` | `{ok, restored}` | `POST /dsh-pet/api/restore` |
| `purge_file` | `{name}` | `{ok}` | `POST /dsh-pet/api/purge` |
| `set_clickthrough` | `{enable}` | — | 鼠标穿透开关（保留，v1 默认不用） |
| `move_window` | `{dx, dy}` | — | 相对移动窗口 |
| `set_window_position` | `{x, y}` | — | 绝对定位窗口 |
| `resize_window` | `{width, height}` | — | 面板开合/缩放时调整窗口尺寸 |
| `get_window_position` | — | `{x, y}` | 缓存窗口位置（拖拽钳制用） |
| `get_work_area` | — | `{x, y, width, height}` | 多屏虚拟桌面边界（钳制用） |
| `set_auto_start` / `get_auto_start` | `{enable}` | `{enabled}` | 开机自启 |

### 7.2 llm.rs —— OpenAI 兼容调用

```
POST {base_url}/chat/completions
Authorization: Bearer {api_key}
Body: { model, messages:[{role:system,content},{role:user,content}],
        max_tokens, temperature, stream: false }
```

- v1 非流式（`stream:false`），读 `choices[0].message.content`。
- 错误处理：超时（30s）、非 2xx（透传 body 错误信息）、空响应 → `{ok:false, diag}`；前端对 `ok:false` 降级为本地固定台词（保留 Web 版行为）。
- base_url 规范化：填 `https://api.deepseek.com` 拼 `/chat/completions`；已含 `/v1` 则保留；以 `/` 结尾去重。
- 复用 `reqwest` 连接池；key 只在此处读取，不落日志。

### 7.3 dsh.rs —— DSH 桥接（仅在线启用）

- `DSH_URL` 默认 `http://127.0.0.1:3080`，可配置。
- `dsh_check`：GET `/dsh-pet/api/check`，2s 超时 → `{online, event, ssh, busy}`（移植 index.js `doCheck`：最新 user/assistant 消息事件、最新 `ssh_*`（除 ssh_list）工具调用、busy=最近消息 <5min；60s 冷却）。
- `dsh_context`：采集主人最近 8 条对话 → `lines`（移植 `gatherContext`），供 say/chat 的「（主人最近的对话）」上下文。
- `dsh_proxy` 通用透传：仅允许 `/dsh-pet/api/` 前缀，拒绝任意 URL 代理（安全边界）。
- **缺口 G1（任务看板）**：Web 版 `detectTaskEvent()` 直接读 DSH 浏览器 localStorage `dsh.taskBoard.v1`，桌面端无法访问。需在 DSH 侧补一个只读端点（如 `/dsh-pet/api/taskboard`，返回「已结算且未读」的执行结果）或复用现有 `/check` 扩展字段。**在补端点前，任务看板感知降级为「不可用」，其余功能不受影响**。

### 7.4 fs.rs —— 吃文件/回收站

- 回收站目录：`{app_data_dir}/trash/` + `manifest.json`（映射 `新名 → 原路径`）。
- `eat_file`：真实路径直接 `rename` 进回收站；无路径时回退到 index.js `doEatFile` 的按名搜索（根目录：桌面/下载/文档，跳过 `node_modules/.git/dist/build/.idea`，上限 50000 个条目）。
- `restore_file` / `purge_file`：复用 index.js `doRestore/doPurge`，改用 `std::fs`，文件名防路径穿越校验（拒绝 `/`、`\`、`..`）。

### 7.5 memory.rs —— 长期记忆

- 文件：`~/.dsh-pet-desktop/records.json` → `memories` 字段（统一记录存储 `storage.rs`，最多 50 条）。
- 条目 schema：`{id, content(≤120), category(goal|deadline|preference|event), date(YYYY-MM-DD|''), createdAt, remindedAt}`。
- 移植 index.js：`runExtraction`（抽取 prompt + 去重 + 截断，注入宠物名）、`parseMemories`（剥 markdown、取首个 JSON 数组）、`pickMemory`（未提醒优先 + 今天日期靠前 + 新创建的靠前）、`markMemory`、`doDeleteMemory/doAddMemory/doImportMemory`。
- 抽取调用内部 `llm::complete`（temperature=0.3，max_tokens=512）。
- 存储读写通过 `tauri::State<RecordsStore>`（RwLock），并发命令互斥，落盘走 `write_atomic`（tmp+rename）。

### 7.6 records.rs —— 日记/聊天/导出导入

- 文件：`~/.dsh-pet-desktop/records.json` → `diary`（≤30 篇，同天覆盖）+ `chat`（≤20 条）。
- `diary_write` 同日期覆盖写入；`chat_set` 整体覆盖；`records_export/import` 打包/还原 `{memories, diary, chat}` 三块。

### 7.7 config.rs —— 配置

- 路径：`~/.dsh-pet-desktop/config.json`
- 内容：`{ base_url, api_key, model, dsh_url, auto_start, sound }`
- key 只存 Rust 侧文件（权限 0600），不进 localStorage、不进前端、不打印日志；`get_ai_config` 只返回 api_key 掩码（如 `sk-***abc`）与「是否已设置」布尔。

---

## 8. AI 接入设计

### 8.1 协议与默认值

| 项 | 设计 |
|---|---|
| 协议 | OpenAI chat/completions 兼容 |
| 默认 base_url | `https://api.deepseek.com`（可改） |
| 模型 | 首次启动引导填，默认 `deepseek-chat`（可改 flash/其他） |
| key | 设置面板填写，存 `~/.dsh-pet-desktop/config.json`（Rust 读，不进前端） |
| 首次启动流程 | 检测无 config → 弹「AI 设置」面板 → 填 base_url + key + model → 测试连接 → 保存 |

### 8.2 LLM 模式清单（33 个，prompt 从 index.js `doSay` 逐字移植）

| 模式 | 触发 | 一句话要点（ask 摘要） |
|---|---|---|
| roast | 戳身体 | 毒舌吐槽主人或他正在做的事 |
| drag | 拖拽 | 傲娇抱怨，别真生气 |
| pet | 抚摸/摸头/摸尾巴 | 口嫌体正直的享受 |
| explain | （预留） | 毒舌点评主人在做的事 |
| auto | 定时/空闲 | 随口吐槽 |
| assistant | DSH agent 回复 | 点评结果或催他去看 |
| user | 主人发消息 | 吐槽能折腾，暗示陪伴 |
| wake | 睡眠中被弄醒 | 起床气 + 一点开心 |
| lonely | 空闲>3min | 寂寞傲娇，想被注意 |
| focus-start | 开始专注 | 加油别摸鱼 |
| focus-done | 专注结束 | 夸奖 + 催休息 |
| sitting | 久坐>50min | 催起来活动/喝水 |
| task-done | 任务成功 | 傲娇夸奖或吐槽 |
| task-failed | 任务失败 | 吐槽催去看 |
| ssh | SSH 操作 | 「又去折腾服务器了？」 |
| feed | 投喂 | 装嫌弃其实开心 |
| double-click | 双击 | 傲娇又开心 |
| long-press | 长按 | 抱怨别真生气 |
| eat-file | 吃文件 | 嫌弃不好吃其实开心 |
| good-morning | 早晨(6-11) | 催起床/吃早餐 |
| good-afternoon | 下午(11-18) | 问今天过得如何 |
| good-evening | 晚上(18-23) | 问忙不忙/催休息 |
| good-night | 深夜(23-6) | 催去休息 |
| tired | 久忙>40min | 关心累不累 |
| achievement | 解锁成就 | 表面不屑其实骄傲 |
| water | 喝水提醒 | 催喝水 |
| birthday | 生日 | 傲娇生日祝福 |
| festival | 节日 | 应景傲娇祝福 |
| egg-poke | 连戳 10 下 | 炸毛吐槽 |
| egg-night | 凌晨 2-4 点 | 又惊又担心催睡觉 |
| egg-love | 聊天说喜欢 | 脸红嘴硬 |
| overtime | 深夜加班 | 催别熬太晚 |
| proactive | 空闲>6min | 主动搭话（可带旧记忆） |

### 8.3 温度与截断矩阵（从 index.js 精确提取）

| 调用 | temperature | max_tokens | 输出截断 |
|---|---|---|---|
| say（33 模式） | sass≥80→0.95，≥50→0.9，else→0.7 | 7680 | 160 字 |
| chat | 0.9 | 7680 | 160 字 |
| diary（心情日记） | 0.85 | 7680 | 400 字 |
| review（工作复盘） | 0.9 | 7680 | 220 字 |
| memory 抽取 | 0.3 | 512 | 每条 120 字，共 ≤50 条 |

> system prompt 结构（say）：`傲娇毒舌桌宠人设 + nameLine + affinityLine + sassLine + personalityLine + moodLine + 输出约束（一句中文 ≤200 字、颜文字 emoji、不要引号/解释/罗列）`。chat 额外含 `mentionedLine + memoryLine`（记忆回忆，触发词：上次/之前/以前/还记得/我说过…）。全部逐字移植，不重写措辞。

### 8.4 记忆回忆链路

- 聊天 3 次 → 触发一次 `memory_extract`（抽取最近聊天 → 去重入库）。
- proactive 模式 → `pickMemory` 取一条未提醒的旧记忆 → 作为「你以前记下的一件事」注入 ask → 命中后 `markMemory`。
- 聊天含回忆触发词 → 注入最多 5 条相关记忆到 system。

---

## 9. 数据与存储设计

**分层原则（桌面版优化）**：Web 版把「记忆(host 文件) + 日记(localStorage) + 聊天(localStorage)」拆得支离破碎，是插件架构的历史包袱。桌面版把它们收敛为 **Rust 侧统一记录存储 `~/.dsh-pet-desktop/records.json`（原子写入 tmp+rename）**，由 `tauri::State` 管理避免命令竞态；而高频交互状态（每次点击/拖拽都要读写）仍留在 WebView localStorage 保证渲染同步。

| 数据 | 存储位置 | 说明 |
|---|---|---|
| 宠物状态（scale/muted/hidden/affinity/sass/name/birthday/waterOn/personality） | localStorage `dsh.vpet.v1` | 高频交互，同步读写 |
| 成就计数 / 解锁 | localStorage `dsh.vpet.ach.c` / `dsh.vpet.ach.u` | 高频（每次互动） |
| 每日统计（chat/feed/pet/eat/poke/focusMin/taskDone/taskFailed/ssh） | localStorage `dsh.vpet.day` | 高频 |
| 喝水/节日/记忆沉淀/复盘标记 | localStorage `dsh.vpet.water` / `dsh.vpet.festive` / `dsh.vpet.memdigest` / `dsh.vpet.review` | 低频标记 |
| **长期记忆** | `~/.dsh-pet-desktop/records.json` → `memories` | Rust `storage.rs` + `commands/memory.rs`，最多 50 条 |
| **心情日记** | `~/.dsh-pet-desktop/records.json` → `diary` | Rust `commands/records.rs`，最多 30 篇（同一天覆盖） |
| **聊天记录** | `~/.dsh-pet-desktop/records.json` → `chat` | Rust `commands/records.rs`，最近 20 条 |
| AI 配置 | `~/.dsh-pet-desktop/config.json` | Rust 侧，含 key（掩码回显，不落前端） |
| 回收站 | `~/.dsh-pet-desktop/trash/` | 真实文件系统 + manifest.json |

**导出/导入**：导出 = 8 个 localStorage 键 + `records_export()`（memories+diary+chat）→ 单文件 `{exportedAt, local:{...}, records:{memories,diary,chat}}`；导入 = 回写 localStorage + `records_import()`。

**与 Web 版数据互迁**：localStorage 键名一致；记忆/日记/聊天从 `~/.dsh/dsh-pet/memory.json` + DSH 浏览器 localStorage 手工迁移到 `~/.dsh-pet-desktop/records.json`（schema 相同）。

---

## 10. 功能 1:1 映射表

| 原功能 | exe 版 | 依赖 |
|---|---|---|
| 51 段动画链/视线/昼夜/入睡唤醒 | ✅ 前端移植 | 本地 assets |
| 点击/双击/长按/抚摸/拖拽/投喂 | ✅ | — |
| 情绪（happy/angry/sleepy）+ 性格（3 档）+ 好感度/毒舌 | ✅ | — |
| 成就（9 个）+ 成就 toast | ✅ | — |
| 粒子特效 + 音效合成（默认关） | ✅ WebAudio | — |
| 聊天（LLM 对话 + 回忆） | ✅ llm_complete | OpenAI 兼容 |
| 长期记忆（抽取+回忆+记忆本+增删+导入导出） | ✅ memory.rs | OpenAI 兼容 |
| 心情日记（自动 + 手动） | ✅ | OpenAI 兼容 |
| 工作复盘（每日 ≥21 点） | ✅ | OpenAI 兼容 |
| 主动话题（proactive，可带旧记忆） | ✅ | OpenAI 兼容 |
| 喝水/久坐/加班/生日节日/彩蛋/昼夜问候 | ✅ | 本地时钟 |
| 番茄专注 | ✅ | 本地时钟 |
| 设置面板（4 分区）/状态/日记/记忆/聊天面板 | ✅ | — |
| 数据导出/导入 | ✅ | — |
| 吃文件 + 回收站 + 恢复 + 彻底删除 | ✅ Rust fs（真实路径） | 真实文件系统 |
| **工作记忆（记住 DSH 里做的事）** | ⚠️ 连回 DSH 才启用 | DSH 在线 |
| **SSH 吐槽** | ⚠️ 连回 DSH 才启用 | DSH 在线 |
| **任务看板感知** | ⚠️ 连回 DSH 才启用（缺口 G1） | DSH 在线 + 补端点 |

---

## 11. 打包与发布

- 开发：`pnpm tauri dev`（热更新；首次 Rust 编译较慢）。
- 打包：`pnpm tauri build` → NSIS 安装包 + 绿色版 exe。
- 图标：生成 `icons/icon.ico`（猫形象）。
- 体积预估：骨架 ~10MB + 51 段 webm（~35MB，参照原生原型内嵌体积）→ 安装包约 40~50MB；webm 可选「首装下载」或「内嵌」两档。

---

## 12. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0 去风险** | 验证 WebView2 渲染 VP9+alpha webm 透明性；验证透明置顶穿透窗口 | 动画透明无黑底；穿透/置顶可用 |
| M1 骨架 | Tauri 工程 + 透明置顶窗口 + React 挂载 + 托盘 | 窗口显示、穿透/托盘可用 |
| M2 桌宠本体 | 移植 51 动画链/交互/粒子/面板/状态/成就/情绪性格 | 宠物能点/摸/拖/喂，面板齐全 |
| M3 AI 接入 | llm_complete + 设置面板 + 33 模式 say/chat/diary/review | 聊天/日记/复盘能跑 |
| M4 记忆 | memory.rs 抽取/合并/增删/导入导出 + 回忆 + 主动话题 | 记忆闭环可用 |
| M5 本地能力 | 音效/喝水/久坐/加班/节日/番茄/导出导入 | 通用功能 1:1 |
| M6 吃文件 | Rust fs 吃文件/回收站/彻底删除（真实路径） | 拖文件吃+恢复+删除 |
| M7 DSH 联动 | dsh_check + dsh_context + 工作记忆/SSH（+任务看板 G1） | DSH 开着时特色功能生效 |
| M8 打包 | NSIS + 开机自启 + 图标 | 可安装 exe |

---

## 13. 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| R0 | **VP9+alpha webm 在 WebView2 `<video>` 透明渲染失败/黑底**（Chromium 对视频 alpha 支持不稳定） | M0 先行验证；失败则三选一：① 预转透明 WebP/APNG/PNG 序列；② 复用原生原型 libvpx 管线在 Rust 侧解码 → 传 RGBA 帧给前端；③ 宠物渲染走原生子窗口（混合架构），面板仍走 WebView |
| R1 | 透明窗口在不同 GPU/缩放下的渲染异常 | 提供「不透明模式」降级开关 |
| R2 | 鼠标穿透与拖放的冲突 | 宠物本体/面板 DOM 非穿透，空白区穿透；拖放仅在非穿透时启用 |
| R3 | OpenAI 接口流式/超时差异 | v1 非流式 + 30s 超时；异常时降级为本地固定台词 |
| R4 | API key 泄露 | key 只存 Rust 侧 config（0600），`get_ai_config` 只回掩码；不进 localStorage/日志/截图 |
| R5 | DSH 未启动导致特色功能不可用 | 托盘/状态面板显示「DSH 未连接」，通用功能不受影响 |
| R6 | Rust 编译环境差异 | 锁定 Cargo.toml 依赖版本；提供预编译安装包 |
| R7 | 记忆逻辑移 Rust 后与 Web 版行为差异 | 复用同一套 prompt 与数据结构 + 去重规则，保证语义一致 |
| R8 | 任务看板感知依赖 DSH 侧补端点（G1） | 未补前降级为「不可用」；与 DSH 插件协同补 `/dsh-pet/api/taskboard` |

---

## 14. 验收标准（DoD）

1. 双击 exe 启动，出现透明置顶桌宠（VP9+alpha 动画透明无黑底），托盘可显示/隐藏/退出。
2. 点/摸/拖/长按/双击/投喂/吃文件全部可用，动画链与粒子正常；情绪/性格/好感度/毒舌随交互正确变化。
3. 9 个成就按规则解锁并 toast；设置/状态/日记/记忆/聊天 8 类面板齐全可用。
4. 首次启动引导填 AI 配置，聊天/日记/复盘/记忆抽取/主动话题均由 LLM 驱动，33 个 say 模式文案符合「傲娇毒舌」人设。
5. 记忆能抽取、去重、回忆、增删、导入导出，落盘 `~/.dsh-pet-desktop/memory.json`。
6. 吃文件移入回收站、可恢复、可彻底删除；无路径穿越漏洞。
7. DSH 启动后，工作记忆/SSH 感知自动启用；DSH 关闭后自动降级（任务看板感知按 G1 状态）。
8. `tauri build` 产出可安装的 Windows exe，开机自启可用。

---

## 15. 附录：移植核对清单

| 源文件 | 移植目标 | 关键函数/常量 | 改动 |
|---|---|---|---|
| client.js `CAT` | pet.jsx | 51 动画名 + 动画链概率 | 无（路径改本地） |
| client.js `CSS` | pet.css | 全部 `dsh-vpet-*` 样式 + keyframes | 无 |
| client.js 状态/定时器/交互 | pet.jsx | §6.3/6.4/6.7 全部 | `timer.*`→`setInterval`，`fetchJson`→`invoke` |
| client.js 粒子/音效 | lib/audio.js | tone/beep/ensureEcho | 无 |
| index.js `doSay/doChat/doDiary/doReview` prompt | lib/ai.js | 33 模式 + 3 类模板 + 温度矩阵 | `llm.stream`→`invoke('llm_complete')` |
| index.js 记忆函数 | commands/memory.rs | runExtraction/parseMemories/pickMemory/markMemory/doDelete/doAdd/doImport | `readFile/writeFile`→`std::fs`；`llm.stream`→内部 llm_complete |
| index.js `gatherContext/findLatestMessage/findLatestSshCall/doCheck` | commands/dsh.rs | 上下文采集 + check | 改走 DSH HTTP 桥 |
| index.js `doEatFile/doTrash/doRestore/doPurge` | commands/fs.rs | 回收站 CRUD | 真实路径优先 |
