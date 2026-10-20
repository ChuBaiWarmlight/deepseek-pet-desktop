# dsh-pet-desktop

独立桌面宠物（Tauri 2 + React + Rust），与资源管理平台 [dsh-pet-assets](../dsh-pet-assets) 配合使用。

## 构建（重要）

**正确方式：用 Tauri CLI 构建，不要直接 `cargo build --release`。**

```bash
# 完整构建（先 pnpm build 前端，再编译 release；产物在 src-tauri/target/release/dsh-pet-desktop.exe）
pnpm tauri build --no-bundle   # 只出 exe
pnpm tauri build               # 出 NSIS 安装包

# 等价 npm 脚本
pnpm build:exe                 # = tauri build --no-bundle
pnpm build:installer           # = tauri build
```

## ⚠️ 坑：直接 `cargo build --release` 会让桌宠退回「开发模式」

`tauri` 的「开发 / 生产」模式由 `custom-protocol` 这个 Cargo feature 决定（内部逻辑是 `dev = !custom-protocol`）。该 feature **不在 `tauri` 的默认特性里**，只有 Tauri CLI（`tauri build`）会自动带上。

如果直接跑：

```bash
cd src-tauri && cargo build --release
```

会**缺失 `custom-protocol`**，程序被编译成 dev 模式，运行时去加载 `src-tauri/tauri.conf.json` 里的 `devUrl = http://localhost:1420`（vite 开发服务器），而不是内嵌的 `dist` 前端。1420 端口没有起 dev 服务器时，窗口就会显示「无法访问此页面」。

如果确实要绕开 CLI、只重编 Rust（前提：前端 `dist` 已经构建好），必须显式带上 feature：

```bash
cd src-tauri && cargo build --release --features tauri/custom-protocol
```

## 开发

```bash
pnpm dev           # 仅前端 vite（http://localhost:1420）
pnpm tauri dev     # 前端 + 桌宠开发模式（走 devUrl）
```

## 与 dsh-pet-assets 的关系

桌宠通过 `~/.dsh-pet-desktop/config.json` 里的 `assets_url`（默认 `http://127.0.0.1:8787`）连接资源管理平台，用于：

- 拉取 `/api/manifest` 动态构建动画池（「上传即学会新动作」）；
- 轮询 `/api/pet/poll` 接收管理平台下发的遥控命令。

桌宠内嵌了内置动画做兜底，平台不在线也能正常显示；要「传新动作 + 遥控」则需保证 dsh-pet-assets 在运行。

为减小 exe 体积，桌宠**只内嵌 5 段核心兜底动画**（待机 / 东张西望 / 拖拽 / 睡眠 / 唤醒，位于 `public/assets/videos/`），其余约 52 段动作**直接从平台 HTTP 流式播放**（`assets_resolve` 返回 `http://127.0.0.1:8787/assets/videos/{name}.webm`）。平台不在线时，这些非内置动作会回退到内置「待机」动画（见 `src/lib/assets.ts` 的 `BUILTIN_NAMES` / `FALLBACK_ANIM`）。被移出的视频备份在项目根目录 `_external-videos/`（平台已持有全部资源，确认后可删除该备份）。

> **依赖提醒**：这 52 段非内置动作依赖 dsh-pet-assets 在运行（默认 `http://127.0.0.1:8787`），平台一停它们就会退回内置兜底。平台需以独立进程常驻（如 `node server.mjs`），不要让它的生命周期挂在某个终端/任务上。

> **CSP 说明**：视频元素跨源加载平台媒体，`index.html` 的 CSP 里 `media-src` 必须放行 `http:`/`https:`（即 `media-src 'self' http: https: blob:`）。若把 `media-src` 收紧为仅 `'self'`，跨源视频会被拦截，`<video>` 报 `MEDIA_ERR_SRC_NOT_SUPPORTED`（code=4）且 `currentSrc` 为空。

## 行为与心情

桌宠的心情由真实事件驱动，并会影响动作选择和台词语气：

| 心情 | 触发 | 效果 |
| --- | --- | --- |
| 开心 | 摸头、投喂、任务完成 | 更容易抽到 `mood:happy` 动作，语气更软 |
| 害羞 | 摸尾巴 | 嘴硬躲闪，`mood:shy` 动作加权 |
| 好奇 | 聊天、DSH 正在工作 | `mood:curious` 动作加权，会探头探脑 |
| 生气 | 连续戳 4 次 | 30 秒内语气更冲，`mood:angry` 动作加权 |
| 低落 | DSH 任务失败 | 3 分钟内语气低落，`mood:sad` 动作加权 |
| 困倦 | 23:00–06:00 仍醒着 | `mood:tired` 动作加权，说话带困意 |
| 无聊 | 3–8 分钟没有互动 | `mood:bored` 动作加权，会主动找事做 |

高优先级心情不会被低优先级事件覆盖；摸头、投喂和任务完成可以强制把宠物哄好。心情会随主状态持久化，重启后未过期的定时心情继续生效。调度器会把这些标签与时间、场景、冷却一起评分，具体见 `src/lib/mood.ts` 和 `src/lib/behaviorScheduler.ts`。

## 工作搭子（Claude Code / Codex）

桌宠内置本机事件总线，默认监听 `127.0.0.1:17777`。右键菜单打开「🤝 工作搭子」可以看到运行状态、复制 Token、手动模拟事件和时间线。

接入 Claude Code：

```powershell
powershell -File scripts\install-agent-hooks.ps1 -Claude
```

接入 Codex：

```powershell
powershell -File scripts\install-agent-hooks.ps1 -Codex
```

接入后，终端里的 AI 工具会把「开始工作 / 工具调用 / 等待确认 / 测试结果 / 回合完成」等事件发给桌宠。审批事件会弹出「去看看」气泡，点击后尝试把终端或 Codex/ChatGPT 窗口切到前台。完整协议和手动接入方式见 `docs/AGENT-INTEGRATIONS.md`。

接入异常时先跑 `powershell -File scripts\doctor-agent-hooks.ps1` 自检：事件总线、`claude` 是否可用、nvm 当前版本、Claude / Codex hook 是否完整，都会给出结论。

工作能力包括：

- **专注态**：事件驱动，10 分钟没动静自动待机，连续 90 分钟提醒起身。
- **任务卡**：按会话汇总项目、工具分布和涉及文件（只存路径，不存内容）。
- **工作报告**：`work_report` 生成日报 / 周报，`work_report_export` 导出 Markdown。
- **MCP**：`http://127.0.0.1:17777/mcp?token=...`，任何支持 MCP 的工具都能上报和查询。
