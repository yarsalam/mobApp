import { registerAs } from '@nestjs/config';

export default registerAs('cors', () => ({
  // origin: [
  //   process.env.FRONTEND_URL || 'http://localhost:3000',
  //   'http://localhost:4000',
  //   'https://admin.example.com',
  // ],
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
  origin: true,
}));
