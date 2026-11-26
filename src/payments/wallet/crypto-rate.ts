import { ServiceUnavailableException } from '@nestjs/common';

const DEVELOPMENT_USDT_RATE_RIALS = 900_000;

export function getUsdtRateRials(
  nodeEnv = process.env.NODE_ENV,
  configuredRate = process.env.CRYPTO_USDT_RATE_RIALS,
): number {
  if (!configuredRate?.trim()) {
    if (nodeEnv === 'production') {
      throw new ServiceUnavailableException(
        'Crypto deposits are not configured: CRYPTO_USDT_RATE_RIALS is required.',
      );
    }
    return DEVELOPMENT_USDT_RATE_RIALS;
  }

  const rate = Number(configuredRate);
  if (!Number.isSafeInteger(rate) || rate <= 0) {
    throw new ServiceUnavailableException(
      'CRYPTO_USDT_RATE_RIALS must be a positive safe integer.',
    );
  }
  return rate;
}

export function usdtRialsToCents(
  amountRials: number,
  rateRialsPerUsdt = getUsdtRateRials(),
): number {
  if (!Number.isSafeInteger(amountRials) || amountRials <= 0) {
    throw new Error('amountRials must be a positive safe integer');
  }
  if (!Number.isSafeInteger(rateRialsPerUsdt) || rateRialsPerUsdt <= 0) {
    throw new Error('USDT rate must be a positive safe integer');
  }

  const amount = BigInt(amountRials);
  const rate = BigInt(rateRialsPerUsdt);
  const cents = (amount * 100n + rate - 1n) / rate;
  const result = Number(cents);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error('Converted USDT amount is outside the safe integer range');
  }
  return result;
}

export function usdtCentsToRials(
  amountCents: number,
  rateRialsPerUsdt = getUsdtRateRials(),
): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error('amountCents must be a positive safe integer');
  }
  if (!Number.isSafeInteger(rateRialsPerUsdt) || rateRialsPerUsdt <= 0) {
    throw new Error('USDT rate must be a positive safe integer');
  }

  const result = Number(
    (BigInt(amountCents) * BigInt(rateRialsPerUsdt)) / 100n,
  );
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error('Converted rial amount is outside the safe integer range');
  }
  return result;
}
