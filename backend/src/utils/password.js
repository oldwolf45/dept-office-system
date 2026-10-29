// 密码哈希：node:crypto scrypt，零原生依赖（契约第1节推荐）
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(plain), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const idx = stored.indexOf(':');
  const salt = stored.slice(0, idx);
  const expected = Buffer.from(stored.slice(idx + 1), 'hex');
  const candidate = scryptSync(String(plain), salt, expected.length);
  return expected.length > 0 && candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
