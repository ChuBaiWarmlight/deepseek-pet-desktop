// 重置 dsh-pet-assets 管理员密码（独立脚本，本地直接运行）。
//
// 用法：
//   node reset-admin-password.mjs              # 重置为默认密码 bzyjzh1314
//   node reset-admin-password.mjs "新密码"      # 重置为指定密码
//
// 说明：
//   - 直接改 ~/.dsh-pet-assets/dsh-pet-assets.db 里 admin 的密码哈希（与 lib/auth.js 的 scrypt 参数一致）；
//   - 同时撤销所有已登录会话，旧 cookie 立即失效；
//   - 密码登录时实时校验，改完即生效，无需重启服务。
//
// 若运行时报 SQLITE_BUSY（服务正占用数据库），先停掉 8787 的服务再跑本脚本。

import Database from 'better-sqlite3'
import { scryptSync, randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const DB_PATH = path.join(os.homedir(), '.dsh-pet-assets', 'dsh-pet-assets.db')
const NEW_PASSWORD = process.argv[2] || 'bzyjzh1314'

if (NEW_PASSWORD.length < 8) {
  console.error('密码至少 8 位')
  process.exit(1)
}

// 与 lib/auth.js hashPassword 保持完全一致（N=16384, r=8, p=1, keyLen=64, salt=16 字节）
function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}`
}

const db = new Database(DB_PATH)
db.pragma('busy_timeout = 5000')

const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get('admin')
if (!user) {
  console.error('未找到 admin 用户，数据库路径：' + DB_PATH)
  process.exit(1)
}

const hash = hashPassword(NEW_PASSWORD)
db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id)
db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), user.id)
db.close()

console.log('已重置管理员密码')
console.log('  账号：admin')
console.log('  密码：' + NEW_PASSWORD)
console.log('  旧会话已全部失效，可直接登录（无需重启服务）')
