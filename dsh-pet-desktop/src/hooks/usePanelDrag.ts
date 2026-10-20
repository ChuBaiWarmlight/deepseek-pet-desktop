// 面板窗口内拖拽：头部按住即可拖动整块面板，钳制在窗口内。
// 首次打开时自动贴在宠物左侧；左侧空间不足则放到右侧，避免固定死在左上角。

import { useLayoutEffect, useRef } from "react";
import type { PointerEvent } from "react";
import { clamp } from "../lib/utils";

export interface PanelAnchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragState {
  sx: number;
  sy: number;
  left: number;
  top: number;
}

const EDGE_MARGIN = 8;

export function usePanelDrag(anchor?: PanelAnchor) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || placed.current) return;
    placed.current = true;
    const panelW = el.offsetWidth;
    const panelH = el.offsetHeight;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const petX = anchor?.x ?? viewportW - panelW - 24;
    const petY = anchor?.y ?? 24;
    const petW = anchor?.w ?? 0;
    const petH = anchor?.h ?? 0;

    let left = petX - panelW - 16;
    if (left < EDGE_MARGIN) left = petX + petW + 16;
    left = clamp(left, EDGE_MARGIN, Math.max(EDGE_MARGIN, viewportW - panelW - EDGE_MARGIN));
    const top = clamp(
      petY + petH / 2 - panelH / 2,
      EDGE_MARGIN,
      Math.max(EDGE_MARGIN, viewportH - panelH - EDGE_MARGIN),
    );
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.right = "auto";
  }, [anchor?.h, anchor?.w, anchor?.x, anchor?.y]);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, select, option, a, [data-no-drag]")) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const parentRect = el.parentElement?.getBoundingClientRect();
    const left = r.left - (parentRect?.left ?? 0);
    const top = r.top - (parentRect?.top ?? 0);
    // 首次拖拽时从 right 定位切换到 left 定位（窗口 resize 后仍稳定）
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = "auto";
    drag.current = { sx: e.clientX, sy: e.clientY, left, top };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d) return;
    // 窗口已全屏覆盖虚拟桌面，面板可在整个窗口内自由拖拽（不再受宠物小窗口限制）
    const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - el.offsetWidth - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - el.offsetHeight - EDGE_MARGIN);
    el.style.left = `${clamp(Math.round(d.left + (e.clientX - d.sx)), EDGE_MARGIN, maxLeft)}px`;
    el.style.top = `${clamp(Math.round(d.top + (e.clientY - d.sy)), EDGE_MARGIN, maxTop)}px`;
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return { ref, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}
