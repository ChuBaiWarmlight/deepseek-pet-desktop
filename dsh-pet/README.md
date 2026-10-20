# dsh-pet — DSH 网页桌宠

浮在 DSH Web GUI 右下角的 AI 桌宠，傲娇毒舌，会用 LLM 实时吐槽/点评你在做什么。

## 目录结构

```
dsh-pet/
├── README.md
├── dynamic/            # 动态插件源码（cordis_define 的 host/client 函数体，用于秒重建）
│   ├── host.js         # 宿主半：视频路由 / petSay / petCheck / LLM 吐槽
│   └── client.js       # 浏览器半：动画 / 交互 / 气泡 / 菜单
└── package/            # 正式插件包（持久安装用）
```

## 能力总览（P0 + P1 + P3）

- **交互**：点击吐槽、拖拽抱怨、抚摸回应、右键菜单（静音/隐藏/复位/缩放）
- **AI 吐槽**：LLM 生成，好感度影响语气（傲娇↔变软），毒舌程度滑杆可调（温柔↔拉满）
- **状态**：睡眠/唤醒、忙碌感知、事件驱动（你发消息/agent 回复/SSH 操作/任务看板结算）
- **生产力**：番茄钟、久坐提醒
- **持久化**：位置/大小/静音/隐藏/好感度/毒舌程度存 localStorage（键 `dsh.vpet.v1`）
- **边界与过渡**：窗口缩放自动回拉位置，移动带平滑过渡

## 正式插件（`package/`，持久安装）

已通过 `dsh plugin --profile web add link:E:\deepseek-harness-student\dsh-pet\package` 安装：
- node_modules 为 Junction 指向本目录，改文件即生效（无需重装）
- `dsh.profile.bundles` 已登记 `dsh-pet`，下次 DSH 重启自动加载
- host：`lib/index.js`（视频路由 + `/dsh-pet/api/say|check` RPC + LLM 吐槽）
- client：`lib/client.js`（`window.__ModuleLoader__` 格式，React via `require("react")`）

## 待办

- [ ] P2：双向对话 / 长期记忆
- [ ] 双击/长按/投喂/摸部位、粒子特效/节日皮肤、成就/解锁、音效、设置面板

