import { CookieOptions } from 'express';

export const authCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: false,
  sameSite: 'lax',
  path: '/',
  domain: '127.0.0.1', // حتماً بزارش!
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 روز
};
