// 工作搭子面板：本机事件总线信息、手动模拟器、最近事件时间线。

import { useCallback, useEffect, useRef, useState } from "react";
import { usePanelDrag, type PanelAnchor } from "../hooks/usePanelDrag";
import {
  agentDetail,
  agentFocusRequest,
  agentHeadline,
  agentIsFailure,
  agentKindLabel,
  agentProviderLabel,
} from "../lib/agent";
import { bridge } from "../lib/bridge";
import type {
  AgentEvent,
  AgentEventInput,
  AgentFocusRequest,
  AgentFocusResult,
  AgentHubInfo,
  WorkFocusState,
  WorkReport,
  WorkTaskCard,
} from "../lib/types";
import { PanelHead } from "./PanelHead";

interface AgentPanelProps {
  events: AgentEvent[];
  hub: AgentHubInfo | null;
  onEmit: (event: AgentEventInput) => Promise<void>;
  onFocus: (req: AgentFocusRequest) => Promise<AgentFocusResult>;
  onClose: () => void;
  anchor?: PanelAnchor;
}

const SIMULATIONS: { label: string; icon: string; event: AgentEventInput }[] = [
  { label: "开始工作", icon: "▶️", event: { provider: "manual", kind: "session.start", status: "已开始" } },
  { label: "思考中", icon: "💭", event: { provider: "manual", kind: "assistant.thinking", status: "思考中" } },
  {
    label: "等待确认",
    icon: "🙋",
    event: {
      provider: "manual",
      kind: "approval.requested",
      status: "等待确认",
      summary: "模拟一次权限确认：Claude Code 想执行命令。",
      windowTitle: "Claude",
      attention: "interrupt",
    },
  },
  {
    label: "测试通过",
    icon: "✅",
    event: { provider: "manual", kind: "test.result", status: "测试通过", severity: "success" },
  },
  {
    label: "测试失败",
    icon: "❌",
    event: {
      provider: "manual",
      kind: "test.result",
      status: "测试失败",
      severity: "error",
      summary: "模拟一次测试失败：2 个用例未通过。",
      attention: "interrupt",
    },
  },
  { label: "任务完成", icon: "🎉", event: { provider: "manual", kind: "task.done", status: "任务完成" } },
  { label: "结束会话", icon: "⏹️", event: { provider: "manual", kind: "session.end", status: "已结束" } },
];

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function toolTotal(card: WorkTaskCard): number {
  return card.tools.reduce((sum, tool) => sum + tool.count, 0);
}

