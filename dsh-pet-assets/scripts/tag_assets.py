#!/usr/bin/env python3
"""给资源库里的现有动作批量追加语义标签（不覆盖已有标签）。

标签格式统一为 `key:value`，桌宠调度器识别：
  scene:work / scene:rest / scene:meal / scene:night
  time:morning / time:day / time:evening / time:night / time:weekend
  mood:happy / mood:calm / mood:sad / mood:bored / mood:angry / mood:shy / mood:tired / mood:curious
  cooldown:秒数

示例：
  python scripts/tag_assets.py --dry-run
  python scripts/tag_assets.py
  python scripts/tag_assets.py --name 吃
  python scripts/tag_assets.py --add scene:work --match 写代码
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

APP_DIR = Path.home() / ".dsh-pet-assets"
DEFAULT_CONFIG = APP_DIR / "config.json"
TAG_PATTERN = re.compile(r"^[a-z][a-z0-9_-]*:[a-z0-9_.-]+$")


# 现有素材的语义标签。只覆盖含义明确的动作，宁缺毋滥。
TAG_RULES: dict[str, list[str]] = {
    # 吃饭与时间
    "吃早餐": ["scene:meal", "time:morning"],
    "吃午餐": ["scene:meal", "time:day"],
    "吃晚餐": ["scene:meal", "time:evening"],
    "吃白饭": ["scene:meal"],
    "吃冰淇淋融化": ["scene:meal", "mood:happy"],
    "大口吃零食": ["scene:meal", "mood:happy"],
    "偷吃零食被抓住": ["scene:meal", "mood:shy"],
    "中秋赏月吃月饼": ["scene:meal", "time:evening", "mood:happy"],

    # 工作与专注
    "写代码": ["scene:work"],
    "深度思考碎碎念": ["scene:work", "mood:curious"],
    "偷看工作": ["scene:work", "mood:curious"],
    "轻快记录": ["scene:work"],

    # 夜晚与困倦
    "原地小憩沉眠": ["scene:night", "mood:tired"],
    "说梦话": ["scene:night", "mood:calm"],
    "哈欠连天": ["time:night", "mood:tired"],
    "打瞌睡被惊醒": ["mood:tired"],
    "赖床打滚": ["time:morning", "mood:tired"],
    "超大伸懒腰": ["mood:tired"],

    # 情绪
    "任务失败": ["mood:sad"],
    "玩游戏气急败坏": ["mood:angry"],
    "点击回应 - 傲娇生气（侧身展示）": ["mood:angry"],
    "被吓一跳（炸毛）": ["mood:angry"],
    "用鲸鱼尾巴拍打地面": ["mood:angry"],
    "点击回应 - 害羞惊讶": ["mood:shy"],
    "照镜子": ["mood:shy"],
    "无聊待机": ["mood:bored"],
    "东张西望": ["mood:curious"],
    "动物环绕": ["mood:curious"],

    # 开心与休闲
    "可爱宅舞": ["mood:happy"],
    "轻快摇摆舞": ["mood:happy"],
    "优雅女仆舞": ["mood:happy"],
    "点击回应 - 开心跃动": ["mood:happy"],
    "悠闲哼歌": ["mood:happy"],
    "吹气球": ["mood:happy"],
    "玩水枪": ["mood:happy"],
    "堆雪人": ["mood:happy"],
    "放风筝": ["time:day", "mood:happy"],
    "蓝鲸现世": ["mood:happy"],
    "鲸鱼吐泡泡特效": ["mood:happy"],
    "原地敲击桌面互动": ["mood:happy"],
    "原地蹲下玩玩具汽车": ["mood:happy"],
    "被挠痒": ["mood:happy"],
    "摇扇纳凉": ["time:day"],

    # 安静
    "待机呼吸休闲": ["mood:calm"],
    "小提琴演奏": ["mood:calm"],
    "女仆屈膝礼仪": ["mood:calm"],
    "原地专心玩魔方": ["mood:calm"],
    "被落叶淹没": ["mood:calm"],
}


def log(*args: object) -> None:
    print(*args, flush=True)


def read_config(explicit: str | None = None) -> dict:
    path = Path(explicit) if explicit else DEFAULT_CONFIG
    defaults = {"dbPath": str(APP_DIR / "dsh-pet-assets.db")}
    try:
        return {**defaults, **json.loads(path.read_text(encoding="utf-8"))}
    except FileNotFoundError:
        return defaults
    except Exception as exc:
        raise SystemExit(f"读取配置失败：{path} ({exc})")


def expand_path(value: str) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(str(value)))).resolve()


def normalize_tags(values: list[str]) -> list[str]:
    tags: list[str] = []
    for value in values:
        for part in re.split(r"[,;\s]+", value.strip()):
            if not part:
                continue
            tag = part.strip().lower()
            if not TAG_PATTERN.match(tag):
                raise SystemExit(f"标签格式不合法：{part}（应为 key:value，例如 scene:work）")
            if tag not in tags:
                tags.append(tag)
    return tags


def parse_existing(raw: str | None) -> list[str]:
    try:
        value = json.loads(raw or "[]")
        return [str(tag) for tag in value] if isinstance(value, list) else []
    except Exception:
        return []


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="给桌宠素材批量追加语义标签（幂等，不覆盖已有标签）")
    parser.add_argument("--db", help="SQLite 路径；默认读取 ~/.dsh-pet-assets/config.json")
    parser.add_argument("--config", help="配置文件路径")
    parser.add_argument("--name", help="只处理名称包含该文本的素材")
    parser.add_argument("--match", help="配合 --add 使用：名称包含该文本")
    parser.add_argument("--add", nargs="+", default=[], help="手动追加标签，如 --add scene:work mood:curious")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不写数据库")
    parser.add_argument("--json", action="store_true", help="输出机器可读结果")
    parser.add_argument("--list-untagged", action="store_true", help="只列出没有语义标签的素材")
    return parser


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = build_parser().parse_args()

    config = read_config(args.config)
    db_path = expand_path(args.db or config["dbPath"])
    if not db_path.exists():
        raise SystemExit(f"资源库不存在：{db_path}")

    manual_tags = normalize_tags(args.add)
    if manual_tags and not (args.match or args.name):
        raise SystemExit("使用 --add 时需要通过 --match 或 --name 指定目标素材")
    if args.list_untagged:
        manual_tags = []

    connection = sqlite3.connect(str(db_path), timeout=10)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        "SELECT id, name, category, tags FROM resources WHERE enabled=1 AND trashed=0 ORDER BY category, name"
    ).fetchall()

    changed: list[dict] = []
    untagged: list[str] = []
    now = int(time.time() * 1000)
    try:
        for row in rows:
            name = str(row["name"])
            existing = parse_existing(row["tags"])
            rule_tags = TAG_RULES.get(name.strip(), [])
            additions = list(rule_tags if not args.add else [])

            if args.add:
                needle = args.match or args.name
                if needle and needle in name:
                    additions = manual_tags
                else:
                    additions = []
            elif args.name and args.name not in name:
                additions = []

            merged = list(existing)
            for tag in additions:
                if tag not in merged:
                    merged.append(tag)
            if not any(tag.startswith(("scene:", "time:", "mood:")) for tag in merged):
                untagged.append(f"{row['category']} | {name}")
            if merged == existing:
                continue

            changed.append({"id": int(row["id"]), "name": name, "category": row["category"], "added": [t for t in merged if t not in existing]})
            if not args.dry_run and not args.list_untagged:
                connection.execute(
                    "UPDATE resources SET tags=?, updated_at=? WHERE id=?",
                    (json.dumps(merged, ensure_ascii=False), now, row["id"]),
                )
        if not args.dry_run and not args.list_untagged:
            connection.commit()
    finally:
        connection.close()

    if args.list_untagged:
        log(f"没有语义标签的素材：{len(untagged)} 条")
        for item in untagged:
            log(f"  {item}")
        return 0

    if args.json:
        log(json.dumps({"ok": True, "dryRun": args.dry_run, "changed": changed, "untagged": untagged}, ensure_ascii=False, indent=2))
        return 0

    action = "计划" if args.dry_run else "已更新"
    log(f"{action} {len(changed)} 条素材（库内共 {len(rows)} 条）")
    for item in changed:
        log(f"  {item['category']} | {item['name']}  +{', '.join(item['added'])}")
    if changed and not args.dry_run:
        log("桌宠重启后会从 manifest 读取新标签。")
    if untagged:
        log(f"\n仍未打标的素材 {len(untagged)} 条（可用 --list-untagged 查看）：")
        for item in untagged[:12]:
            log(f"  {item}")
        if len(untagged) > 12:
            log(f"  ... 其余 {len(untagged) - 12} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
