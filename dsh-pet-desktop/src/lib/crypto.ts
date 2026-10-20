// 端到端加密备份/多设备同步：PBKDF2-SHA256 派生密钥 + AES-GCM。
// 平台只看到同步码哈希与密文，不保存密码或明文记录。

const FORMAT = "dsh-pet-encrypted";
const VERSION = 1;
const ITERATIONS = 210_000;

export interface EncryptedEnvelope {
  format: typeof FORMAT;
  version: number;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function randomBytes(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}

/** WebCrypto 的 BufferSource 只接受 ArrayBuffer 支撑的视图，统一复制一份。 */
function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bytesBuffer(salt), iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJson(value: unknown, secret: string): Promise<string> {
  const pass = secret.trim();
  if (pass.length < 8) throw new Error("加密密码至少 8 位");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(pass, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: bytesBuffer(iv) }, key, bytesBuffer(plaintext)),
  );
  const envelope: EncryptedEnvelope = {
    format: FORMAT,
    version: VERSION,
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
  return JSON.stringify(envelope);
}

export function looksEncrypted(text: string): boolean {
  try {
    const raw = JSON.parse(text) as Partial<EncryptedEnvelope>;
    return raw.format === FORMAT && raw.version === VERSION && !!raw.ciphertext;
  } catch {
    return false;
  }
}

export async function decryptJson<T>(text: string, secret: string): Promise<T> {
  const envelope = JSON.parse(text) as Partial<EncryptedEnvelope>;
  if (envelope.format !== FORMAT || envelope.version !== VERSION) {
    throw new Error("不是受支持的加密备份格式");
  }
  if (!envelope.salt || !envelope.iv || !envelope.ciphertext) {
    throw new Error("加密备份字段不完整");
  }
  const key = await deriveKey(secret, fromBase64(envelope.salt));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesBuffer(fromBase64(envelope.iv)) },
    key,
    bytesBuffer(fromBase64(envelope.ciphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/** 生成高熵同步码（约 256 bit），同时作为平台定位码与加密口令。 */
export function generateSyncCode(): string {
  return toBase64(randomBytes(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

