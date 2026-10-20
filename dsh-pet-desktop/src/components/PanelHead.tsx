// 面板标题栏：可拖动（由 usePanelDrag 提供 handlers），含关闭按钮。

import type { PointerEvent } from "react";

export interface PanelHeadProps {
  title: string;
  onClose: () => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: () => void;
}

export function PanelHead({ title, onClose, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: PanelHeadProps) {
  return (
    <div
      className="dsh-vpet-settings-head"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span className="dsh-vpet-settings-title">{title}</span>
      <button className="dsh-vpet-settings-close" type="button" onClick={onClose} aria-label={`关闭${title}`}>
        ✕
      </button>
    </div>
  );
}
