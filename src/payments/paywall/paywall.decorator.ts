import { SetMetadata } from '@nestjs/common';

export const Paywall = (options: { credits?: number; boost?: boolean }) =>
  SetMetadata('paywall', options);
