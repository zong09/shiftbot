import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { TradingMode } from '../trading-settings/trading-settings.service';
import { NotificationChannel } from '../notification-settings/notification-settings.service';

@Injectable()
export class ParseModePipe implements PipeTransform<string, TradingMode> {
  transform(value: string): TradingMode {
    if (value !== 'live' && value !== 'sandbox') {
      throw new BadRequestException(`mode must be 'live' or 'sandbox', got '${value}'`);
    }
    return value;
  }
}

@Injectable()
export class ParseChannelPipe implements PipeTransform<string, NotificationChannel> {
  transform(value: string): NotificationChannel {
    if (value !== 'line' && value !== 'telegram') {
      throw new BadRequestException(`channel must be 'line' or 'telegram', got '${value}'`);
    }
    return value;
  }
}
