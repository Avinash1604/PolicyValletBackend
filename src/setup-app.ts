import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
export function setupApp(app: INestApplication) {
  const config = app.get(ConfigService);

  // Behind the Caddy proxy: use X-Forwarded-For for rate limiting.
  (app as NestExpressApplication).set('trust proxy', 1);
  app.use(helmet());
  const origins = config.getOrThrow<string[]>('corsOrigins');
  app.enableCors({ origin: origins.includes('*') ? true : origins });

  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('PolicyValet API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, swagger),
  );
}
