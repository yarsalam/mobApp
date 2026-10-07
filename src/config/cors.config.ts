import { registerAs } from '@nestjs/config';

export default registerAs('cors', () => ({
  // origin: [
  //   process.env.FRONTEND_URL || 'http://localhost:3000',
  //   'http://localhost:4000',
  //   'https://admin.example.com',
  // ],
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  origin: true,
}));
