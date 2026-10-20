// 按住说话：封装 WebView2 的 SpeechRecognition，识别结果回填聊天输入框。

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return recognitionCtor() !== null;
}

export interface SpeechHandlers {
  onStart?: () => void;
  onResult?: (text: string, final: boolean) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

export interface SpeechRecognizer {
  readonly supported: boolean;
  start: () => boolean;
  stop: () => void;
  cancel: () => void;
}

export function createSpeechRecognizer(handlers: SpeechHandlers): SpeechRecognizer {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    return {
      supported: false,
      start: () => {
        handlers.onError?.("当前系统不支持语音识别");
        return false;
      },
      stop: () => {},
      cancel: () => {},
    };
  }

  let rec: SpeechRecognitionLike | null = null;
  let active = false;
  let finalText = "";

  const build = () => {
    const r = new Ctor();
    r.lang = "zh-CN";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => {
      active = true;
      handlers.onStart?.();
    };
    r.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += text;
        else interim += text;
      }
      handlers.onResult?.((finalText + interim).trim(), finalText.length > 0);
    };
    r.onerror = (event) => {
      const code = event.error || "unknown";
      const message =
        code === "not-allowed" || code === "service-not-allowed"
          ? "麦克风权限被拒绝，请在系统设置中允许桌宠使用麦克风"
          : code === "no-speech"
            ? "没有听到声音，再试一次"
            : code === "network"
              ? "语音识别服务不可用"
              : `语音识别失败：${code}`;
      handlers.onError?.(message);
    };
    r.onend = () => {
      active = false;
      handlers.onEnd?.();
    };
    return r;
  };

  return {
    supported: true,
    start() {
      if (active) return true;
      finalText = "";
      try {
        rec = build();
        rec.start();
        return true;
      } catch (e) {
        handlers.onError?.(`无法开始录音：${String(e)}`);
        return false;
      }
    },
    stop() {
      try {
        rec?.stop();
      } catch {
        /* 忽略 */
      }
    },
    cancel() {
      try {
        rec?.abort();
      } catch {
        /* 忽略 */
      }
      active = false;
    },
  };
}

