// SQLite 连接 + 建表迁移（递增式：v1 → v2）。
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

let db = null

export function initDb(dbPath) {
  if (db) return db
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 3000')
  migrate()
  return db
}

export function getDb() {
  if (!db) throw new Error('db not initialized')
  return db
}

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM schema_version').get()
  let current = row ? row.version : 0

  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column)
  const addColumn = (table, column, definition) => {
    if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  if (current < 1) {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        disabled INTEGER NOT NULL DEFAULT 0,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        ip TEXT,
        user_agent TEXT
      );
      CREATE TABLE resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        file TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        mime TEXT NOT NULL DEFAULT 'video/webm',
        category TEXT NOT NULL DEFAULT 'act',
        tags TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        target TEXT,
        detail TEXT,
        ip TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE INDEX idx_resources_category ON resources(category);
      CREATE INDEX idx_resources_enabled ON resources(enabled);
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX idx_audit_created ON audit_logs(created_at);
    `)
    db.prepare('INSERT INTO schema_version (version) VALUES (1)').run()
    current = 1
  }

  if (current < 2) {
    db.exec(`
      CREATE TABLE pet_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        done_at INTEGER
      );
      CREATE INDEX idx_pet_commands_status ON pet_commands(status);
      CREATE INDEX idx_pet_commands_created ON pet_commands(created_at);
    `)
    db.prepare('UPDATE schema_version SET version = 2').run()
    current = 2
  }

  if (current < 3) {
    db.exec('ALTER TABLE resources ADD COLUMN trashed INTEGER NOT NULL DEFAULT 0;')
    db.prepare('CREATE INDEX IF NOT EXISTS idx_resources_trashed ON resources(trashed)').run()
    db.prepare('UPDATE schema_version SET version = 3').run()
    current = 3
  }

  if (current < 4) {
    db.exec('ALTER TABLE resources ADD COLUMN weight INTEGER NOT NULL DEFAULT 100;')
    db.prepare('UPDATE schema_version SET version = 4').run()
    current = 4
  }

  if (current < 5) {
    db.exec(`
      CREATE TABLE pet_devices (
        device_id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        last_seen INTEGER NOT NULL,
        first_seen INTEGER NOT NULL,
        affinity INTEGER NOT NULL DEFAULT 50,
        sass INTEGER NOT NULL DEFAULT 60,
        personality INTEGER NOT NULL DEFAULT 50,
        mood TEXT NOT NULL DEFAULT 'normal',
        model TEXT NOT NULL DEFAULT '',
        dsh_online INTEGER NOT NULL DEFAULT 0,
        today_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_pet_devices_last_seen ON pet_devices(last_seen);
    `)
    db.prepare('UPDATE schema_version SET version = 5').run()
    current = 5
  }

  if (current < 6) {
    // M-05 设备鉴权：pet_devices 增加设备 token 的 sha256 哈希（明文 token 只配对时展示一次）。
    db.exec('ALTER TABLE pet_devices ADD COLUMN device_token_hash TEXT;')
    db.prepare('UPDATE schema_version SET version = 6').run()
    current = 6
  }

  if (current < 7) {
    // M-02 命令增强：命令支持设备定向（device_id 为空 = 广播/单机）+ 定时任务表。
    db.exec(`
      ALTER TABLE pet_commands ADD COLUMN device_id TEXT;
      CREATE INDEX idx_pet_commands_device ON pet_commands(device_id);
      CREATE TABLE pet_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cron TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        device_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_pet_schedules_enabled ON pet_schedules(enabled);
    `)
    db.prepare('UPDATE schema_version SET version = 7').run()
    current = 7
  }

  if (current < 8) {
    // 多设备记忆同步（平台只保存客户端加密后的密文）+ 设备场景/关系阶段遥测。
    // 整个 v8 放进事务并逐列检查，避免“列已加、版本没写”导致下次启动重复 ALTER。
    const migrateV8 = db.transaction(() => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS pet_sync (
        code_hash TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pet_sync_updated ON pet_sync(updated_at);
      `)
      addColumn('pet_devices', 'scene', "TEXT NOT NULL DEFAULT 'auto'")
      addColumn('pet_devices', 'stage', "TEXT NOT NULL DEFAULT '陌生'")
      addColumn('pet_devices', 'companion_secs', 'INTEGER NOT NULL DEFAULT 0')
      db.prepare('UPDATE schema_version SET version = 8').run()
    })
    migrateV8()
    current = 8
  }
}
