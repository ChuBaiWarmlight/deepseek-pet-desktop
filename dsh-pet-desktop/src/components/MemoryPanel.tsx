// 记忆面板：手动添加 + 分类 + 列表删除。

import { useRef, useState } from "react";
import { usePanelDrag, type PanelAnchor } from "../hooks/usePanelDrag";
import { MEM_CATS, todayStr } from "../lib/constants";
import type { Memory } from "../lib/types";
import { PanelHead } from "./PanelHead";

interface MemoryPanelProps {
  list: Memory[];
  onAdd: (content: string, category: string, date: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
  anchor?: PanelAnchor;
}

export function MemoryPanel(props: MemoryPanelProps) {
  const drag = usePanelDrag(props.anchor);
  const [content, setContent] = useState("");
  const [cat, setCat] = useState("goal");
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div ref={drag.ref} className="dsh-vpet-mempanel">
      <PanelHead
        icon="🧠"
        title="记忆本"
        subtitle="她会记住你说过的事"
        onClose={props.onClose}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
      />
      <div className="dsh-vpet-mem-add">
        <input
          ref={inputRef}
          className="dsh-vpet-name-input"
          style={{ flex: 1 }}
          value={content}
          placeholder="记点什么…"
          onChange={(e) => setContent(e.target.value)}
        />
        <select className="dsh-vpet-mem-select" value={cat} onChange={(e) => setCat(e.target.value)}>
          {Object.entries(MEM_CATS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button
          className="dsh-vpet-chat-btn"
          onClick={async () => {
            if (!content.trim()) return;
            await props.onAdd(content.trim(), cat, todayStr());
            setContent("");
          }}
        >
          添加
        </button>
      </div>
      <div className="dsh-vpet-mem-list">
        {props.list.length === 0 && (
          <div className="dsh-vpet-mem-empty">
            <span className="dsh-vpet-empty-icon" aria-hidden="true">🧠</span>
            <div className="dsh-vpet-empty-title">还没有记忆</div>
            <div className="dsh-vpet-empty-desc">聊几句天她会自动记住你的事，也可以手动加一条。</div>
            <button className="dsh-vpet-settings-btn" type="button" onClick={() => inputRef.current?.focus()}>
              添加第一条
            </button>
          </div>
        )}
        {props.list.map((m) => (
          <div key={m.id} className="dsh-vpet-mem-item">
            <div className="dsh-vpet-mem-top">
              <span className="dsh-vpet-mem-cat">
                {MEM_CATS[m.category] || m.category} {m.date ? `· ${m.date}` : ""}
              </span>
              <button className="dsh-vpet-mem-del" onClick={() => void props.onDelete(m.id)}>✕</button>
            </div>
            <div className="dsh-vpet-mem-content">{m.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
