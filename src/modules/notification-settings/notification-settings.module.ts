import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationSettingsEntity } from '../../database/entities/notification-settings.entity';
import { NotificationSettingsService } from './notification-settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationSettingsEntity])],
  providers: [NotificationSettingsService],
  exports: [NotificationSettingsService],
})
export class NotificationSettingsModule {}
