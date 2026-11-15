import { registerAs } from '@nestjs/config';

export default registerAs('cors', () => ({
  origin: [
    ...(process.env.CORS_ORIGINS || '').split(','),
    process.env.FRONTEND_URL || '',
  ].map((origin) => origin.trim()).filter(Boolean),
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Api-Key',
    'X-Device-Id',
    'X-Platform',
    'X-Brand',
    'X-Model',
    'X-App-Version',
    'X-Os-Version',
    'X-Timezone',
  ],
  credentials: true,
}));
