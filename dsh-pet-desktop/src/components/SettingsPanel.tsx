// 设置面板：基础 / AI 配置 / 语音朗读 / 性格与提醒 / 数据 / 设备配对 折叠分区。

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { usePanelDrag, type PanelAnchor } from "../hooks/usePanelDrag";
import { bridge } from "../lib/bridge";
import type { SceneMode } from "../lib/behaviorScheduler";
import { THEMES, type ThemeId } from "../lib/constants";
import { generateSyncCode } from "../lib/crypto";
import type { ModelProfileView, TrashItem } from "../lib/types";
import { getVoices, speak } from "../lib/voice";
import { PanelHead } from "./PanelHead";
import { Toggle } from "./Toggle";

interface SettingsPanelProps {
  scale: number;
  setScale: (n: number) => void;
  soundOn: boolean;
  setSoundOn: (b: boolean) => void;
  voiceOn: boolean;
  setVoiceOn: (b: boolean) => void;
  voiceRate: number;
  setVoiceRate: (n: number) => void;
  voiceName: string;
  setVoiceName: (v: string) => void;
  voiceAmbient: boolean;
  setVoiceAmbient: (b: boolean) => void;
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  waterOn: boolean;
  setWaterOn: (b: boolean) => void;
  appTeaseOn: boolean;
  setAppTeaseOn: (b: boolean) => void;
  batteryOn: boolean;
  setBatteryOn: (b: boolean) => void;
  name: string;
  setName: (n: string) => void;
  birthday: string;
  setBirthday: (b: string) => void;
  sass: number;
  setSass: (n: number) => void;
  talkativity: number;
  setTalkativity: (n: number) => void;
  quietOn: boolean;
  setQuietOn: (b: boolean) => void;
  quietFrom: string;
  setQuietFrom: (v: string) => void;
  quietTo: string;
  setQuietTo: (v: string) => void;
  sceneMuteOn: boolean;
  setSceneMuteOn: (b: boolean) => void;
  sceneMode: SceneMode;
  setSceneMode: (mode: SceneMode) => void;
  personality: number;
  affinity: number;
  sectionsOpen: Record<string, boolean>;
  setSectionsOpen: (r: Record<string, boolean>) => void;
  trashItems: TrashItem[];
  refreshTrash: () => Promise<void>;
  onRestore: (name: string) => Promise<void>;
  onPurge: (name: string) => Promise<void>;
  testMsg: string;
  dataMsg: string;
  onTest: () => Promise<void>;
  onExport: () => Promise<void>;
  onImport: () => Promise<void>;
  onExportEncrypted: (password: string) => Promise<void>;
  onImportEncrypted: (password: string) => Promise<void>;
  syncMsg: string;
  syncBusy: boolean;
  onSyncUpload: (code: string) => Promise<void>;
  onSyncDownload: (code: string) => Promise<void>;
  onClose: () => void;
  anchor?: PanelAnchor;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const p = props;
  const drag = usePanelDrag(p.anchor);
  const [backupPassword, setBackupPassword] = useState("");
  const toggle = (key: string) => p.setSectionsOpen({ ...p.sectionsOpen, [key]: !p.sectionsOpen[key] });

