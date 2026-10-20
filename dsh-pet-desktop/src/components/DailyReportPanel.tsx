// 每日陪伴报告：历史切换、手动生成、分享卡导出。

import { usePanelDrag, type PanelAnchor } from "../hooks/usePanelDrag";
import type { DailyReport } from "../lib/types";
import { PanelHead } from "./PanelHead";

interface DailyReportPanelProps {
  reports: DailyReport[];
  selectedDate: string;
  busy: boolean;
  message: string;
  onSelect: (date: string) => void;
  onGenerate: () => Promise<void>;
  onExport: (report: DailyReport) => Promise<void>;
  onClose: () => void;
  anchor?: PanelAnchor;
}

export function DailyReportPanel(props: DailyReportPanelProps) {
  const drag = usePanelDrag(props.anchor);
  const selected = props.reports.find((r) => r.date === props.selectedDate) ?? props.reports[0] ?? null;
  return (
    <div ref={drag.ref} className="dsh-vpet-reportpanel">
      <PanelHead
        title="📊 每日陪伴报告"
        onClose={props.onClose}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
      />
      <div className="dsh-vpet-panel-body">
        <div className="dsh-vpet-report-toolbar">
          <select
            className="dsh-vpet-name-input"
            value={selected?.date ?? ""}
            onChange={(e) => props.onSelect(e.target.value)}
            disabled={props.reports.length === 0}
            aria-label="选择报告日期"
          >
            {props.reports.length === 0 && <option value="">还没有报告</option>}
            {props.reports.map((report) => (
              <option key={report.date} value={report.date}>
                {report.date} · 陪伴 {formatDuration(report.companionSecs)}
              </option>
            ))}
          </select>
          <button
            className="dsh-vpet-chat-btn"
            type="button"
            disabled={props.busy}
            onClick={() => void props.onGenerate()}
          >
            {props.busy ? "生成中…" : "生成今天"}
          </button>
        </div>
        {props.message && <div className="dsh-vpet-settings-hint">{props.message}</div>}
        {!selected ? (
          <div className="dsh-vpet-diarypanel-empty">
            <div>今天还没有报告</div>
            <div>晚上 21:00 会自动生成</div>
            <div>也可以现在手动生成一份</div>
          </div>
        ) : (
          <div className="dsh-vpet-reportcard">
            <div className="dsh-vpet-reportcard-top">
              <div>
                <div className="dsh-vpet-reportcard-title">今天也陪你过完了</div>
                <div className="dsh-vpet-reportcard-date">{selected.date}</div>
              </div>
              <button className="dsh-vpet-settings-btn" type="button" onClick={() => void props.onExport(selected)}>
                导出分享卡
              </button>
            </div>
            <div className="dsh-vpet-report-stats">
              <Stat label="陪伴" value={formatDuration(selected.companionSecs)} />
              <Stat label="聊天" value={`${numberStat(selected, "chat")} 次`} />
              <Stat label="专注" value={`${numberStat(selected, "focusMin")} 分`} />
              <Stat label="任务" value={`${numberStat(selected, "taskDone")} 完成`} />
            </div>
            <ReportSection icon="💬" title="今天聊了什么" text={selected.chatSummary} />
            <ReportSection icon="✅" title="完成了什么" text={selected.doneSummary} />
            <ReportSection icon="🌤" title="明天的小建议" text={selected.tomorrow} />
            <div className="dsh-vpet-report-mood">{selected.mood || "哼，今天也算勉强陪你一下吧。"}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <span className="dsh-vpet-report-stat">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </span>
  );
}

function ReportSection(props: { icon: string; title: string; text: string }) {
  return (
    <div className="dsh-vpet-report-section">
      <div className="dsh-vpet-report-section-title">{props.icon} {props.title}</div>
      <div className="dsh-vpet-report-section-text">{props.text || "（今天没有记录）"}</div>
    </div>
  );
}

function numberStat(report: DailyReport, key: string): number {
  const value = report.stats[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function formatDuration(secs: number): string {
  const total = Math.max(0, Math.round(secs / 60));
  if (total < 60) return `${total} 分钟`;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return mins ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
}
