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

为减小 exe 体积，桌宠**只内嵌 5 段核心兜底动画**（待机 / 东张西望 / 拖拽 / 睡眠 / 唤醒，位于 `public/assets/videos/`），其余约 46 段动作**直接从平台 HTTP 流式播放**（`assets_resolve` 返回 `http://127.0.0.1:8787/assets/videos/{name}.webm`）。平台不在线时，这些非内置动作会回退到内置「待机」动画（见 `src/lib/assets.ts` 的 `BUILTIN_NAMES` / `FALLBACK_ANIM`）。被移出的视频备份在项目根目录 `_external-videos/`（平台已持有全部资源，确认后可删除该备份）。

> **依赖提醒**：这 46 段非内置动作依赖 dsh-pet-assets 在运行（默认 `http://127.0.0.1:8787`），平台一停它们就会退回内置兜底。平台需以独立进程常驻（如 `node server.mjs`），不要让它的生命周期挂在某个终端/任务上。

> **CSP 说明**：视频元素跨源加载平台媒体，`index.html` 的 CSP 里 `media-src` 必须放行 `http:`/`https:`（即 `media-src 'self' http: https: blob:`）。若把 `media-src` 收紧为仅 `'self'`，跨源视频会被拦截，`<video>` 报 `MEDIA_ERR_SRC_NOT_SUPPORTED`（code=4）且 `currentSrc` 为空。
