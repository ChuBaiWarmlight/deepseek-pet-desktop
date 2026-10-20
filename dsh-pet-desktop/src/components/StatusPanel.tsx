// 状态面板：好感/毒舌/情绪/性格 + 今日统计 + 成就进度。

import { usePanelDrag, type PanelAnchor } from "../hooks/usePanelDrag";
import { ACHIEVEMENTS, RELATION_STAGES, type RelationStage } from "../lib/constants";
import { moodMeta } from "../lib/mood";
import type { DayStats, DshCheck, SystemSnapshot } from "../lib/types";
import { PanelHead } from "./PanelHead";

interface StatusPanelProps {
  affinity: number;
  sass: number;
  mood: string;
  personality: number;
  relationStage: RelationStage;
  relationNext: RelationStage | null;
  assetsOnline: boolean;
  dayStats: DayStats;
  achCounters: Record<string, number>;
  achUnlocked: Record<string, number>;
  dsHealth: DshCheck | null;
  system: SystemSnapshot | null;
  onClose: () => void;
  anchor?: PanelAnchor;
}

export function StatusPanel(props: StatusPanelProps) {
  const drag = usePanelDrag(props.anchor);
  const mood = moodMeta(props.mood);
  return (
    <div ref={drag.ref} className="dsh-vpet-status">
      <PanelHead
        icon="📊"
        title="状态"
        subtitle="关系、习惯与今天"
        onClose={props.onClose}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
      />
      <div className="dsh-vpet-panel-body">
      <div className="dsh-vpet-status-row">
        <span className="dsh-vpet-status-k">好感度</span>
        <span className="dsh-vpet-status-track">
          <span className="dsh-vpet-status-fill" style={{ width: `${props.affinity}%`, background: "var(--pink)" }} />
        </span>
        <span className="dsh-vpet-status-v">{props.affinity}</span>
      </div>
      <div className="dsh-vpet-status-row">
        <span className="dsh-vpet-status-k">毒舌</span>
        <span className="dsh-vpet-status-track">
          <span className="dsh-vpet-status-fill" style={{ width: `${props.sass}%`, background: "var(--mint)" }} />
        </span>
        <span className="dsh-vpet-status-v">{props.sass}</span>
      </div>
      <div className="dsh-vpet-status-row">
        <span className="dsh-vpet-status-k">情绪</span>
        <span className="dsh-vpet-status-v">{mood.emoji} {mood.label}</span>
      </div>
      <div className="dsh-vpet-status-row">
        <span className="dsh-vpet-status-k">性格</span>
        <span className="dsh-vpet-status-v">
          {props.personality >= 70 ? "撒娇黏人" : props.personality >= 35 ? "标准傲娇" : "高冷傲娇"}
        </span>
      </div>
      <div className="dsh-vpet-status-sep" />
      <div className="dsh-vpet-relation-head">
        <span className="dsh-vpet-relation-emoji">{props.relationStage.emoji}</span>
        <span className="dsh-vpet-relation-name">{props.relationStage.name}</span>
        {props.relationStage.accessory && <span className="dsh-vpet-relation-accessory">{props.relationStage.accessory}</span>}
      </div>
      <div className="dsh-vpet-status-row">
        <span className="dsh-vpet-status-k">下一阶段</span>
        <span className="dsh-vpet-status-track">
          <span
            className="dsh-vpet-status-fill"
            style={{
              width: `${props.relationNext
                ? Math.max(0, Math.min(100, ((props.affinity - props.relationStage.min) / (props.relationNext.min - props.relationStage.min)) * 100))
                : 100}%`,
              background: "linear-gradient(90deg, var(--pink), var(--mint))",
            }}
          />
        </span>
        <span className="dsh-vpet-status-v">{props.relationNext ? `${props.affinity}/${props.relationNext.min}` : "MAX"}</span>
      </div>
      <div className="dsh-vpet-relation-hint">
        {props.relationNext
          ? `再亲近一点就能到「${props.relationNext.name}」`
          : "已经是最亲密的阶段了"}
      </div>
      <div className="dsh-vpet-relation-hint">已解锁动作：{props.relationStage.action}</div>
      <div className="dsh-vpet-relation-collection">
        {RELATION_STAGES.map((stage) => {
          const unlocked = props.affinity >= stage.min;
          return (
            <span
              key={stage.id}
              className={`dsh-vpet-relation-chip${unlocked ? " is-unlocked" : ""}`}
              title={unlocked ? `${stage.name}：${stage.action}` : `好感度 ${stage.min} 解锁`}
            >
              <span>{stage.emoji}</span>
              <span>{stage.name}</span>
              {stage.accessory && <span>{stage.accessory}</span>}
            </span>
          );
        })}
      </div>
      <div className="dsh-vpet-status-row">
        <span className="dsh-vpet-status-k">DSH</span>
        <span className="dsh-vpet-status-v">{props.dsHealth?.online ? "已连接" : "未连接"}</span>
      </div>
      <div className="dsh-vpet-status-row">
        <span className="dsh-vpet-status-k">资源平台</span>
        <span className="dsh-vpet-status-v">{props.assetsOnline ? "已连接" : "离线"}</span>
      </div>
      <div className="dsh-vpet-status-sep" />
      <div className="dsh-vpet-status-row">
        <span className="dsh-vpet-status-k">前台</span>
        <span className="dsh-vpet-status-v" title={props.system?.foreground?.title}>
          {props.system?.foreground?.name || "—"}
        </span>
      </div>
      <div className="dsh-vpet-status-row">
        <span className="dsh-vpet-status-k">空闲</span>
        <span className="dsh-vpet-status-v">{props.system ? fmtIdle(props.system.idleSecs) : "—"}</span>
      </div>
      <div className="dsh-vpet-status-row">
        <span className="dsh-vpet-status-k">电量</span>
        <span className="dsh-vpet-status-v">
          {props.system?.battery
            ? `${props.system.battery.percent}%${props.system.battery.onAc ? " ⚡" : ""}`
            : "—"}
        </span>
      </div>
      <div className="dsh-vpet-status-grid">
        <span>💬 {props.dayStats.chat}</span>
        <span>🍩 {props.dayStats.feed}</span>
        <span>🖐 {props.dayStats.pet}</span>
        <span>🗑 {props.dayStats.eat}</span>
        <span>💢 {props.dayStats.poke}</span>
        <span>🍅 {props.dayStats.focusMin}m</span>
      </div>
      <div className="dsh-vpet-status-sep" />
      <div className="dsh-vpet-ach-grid">
        {ACHIEVEMENTS.map((a) => (
          <div key={a.id} className={"dsh-vpet-ach-item " + (props.achUnlocked[a.id] ? "dsh-vpet-ach-on" : "dsh-vpet-ach-off")}>
            <span className="dsh-vpet-ach-icon">{a.icon}</span>
            <span className="dsh-vpet-ach-name">{a.name}</span>
            <span className="dsh-vpet-ach-prog">
              {a.key === "unlocked" ? `${Object.keys(props.achUnlocked).length}/${a.need}` : `${props.achCounters[a.key] || 0}/${a.need}`}
            </span>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

function fmtIdle(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}
