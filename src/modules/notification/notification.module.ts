import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationSettingsModule } from '../notification-settings/notification-settings.module';

@Module({
  imports: [NotificationSettingsModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
