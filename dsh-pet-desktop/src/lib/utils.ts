// 通用工具函数（与业务无关）。

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function pick2<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}
