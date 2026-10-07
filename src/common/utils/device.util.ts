import * as crypto from 'crypto';

export function generateDeviceFingerprint(
  deviceInfo: string,
  ip: string,
): string {
  return crypto
    .createHash('sha256')
    .update(deviceInfo + ip + process.env.DEVICE_SECRET)
    .digest('hex');
}
