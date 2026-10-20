// 工作搭子面板：本机事件总线信息、手动模拟器、最近事件时间线。

import { useState } from "react";
import { usePanelDrag, type PanelAnchor } from "../hooks/usePanelDrag";
import { agentDetail, agentHeadline, agentIsFailure, agentKindLabel, agentProviderLabel } from "../lib/agent";
import type { AgentEvent, AgentEventInput, AgentHubInfo } from "../lib/types";
import { PanelHead } from "./PanelHead";

interface AgentPanelProps {
  events: AgentEvent[];
  hub: AgentHubInfo | null;
  onEmit: (event: AgentEventInput) => Promise<void>;
  onFocus: (query: string) => Promise<string>;
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

export function AgentPanel(props: AgentPanelProps) {
  const p = props;
  const drag = usePanelDrag(p.anchor);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

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

  const focus = async (ev: AgentEvent) => {
    try {
      const title = await p.onFocus(ev.windowTitle || agentProviderLabel(ev.provider));
      setMessage(`已切换到：${title}`);
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
                <button className="dsh-vpet-agent-link" type="button" onClick={() => void focus(ev)}>
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
