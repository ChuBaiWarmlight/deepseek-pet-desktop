// 工作搭子事件的可读文案与轻量判定。

import type { AgentEvent } from "./types";

const PROVIDER_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  chatgpt: "ChatGPT",
  cursor: "Cursor",
  dsh: "DSH",
  manual: "手动测试",
  generic: "AI 工具",
};

export function agentProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] || provider || "AI 工具";
}

const KIND_LABELS: Record<string, string> = {
  "session.start": "开始工作",
  "session.end": "结束会话",
  "prompt.submitted": "收到新任务",
  "assistant.thinking": "思考中",
  "assistant.message": "正在回复",
  "tool.start": "调用工具",
  "tool.end": "工具完成",
  "approval.requested": "等待确认",
  "approval.resolved": "已确认",
  "test.result": "测试结果",
  "build.result": "构建结果",
  "task.done": "任务完成",
  "task.failed": "任务失败",
  "turn.completed": "回合完成",
  notification: "提醒",
};

export function agentKindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind;
}

export function agentIsFailure(ev: AgentEvent): boolean {
  return ev.severity === "error" || ev.kind === "task.failed" || ev.kind === "error";
}

export function agentHeadline(ev: AgentEvent): string {
  const provider = agentProviderLabel(ev.provider);
  const status = ev.status || agentKindLabel(ev.kind);
  return `${provider} · ${status}`;
}

export function agentDetail(ev: AgentEvent): string {
  return (ev.summary || ev.title || ev.status || agentKindLabel(ev.kind)).slice(0, 120);
}

export function agentFocusQuery(ev: AgentEvent): string {
  return (ev.windowTitle || agentProviderLabel(ev.provider)).trim();
}