export function AgentPanel(props: AgentPanelProps) {
  const p = props;
  const drag = usePanelDrag(p.anchor);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [focusState, setFocusState] = useState<WorkFocusState | null>(null);
  const [cards, setCards] = useState<WorkTaskCard[]>([]);
  const [report, setReport] = useState<WorkReport | null>(null);
  const [reportPeriod, setReportPeriod] = useState<"day" | "week">("day");
  const [reportBusy, setReportBusy] = useState(false);
  const lastRefreshRef = useRef(0);

  const refreshWork = useCallback(async () => {
    const [nextFocus, nextCards] = await Promise.all([
      bridge.workFocusState().catch(() => null),
      bridge.workTaskCards().catch(() => [] as WorkTaskCard[]),
    ]);
    if (nextFocus) setFocusState(nextFocus);
    setCards(nextCards);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void refreshWork().catch(() => {
        if (alive) setMessage("读取工作数据失败");
      });
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refreshWork]);

  // 新事件到达时立即刷新，不必等 15 秒轮询。
  const latestEventId = p.events[0]?.id ?? "";
  useEffect(() => {
    const now = Date.now();
    // 工具调用可能很密集，任务卡需要读当天 JSONL；最多 5 秒刷新一次。
    if (now - lastRefreshRef.current < 5_000) return;
    lastRefreshRef.current = now;
    void refreshWork().catch(() => {});
  }, [latestEventId, refreshWork]);

  const generateReport = async () => {
    setReportBusy(true);
    try {
      const next = await bridge.workReport(reportPeriod);
      setReport(next);
      setMessage(reportPeriod === "day" ? "已生成今日日报" : "已生成近 7 天周报");
    } catch (error) {
      setMessage(`生成报告失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setReportBusy(false);
    }
  };

  const exportReport = async () => {
    try {
      const path = await bridge.workReportExport(reportPeriod);
      setMessage(`已导出：${path}`);
    } catch (error) {
      setMessage(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`已复制${label}`);
    } catch {
      setMessage(`复制${label}失败，请手动选择`);
    }
  };

  const emit = async (label: string, event: AgentEventInput) => {
    setBusy(label);
    try {
      await p.onEmit(event);
      setMessage(`已触发：${label}`);
    } catch (error) {
      setMessage(`触发失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy("");
    }
  };

  const focus = async (req: AgentFocusRequest) => {
    try {
      const result = await p.onFocus(req);
      const text = result.focused
        ? `${result.launched ? "已打开并切换到" : "已切换到"}：${result.title}`
        : result.launched
          ? `已发起启动：${result.title}`
          : `已找到窗口但未能切到前台：${result.title}`;
      setMessage(text);
    } catch (error) {
      setMessage(`切换窗口失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div ref={drag.ref} className="dsh-vpet-agentpanel">
      <PanelHead
        icon="🤝"
        title="工作搭子"
        subtitle="Claude Code / Codex 实时状态"
        onClose={p.onClose}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
      />
      <div className="dsh-vpet-panel-body">
        <div className={"dsh-vpet-agent-hub" + (p.hub?.running ? " is-online" : "")}>
          <div className="dsh-vpet-agent-hub-row">
            <span className="dsh-vpet-agent-dot" />
            <strong>{p.hub?.running ? "本机事件总线运行中" : "事件总线未启动"}</strong>
          </div>
          {p.hub && (
            <>
              <div className="dsh-vpet-agent-mono">{p.hub.endpoint}</div>
              <div className="dsh-vpet-agent-actions">
                <button className="dsh-vpet-settings-btn" type="button" onClick={() => void copy(p.hub!.endpoint, "地址")}>
                  复制地址
                </button>
                <button className="dsh-vpet-settings-btn" type="button" onClick={() => void copy(p.hub!.token, "Token")}>
                  复制 Token
                </button>
              </div>
            </>
          )}
        </div>

        <div className="dsh-vpet-agent-section-title">专注状态</div>
        <div className={"dsh-vpet-agent-hub" + (focusState?.working ? " is-online" : "")}>
          <div className="dsh-vpet-agent-hub-row">
            <span className="dsh-vpet-agent-dot" />
            <strong>
              {focusState?.working
                ? `工作中 · 连续 ${fmtDuration(focusState.continuousMinutes)}`
                : focusState && focusState.idleMinutes > 0
                  ? `休息中 · 已空闲 ${fmtDuration(focusState.idleMinutes)}`
                  : "还没有工作事件"}
            </strong>
          </div>
          {focusState && focusState.working && (
            <div className="dsh-vpet-agent-mono">
              {focusState.needsBreak
                ? "已经连续工作 90 分钟，起来活动一下。"
                : `这段连续工作从 ${fmtTime(focusState.sinceTs)} 开始`}
            </div>
          )}
          {focusState && focusState.pendingApprovals > 0 && (
            <div className="dsh-vpet-settings-hint">有 {focusState.pendingApprovals} 个任务在等你确认</div>
          )}
        </div>

        <div className="dsh-vpet-agent-section-title">今日任务卡（{cards.length}）</div>
        <div className="dsh-vpet-agent-events">
          {cards.length === 0 && (
            <div className="dsh-vpet-settings-hint">今天还没有任务卡。接入 Claude Code / Codex 后会自动按会话生成。</div>
          )}
          {cards.slice(0, 8).map((card) => (
            <div key={`${card.provider}-${card.sessionId}`} className="dsh-vpet-agent-event">
              <div className="dsh-vpet-agent-event-head">
                <span className="dsh-vpet-agent-event-provider">{agentProviderLabel(card.provider)}</span>
                <span className="dsh-vpet-agent-event-kind">{card.completed ? "已完成" : "进行中"}</span>
                <span className="dsh-vpet-agent-event-time">{fmtDuration(card.minutes)}</span>
              </div>
              <div className="dsh-vpet-agent-event-title">{card.project || "未命名项目"}</div>
              <div className="dsh-vpet-agent-event-detail">
                {fmtTime(card.startTs)} - {fmtTime(card.endTs)} · 工具 {toolTotal(card)} 次
                {card.failures > 0 ? ` · 失败 ${card.failures} 次` : ""}
                {card.approvals > 0 ? ` · 确认 ${card.approvals} 次` : ""}
              </div>
              {card.tools.length > 0 && (
                <div className="dsh-vpet-agent-event-detail">
                  工具：{card.tools.map((tool) => `${tool.name}×${tool.count}`).join("、")}
                </div>
              )}
              {card.files.length > 0 && (
                <div className="dsh-vpet-agent-event-detail">
                  文件：{card.files.slice(0, 3).join("、")}
                  {card.files.length > 3 ? ` 等 ${card.files.length} 个` : ""}
                </div>
              )}
              <button
                className="dsh-vpet-agent-link"
                type="button"
                onClick={() =>
                  void focus({
                    query: card.project || agentProviderLabel(card.provider),
                    provider: card.provider,
                    cwd: card.cwd,
                    project: card.project,
                    sessionId: card.sessionId,
                  })
                }
              >
                定位窗口
              </button>
            </div>
          ))}
        </div>

        <div className="dsh-vpet-agent-section-title">工作汇报</div>
        <div className="dsh-vpet-agent-actions">
          <select
            className="dsh-vpet-name-input"
            value={reportPeriod}
            onChange={(e) => setReportPeriod(e.target.value === "week" ? "week" : "day")}
            aria-label="选择报告周期"
          >
            <option value="day">今日日报</option>
            <option value="week">近 7 天周报</option>
          </select>
          <button className="dsh-vpet-settings-btn" type="button" disabled={reportBusy} onClick={() => void generateReport()}>
            {reportBusy ? "生成中…" : "生成"}
          </button>
          <button className="dsh-vpet-settings-btn" type="button" disabled={reportBusy} onClick={() => void exportReport()}>
            导出 Markdown
          </button>
        </div>
        {report && (
          <div className="dsh-vpet-agent-event">
            <div className="dsh-vpet-agent-event-title">{report.title}</div>
            <div className="dsh-vpet-agent-event-detail" style={{ whiteSpace: "pre-wrap" }}>
              {report.markdown.length > 1500 ? `${report.markdown.slice(0, 1500)}\n…` : report.markdown}
            </div>
          </div>
        )}

        <div className="dsh-vpet-agent-section-title">手动模拟</div>
        <div className="dsh-vpet-agent-sims">
          {SIMULATIONS.map((sim) => (
            <button
              key={sim.label}
              type="button"
              className="dsh-vpet-settings-btn"
              disabled={busy !== ""}
              onClick={() => void emit(sim.label, sim.event)}
            >
              {sim.icon} {sim.label}
            </button>
          ))}
        </div>
        {message && <div className="dsh-vpet-settings-hint">{message}</div>}

        <div className="dsh-vpet-agent-section-title">最近事件</div>
        <div className="dsh-vpet-agent-events">
          {p.events.length === 0 && <div className="dsh-vpet-settings-hint">还没有事件。接入 Claude Code / Codex 后，这里会实时出现工作状态。</div>}
          {p.events.slice(0, 20).map((ev) => (
            <div key={ev.id} className={"dsh-vpet-agent-event" + (agentIsFailure(ev) ? " is-error" : "")}>
              <div className="dsh-vpet-agent-event-head">
                <span className="dsh-vpet-agent-event-provider">{agentProviderLabel(ev.provider)}</span>
                <span className="dsh-vpet-agent-event-kind">{agentKindLabel(ev.kind)}</span>
                <span className="dsh-vpet-agent-event-time">{fmtTime(ev.ts)}</span>
              </div>
              <div className="dsh-vpet-agent-event-title">{agentHeadline(ev)}</div>
              <div className="dsh-vpet-agent-event-detail">{agentDetail(ev)}</div>
              {(ev.kind === "approval.requested" || ev.windowTitle) && (
                <button className="dsh-vpet-agent-link" type="button" onClick={() => void focus(agentFocusRequest(ev))}>
                  定位窗口
                </button>
              )}
            </div>
          ))}
        </div>

        <details className="dsh-vpet-agent-help">
          <summary>如何接入 Claude Code / Codex</summary>
          <div>
            在桌宠目录运行 <code>powershell -File scripts\install-agent-hooks.ps1 -Claude</code> 可接入 Claude Code；
            Codex 使用 <code>scripts\codex-hook.cmd</code> 配置 notify。详细说明见
            <code>docs/AGENT-INTEGRATIONS.md</code>。
          </div>
        </details>
      </div>
    </div>
  );
}
