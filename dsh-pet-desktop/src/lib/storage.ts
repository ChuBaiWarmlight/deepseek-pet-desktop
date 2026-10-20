// localStorage 读写（高频交互状态仍存 WebView localStorage，见 storage 设计）。
// 记忆/日记/聊天等“记录”已迁到 Rust 侧 records.json，不经过这里。

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v != null) return JSON.parse(v) as T;
  } catch {
    /* 忽略损坏数据，回退默认值 */
  }
  return fallback;
}

export function saveJson(key: string, val: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* 忽略写入失败（如隐私模式） */
  }
}
