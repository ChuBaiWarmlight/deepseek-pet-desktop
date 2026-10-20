// 聊天面板：历史气泡 + 输入框 + 发送。

import { useEffect, useRef, useState } from "react";
import { usePanelDrag, type PanelAnchor } from "../hooks/usePanelDrag";
import { createSpeechRecognizer, speechSupported } from "../lib/speech";
import type { ChatTurn } from "../lib/types";

interface ChatPanelProps {
  history: ChatTurn[];
  input: string;
  setInput: (s: string) => void;
  loading: boolean;
  onSend: () => void;
  onClose: () => void;
  anchor?: PanelAnchor;
}

export function ChatPanel(props: ChatPanelProps) {
  const drag = usePanelDrag(props.anchor);
  const logRef = useRef<HTMLDivElement | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState("");
  const recognizerRef = useRef(
    createSpeechRecognizer({
      onStart: () => {
        setRecording(true);
        setVoiceMsg("正在听…松开结束");
      },
      onResult: (text) => {
        if (text) props.setInput(text);
      },
      onEnd: () => setRecording(false),
      onError: (message) => {
        setRecording(false);
        setVoiceMsg(message);
      },
    }),
  );
  useEffect(() => () => recognizerRef.current.cancel(), []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [props.history]);
  return (
    <div ref={drag.ref} className="dsh-vpet-chat">
      <div
        className="dsh-vpet-chat-head"
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
      >
        <span>💬 聊天</span>
        <button className="dsh-vpet-chat-close" type="button" onClick={props.onClose} aria-label="关闭聊天">✕</button>
      </div>
      <div className="dsh-vpet-chat-log" ref={logRef}>
        {props.history.map((h, i) => {
          const streaming = i === props.history.length - 1 && props.loading && h.role === "assistant";
          const thinking = streaming && h.text.trim().length === 0;
          return (
            <div key={i} className={"dsh-vpet-chat-msg " + (h.role === "assistant" ? "dsh-vpet-chat-a" : "dsh-vpet-chat-u")}>
              {thinking ? <span className="dsh-vpet-chat-thinking">正在思考</span> : h.text}
              {streaming && <span className="dsh-vpet-chat-cursor">▍</span>}
            </div>
          );
        })}
        {props.history.length === 0 && <div className="dsh-vpet-chat-a dsh-vpet-chat-msg">哼，想聊什么？</div>}
      </div>
      <div className="dsh-vpet-chat-row">
        <button
          className={"dsh-vpet-chat-mic" + (recording ? " is-recording" : "")}
          type="button"
          title={speechSupported() ? "按住说话，松开结束" : "当前系统不支持语音识别"}
          disabled={!speechSupported()}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setVoiceMsg("");
            recognizerRef.current.start();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            recognizerRef.current.stop();
          }}
          onPointerCancel={() => recognizerRef.current.stop()}
          aria-label="按住说话"
        >
          {recording ? "●" : "🎙"}
        </button>
        <input
          className="dsh-vpet-chat-input"
          value={props.input}
          placeholder="说点什么…"
          onChange={(e) => props.setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (e.nativeEvent.isComposing) return; // 中文输入法选词回车不发送
            props.onSend();
          }}
        />
        <button className="dsh-vpet-chat-btn" disabled={props.loading} onClick={props.onSend}>
          {props.loading ? "…" : "发送"}
        </button>
      </div>
      {voiceMsg && <div className="dsh-vpet-chat-voicehint">{voiceMsg}</div>}
    </div>
  );
}
