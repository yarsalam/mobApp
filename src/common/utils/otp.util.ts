import * as crypto from 'crypto';

export function generateOTP(length = 6): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

export function hashOTP(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}
