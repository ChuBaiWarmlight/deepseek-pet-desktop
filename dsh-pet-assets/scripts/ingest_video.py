#!/usr/bin/env python3
"""一条命令把 AI 生成的动作视频入库为带 alpha 的桌宠素材。

流程：ffmpeg 抽帧 -> rembg 抠图 -> 补内部孔洞 -> VP9 alpha 编码
      -> alpha 校验 -> 生成预览 -> 直接写入资源库 SQLite。

示例：
  python scripts/ingest_video.py --src "C:\\Users\\me\\Downloads\\A-11.mp4" --name "任务失败" --category act
  python scripts/ingest_video.py --src "C:\\Users\\me\\Downloads\\batch" --category auto
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CATEGORIES = {
    "idle", "turn", "move", "click", "drag", "sleep",
    "wake", "focus", "celebrate", "stretch", "act",
}
# 仅对语义非常明确的分类给默认标签；其余交给 --tags 或 tag_assets.py。
CATEGORY_DEFAULT_TAGS = {
    "focus": ["scene:work"],
    "celebrate": ["mood:happy"],
    "wake": ["time:morning"],
}
TAG_RE = re.compile(r"^[a-z][a-z0-9_-]*:[a-z0-9_.-]+$")
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}
APP_DIR = Path.home() / ".dsh-pet-assets"
DEFAULT_CONFIG = APP_DIR / "config.json"


def log(*args: object) -> None:
    print(*args, file=sys.stderr, flush=True)


def read_config(explicit: str | None = None) -> dict:
    path = Path(explicit) if explicit else DEFAULT_CONFIG
    defaults = {
        "assetsDir": str(APP_DIR / "assets"),
        "dbPath": str(APP_DIR / "dsh-pet-assets.db"),
    }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {**defaults, **data}
    except FileNotFoundError:
        return defaults
    except Exception as exc:
        raise SystemExit(f"读取配置失败：{path} ({exc})")


def expand_path(value: str) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(str(value)))).resolve()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sanitize_name(value: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", str(value or ""))
    name = re.sub(r"\s+", " ", name).strip().rstrip(". ")
    return name[:80]


def parse_tags(value: str | None) -> list[str]:
    tags: list[str] = []
    for part in re.split(r"[,;\s]+", str(value or "").strip()):
        if not part:
            continue
        tag = part.strip().lower()
        if not TAG_RE.match(tag):
            raise SystemExit(f"标签格式不合法：{part}（应为 key:value，例如 scene:work）")
        if tag not in tags:
            tags.append(tag)
    return tags


def derive_name(path: Path) -> str:
    stem = path.stem
    match = re.match(r"^(?:[A-Za-z]+-\d+|\d+)[\s_.-]+(.+)$", stem)
    if match:
        stem = match.group(1)
    return sanitize_name(stem) or "未命名动作"


def infer_meta(path: Path, default_category: str | None, explicit_name: str | None, default_weight: int) -> dict:
    name = path.stem
    category = default_category
    prefixed = re.match(r"^([a-z]+)__(.+)$", name)
    if prefixed and prefixed.group(1) in CATEGORIES:
        category = prefixed.group(1)
        name = prefixed.group(2)
    elif category is None or category == "auto":
        category = next((part for part in reversed(path.parts[:-1]) if part in CATEGORIES), "act")
    weight = default_weight
    weighted = re.search(r"@w(\d{1,4})$", name)
    if weighted:
        weight = max(0, min(1000, int(weighted.group(1))))
        name = name[: weighted.start()]
    if explicit_name:
        name = explicit_name
    return {
        "name": sanitize_name(name) or "未命名动作",
        "category": category if category in CATEGORIES else "act",
        "weight": max(0, min(1000, int(weight))),
    }


def resolve_ffmpeg(explicit: str | None) -> str:
    candidates: list[str] = []
    if explicit:
        candidates.append(explicit)
    if os.environ.get("FFMPEG_PATH"):
        candidates.append(os.environ["FFMPEG_PATH"])
    found = shutil.which("ffmpeg")
    if found:
        candidates.append(found)
    try:
        import imageio_ffmpeg

        candidates.append(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        pass
    candidates.extend([
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\ffmpeg\bin\ffmpeg.exe",
    ])
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return str(Path(candidate))
    raise SystemExit(
        "找不到 ffmpeg。请安装 ffmpeg，或用 --ffmpeg 指定路径，或设置 FFMPEG_PATH。\n"
        '也可以执行：python -m pip install imageio-ffmpeg'
    )


def run(cmd: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess:
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip().splitlines()[-10:]
        raise RuntimeError("\n".join(detail) or f"命令失败（退出码 {result.returncode}）")
    return result


def probe_video(path: Path, ffmpeg: str) -> dict:
    # `ffmpeg -i` 在没有输出文件时会返回 1，但 stderr 里已有完整元数据。
    result = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    text = result.stderr or result.stdout
    duration_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    video_line = re.search(r"Video:\s*([^\n]+)", text)
    duration = 0.0
    if duration_match:
        duration = int(duration_match.group(1)) * 3600 + int(duration_match.group(2)) * 60 + float(duration_match.group(3))
    dims = re.search(r"(\d{2,5})x(\d{2,5})", video_line.group(1)) if video_line else None
    fps = re.search(r"(\d+(?:\.\d+)?)\s*fps", video_line.group(1)) if video_line else None
    return {
        "duration": duration,
        "width": int(dims.group(1)) if dims else 0,
        "height": int(dims.group(2)) if dims else 0,
        "fps": float(fps.group(1)) if fps else 0.0,
        "alpha": bool(re.search(r"alpha_mode\s*:\s*1", text, re.IGNORECASE)),
    }


def parse_size(value: str) -> tuple[int, int]:
    match = re.match(r"^(\d{2,5})x(\d{2,5})$", value)
    if not match:
        raise SystemExit(f"--size 需要 WIDTHxHEIGHT：{value}")
    return int(match.group(1)), int(match.group(2))


def extract_frames(src: Path, frames_dir: Path, ffmpeg: str, size: tuple[int, int], fps: int, duration: float, rgba: bool) -> list[Path]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    for old in frames_dir.glob("frame-*.png"):
        old.unlink()
    width, height = size
    vf = f"fps={fps},scale={width}:{height}:flags=lanczos"
    if rgba:
        vf += ",format=rgba"
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
    if duration and duration > 0:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-i", str(src), "-vf", vf, "-pix_fmt", "rgba" if rgba else "rgb24", str(frames_dir / "frame-%04d.png")]
    run(cmd)
    frames = sorted(frames_dir.glob("frame-*.png"))
    if not frames:
        raise RuntimeError("没有从视频里抽到任何帧")
    return frames


def fix_alpha(rgba, cv2, np):
    from PIL import Image

    arr = np.array(rgba.convert("RGBA"))
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]
    fg = (alpha > 40).astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    if count > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        largest = int(areas.max()) if len(areas) else 0
        keep = np.zeros_like(fg)
        for index in range(1, count):
            if int(stats[index, cv2.CC_STAT_AREA]) >= max(80, int(largest * 0.01)):
                keep[labels == index] = 255
        if keep.any():
            fg = keep
    inv = cv2.bitwise_not(fg)
    holes = inv.copy()
    flood_mask = np.zeros((fg.shape[0] + 2, fg.shape[1] + 2), np.uint8)
    height, width = holes.shape[:2]
    for seed in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        if holes[seed[1], seed[0]] > 0:
            cv2.floodFill(holes, flood_mask, seed, 0)
    alpha = np.where(holes > 0, 255, alpha).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def remove_background(frames: list[Path], model: str) -> None:
    try:
        import cv2
        import numpy as np
        from PIL import Image
        from rembg import new_session, remove
    except ImportError as exc:
        raise SystemExit(
            "缺少 Python 依赖，请执行：\n"
            '  python -m pip install "rembg[cpu]" opencv-python pillow imageio-ffmpeg\n'
            f"原始错误：{exc}"
        )
    session = new_session(model)
    total = len(frames)
    started = time.time()
    for index, frame_path in enumerate(frames, 1):
        image = Image.open(frame_path).convert("RGB")
        rgba = remove(image, session=session).convert("RGBA")
        rgba = fix_alpha(rgba, cv2, np)
        rgba.save(frame_path)
        if index % 24 == 0 or index == total:
            elapsed = time.time() - started
            log(f"  抠图 {index}/{total} 帧（{elapsed:.0f}s）")


def make_preview(frames: list[Path], output: Path, name: str, fps: int) -> None:
    from PIL import Image, ImageDraw, ImageFont

    picks = [0, len(frames) // 4, len(frames) // 2, (len(frames) * 3) // 4]
    picks = sorted({min(max(i, 0), len(frames) - 1) for i in picks})
    width, height, gap, label_h = 640, 360, 12, 26
    canvas = Image.new("RGB", (width * 2 + gap, (height + label_h) * 2 + gap), (32, 36, 43))
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 18)
    except Exception:
        font = ImageFont.load_default()
    for index, frame_index in enumerate(picks[:4]):
        frame = Image.open(frames[frame_index]).convert("RGBA")
        tile = Image.new("RGB", (width, height), (235, 235, 235))
        draw = ImageDraw.Draw(tile)
        for y in range(0, height, 28):
            for x in range(0, width, 28):
                if (x // 28 + y // 28) % 2 == 0:
                    draw.rectangle([x, y, x + 27, y + 27], fill=(190, 190, 190))
        tile = tile.convert("RGBA")
        tile.alpha_composite(frame)
        x = (index % 2) * (width + gap)
        y = (index // 2) * (height + label_h + gap)
        canvas.paste(tile.convert("RGB"), (x, y))
        ImageDraw.Draw(canvas).text(
            (x + 8, y + height + 4),
            f"{name}  {frame_index / max(fps, 1):.1f}s",
            fill=(240, 240, 240),
            font=font,
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)


def encode_webm(frames_dir: Path, output: Path, ffmpeg: str, fps: int, crf: int, max_mb: float) -> tuple[int, int]:
    pattern = str(frames_dir / "frame-%04d.png")
    max_bytes = int(max_mb * 1024 * 1024)
    last_error = ""
    for attempt, current_crf in enumerate([crf, min(55, crf + 6), min(60, crf + 12)], 1):
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-framerate", str(fps), "-start_number", "1", "-i", pattern,
            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0",
            "-crf", str(current_crf), "-row-mt", "1", "-deadline", "good",
            "-cpu-used", "2", "-auto-alt-ref", "0", "-an",
            "-metadata:s:v:0", "alpha_mode=1", str(output),
        ]
        try:
            run(cmd)
            size = output.stat().st_size
            if size <= max_bytes:
                return size, current_crf
            last_error = f"输出 {size / 1024 / 1024:.2f}MB 超过 --max-mb {max_mb}"
        except Exception as exc:
            last_error = str(exc)
            break
    raise RuntimeError(last_error or "VP9 alpha 编码失败")


def verify_alpha(output: Path, ffmpeg: str, work_dir: Path) -> tuple[int, int]:
    from PIL import Image

    check = work_dir / "alpha-check.png"
    run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-c:v", "libvpx-vp9", "-i", str(output),
        "-frames:v", "1", "-pix_fmt", "rgba", "-update", "1", str(check),
    ])
    image = Image.open(check).convert("RGBA")
    return image.getchannel("A").getextrema()


def open_db(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise SystemExit(f"资源库不存在：{path}\n请先启动一次资源平台：cd dsh-pet-assets && node server.mjs")
    connection = sqlite3.connect(str(path), timeout=30)
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def find_duplicate(connection: sqlite3.Connection, source_hash: str) -> tuple | None:
    tag = f'%"src:{source_hash}"%'
    return connection.execute(
        "SELECT name, file FROM resources WHERE enabled=1 AND trashed=0 AND tags LIKE ? LIMIT 1",
        (tag,),
    ).fetchone()


def unique_file_name(connection: sqlite3.Connection, videos_dir: Path, name: str) -> str:
    candidate = f"{name}.webm"
    index = 2
    while True:
        row = connection.execute("SELECT id FROM resources WHERE file=?", (candidate,)).fetchone()
        if not row and not (videos_dir / candidate).exists():
            return candidate
        candidate = f"{name}-{index}.webm"
        index += 1
        if index > 100:
            raise RuntimeError(f"同名素材过多：{name}")


def write_resource(connection: sqlite3.Connection, *, name: str, file_name: str, size: int, sha256: str, category: str, weight: int, source_hash: str, source: Path, force: bool, extra_tags: list[str] | None = None) -> tuple[str, int]:
    now = int(time.time() * 1000)
    row = connection.execute("SELECT id, tags FROM resources WHERE file=?", (file_name,)).fetchone()
    tags = []
    if row:
        try:
            tags = json.loads(row[1] or "[]")
        except Exception:
            tags = []
    source_tag = f"src:{source_hash}"
    if source_tag not in tags:
        tags.append(source_tag)
    for tag in extra_tags or []:
        if tag not in tags:
            tags.append(tag)
    tags_json = json.dumps(tags, ensure_ascii=False)

    with connection:
        if row:
            if not force:
                raise RuntimeError(f"资源已存在：{file_name}（加 --force 覆盖）")
            connection.execute(
                "UPDATE resources SET name=?, size=?, sha256=?, mime=?, category=?, tags=?, enabled=1, trashed=0, weight=?, updated_at=? WHERE id=?",
                (name, size, sha256, "video/webm", category, tags_json, weight, now, row[0]),
            )
            resource_id = int(row[0])
            action = "updated"
        else:
            cursor = connection.execute(
                "INSERT INTO resources (name, file, size, sha256, mime, category, tags, enabled, trashed, weight, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (name, file_name, size, sha256, "video/webm", category, tags_json, 1, 0, weight, now, now),
            )
            resource_id = int(cursor.lastrowid)
            action = "inserted"
        connection.execute(
            "INSERT INTO audit_logs (user_id, action, target, detail, ip, created_at) VALUES (NULL, 'ingest', ?, ?, NULL, ?)",
            (file_name, json.dumps({"source": str(source), "category": category, "weight": weight, "tags": tags}, ensure_ascii=False), now),
        )
    return action, resource_id


def process_one(args, source: Path, connection: sqlite3.Connection, ffmpeg: str, videos_dir: Path, previews_dir: Path, work_root: Path) -> dict:
    meta = infer_meta(source, args.category, args.name if len(args.src) == 1 else None, args.weight)
    name, category, weight = meta["name"], meta["category"], meta["weight"]
    tags = list(CATEGORY_DEFAULT_TAGS.get(category, []))
    for tag in parse_tags(args.tags):
        if tag not in tags:
            tags.append(tag)
    source_hash = sha256_file(source)
    tag_note = f", tags={','.join(tags)}" if tags else ""
    log(f"\n[{source.name}] -> {name}（{category}, w{weight}{tag_note}）")

    duplicate = find_duplicate(connection, source_hash)
    if duplicate and not args.force:
        log(f"  跳过：相同内容已入库为「{duplicate[0]}」")
        return {"source": str(source), "name": duplicate[0], "file": duplicate[1], "status": "duplicate"}

    file_name = f"{name}.webm"
    if connection.execute("SELECT id FROM resources WHERE file=?", (file_name,)).fetchone() and not args.force:
        file_name = unique_file_name(connection, videos_dir, name)
        name = file_name[:-5]
        log(f"  同名已存在，自动改名为「{name}」")

    probe = probe_video(source, ffmpeg)
    log(f"  源：{probe['width']}x{probe['height']} {probe['fps']:.2f}fps {probe['duration']:.2f}s")
    if args.dry_run:
        return {"source": str(source), "name": name, "file": file_name, "status": "dry-run", "probe": probe}

    work_dir = Path(tempfile.mkdtemp(prefix="ingest-", dir=str(work_root)))
    frames_dir = work_dir / "frames"
    output_tmp = work_dir / ("out.webm")
    try:
        frames = extract_frames(
            source, frames_dir, ffmpeg, parse_size(args.size), args.fps,
            args.duration, rgba=args.no_rembg,
        )
        log(f"  抽帧：{len(frames)} 帧")
        if not args.no_rembg:
            remove_background(frames, args.model)
        preview = previews_dir / f"{name}-preview.png"
        make_preview(frames, preview, name, args.fps)
        log(f"  预览：{preview}")
        size, used_crf = encode_webm(frames_dir, output_tmp, ffmpeg, args.fps, args.crf, args.max_mb)
        alpha = verify_alpha(output_tmp, ffmpeg, work_dir)
        if alpha[0] == 255 and not args.allow_opaque:
            raise RuntimeError("alpha 校验失败：整帧不透明（源视频没有透明背景，或抠图失败）")
        log(f"  编码：{size / 1024:.0f}KB，crf={used_crf}，alpha={alpha[0]}-{alpha[1]}")

        videos_dir.mkdir(parents=True, exist_ok=True)
        output = videos_dir / file_name
        backup = None
        if output.exists():
            backup = output.with_name(output.name + ".bak")
            if backup.exists():
                backup.unlink()
            os.replace(output, backup)
        dest_tmp = output.with_name(output.name + ".tmp")
        shutil.copyfile(output_tmp, dest_tmp)
        os.replace(dest_tmp, output)
        try:
            action, resource_id = write_resource(
                connection, name=name, file_name=file_name, size=size,
                sha256=sha256_file(output), category=category, weight=weight,
                source_hash=source_hash, source=source, force=args.force, extra_tags=tags,
            )
        except Exception:
            output.unlink(missing_ok=True)
            if backup and backup.exists():
                os.replace(backup, output)
            raise
        if backup and backup.exists():
            backup.unlink()
        log(f"  入库：{action} #{resource_id}")
        return {
            "source": str(source), "name": name, "file": file_name, "status": action,
            "id": resource_id, "size": size, "alpha": alpha, "preview": str(preview),
        }
    finally:
        if args.keep_frames:
            log(f"  保留工作目录：{work_dir}")
        else:
            shutil.rmtree(work_dir, ignore_errors=True)


def collect_sources(values: list[str]) -> list[Path]:
    sources: list[Path] = []
    for value in values:
        path = expand_path(value)
        if path.is_file() and path.suffix.lower() in VIDEO_EXTS:
            sources.append(path)
        elif path.is_dir():
            sources.extend(sorted(
                item for item in path.rglob("*")
                if item.is_file() and item.suffix.lower() in VIDEO_EXTS
            ))
        else:
            raise SystemExit(f"找不到视频：{path}")
    unique = list(dict.fromkeys(sources))
    if not unique:
        raise SystemExit("没有找到可处理的视频")
    return unique


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="AI 动作视频自动透明化并入库（rembg + VP9 alpha + SQLite）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例：\n"
            '  python scripts/ingest_video.py --src A-11.mp4 --name "任务失败" --category act\n'
            '  python scripts/ingest_video.py --src C:\\videos --category auto\n'
            '  python scripts/ingest_video.py --src A-11.mp4 --name "任务失败" --dry-run'
        ),
    )
    parser.add_argument("--src", nargs="+", required=True, help="视频文件或目录，可传多个")
    parser.add_argument("--name", help="单个文件时指定动作名")
    parser.add_argument("--category", help="分类；目录或 category__name 文件名可自动识别")
    parser.add_argument("--weight", type=int, default=100, help="抽中权重 0-1000（默认 100）")
    parser.add_argument("--tags", help="语义标签，逗号分隔，例如 scene:work,mood:curious,cooldown:180")
    parser.add_argument("--size", default="640x360", help="输出尺寸（默认 640x360）")
    parser.add_argument("--fps", type=int, default=24, help="输出帧率（默认 24）")
    parser.add_argument("--duration", type=float, default=0, help="最长截取秒数；0 表示保留完整视频")
    parser.add_argument("--crf", type=int, default=30, help="VP9 CRF（默认 30）")
    parser.add_argument("--max-mb", type=float, default=5.5, help="单文件上限 MB（默认 5.5）")
    parser.add_argument("--model", default="isnet-anime", help="rembg 模型（默认 isnet-anime）")
    parser.add_argument("--ffmpeg", help="ffmpeg 路径；默认自动查找或使用 imageio-ffmpeg")
    parser.add_argument("--assets-dir", help="资源目录；默认读取 ~/.dsh-pet-assets/config.json")
    parser.add_argument("--db", help="SQLite 路径；默认读取 config.json")
    parser.add_argument("--previews-dir", help="预览图目录（默认 <assetsDir>/previews）")
    parser.add_argument("--work-dir", help="临时工作目录（默认系统临时目录）")
    parser.add_argument("--no-rembg", action="store_true", help="源视频已经是真 alpha，跳过抠图")
    parser.add_argument("--allow-opaque", action="store_true", help="允许 alpha 全不透明（不推荐）")
    parser.add_argument("--force", action="store_true", help="同名覆盖；忽略内容查重")
    parser.add_argument("--keep-frames", action="store_true", help="保留逐帧 PNG 便于排查")
    parser.add_argument("--dry-run", action="store_true", help="只检查计划和查重，不处理")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出最终结果")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.category and args.category not in CATEGORIES and args.category != "auto":
        parser.error(f"--category 不合法：{args.category}")
    if args.fps <= 0 or args.fps > 60:
        parser.error("--fps 需要在 1-60 之间")
    if args.weight < 0 or args.weight > 1000:
        parser.error("--weight 需要在 0-1000 之间")

    config = read_config()
    assets_dir = expand_path(args.assets_dir or config["assetsDir"])
    db_path = expand_path(args.db or config["dbPath"])
    videos_dir = assets_dir / "videos"
    previews_dir = expand_path(args.previews_dir) if args.previews_dir else assets_dir / "previews"
    work_root = expand_path(args.work_dir) if args.work_dir else Path(tempfile.gettempdir())
    work_root.mkdir(parents=True, exist_ok=True)

    sources = collect_sources(args.src)
    if args.name and len(sources) != 1:
        parser.error("--name 只能用于单个文件；批量请用 category__名称.mp4 或目录分类")

    ffmpeg = resolve_ffmpeg(args.ffmpeg)
    connection = open_db(db_path)
    results: list[dict] = []
    failed = 0
    log(f"ffmpeg: {ffmpeg}")
    log(f"资源目录: {videos_dir}")
    log(f"待处理: {len(sources)} 个文件")
    try:
        for source in sources:
            try:
                results.append(process_one(args, source, connection, ffmpeg, videos_dir, previews_dir, work_root))
            except Exception as exc:
                failed += 1
                log(f"  失败：{exc}")
                results.append({"source": str(source), "status": "failed", "error": str(exc)})
    finally:
        connection.close()

    if args.json:
        print(json.dumps({"ok": failed == 0, "results": results}, ensure_ascii=False, indent=2))
    else:
        ok = sum(1 for item in results if item.get("status") not in {"failed", "duplicate", "dry-run"})
        log(f"\n完成：成功 {ok}，失败 {failed}。平台 manifest 会自动反映新素材；桌宠重启后加载。")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
