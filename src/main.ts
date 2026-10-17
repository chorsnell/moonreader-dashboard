import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AccessSettingsService } from './access/access-settings.service';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadAppConfig } from './config/app.config';
import { ActivityLogService } from './library/activity-log.service';
import { dropPrivileges } from './privileges';

async function bootstrap() {
  const config = loadAppConfig();
  dropPrivileges(config); // before anything is written to the library
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(config.port);
  const { access } = await app.get(AccessSettingsService).load();
  app
    .get(ActivityLogService)
    .log(
      `Serving on port ${config.port}${config.basePath ? ` under ${config.basePath}` : ''}; ` +
        `uploads and WebDAV ${config.uploadToken ? 'on' : 'off (set UPLOAD_TOKEN to turn them on)'}; ` +
        `the dashboard is ${access}`,
    );
}

void bootstrap();
