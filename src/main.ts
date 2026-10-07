// import { NestFactory } from '@nestjs/core';
// import { AppModule } from './app.module';
// import * as dotenv from 'dotenv';
// import cookieParser from 'cookie-parser';
// import { ValidationPipe } from '@nestjs/common';
// import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// async function bootstrap() {
//   const app = await NestFactory.create(AppModule);
//   dotenv.config();
//   app.use(cookieParser());
//   app.useGlobalPipes(new ValidationPipe());
//   app.useGlobalPipes(
//     new ValidationPipe({
//       whitelist: true,
//       transform: true,
//       forbidNonWhitelisted: false,
//     }),
//   );
//   app.enableCors({
//     // origin: [
//     //   'https://yourdomain.com',
//     //   'http://localhost:3000',
//     //   'http://127.0.0.1:3000',
//     // ], // آدرس فرانت
//     origin: true,
//     methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
//     allowedHeaders: [
//       'Content-Type',
//       'Authorization',
//       'x-device-id',
//       'x-platform', // ← اضافه کنید
//       'x-app-version', // ← اگر بعداً لازم شد
//     ],
//     credentials: true,
//   });
//   const config = new DocumentBuilder()
//     .setTitle('Sugaro API Docs')
//     .setDescription('مستندات هوشمند سامانه‌ی پیشنهادها و کاربران')
//     .setVersion('1.0')
//     .addBearerAuth() // برای JWT
//     .build();
//   const document = SwaggerModule.createDocument(app, config);
//   SwaggerModule.setup('api-docs', app, document);
//   // await app.listen(process.env.PORT ?? 5000);
//   // await app.listen(process.env.PORT ?? 5000, process.env.HOST ?? '127.0.0.1');
//   await app.listen(5000, '0.0.0.0');
// }
// bootstrap();
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
// import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
// import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import corsConfig from './config/cors.config';
import { TraceInterceptor } from './ops/trace.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const isProduction = configService.get('NODE_ENV') === 'production';

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(cookieParser());

  app.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // app.useGlobalFilters(new AllExceptionsFilter());
  // app.useGlobalInterceptors(new LoggingInterceptor());

  app.enableCors({
    // origin: corsConfig,
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
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
    ],
    credentials: true,
  });

  const swaggerEnabled =
    !isProduction || configService.get('ENABLE_SWAGGER') === 'true';

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Sugaro API Docs')
      .setDescription('مستندات هوشمند سامانه‌ی پیشنهادها و کاربران')
      .setVersion('1.0')
      .addBearerAuth() // برای JWT
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document);
  }

  app.enableShutdownHooks();

  const traceInterceptor = app.get(TraceInterceptor);
  app.useGlobalInterceptors(traceInterceptor);

  const port = configService.get<number>('PORT') ?? 5000;
  const host = configService.get<string>('HOST') ?? '0.0.0.0';

  await app.listen(port, host);

  logger.log(`🚀 Application is running on http://${host}:${port}`);
  if (swaggerEnabled) {
    logger.log(`📚 Swagger docs available at http://${host}:${port}/api-docs`);
  }
}

bootstrap();
