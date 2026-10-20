# dsh-pet-assets 详细设计文档

> 独立轻量本地资源服务：把桌宠的 51 段透明 webm 动画从 exe 内嵌中「外置」，
> 由本机常驻 HTTP 服务统一托管 + 一个**带管理员登录**的管理页面维护，桌宠（dsh-pet-desktop）通过接口按需拉取。
> 目标：exe 瘦身、资源热更新（加动画/换皮肤不发版）、多端共享一份资源池、资源可被有权限地管理。

---

## 0. 现状盘点与代码资产（本文档的事实依据）

| 资产 | 路径 | 角色 |
|---|---|---|
| **桌宠桌面端** | `E:\deepseek-harness-student\dsh-pet-desktop` | Tauri 2.x + React 18。资源消费方 |
| **桌宠 Web 版（插件）** | `E:\deepseek-harness-student\dsh-pet` | 已有 `/dsh-pet/video/{name}.webm` HTTP 路由，作接口/安全校验参照 |
| **动画素材** | `E:\esign_5.3\dsh-pet-standalone\assets\videos` | 51 段 640×360 VP9+alpha webm，**中文文件名**，共约 36.4MB |

**关键事实（已核对）**

- 桌宠前端引用方式（`PetApp.tsx:1316`）：`src={`/assets/videos/${encodeURIComponent(anim)}.webm`}`，`anim` 为中文名（`constants.ts` 的 `CAT`）。
- 素材副本分布：`public/assets/videos`（51 段，36.4MB）、`dist/assets/videos`、`src-tauri/target/.../tauri-codegen-assets` 各一份。
- 桌面端网络层：`http.rs` 已有全局 `reqwest::Client`（30s 总超时 / 2s 连接超时，连接池复用）。
- 桌面端配置：`config.rs` 的 `Config`，`Store` 为 `RwLock`，`write_atomic` 落盘。
- 桌面端命令注册集中在 `lib.rs` 的 `generate_handler!`，前端统一走 `bridge.ts` 的 `invoke`。
- 安全校验参照：Web 版 `host.js:19-52` 对文件名做「禁 `/`、`\`、`..`、非 `.webm`」校验。
- `tauri.conf.json` 当前 `security.csp = null`（加载 localhost 资源当前可用，须保留放行策略，见 §11）。
- 环境：Node `v22.12.0` ✅、Rust `1.94.1` ✅。**注意**：Node 22.12 的内置 `node:sqlite` 为 experimental 且需 `--experimental-sqlite` flag，故数据库驱动主推 `better-sqlite3`（见 §3.2）。

---

## 1. 项目概述

| 项 | 内容 |
|---|---|
| 名称 | `dsh-pet-assets`（资源管理平台 / 资源服务） |
| 目标 | 外置桌宠动画资源，本机常驻 HTTP 服务托管 + **带管理员登录**的 Web 管理页维护，桌宠经接口按需拉取 |
| 形态 | 独立轻量本地服务（常驻进程 + 开机自启可选）+ 内置管理页 + SQLite 持久化 |
| 默认端口 | `8787`（避开 DSH 3080 / Vite 1420），可配置 |
| 数据目录 | `~/.dsh-pet-assets/`（可配置），含 SQLite 库 + 资源文件 |
| 消费方 | `dsh-pet-desktop`（HTTP 匿名读 + 本地缓存 + 内置兜底） |
| 协议 | HTTP REST + 静态文件；管理写接口需 Session 认证 |

**原则**：服务只做「资源的存取、清单、托管 + 有权限的管理」这一件事；桌宠的「动画链 / 交互 / 状态」逻辑一行不动，只把「资源来源」从内嵌改为「接口解析」。

**访问边界（关键）**：

| 面 | 认证要求 |
|---|---|
| 桌宠读资源（`/assets/videos/*`、`/api/manifest`、`/api/health`） | **匿名**（资源是公开动画清单，无敏感信息） |
| 管理页数据与写操作（上传/删除/改元数据/重建/改密） | **必须登录**（Session） |

---

## 2. 技术选型

| 决策 | 选择 | 理由 |
|---|---|---|
| 服务运行时 | **Node.js（内置 `http`/`fs`/`crypto`）+ 单一原生依赖 `better-sqlite3`** | 轻量；静态文件 + Range/ETag + scrypt 哈希 + random token 全走内置模块；仅数据库需一个成熟驱动 |
| 数据库 | **SQLite**（见 §3） | 单机嵌入式、零部署、ACID、单文件 |
| 数据库驱动 | **`better-sqlite3`** | 成熟稳定、同步 API、无 experimental flag；预编译二进制免本地编译 |
| 密码哈希 | `node:crypto` **scrypt**（`scryptSync` + `timingSafeEqual`） | 零依赖、抗暴力破解、内置 |
| 会话 | **Session token + HttpOnly Cookie**（随机 token，DB 存 hash） | 可撤销、本地单机最简安全；优于 JWT（无状态难吊销） |
| 管理页面 | **Vue 3 + Element Plus + Vite**（构建产物 `dist/` 由服务托管） | 管理后台用成熟组件库（Dialog/Upload/Table/Message/Switch），开发快、交互成熟、易维护 |
| 桌宠客户端 | 复用现有 `reqwest` + `invoke` 桥（新增 `commands/assets.rs`） | 与 `commands/dsh.rs` 桥接同一模式 |
| 缓存 | 桌宠本地 `~/.dsh-pet-desktop/cache/assets/` | 命中即本地，不重复下载 |

> 备选（升级路径）：数据库驱动可切内置 `node:sqlite`（升级 Node ≥23.4 后零依赖）；服务整体可切 Rust + `axum` + `rusqlite` 编成单 exe（零运行时分发）。**接口契约不变，可互换。**

---

## 3. 数据库选型

### 3.1 为什么是 SQLite

| 选项 | 形态 | 是否适合 | 结论 |
|---|---|---|---|
| **SQLite** | 单文件嵌入式，零服务进程，ACID，WAL | 本地单机、低并发、需事务与关系 | ✅ **主选** |
| MySQL | 客户端-服务器，独立进程 | 需多用户并发/远程/集群，本场景过重 | ❌ |
| PostgreSQL | 客户端-服务器，功能最强 | 同上，且引入运维成本 | ❌ |
| JSON 文件（原 manifest.json） | 纯文本 | 无法支撑用户/会话/审计/并发写/外键 | ⚠️ 仅作「快照」保留 |
| Redis | 内存 KV | 可做会话缓存，但非必需，徒增依赖 | 可选，不默认 |

**结论**：SQLite 单文件（`~/.dsh-pet-assets/dsh-pet-assets.db`），开启 **WAL** 模式提升并发读写，是本「独立轻量本地服务」的最优解。

### 3.2 驱动选型

| 驱动 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **`better-sqlite3`** | 成熟、同步 API 简单、快、无 flag | 一个原生依赖（预编译二进制，免编译） | ✅ **主选** |
| `node:sqlite`（内置） | 零依赖 | Node 22.12 需 `--experimental-sqlite`，标记 experimental | 备选（升级 Node ≥23.4 可零依赖） |
| `sql.js` | 纯 WASM | 内存库、需手动持久化到文件 | ❌ 不推荐 |

---

## 4. 总体架构

```
┌─────────────────────────────── 浏览器 ────────────────────────────────────────┐
│  /login  登录页（表单 → POST /api/auth/login → 得 HttpOnly Cookie）          │
│  /       管理页（列表/预览/上传/删除/改元数据/统计/重建/改密）                │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   ▼  写接口带 Session Cookie；读接口匿名
┌────────────────────────── dsh-pet-assets 服务 (Node, 127.0.0.1:8787) ─────────┐
│  路由层  server.mjs                                                          │
│  ├─ 认证层  lib/auth.js       scrypt 校验 + session 签发/校验中间件          │
│  ├─ 资源层  lib/resources.js  CRUD + 磁盘对齐 + rebuild                      │
│  ├─ 清单层  lib/manifest.js   从 DB 生成 manifest + version                  │
│  ├─ 静态层  lib/static.js     静态文件 + Range/ETag + 路径白名单             │
│  └─ 审计层  lib/audit.js      写 audit_logs                                  │
│            │                                                                 │
│            ├─ lib/db.js  →  SQLite  (dsh-pet-assets.db, WAL)                │
│            │     users / sessions / resources / audit_logs / settings        │
│            └─ 磁盘  ~/.dsh-pet-assets/assets/videos/*.webm                   │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   ▼  匿名 GET manifest / assets（带 Range）
┌────────────────────────── dsh-pet-desktop (Tauri) ───────────────────────────┐
│  前端 lib/assets.ts → invoke('assets_resolve', {name})                       │
│  Rust commands/assets.rs: check / resolve / prefetch / clear_cache           │
│  兜底：内置最小动画集（服务不可达时用）                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

**「通过接口联通」的明确回答**：是。桌宠与资源服务间是标准 HTTP REST 联通（匿名读），与现有 `dsh.rs` 桥接同一套 `reqwest` + `invoke` 模式；管理员对资源的管理走同一服务上带认证的写接口。

---

## 5. 目录结构（目标态）

```
dsh-pet-assets/                       # 本工程（服务）
├── DESIGN.md
├── package.json                      # name=dsh-pet-assets, type=module, deps: better-sqlite3
├── server.mjs                        # 入口：http 服务 + 路由分发
├── lib/
│   ├── db.js                         # SQLite 连接 + 建表 + 迁移（schema v1）
│   ├── auth.js                       # scrypt 哈希 + session 签发/校验 + 认证中间件
│   ├── resources.js                  # 资源 CRUD + 磁盘对齐 + rebuild
│   ├── manifest.js                   # 从 DB 生成 manifest + version
│   ├── static.js                     # 静态文件 + Range/ETag + 路径白名单
│   ├── audit.js                      # 审计日志写入
│   └── util.js                       # JSON 响应 / body 解析 / 错误包装
├── public/
│   ├── login.html                    # 登录页
│   ├── index.html                    # 管理页
│   ├── app.js                        # fetch 调用 + 列表渲染 + 上传/删除/改密
│   └── style.css
└── scripts/
    ├── init-admin.ps1                # 首启生成随机管理员初始密码
    ├── install-service.ps1           # 注册开机自启（可选）
    └── seed-assets.ps1               # 从 E:\esign_5.3\...\videos 复制 51 段到资源目录

~/.dsh-pet-assets/                    # 运行时数据目录（服务生成）
├── config.json                       # { port, host, assetsDir, dbPath }
├── dsh-pet-assets.db                 # SQLite（WAL，含 -wal/-shm）
└── assets/videos/*.webm              # 51 段动画
```

**桌宠端新增/改动（在 `dsh-pet-desktop` 内）**

```
src/lib/assets.ts                     # 新增：resolveVideoUrl / 预取 / 清缓存
src-tauri/src/commands/assets.rs      # 新增：assets_check/resolve/prefetch/clear_cache
src-tauri/src/config.rs               # 改：Config 增 assets_url/assets_enabled
src-tauri/src/lib.rs                  # 改：注册 assets 命令
src/PetApp.tsx                        # 改：video src 改为 resolveVideoUrl 结果
public/assets/videos/                 # 改：从「全量 51 段」改为「最小兜底集」
```

---

## 6. 数据库设计（SQLite，schema v1）

### 6.1 建库

- 路径：`~/.dsh-pet-assets/dsh-pet-assets.db`
- 连接参数：`PRAGMA journal_mode=WAL;`、`PRAGMA foreign_keys=ON;`、`PRAGMA busy_timeout=3000;`
- 迁移：`db.js` 内 `schema_version` 表 + 顺序迁移函数（v1 建表），启动时自动执行，幂等。

### 6.2 表结构

**users（管理员账号）**

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | |
| username | TEXT | UNIQUE NOT NULL | 登录名（默认 `admin`） |
| password_hash | TEXT | NOT NULL | scrypt 存储格式 `scrypt$N$r$p$salt_hex$hash_hex` |
| role | TEXT | NOT NULL DEFAULT 'admin' | 预留 RBAC（v1 仅 `admin`） |
| disabled | INTEGER | NOT NULL DEFAULT 0 | 禁用开关 |
| must_change_password | INTEGER | NOT NULL DEFAULT 1 | 首登强制改密 |
| created_at | INTEGER | NOT NULL | 毫秒时间戳 |
| last_login_at | INTEGER | | 最近登录 |

**sessions（登录会话）**

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | = 原始 token 的 sha256（DB 不存明文 token） |
| user_id | INTEGER | NOT NULL REFERENCES users(id) | |
| created_at | INTEGER | NOT NULL | |
| expires_at | INTEGER | NOT NULL | 默认 12h，可滑动续期 |
| revoked_at | INTEGER | | 登出/改密后置位 |
| ip | TEXT | | 审计 |
| user_agent | TEXT | | 审计 |

**resources（资源元数据，权威来源）**

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | |
| name | TEXT | NOT NULL | 逻辑名（= 桌宠 `CAT` 的 anim，不含扩展名） |
| file | TEXT | UNIQUE NOT NULL | 磁盘文件名（含 `.webm`） |
| size | INTEGER | NOT NULL | 字节数 |
| sha256 | TEXT | NOT NULL | 一致性校验 |
| mime | TEXT | NOT NULL DEFAULT 'video/webm' | |
| category | TEXT | NOT NULL DEFAULT 'act' | 见 §6.3 枚举 |
| tags | TEXT | NOT NULL DEFAULT '[]' | JSON 数组 |
| enabled | INTEGER | NOT NULL DEFAULT 1 | 0 = 软删/下线（manifest 不含） |
| created_at | INTEGER | NOT NULL | |
| updated_at | INTEGER | NOT NULL | |

**audit_logs（操作审计）**

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | |
| user_id | INTEGER | REFERENCES users(id) | 可空（匿名动作） |
| action | TEXT | NOT NULL | login/logout/change_password/upload/delete/patch/rebuild |
| target | TEXT | | 资源名或对象标识 |
| detail | TEXT | | JSON（如 `{size, oldCategory, newCategory}`） |
| ip | TEXT | | |
| created_at | INTEGER | NOT NULL | |

**settings（服务级 KV，可选）**

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| key | TEXT | PK | 如 `manifest_version_seed` |
| value | TEXT | | |

### 6.3 category 枚举与索引

- `category` 与桌宠 `CAT` 槽位对齐：`idle | turn | move | click | drag | sleep | wake | focus | celebrate | stretch | act`。
- 索引：`resources(file)` UNIQUE、`resources(category)`、`resources(enabled)`、`sessions(user_id)`、`sessions(expires_at)`、`audit_logs(created_at)`。

---

## 7. 认证与权限设计

### 7.1 密码哈希（scrypt）

- `salt = randomBytes(16)`；`hash = scryptSync(password, salt, 64, {N:16384, r:8, p:1})`。
- 存储：`scrypt$16384$8$1$<salt_hex>$<hash_hex>`；校验用 `scryptSync` 重算 + `timingSafeEqual` 防时序侧信道。

### 7.2 会话（Session token）

- 登录成功 → `token = randomBytes(32).toString('hex')` → Cookie `dpa_session=<token>`（`HttpOnly; SameSite=Strict; Path=/`，本机 http 暂不 `Secure`，https 下加）。
- DB 只存 `sha256(token)` 为 `sessions.id`；校验时对 cookie token 取 hash 查表，比对 `expires_at` / `revoked_at`。
- 有效期 12h，活跃滑动续期；`logout` / `change_password` 撤销该用户全部会话。

### 7.3 首次初始化（管理员引导）

- 首启检测 `users` 表为空 → 生成随机初始密码（`crypto.randomBytes(12).toString('base64url')`），写到 `~/.dsh-pet-assets/initial-admin.txt`（权限 0600）+ 控制台打印一次，并 `must_change_password=1`。
- 首次登录后强制跳转改密页，改密后才放行管理功能。

### 7.4 权限模型

- **v1 单管理员**：一个 `admin` 账号，覆盖全部管理能力。
- **P1 可选**：多用户 + 角色（`admin` / `viewer`），`viewer` 只读管理页、不可写。schema 已预留 `role` 字段。

### 7.5 登录防护（可选，P1）

- 同用户名连续失败 5 次 → 锁定 15 分钟（`audit_logs` + 内存计数）。
- 登录接口限速（内存滑动窗口，如 10 次/分钟/IP）。

---

## 8. 资源服务 API 设计

### 8.1 配置 `~/.dsh-pet-assets/config.json`

```json
{ "host": "127.0.0.1", "port": 8787, "assetsDir": "~/.dsh-pet-assets/assets", "dbPath": "~/.dsh-pet-assets/dsh-pet-assets.db" }
```

- `host` 默认 `127.0.0.1`（不暴露局域网）；显式改 `0.0.0.0` 时启动日志告警。
- 首启自动生成；`PORT` 环境变量可覆盖（测试用）。

### 8.2 manifest 结构（由 DB 生成）

```json
{
  "version": "a1b2c3d4e5f67890",     // = 所有 enabled item 的 sha256 拼接后再 sha256 前 16 位
  "generatedAt": 1735689600000,
  "items": [
    {
      "name": "待机呼吸休闲",
      "file": "待机呼吸休闲.webm",
      "url": "/assets/videos/%E5%BE%85%E6%9C%BA....webm",
      "size": 723456,
      "sha256": "abc123...",
      "mime": "video/webm",
      "category": "idle",
      "tags": []
    }
  ]
}
```

- 仅含 `enabled=1` 的条目；`version` 内容变则变，供客户端增量判定。
- 生成：启动时 + `rebuild` 后，从 `resources` 表实时生成并做内存缓存；磁盘扫描用于检测「手动增删文件」的漂移并回写 DB。

### 8.3 REST API 契约

**匿名（桌宠）**

| 方法 | 路径 | 输出 | 说明 |
|---|---|---|---|
| GET | `/api/health` | `{ok, service, version, assetCount, totalBytes}` | 健康检查 |
| GET | `/api/manifest` | `Manifest` | 完整清单 |
| GET | `/api/manifest/version` | `{version, assetCount, totalBytes}` | 轻量版本探测 |
| GET\|HEAD | `/assets/videos/{name}.webm` | 二进制 | Range / ETag（§8.4） |

**认证（管理页，需 Session Cookie）**

| 方法 | 路径 | 输入 | 输出 | 说明 |
|---|---|---|---|---|
| POST | `/api/auth/login` | `{username, password}` | `{ok, mustChangePassword}` | 签发 session |
| POST | `/api/auth/logout` | — | `{ok}` | 撤销 session |
| GET | `/api/auth/me` | — | `{ok, username, role}` | 当前登录 |
| POST | `/api/auth/change-password` | `{oldPassword, newPassword}` | `{ok}` | 改密（撤销其它会话） |
| GET | `/api/resources` | — | `{ok, items[], stats}` | 列表（含 disabled、tags、审计字段） |
| POST | `/api/resources` | multipart `file`+`category` | `{ok, item}` | 上传 |
| DELETE | `/api/resources/{name}` | — | `{ok, removed}` | 删除（`enabled=0` 软删，磁盘进回收目录） |
| PATCH | `/api/resources/{name}` | `{category?, tags?, name?}` | `{ok, item}` | 改元数据 |
| POST | `/api/rebuild` | — | `{ok, version, count}` | 磁盘对齐 + 重建清单 |

- JSON 统一 `Content-Type: application/json; charset=utf-8`；错误 `{ok:false, error}` + 4xx/5xx。
- 认证失败统一 `401 {ok:false, error:"unauthorized"}`；权限不足 `403`。
- 写接口全部落 `audit_logs`。

### 8.4 静态文件服务 `/assets/videos/*`

- 支持 **Range**（`206 Partial Content` + `Accept-Ranges: bytes`），WebView2 `<video>` 边下边播依赖它。
- **ETag** = `sha256 前 12 位`，`If-None-Match` 命中回 `304`。
- **路径白名单**：`decodeURIComponent` 后拒绝 `/`、`\`、`..`、`%00`；仅 `.webm`；`resolve` 后仍在 `assetsDir/videos` 内。
- `Content-Type: video/webm`；`Cache-Control: no-cache`。

---

## 9. 管理页面设计（public/，纯静态）

| 页面 | 内容 |
|---|---|
| **登录页 `/login`** | 用户名 + 密码表单；首登提示改密；`mustChangePassword` 时跳改密视图 |
| **管理页 `/`**（登录后） | 见下表 |
| **改密视图** | 旧密码 + 新密码（含复杂度校验） |

管理页分区：

| 区块 | 内容 |
|---|---|
| 顶部统计栏 | 服务状态（health 轮询）、资源总数、总大小、分类分布 |
| 资源列表 | 卡片/表格：内嵌 `<video muted loop>` 预览、名称、分类、大小、sha256 前 8 位、tags、enabled 状态 |
| 操作 | 上传（拖拽+文件选择，multipart，选分类）、删除（二次确认）、改分类/tags、重命名、上线/下线 |
| 服务操作 | 重建清单、显示端口/资源目录、复制桌宠配置说明 |
| 账号操作 | 改密、退出登录 |

- 预览用 `<video preload="metadata" muted>` 只取首帧，列表不自动播放。
- 上传校验：仅 `.webm`、单文件 ≤5MB、文件名清洗（保留中文、去路径字符）、同名（同 file）校验。
- 所有写请求统一带 `X-Requested-With: XMLHttpRequest` header + `credentials: 'same-origin'`（配合 SameSite=Strict 防 CSRF）。

---

## 10. 桌宠客户端改造（dsh-pet-desktop）

### 10.1 配置扩展（config.rs）

`Config` 增加两字段（`ConfigView` / `ConfigUpdate` 同步）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `assets_url` | `http://127.0.0.1:8787` | 资源服务地址 |
| `assets_enabled` | `true` | 是否启用接口拉取；`false` 退回纯内置兜底 |

### 10.2 新增命令（commands/assets.rs）

| 命令 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `assets_check` | — | `{online, version, assetCount, diag}` | `GET /api/manifest/version`，2s 超时 |
| `assets_resolve` | `{name}` | `{ok, url, source, diag}` | 缓存命中→`cache`；未命中→下载→`downloaded`；失败→内置兜底→`embedded` |
| `assets_prefetch` | `{names}` | `{ok, fetched, failed}` | 后台预取（不阻塞） |
| `assets_clear_cache` | — | `{ok, freedBytes}` | 清缓存 |

- `assets_resolve` 返回的 `url` 是**本地** `asset://` 路径（`convertFileSrc`），非远端 URL——`<video>` 仍走本地文件，透明视频行为与内嵌一致，规避 WebView2 直连 localhost 视频的 R0 不确定性。

### 10.3 前端改造

- 新增 `src/lib/assets.ts`：`resolveVideoUrl(name)`、`prefetch(names)`、`checkAssets()`。
- `PetApp.tsx:1316`：`src={animUrl}`，`animUrl` 由 `resolveVideoUrl(anim)` 异步解析（`setAnimKey` 重挂载逻辑不变）。
- 预取：启动后/空闲预取 `idle/turn/moves×3/clicks×3/sleep/wake/celebrate/stretch`；`act` 池按需下载。

### 10.4 缓存与一致性

- 缓存目录：`~/.dsh-pet-desktop/cache/assets/videos/{name}.webm` + 同级 `.meta.json`（`{sha256, size, downloadedAt}`）。
- 命中：文件存在且 `.meta.json` sha256 == manifest 该项 sha256；否则重下。
- 下载原子性：`.tmp` + `rename`（复用 `write_atomic` 思路）。

### 10.5 内置兜底

| 档位 | 内容 | 大小 | 触发 |
|---|---|---|---|
| **最小集（默认）** | `idle/turn/sleep/wake/celebrate/stretch/focus/drag` + `clicks×3` + `moves×3` = 13 段 | ~9MB | 服务不可达 / 下载失败 / `assets_enabled=false` |
| 全量内嵌 | 51 段 | ~36MB | 「离线模式」显式开启 |

- `act` 池（40 段）兜底缺失时 `chainNext` fallback 到 `idle`，宠物不卡死。

---

## 11. 安全设计

| 面 | 措施 |
|---|---|
| 认证 | scrypt 密码哈希 + `timingSafeEqual`；Session token 仅 DB 存 hash；HttpOnly + SameSite=Strict |
| 会话 | 可撤销、12h 过期、改密/登出撤销全会话；首登强制改密 |
| CSRF | SameSite=Strict + 自定义 `X-Requested-With` 校验 |
| 路径穿越 | 静态与写接口统一白名单（decode → 拒 `/ \ .. %00` → 仅 `.webm` → resolve 后仍在资源子树） |
| 任意文件读取 | 仅 `assetsDir/videos` 子树；符号链接 resolve 后校验 |
| 上传 | 仅 `.webm`、≤5MB、文件名清洗；需登录 |
| 绑定范围 | 默认 `127.0.0.1`；`0.0.0.0` 显式开启并告警 |
| 桌宠端 | 仅允许 `127.0.0.1:8787`/`localhost`；下载后 sha256 校验；单文件 ≤6MB |
| CSP | `tauri.conf.json` 当前 `csp:null`；若后续加 CSP，`video-src` 放行 `asset:`/`tauri:`（资源走本地路径，不直连远端） |
| 审计 | 所有写操作 + 登录事件落 `audit_logs`（含 ip/时间/对象） |
| 密钥隔离 | 资源服务不接触任何 API key / DSH 凭据 |

---

## 12. 性能设计

| 目标 | 手段 |
|---|---|
| exe 瘦身 | 内嵌 51 段 → 13 段，安装包约 50MB → 20MB |
| 首屏不卡 | 只解析当前动画（懒加载）；启动仅一次 `assets_check` |
| 后续播放快 | 预取高频槽位 + 本地缓存（`asset://`） |
| 视频 seek | 静态服务 Range |
| 重复请求 | ETag `304` + sha256 缓存一致性 |
| 增量更新 | manifest `version` 变化才重拉，按 item 差异只下变更文件 |
| DB 并发 | SQLite WAL + `busy_timeout`；`better-sqlite3` 同步事务简单可靠 |
| 服务内存 | manifest 常驻（KB 级），文件流式读写不整体载入 |

> localhost 读取与本地文件基本持平，收益在「体积 + 更新 + 多端共享」，不在「运行时帧率」。

---

## 13. 打包与发布

- **服务**：`dsh-pet-assets` 源码 + `pnpm install` + `node server.mjs`；`install-service.ps1` 用 `schtasks`/启动项注册自启（可选）；P1 可选 Rust 单 exe。
- **桌宠**：`pnpm tauri build` 产出 NSIS；`public/assets/videos` 保留 13 段兜底。
- **首次启动流程**：服务首启建库 + 生成随机管理员密码 → 桌宠 `assets_check` → 在线按需拉取缓存；离线用兜底 + 状态面板提示。

---

## 14. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0 去风险** | 服务骨架 + SQLite 建库跑通；管理页登录；`GET /assets/videos/待机呼吸休闲.webm` 带 Range 播放；桌宠 `assets_resolve` 拉本地路径透明渲染无黑底 | 透明视频经接口正常；断服务回退兜底不白屏；登录/登出可用 |
| **M1 服务+库** | db.js 迁移 + auth.js + resources.js + manifest.js + static.js；全路由 + 认证中间件 + 审计 | API §8.3 全通；未登录写接口 401；路径穿越被拒 |
| **M2 桌宠改造** | config 扩展 + assets.rs + lib/assets.ts + PetApp src + 缓存一致性 + 预取 | 动画走接口；缓存命中不重复下载；离线兜底 |
| **M3 管理页** | 登录页/管理页/改密：列表/预览/上传/删除/改元数据/统计/重建/审计查看 | 管理页可完整维护资源且全程鉴权 |
| **M4 安全性能** | 上传校验、sha256、增量更新、登录限流、13 段兜底删减 | 改单资源仅该资源重下；exe 体积下降；连续失败锁定生效 |
| **M5 打包自启** | install-service 自启 + 桌宠 NSIS + （可选）Rust 单 exe / 多用户 | 开机资源服务可用；桌宠安装包可装 |

---

## 15. 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| R0 | WebView2 渲染经 `asset://` 本地缓存的 VP9+alpha webm 透明失败/黑底 | 与内嵌同源（本地文件）；M0 先验证，失败回退远端 URL 直连或原生 libvpx 管线 |
| R1 | 服务未启动导致动画缺失 | 13 段内置兜底 + 状态提示；`assets_resolve` 永不返回失败路径 |
| R2 | 中文文件名 URL 编解码不一致 | 统一 `encodeURIComponent`/`decodeURIComponent`，服务端与客户端一致测试用例 |
| R3 | 缓存与 manifest 不一致 | sha256 校验 + `.tmp` 原子写 + 版本比对 |
| R4 | 路径穿越 / 任意文件读取 | §11 白名单 + resolve 校验 + 仅 127.0.0.1 |
| R5 | `better-sqlite3` 原生模块编译/版本不匹配 | 锁定版本 + 预编译二进制；备选切 `node:sqlite`（升级 Node） |
| R6 | 初始管理员密码泄露（明文落盘） | 权限 0600 + 首登强制改密 + 改密后提示删除 `initial-admin.txt` |
| R7 | 会话劫持（本机其它进程读 Cookie） | HttpOnly + SameSite=Strict + 短有效期 + 可撤销 |
| R8 | act 池兜底缺失导致动画链断裂 | `chainNext` fallback 到 `idle` |
| R9 | 分发场景无 Node | 切 Rust 单 exe（接口不变） |

---

## 16. 验收标准（DoD）

1. `node server.mjs` 首启建库并生成随机管理员密码；`GET /api/manifest` 返回 51 条（含 sha256/size/category）。
2. `GET /assets/videos/{中文名}.webm` 支持 Range（`206`），浏览器边下边播；路径穿越请求 4xx。
3. 未登录访问管理页数据/写接口 → 401；登录后可列表/预览/上传/删除/改元数据/重建/改密；登出后失效。
4. 密码以 scrypt 哈希存储，DB 无明文；会话可撤销；写操作落审计日志。
5. 桌宠 `assets_resolve` 在线时下载到本地缓存并透明播放；二次命中不重复下载；离线回退内置兜底不白屏。
6. 修改单个资源后客户端仅重下该资源；exe 体积较现状下降且断服务时宠物完整可交互。

---

## 17. 附录

### 17.1 服务端路由汇总

```
GET  /                          → 管理页（登录校验由前端跳转）
GET  /login                     → 登录页
GET  /api/health                → 匿名
GET  /api/manifest              → 匿名
GET  /api/manifest/version      → 匿名
GET|HEAD /assets/videos/{name}  → 匿名（Range/ETag）
POST /api/auth/login            → 公开
POST /api/auth/logout           → 认证
GET  /api/auth/me               → 认证
POST /api/auth/change-password  → 认证
GET  /api/resources             → 认证
POST /api/resources             → 认证（multipart）
DELETE /api/resources/{name}    → 认证
PATCH /api/resources/{name}     → 认证
POST /api/rebuild               → 认证
```

### 17.2 桌宠新增 Rust DTO（commands/assets.rs）

| 类型 | 字段 |
|---|---|
| `AssetsCheck` | `online: bool, version: Option<String>, asset_count: u32, diag: String` |
| `AssetsResolve` | `ok: bool, url: String, source: String /* cache\|downloaded\|embedded */, diag: String` |
| `AssetsPrefetch` | `ok: bool, fetched: Vec<String>, failed: Vec<String>` |
| `AssetsClearCache` | `ok: bool, freed_bytes: u64` |

### 17.3 Config 增量

```rust
pub assets_url: String,        // 默认 "http://127.0.0.1:8787"
pub assets_enabled: bool,      // 默认 true
```

### 17.4 bridge.ts 增量

```ts
assetsCheck: () => invoke<AssetsCheck>("assets_check"),
assetsResolve: (name: string) => invoke<AssetsResolve>("assets_resolve", { name }),
assetsPrefetch: (names: string[]) => invoke<AssetsPrefetch>("assets_prefetch", { names }),
assetsClearCache: () => invoke<AssetsClearCache>("assets_clear_cache"),
```

### 17.5 依赖清单

| 包 | 用途 | 版本约束 |
|---|---|---|
| `better-sqlite3` | SQLite 驱动 | `^11`（锁小版本） |

其余（`http`/`fs`/`crypto`/`path`/`url`）均为 Node 内置模块，无额外依赖。
