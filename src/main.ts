import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get(ConfigService).getOrThrow<number>('port'));
}
void bootstrap();
