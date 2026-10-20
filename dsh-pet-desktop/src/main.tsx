import ReactDOM from "react-dom/client";
import { PetApp } from "./PetApp";
import { bridge } from "./lib/bridge";
import "./pet.css";

// 把未捕获异常写入诊断日志：release 版没有 devtools，否则前端崩溃后只能看到空白窗口。
function logClientError(prefix: string, detail: unknown) {
  const text =
    detail instanceof Error ? detail.stack || detail.message : typeof detail === "string" ? detail : String(detail);
  void bridge.diagLog(`${prefix}: ${text}`).catch(() => {});
}

window.addEventListener("error", (e) => {
  logClientError("window error", `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  logClientError("unhandled rejection", e.reason);
});

// 窗口根节点锁滚：透明全屏窗口只作为画布，任何内容（宠物/气泡/菜单/面板）都不得
// 把 WebView 撑出页面级滚动条。额外做运行时兜底，避免个别缩放/字体环境绕过 CSS。
function lockRootScroll() {
  for (const el of [document.documentElement, document.body]) {
    el.style.overflow = "hidden";
    el.style.scrollbarWidth = "none";
  }
}

lockRootScroll();
let rootOverflowed = false;
setInterval(() => {
  lockRootScroll();
  const doc = document.documentElement;
  const overflowed = doc.scrollWidth > doc.clientWidth || doc.scrollHeight > doc.clientHeight;
  if (overflowed) {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
  }
  if (overflowed !== rootOverflowed) {
    rootOverflowed = overflowed;
    logClientError(
      "root overflow",
      overflowed
        ? `${doc.scrollWidth}x${doc.scrollHeight} > ${doc.clientWidth}x${doc.clientHeight}`
        : "cleared",
    );
  }
}, 1000);

// 注意：刻意不使用 StrictMode，避免其 dev 下对大量 setInterval 副作用重复挂载造成双计时器。
ReactDOM.createRoot(document.getElementById("root")!).render(<PetApp />);
