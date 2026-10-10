import { HttpModuleOptions } from '@nestjs/axios';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getExternalHttpOptions(): HttpModuleOptions {
  return {
    timeout: positiveInteger(process.env.EXTERNAL_HTTP_TIMEOUT_MS, 10_000),
    maxRedirects: 3,
  };
}
