import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoversModule } from '../covers/covers.module';
import { LibraryModule } from '../library/library.module';
import { StatusController } from './status.controller';

@Module({
  imports: [AuthModule, CoversModule, LibraryModule],
  controllers: [StatusController],
})
export class StatusModule {}
