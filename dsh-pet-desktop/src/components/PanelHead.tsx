// 面板标题栏：图标 + 标题/副标题 + 关闭按钮，整条可拖动。

import type { PointerEvent } from "react";

export interface PanelHeadProps {
  title: string;
  icon?: string;
  subtitle?: string;
  onClose: () => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: () => void;
}

export function PanelHead({
  title,
  icon,
  subtitle,
  onClose,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: PanelHeadProps) {
  return (
    <div
      className="dsh-vpet-panel-head"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {icon ? (
        <span className="dsh-vpet-panel-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="dsh-vpet-panel-titles">
        <h2 className="dsh-vpet-panel-title">{title}</h2>
        {subtitle ? <p className="dsh-vpet-panel-subtitle">{subtitle}</p> : null}
      </div>
      <button className="dsh-vpet-panel-close" type="button" onClick={onClose} aria-label={`关闭${title}`}>
        ✕
      </button>
    </div>
  );
}
