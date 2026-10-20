# dsh-pet-assets

桌宠资源管理平台（Node + SQLite + Vue）。

## 自动入库动作视频

`scripts/ingest_video.py` 把 AI 生成的动作视频一条命令处理成桌宠素材：

```text
MP4/MOV/WebM
  → ffmpeg 抽帧（640×360 / 24fps）
  → rembg isnet-anime 抠图
  → 补回角色内部孔洞
  → VP9 alpha WebM
  → alpha 校验 + 2×2 预览图
  → 直接写入资源库 SQLite
```

### 安装依赖

```powershell
python -m pip install "rembg[cpu]" opencv-python pillow imageio-ffmpeg
```

`imageio-ffmpeg` 会自带一份 ffmpeg；如果本机已有 ffmpeg，也可以用 `--ffmpeg` 指定。

### 单条入库

```powershell
cd E:\deepseek-harness-student\dsh-pet-assets

python scripts/ingest_video.py `
  --src "C:\Users\初白\Downloads\A-11.mp4" `
  --name "任务失败" `
  --category act `
  --tags mood:sad
```

也可以用 pnpm 入口：

```powershell
pnpm ingest -- --src "C:\Users\初白\Downloads\A-11.mp4" --name "任务失败" --category act
```

### 批量入库

目录会递归扫描。分类可以从子目录或文件名推断：

```text
videos\act\任务失败.mp4
videos\idle\无聊待机.mp4
videos\idle__偷看工作.mp4
```

```powershell
python scripts/ingest_video.py --src "D:\doubao-output" --category auto
```

文件名支持权重后缀 `@w120`，例如 `act__任务失败@w120.mp4`。

### 常用参数

| 参数 | 说明 |
| --- | --- |
| `--name` | 单个文件时指定动作名 |
| `--category` | `idle/turn/move/click/drag/sleep/wake/focus/celebrate/stretch/act` |
| `--weight` | 抽中权重 0–1000，默认 100 |
| `--tags` | 语义标签，逗号分隔，例如 `scene:work,mood:curious,cooldown:180` |
| `--size` | 输出尺寸，默认 `640x360` |
| `--fps` | 输出帧率，默认 24 |
| `--duration` | 最长截取秒数，默认 0（保留完整视频） |
| `--crf` | VP9 质量，默认 30；超过 5.5MB 会自动提高 CRF 重试 |
| `--dry-run` | 只做探测与查重，不处理 |
| `--force` | 同名覆盖，并忽略内容查重 |
| `--no-rembg` | 源视频已经是真 alpha，跳过抠图 |
| `--keep-frames` | 保留逐帧 PNG，便于排查 |
| `--json` | 输出机器可读结果 |

### 查重与冲突

- 源文件 sha256 会写入资源 `tags` 的 `src:<hash>`；重复导入会直接跳过。
- 同名但内容不同时会自动追加 `-2`、`-3`；`--force` 则覆盖同名资源。
- 输出 WebM 会用 libvpx 解码首帧检查 alpha；整帧不透明会报错，除非加 `--allow-opaque`。

### 语义标签与调度

打标后，桌宠会按「时间 / 场景 / 心情 / 冷却」给动作加权，而不是纯随机播放。标签统一为 `key:value`：

| 键 | 可用值 | 作用 |
| --- | --- | --- |
| `scene` | `work` `rest` `meal` `night` | 工作/休息/饭点/深夜场景加权 |
| `time` | `morning` `day` `evening` `night` `weekday` `weekend` | 时段加权 |
| `mood` | `happy` `calm` `sad` `bored` `angry` `shy` `tired` `curious` | 当前心情加权 |
| `cooldown` | 秒数（15–3600） | 该动作播完后多久内降低再次抽中概率 |

没有语义标签的素材仍按原权重参与播放，不会因为过滤而消失。`src:<sha256>` 是入库查重标记，调度器会忽略。

给现有素材批量补标签（幂等、只追加、不覆盖）：

```powershell
pnpm tag -- --dry-run       # 先看计划
pnpm tag                    # 正式写入
pnpm tag -- --list-untagged # 查看还没打标的素材
pnpm tag -- --name 吃       # 只处理名称包含「吃」的素材
```

手动给某条素材追加标签：

```powershell
python scripts/tag_assets.py --match "写代码" --add scene:work mood:curious
```

### 生效方式

资源平台每次请求 `/api/manifest` 都会从 SQLite 重新生成清单，所以入库后无需手动刷新。桌宠在启动时拉取 manifest，重启桌宠即可加载新素材。

## 相关脚本

- `scripts/ingest_video.py`：推荐的自动入库流程（rembg 抠图）。
- `scripts/import-videos.mjs`：绿幕抠像 + 平台上传的旧流程，适合纯绿背景素材。
