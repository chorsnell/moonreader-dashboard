import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BackupImportModule } from '../backup-import/backup-import.module';
import { appConfig } from '../config/app.config';
import { CoversModule } from '../covers/covers.module';
import { MediaCoreModule } from '../media/media-core.module';
import { MetadataModule } from '../metadata/metadata.module';

/** Just the imports (books and other media) and covers, without the web server or the rebuild watcher. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [appConfig] }),
    EventEmitterModule.forRoot(),
    BackupImportModule,
    CoversModule,
    MediaCoreModule,
    MetadataModule,
  ],
})
export class DemoModule {}
