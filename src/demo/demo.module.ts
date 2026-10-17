import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BackupImportModule } from '../backup-import/backup-import.module';
import { appConfig } from '../config/app.config';
import { CoversModule } from '../covers/covers.module';
import { MetadataModule } from '../metadata/metadata.module';

/** Just the import and covers, without the web server or the rebuild watcher. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [appConfig] }),
    EventEmitterModule.forRoot(),
    BackupImportModule,
    CoversModule,
    MetadataModule,
  ],
})
export class DemoModule {}
