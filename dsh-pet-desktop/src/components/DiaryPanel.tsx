// 日记面板：手动写 + 历史列表。

import { useRef, useState } from "react";
import { usePanelDrag, type PanelAnchor } from "../hooks/usePanelDrag";
import type { DiaryEntry } from "../lib/types";
import { PanelHead } from "./PanelHead";

interface DiaryPanelProps {
  list: DiaryEntry[];
  onWrite: (text: string) => Promise<void>;
  onClose: () => void;
  anchor?: PanelAnchor;
}

export function DiaryPanel(props: DiaryPanelProps) {
  const drag = usePanelDrag(props.anchor);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const submit = async () => {
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      await props.onWrite(value);
      setText("");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div ref={drag.ref} className="dsh-vpet-diarypanel">
      <PanelHead
        icon="📔"
        title="心情日记"
        subtitle="记录今天，也记录她"
        onClose={props.onClose}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
      />
      <div className="dsh-vpet-diarypanel-intro">
        <span>今天的记录</span>
        <span>{props.list.length} 篇</span>
      </div>
      <div className="dsh-vpet-diarypanel-toolbar">
        <textarea
          ref={textRef}
          className="dsh-vpet-name-input"
          style={{ flex: 1, minHeight: 84 }}
          value={text}
          placeholder="记下今天发生的事、此刻的心情或明天要做的事…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          className="dsh-vpet-chat-btn"
          type="button"
          disabled={!text.trim() || saving}
          onClick={() => void submit()}
        >
          {saving ? "保存中" : "记录"}
        </button>
      </div>
      <div className="dsh-vpet-diarypanel-list">
        {props.list.length === 0 && (
          <div className="dsh-vpet-diarypanel-empty">
            <span className="dsh-vpet-empty-icon" aria-hidden="true">📝</span>
            <div className="dsh-vpet-empty-title">今天还没有记录</div>
            <div className="dsh-vpet-empty-desc">聊几句天她会自动写一篇，也可以现在写一条。</div>
            <button className="dsh-vpet-settings-btn" type="button" onClick={() => textRef.current?.focus()}>
              写第一条
            </button>
          </div>
        )}
        {props.list.map((d) => (
          <div key={d.date} className="dsh-vpet-diarycard">
            <div className="dsh-vpet-diarycard-date">{d.date}</div>
            <div className="dsh-vpet-diarycard-text">{d.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
