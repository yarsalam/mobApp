import { describe, expect, it } from '@jest/globals';
import {
  getUsdtRateRials,
  usdtCentsToRials,
  usdtRialsToCents,
} from './crypto-rate';

describe('USDT conversion rate', () => {
  it('uses the configured rial-per-USDT rate for both directions', () => {
    expect(usdtRialsToCents(900_000, 900_000)).toBe(100);
    expect(usdtRialsToCents(450_000, 900_000)).toBe(50);
    expect(usdtCentsToRials(100, 900_000)).toBe(900_000);
    expect(usdtCentsToRials(50, 900_000)).toBe(450_000);
  });

  it('rounds a rial deposit up to the next USDT cent', () => {
    expect(usdtRialsToCents(900_001, 900_000)).toBe(101);
  });

  it('uses the development fallback only outside production', () => {
    expect(getUsdtRateRials('development', undefined)).toBe(900_000);
    expect(() => getUsdtRateRials('production', undefined)).toThrow(
      'CRYPTO_USDT_RATE_RIALS is required',
    );
  });

  it('rejects invalid configured rates', () => {
    expect(() => getUsdtRateRials('production', '0')).toThrow(
      'positive safe integer',
    );
    expect(() => getUsdtRateRials('production', 'not-a-rate')).toThrow(
      'positive safe integer',
    );
  });
});
