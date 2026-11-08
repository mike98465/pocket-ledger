// 開啟密碼：只存 PBKDF2 雜湊（加鹽），不存原始密碼。用瀏覽器內建的 Web Crypto，Node 也能測。
// 注意：這是「畫面鎖」，記帳資料本身沒有加密（4 位數密碼加密資料很容易被暴力破解，且忘記就救不回）。

export const PIN_LENGTH = 4;
export const MAX_FREE_ATTEMPTS = 5; // 前 5 次輸錯不用等
export const RELOCK_OPTIONS = { 0: '立即', 60000: '1 分鐘', 300000: '5 分鐘' };
export const DEFAULT_RELOCK_MS = 60000;
const ITERATIONS = 150000;

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const isValidPin = (pin) => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toB64(bits);
}

/** 產生要儲存的密碼紀錄 { hash, salt, iterations } */
export async function hashPin(pin) {
  if (!isValidPin(pin)) throw new Error(`密碼要是 ${PIN_LENGTH} 位數字`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await derive(pin, salt, ITERATIONS), salt: toB64(salt), iterations: ITERATIONS };
}

/** 比對密碼（固定時間比較，避免從比對時間猜出密碼） */
export async function verifyPin(pin, record) {
  if (!record || !isValidPin(pin)) return false;
  const hash = await derive(pin, fromB64(record.salt), record.iterations);
  if (hash.length !== record.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ record.hash.charCodeAt(i);
  return diff === 0;
}

/** 連續輸錯 n 次後要等多久（毫秒）：前 5 次不用等，之後 30 秒起每次加倍，最多 15 分鐘。 */
export function lockoutMs(failedAttempts) {
  if (failedAttempts < MAX_FREE_ATTEMPTS) return 0;
  return Math.min(30000 * 2 ** (failedAttempts - MAX_FREE_ATTEMPTS), 15 * 60000);
}

/** 回到 App 時要不要重新上鎖 */
export function shouldRelock(hiddenAt, now, relockAfterMs) {
  if (hiddenAt == null) return false;
  return now - hiddenAt >= relockAfterMs;
}
