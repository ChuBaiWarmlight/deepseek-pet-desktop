// 语音朗读：基于 WebView2 的 Web Speech API。
//
// 注意：WebView2 在首次用户手势之前可能返回 0 个 voice（实测点击宠物后才会出现
// 中文 Huihui/Kangkang/Yaoyao）。因此交互入口先调用 primeVoices()；即使暂时没有
// voice，speak() 仍会尝试用系统默认声音朗读。

export interface SpeakOptions {
  rate?: number;
  voiceName?: string;
  lang?: string;
}

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

/** 触发 WebView2 加载系统 voice 列表（需要一次用户手势之后调用）。 */
export function primeVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  try {
    return s.getVoices();
  } catch {
    return [];
  }
}

/** 中文 voice 排前面，其余保持系统顺序。 */
export function getVoices(): SpeechSynthesisVoice[] {
  const voices = primeVoices();
  return voices.slice().sort((a, b) => {
    const az = a.lang.toLowerCase().startsWith("zh") ? 0 : 1;
    const bz = b.lang.toLowerCase().startsWith("zh") ? 0 : 1;
    return az - bz || a.name.localeCompare(b.name);
  });
}

/** 去掉 emoji/Markdown/URL，避免语音把符号逐个念出来。 */
function cleanForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[*_`#>~]/g, "")
    .replace(/[\u{1f000}-\u{1faff}\u{2600}-\u{27bf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function isSpeechAvailable(): boolean {
  return synth() !== null && typeof SpeechSynthesisUtterance !== "undefined";
}

/** 立即朗读一段文字；新的朗读会打断旧的，避免多条气泡叠音。 */
export function speak(text: string, opts: SpeakOptions = {}): boolean {
  const s = synth();
  if (!s || typeof SpeechSynthesisUtterance === "undefined") return false;
  const clean = cleanForSpeech(text);
  if (!clean) return false;
  try {
    s.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = opts.lang || "zh-CN";
    utterance.rate = Math.max(0.6, Math.min(1.6, opts.rate ?? 1));
    utterance.pitch = 1;
    const voice = getVoices().find((v) => v.name === opts.voiceName);
    if (voice) utterance.voice = voice;
    s.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  try {
    synth()?.cancel();
  } catch {
    /* 忽略 */
  }
}
