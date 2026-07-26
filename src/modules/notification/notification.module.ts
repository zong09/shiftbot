import { Module } from '@nestjs/common';
import { LineWebhookController } from './line-webhook.controller';
import { NotificationService } from './notification.service';
import { NotificationSettingsModule } from '../notification-settings/notification-settings.module';

@Module({
  imports: [NotificationSettingsModule],
  controllers: [LineWebhookController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
