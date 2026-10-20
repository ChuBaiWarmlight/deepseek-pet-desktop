// WebAudio 音效合成：移植自 client.js 的 tone/beep/ensureEcho/getAudio。

let audioCtx: AudioContext | null = null;
let echoInput: DelayNode | null = null;

function getAudio(): AudioContext | null {
  const AC: typeof AudioContext | undefined =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    return null;
  }
  return audioCtx;
}

function ensureEcho(): DelayNode | null {
  const ctx = getAudio();
  if (!ctx || echoInput) return echoInput;
  try {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.3;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(ctx.destination);
    echoInput = delay;
  } catch {
    echoInput = null;
  }
  return echoInput;
}

function tone(
  freq: number,
  dur: number,
  delay: number,
  gain: number,
  type: OscillatorType,
  echo: boolean,
): void {
  const ctx = getAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + (delay || 0);
  const release = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain || 0.05, t0 + 0.04);
  g.gain.setValueAtTime(gain || 0.05, t0 + dur);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);

  const osc = ctx.createOscillator();
  osc.type = type || "triangle";
  osc.frequency.setValueAtTime(freq, t0);

  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(freq * 1.004, t0);
  const sg = ctx.createGain();
  sg.gain.value = 0.2;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(freq * 5, 8000);
  filter.Q.value = 0.4;

  osc.connect(g);
  sub.connect(sg);
  sg.connect(g);
  g.connect(filter);
  filter.connect(ctx.destination);

  if (echo) {
    const send = ctx.createGain();
    send.gain.value = 0.45;
    g.connect(send);
    const bus = ensureEcho();
    if (bus) send.connect(bus);
  }

  osc.start(t0);
  sub.start(t0);
  osc.stop(t0 + dur + release + 0.1);
  sub.stop(t0 + dur + release + 0.1);
}

export type BeepKind = "click" | "pet" | "feed" | "celebrate" | "longpress" | "eat" | "wake" | "drag";

/** 播放一种音效；`soundOn`（总开关，默认关）与 `muted`（静音）任一为真则不发。 */
export function beep(kind: BeepKind, opts: { soundOn: boolean; muted: boolean }): void {
  if (!opts.soundOn || opts.muted) return;
  try {
    switch (kind) {
      case "click":
        tone(659, 0.2, 0, 0.05, "triangle", false);
        tone(880, 0.18, 0.06, 0.04, "sine", false);
        break;
      case "pet":
        tone(392, 0.55, 0, 0.05, "sine", false);
        tone(494, 0.55, 0.1, 0.035, "sine", false);
        break;
      case "feed":
        tone(330, 0.22, 0, 0.05, "triangle", false);
        tone(392, 0.22, 0.14, 0.05, "triangle", false);
        tone(523, 0.32, 0.28, 0.05, "triangle", false);
        break;
      case "celebrate":
        tone(523, 0.26, 0, 0.05, "triangle", true);
        tone(659, 0.26, 0.14, 0.05, "triangle", true);
        tone(784, 0.4, 0.28, 0.05, "triangle", true);
        tone(1047, 0.5, 0.42, 0.04, "sine", true);
        break;
      case "longpress":
        tone(220, 0.55, 0, 0.05, "sine", false);
        tone(277, 0.5, 0.1, 0.03, "sine", false);
        break;
      case "eat":
        tone(587, 0.2, 0, 0.05, "triangle", false);
        tone(740, 0.2, 0.12, 0.05, "triangle", false);
        tone(880, 0.4, 0.24, 0.045, "sine", true);
        break;
      case "wake":
        tone(440, 0.45, 0, 0.05, "sine", false);
        tone(550, 0.45, 0.16, 0.045, "sine", false);
        tone(660, 0.5, 0.32, 0.04, "sine", false);
        break;
      case "drag":
        tone(392, 0.35, 0, 0.035, "triangle", false);
        break;
    }
  } catch {
    /* 忽略音频异常 */
  }
}