  // 打开时加载回收站列表
  useEffect(() => {
    void p.refreshTrash().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={drag.ref} className="dsh-vpet-settings">
      <PanelHead
        icon="⚙️"
        title="设置"
        subtitle="外观、声音与陪伴方式"
        onClose={p.onClose}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
      />
      <div className="dsh-vpet-panel-body">
      <Section label="基础" open={p.sectionsOpen.base} onToggle={() => toggle("base")}>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">名字</span>
          <input
            className="dsh-vpet-name-input"
            value={p.name}
            placeholder="给它起个名字"
            onChange={(e) => p.setName(e.target.value)}
          />
        </div>
        <div className="dsh-vpet-settings-row dsh-vpet-settings-row-range">
          <span className="dsh-vpet-settings-label">大小 {Math.round(p.scale * 100)}%</span>
          <input
            type="range"
            min={0.3}
            max={1.2}
            step={0.05}
            value={p.scale}
            onChange={(e) => p.setScale(Number(e.target.value))}
          />
        </div>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">音效</span>
          <Toggle checked={p.soundOn} onChange={p.setSoundOn} label="音效" />
        </div>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">喝水提醒</span>
          <Toggle checked={p.waterOn} onChange={p.setWaterOn} label="喝水提醒" />
        </div>
        <AutoStartSetting />
      </Section>
      <Section label="外观与主题" open={p.sectionsOpen.appearance} onToggle={() => toggle("appearance")}>
        <div className="dsh-vpet-theme-grid">
          {THEMES.map((theme) => {
            const active = p.theme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                className={"dsh-vpet-theme-card" + (active ? " is-active" : "")}
                onClick={() => p.setTheme(theme.id)}
                aria-pressed={active}
                title={`切换到${theme.name}主题`}
                style={
                  {
                    "--t-bg": theme.preview.bg,
                    "--t-surface": theme.preview.surface,
                    "--t-soft": theme.preview.soft,
                    "--t-border": theme.preview.border,
                    "--t-text": theme.preview.text,
                    "--t-accent": theme.colors[0],
                  } as CSSProperties
                }
              >
                <span className="dsh-vpet-theme-preview" aria-hidden="true">
                  <span className="dsh-vpet-theme-preview-head">
                    <span className="dsh-vpet-theme-preview-title" />
                    <span className="dsh-vpet-theme-preview-dot" />
                  </span>
                  <span className="dsh-vpet-theme-preview-bubble" />
                  <span className="dsh-vpet-theme-preview-line" />
                  <span className="dsh-vpet-theme-preview-line is-short" />
                  <span className="dsh-vpet-theme-preview-pill" />
                </span>
                <span className="dsh-vpet-theme-meta">
                  <span className="dsh-vpet-theme-name">
                    <span className="dsh-vpet-theme-emoji" aria-hidden="true">{theme.emoji}</span>
                    {theme.name}
                    {active && <span className="dsh-vpet-theme-check" aria-hidden="true">✓</span>}
                  </span>
                  <span className="dsh-vpet-theme-desc">{theme.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="dsh-vpet-settings-hint">
          主题会立即应用到所有面板、菜单和气泡，并随配置保存；管理平台下发 skin 命令也可切换。
        </div>
      </Section>
      <Section label="AI 配置" open={p.sectionsOpen.ai} onToggle={() => toggle("ai")}>
        <AiSettings testMsg={p.testMsg} onTest={p.onTest} />
      </Section>
      <Section label="语音朗读" open={p.sectionsOpen.voice} onToggle={() => toggle("voice")}>
        <VoiceSettings
          voiceOn={p.voiceOn}
          setVoiceOn={p.setVoiceOn}
          voiceRate={p.voiceRate}
          setVoiceRate={p.setVoiceRate}
          voiceName={p.voiceName}
          setVoiceName={p.setVoiceName}
          voiceAmbient={p.voiceAmbient}
          setVoiceAmbient={p.setVoiceAmbient}
        />
      </Section>
      <Section label="性格与提醒" open={p.sectionsOpen.pet} onToggle={() => toggle("pet")}>
        <div className="dsh-vpet-settings-row dsh-vpet-settings-row-block">
          <span className="dsh-vpet-settings-label">场景模式</span>
          <span className="dsh-vpet-scene-grid">
            {([
              ["auto", "自动"],
              ["work", "工作"],
              ["rest", "休息"],
              ["dnd", "勿扰"],
            ] as [SceneMode, string][]).map(([mode, label]) => (
              <button
                key={mode}
                className={"dsh-vpet-settings-btn" + (p.sceneMode === mode ? " is-active" : "")}
                onClick={() => p.setSceneMode(mode)}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
        <div className="dsh-vpet-settings-hint">
          工作：尽量保持专注动画；休息：慢节奏待机；勿扰：停止主动开口/粒子，仍可点击互动；自动：由状态机按优先级决定。
        </div>
        <div className="dsh-vpet-settings-row dsh-vpet-settings-row-range">
          <span className="dsh-vpet-settings-label">毒舌程度 {p.sass}</span>
          <input type="range" min={0} max={100} value={p.sass} onChange={(e) => p.setSass(Number(e.target.value))} />
        </div>
        <div className="dsh-vpet-settings-row dsh-vpet-settings-row-range">
          <span className="dsh-vpet-settings-label">话痨程度 {p.talkativity}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={p.talkativity}
            onChange={(e) => p.setTalkativity(Number(e.target.value))}
          />
        </div>
        <div className="dsh-vpet-settings-hint">0 = 几乎不主动开口，100 = 约每分钟一次；点击/聊天等主动互动不受影响。</div>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">安静时段</span>
          <Toggle checked={p.quietOn} onChange={p.setQuietOn} label="安静时段" />
        </div>
        {p.quietOn && (
          <div className="dsh-vpet-settings-row">
            <span className="dsh-vpet-settings-label">时间</span>
            <input
              className="dsh-vpet-name-input"
              type="time"
              value={p.quietFrom}
              onChange={(e) => p.setQuietFrom(e.target.value)}
            />
            <span className="dsh-vpet-settings-v">→</span>
            <input
              className="dsh-vpet-name-input"
              type="time"
              value={p.quietTo}
              onChange={(e) => p.setQuietTo(e.target.value)}
            />
          </div>
        )}
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">会议自动静音</span>
          <Toggle checked={p.sceneMuteOn} onChange={p.setSceneMuteOn} label="会议自动静音" />
        </div>
        <div className="dsh-vpet-settings-hint">检测到会议/通话时，仅暂停主动说话与粒子，不隐藏桌宠、不阻塞交互。</div>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">性格 {p.personality}</span>
          <span className="dsh-vpet-settings-v">
            {p.personality >= 70 ? "撒娇黏人" : p.personality >= 35 ? "标准傲娇" : "高冷傲娇"}
          </span>
        </div>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">好感度</span>
          <span className="dsh-vpet-settings-v">{p.affinity}/100</span>
        </div>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">生日</span>
          <input
            className="dsh-vpet-name-input"
            type="date"
            value={p.birthday}
            onChange={(e) => p.setBirthday(e.target.value)}
          />
        </div>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">前台应用吐槽</span>
          <Toggle checked={p.appTeaseOn} onChange={p.setAppTeaseOn} label="前台应用吐槽" />
        </div>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">低电量提醒</span>
          <Toggle checked={p.batteryOn} onChange={p.setBatteryOn} label="低电量提醒" />
        </div>
      </Section>
      <Section label="数据" open={p.sectionsOpen.data} onToggle={() => toggle("data")}>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">本地备份</span>
          <span>
            <button className="dsh-vpet-settings-btn" onClick={() => void p.onExport()}>导出</button>
            <button className="dsh-vpet-settings-btn" onClick={() => void p.onImport()}>导入</button>
          </span>
        </div>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">加密密码</span>
          <input
            className="dsh-vpet-name-input"
            type="password"
            value={backupPassword}
            placeholder="至少 8 位，仅本地记住本次输入"
            onChange={(e) => setBackupPassword(e.target.value)}
          />
        </div>
        <div className="dsh-vpet-settings-row">
          <span className="dsh-vpet-settings-label">端到端加密</span>
          <span>
            <button
              className="dsh-vpet-settings-btn"
              disabled={backupPassword.trim().length < 8}
              onClick={() => void p.onExportEncrypted(backupPassword)}
            >
              加密导出
            </button>
            <button
              className="dsh-vpet-settings-btn"
              disabled={backupPassword.trim().length < 8}
              onClick={() => void p.onImportEncrypted(backupPassword)}
            >
              解密导入
            </button>
          </span>
        </div>
        <div className="dsh-vpet-settings-hint">
          加密备份使用 PBKDF2-SHA256 + AES-GCM，密码不会保存到磁盘；忘记密码将无法恢复。
        </div>
        {p.dataMsg && <div className="dsh-vpet-settings-hint">{p.dataMsg}</div>}
        <div className="dsh-vpet-settings-hint">回收站</div>
        <div className="dsh-vpet-trash">
          {p.trashItems.length === 0 && <div className="dsh-vpet-settings-hint">（空）</div>}
          {p.trashItems.map((t) => (
            <div key={t.name} className="dsh-vpet-trash-item">
              <span className="dsh-vpet-trash-name" title={t.original}>
                {t.original.split(/[\\/]/).pop()}
              </span>
              <span className="dsh-vpet-trash-actions">
                <button className="dsh-vpet-settings-btn" onClick={() => void p.onRestore(t.name)}>恢复</button>
                <button className="dsh-vpet-settings-btn dsh-vpet-btn-danger" onClick={() => void p.onPurge(t.name)}>删除</button>
              </span>
            </div>
          ))}
        </div>
      </Section>
      <Section label="多设备同步" open={p.sectionsOpen.sync} onToggle={() => toggle("sync")}>
        <SyncSettings
          busy={p.syncBusy}
          message={p.syncMsg}
          onUpload={p.onSyncUpload}
          onDownload={p.onSyncDownload}
        />
      </Section>
      <Section label="设备配对" open={p.sectionsOpen.device} onToggle={() => toggle("device")}>
        <DeviceSettings />
      </Section>
      </div>
    </div>
  );
}

function SyncSettings(props: {
  busy: boolean;
  message: string;
  onUpload: (code: string) => Promise<void>;
  onDownload: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const generate = () => setCode(generateSyncCode());
  return (
    <div>
      <div className="dsh-vpet-settings-hint">
        同步码既用于定位，也作为加密口令。平台只保存同步码哈希和 AES-GCM 密文，看不到聊天、日记和记忆明文。
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">同步码</span>
        <input
          className="dsh-vpet-name-input"
          value={code}
          placeholder="16 位以上，或点「生成」"
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">操作</span>
        <span>
          <button className="dsh-vpet-settings-btn" onClick={generate}>生成</button>
          <button
            className="dsh-vpet-settings-btn"
            disabled={props.busy || code.trim().length < 16}
            onClick={() => void props.onUpload(code)}
          >
            {props.busy ? "处理中…" : "上传"}
          </button>
          <button
            className="dsh-vpet-settings-btn"
            disabled={props.busy || code.trim().length < 16}
            onClick={() => void props.onDownload(code)}
          >
            下载并合并
          </button>
        </span>
      </div>
      <div className="dsh-vpet-settings-hint">另一台设备输入同一个同步码即可拉取；下载会按记忆 id、日记/报告日期合并，不会直接覆盖本地数据。</div>
      {props.message && <div className="dsh-vpet-settings-hint">{props.message}</div>}
    </div>
  );
}

function VoiceSettings(props: {
  voiceOn: boolean;
  setVoiceOn: (b: boolean) => void;
  voiceRate: number;
  setVoiceRate: (n: number) => void;
  voiceName: string;
  setVoiceName: (v: string) => void;
  voiceAmbient: boolean;
  setVoiceAmbient: (b: boolean) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [msg, setMsg] = useState("");

  // WebView2 的系统语音列表可能在首次用户手势后才异步出现，这里既监听
  // voiceschanged，也在面板刚打开时短暂轮询，避免下拉框一直是空的。
  useEffect(() => {
    const refresh = () => setVoices(getVoices());
    refresh();
    const synth = window.speechSynthesis;
    synth?.addEventListener("voiceschanged", refresh);
    let tries = 0;
    const timer = setInterval(() => {
      const list = getVoices();
      tries += 1;
      if (list.length > 0 || tries >= 20) {
        setVoices(list);
        clearInterval(timer);
      }
    }, 250);
    return () => {
      clearInterval(timer);
      synth?.removeEventListener("voiceschanged", refresh);
    };
  }, []);

  const preview = () => {
    const list = getVoices();
    setVoices(list);
    const fallbackVoice = list.find((v) => v.lang.toLowerCase().startsWith("zh"))?.name || "";
    const ok = speak("你好呀，我是你的桌面宠物。", {
      rate: props.voiceRate,
      voiceName: props.voiceName || fallbackVoice,
    });
    setMsg(ok ? "正在试听…" : "当前系统没有可用的语音引擎");
  };

  return (
    <div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">启用语音</span>
        <Toggle checked={props.voiceOn} onChange={props.setVoiceOn} label="启用语音" />
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">主动吐槽也朗读</span>
        <Toggle checked={props.voiceAmbient} onChange={props.setVoiceAmbient} label="主动吐槽也朗读" />
      </div>
      <div className="dsh-vpet-settings-hint">
        点击、聊天回复和提醒默认会朗读；主动吐槽默认只显示气泡，避免频繁打断。安静时段与会议静音仍然优先。
      </div>
      <div className="dsh-vpet-settings-row dsh-vpet-settings-row-range">
        <span className="dsh-vpet-settings-label">语速 {props.voiceRate.toFixed(1)}x</span>
        <input
          type="range"
          min={0.6}
          max={1.6}
          step={0.05}
          value={props.voiceRate}
          onChange={(e) => props.setVoiceRate(Number(e.target.value))}
        />
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">音色</span>
        <select
          className="dsh-vpet-name-input"
          value={props.voiceName}
          onChange={(e) => props.setVoiceName(e.target.value)}
        >
          <option value="">系统默认</option>
          {props.voiceName && !voices.some((v) => v.name === props.voiceName) && (
            <option value={props.voiceName}>{props.voiceName}（当前）</option>
          )}
          {voices.map((v) => (
            <option key={`${v.name}|${v.lang}`} value={v.name}>
              {v.name} · {v.lang}
            </option>
          ))}
        </select>
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">试听</span>
        <span>
          <button className="dsh-vpet-settings-btn" onClick={preview}>播放一句</button>
        </span>
      </div>
      <div className="dsh-vpet-settings-hint">
        使用 Windows 内置离线语音，不消耗 API 额度。没有声音时先点一次「播放一句」。
      </div>
      {msg && <div className="dsh-vpet-settings-hint">{msg}</div>}
    </div>
  );
}

function DeviceSettings() {
  const [info, setInfo] = useState<{ deviceId: string; hasDeviceToken: boolean } | null>(null);
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");

  const load = async () => {
    const d = await bridge.getDeviceInfo();
    setInfo(d);
  };

  useEffect(() => {
    void load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const t = token.trim();
    if (!t) {
      setMsg("请先在管理平台「宠物」页对该设备点「配对」，再粘贴令牌");
      return;
    }
    try {
      await bridge.setDeviceToken(t);
      setToken("");
      await load();
      setMsg("已保存，配对成功");
    } catch (e) {
      setMsg(String(e));
    }
  };

  const clear = async () => {
    try {
      await bridge.setDeviceToken("");
      await load();
      setMsg("已清除配对");
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <div>
      <div className="dsh-vpet-settings-hint">
        在管理平台「宠物」页对这台设备点「配对」，把生成的令牌粘贴到下面即可。配对后桌宠才能接收遥控命令。
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">设备 ID</span>
        <span className="dsh-vpet-settings-v" style={{ wordBreak: "break-all" }}>
          {info ? info.deviceId : "加载中…"}
        </span>
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">状态</span>
        <span className="dsh-vpet-settings-v">{info ? (info.hasDeviceToken ? "已配对" : "未配对") : "—"}</span>
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">配对令牌</span>
        <input
          className="dsh-vpet-name-input"
          type="password"
          value={token}
          placeholder="粘贴平台生成的令牌…"
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">操作</span>
        <span>
          <button className="dsh-vpet-settings-btn" onClick={() => void save()}>保存</button>
          {info && info.hasDeviceToken && (
            <button className="dsh-vpet-settings-btn dsh-vpet-btn-danger" onClick={() => void clear()}>
              取消配对
            </button>
          )}
        </span>
      </div>
      {msg && <div className="dsh-vpet-settings-hint">{msg}</div>}
    </div>
  );
}

function Section(props: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div>
      <button type="button" className="dsh-vpet-sec-head" onClick={props.onToggle} aria-expanded={props.open}>
        <span className="dsh-vpet-sec-arrow">{props.open ? "▼" : "▶"}</span>
        <span className="dsh-vpet-sec-label">{props.label}</span>
      </button>
      {props.open && <div className="dsh-vpet-sec-body">{props.children}</div>}
    </div>
  );
}

function AutoStartSetting() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void bridge
      .getAutoStart()
      .then(setEnabled)
      .catch((e) => setMsg(`读取失败：${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setBusy(false));
  }, []);

  const change = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const actual = await bridge.setAutoStart(next);
      setEnabled(actual);
      setMsg(
        actual
          ? "已开启，下次登录 Windows 会自动启动（不会补启动本次会话）。"
          : "已关闭，下次登录 Windows 不再自动启动。",
      );
    } catch (e) {
      setMsg(`设置失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">开机自启</span>
        <Toggle checked={enabled} onChange={(next) => void change(next)} label="开机自启" />
      </div>
      <div className="dsh-vpet-settings-hint">
        {msg || "状态读取中… 如果任务管理器禁用了本应用，这里会显示为关闭。"}
      </div>
    </>
  );
}

function AiSettings(props: { testMsg: string; onTest: () => Promise<void> }) {
  const [main, setMain] = useState({ baseUrl: "", model: "", dshUrl: "", hasApiKey: false });
  const [mainKey, setMainKey] = useState("");
  const [models, setModels] = useState<ModelProfileView[]>([]);
  const [sayModelId, setSayModelId] = useState("");
  const [chatModelId, setChatModelId] = useState("");
  const [form, setForm] = useState<{ id?: string; label: string; baseUrl: string; model: string; apiKey: string } | null>(null);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const c = await bridge.getAiConfig();
    setMain({ baseUrl: c.baseUrl, model: c.model, dshUrl: c.dshUrl, hasApiKey: c.hasApiKey });
    setModels(c.models);
    setSayModelId(c.sayModelId ?? "");
    setChatModelId(c.chatModelId ?? "");
  };

  useEffect(() => {
    void load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveAll = async () => {
    try {
      await bridge.setAiConfig({ baseUrl: main.baseUrl, model: main.model, dshUrl: main.dshUrl, apiKey: mainKey || undefined });
      await bridge.setModelRoute({ sayModelId: sayModelId || undefined, chatModelId: chatModelId || undefined });
      setMainKey("");
      setMsg("已保存");
    } catch (e) {
      setMsg(String(e));
    }
  };

  const submitForm = async () => {
    if (!form) return;
    try {
      await bridge.saveModel({
        id: form.id,
        label: form.label,
        baseUrl: form.baseUrl,
        model: form.model,
        apiKey: form.apiKey || undefined,
      });
      setForm(null);
      await load();
    } catch (e) {
      setMsg(String(e));
    }
  };

  const removeModel = async (id: string) => {
    try {
      await bridge.deleteModel(id);
      await load();
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <div>
      <div className="dsh-vpet-settings-hint">主模型：聊天/日记/复盘默认使用的模型（也是兜底模型）</div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">Base URL</span>
        <input
          className="dsh-vpet-name-input"
          value={main.baseUrl}
          placeholder="https://api.deepseek.com（裸域名自动补 /v1）"
          onChange={(e) => setMain({ ...main, baseUrl: e.target.value })}
        />
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">模型</span>
        <input className="dsh-vpet-name-input" value={main.model} onChange={(e) => setMain({ ...main, model: e.target.value })} />
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">API Key</span>
        <input
          className="dsh-vpet-name-input"
          type="password"
          value={mainKey}
          placeholder={main.hasApiKey ? "（已设置，留空不修改）" : "sk-…"}
          onChange={(e) => setMainKey(e.target.value)}
        />
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">DSH 地址</span>
        <input
          className="dsh-vpet-name-input"
          value={main.dshUrl}
          placeholder="http://127.0.0.1:3080"
          onChange={(e) => setMain({ ...main, dshUrl: e.target.value })}
        />
      </div>

      <div className="dsh-vpet-settings-hint">模型路由：短句吐槽走「快模型」，聊天/日记/复盘走「聪明模型」</div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">短句模型</span>
        <select className="dsh-vpet-name-input" value={sayModelId} onChange={(e) => setSayModelId(e.target.value)}>
          <option value="">主模型（默认）</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">聊天/日记/复盘</span>
        <select className="dsh-vpet-name-input" value={chatModelId} onChange={(e) => setChatModelId(e.target.value)}>
          <option value="">主模型（默认）</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="dsh-vpet-settings-hint">自定义模型列表</div>
      {models.map((m) => (
        <div key={m.id} className="dsh-vpet-trash-item">
          <span className="dsh-vpet-trash-name" title={`${m.baseUrl} / ${m.model}`}>
            {m.label}（{m.model}{m.hasApiKey ? " · 已设key" : ""}）
          </span>
          <span className="dsh-vpet-trash-actions">
            <button className="dsh-vpet-settings-btn" onClick={() => setForm({ id: m.id, label: m.label, baseUrl: m.baseUrl, model: m.model, apiKey: "" })}>编辑</button>
            <button className="dsh-vpet-settings-btn dsh-vpet-btn-danger" onClick={() => void removeModel(m.id)}>删除</button>
          </span>
        </div>
      ))}
      {models.length === 0 && <div className="dsh-vpet-settings-hint">（暂无，可添加不同模型）</div>}
      <div className="dsh-vpet-settings-row">
        <button className="dsh-vpet-settings-btn" onClick={() => setForm({ label: "", baseUrl: "", model: "", apiKey: "" })}>＋ 添加模型</button>
      </div>

      {form && (
        <div>
          <div className="dsh-vpet-settings-row">
            <span className="dsh-vpet-settings-label">显示名</span>
            <input className="dsh-vpet-name-input" value={form.label} placeholder="如 DeepSeek 快" onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div className="dsh-vpet-settings-row">
            <span className="dsh-vpet-settings-label">Base URL</span>
            <input className="dsh-vpet-name-input" value={form.baseUrl} placeholder="https://api.deepseek.com" onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          </div>
          <div className="dsh-vpet-settings-row">
            <span className="dsh-vpet-settings-label">模型名</span>
            <input className="dsh-vpet-name-input" value={form.model} placeholder="deepseek-chat" onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
          <div className="dsh-vpet-settings-row">
            <span className="dsh-vpet-settings-label">API Key</span>
            <input
              className="dsh-vpet-name-input"
              type="password"
              value={form.apiKey}
              placeholder={form.id ? "（留空不修改）" : "sk-…"}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </div>
          <div className="dsh-vpet-settings-row">
            <button className="dsh-vpet-settings-btn" onClick={() => void submitForm()}>确定</button>
            <button className="dsh-vpet-settings-btn" onClick={() => setForm(null)}>取消</button>
          </div>
        </div>
      )}

      <div className="dsh-vpet-settings-row">
        <span className="dsh-vpet-settings-label">测试</span>
        <span>
          <button className="dsh-vpet-settings-btn" onClick={() => void props.onTest()}>测试连接</button>
        </span>
      </div>
      {props.testMsg && <div className="dsh-vpet-settings-hint">{props.testMsg}</div>}
      {msg && <div className="dsh-vpet-settings-hint">{msg}</div>}
      <div className="dsh-vpet-settings-row">
        <button className="dsh-vpet-settings-btn" onClick={() => void saveAll()}>保存</button>
      </div>
    </div>
  );
}
