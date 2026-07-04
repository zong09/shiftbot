import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { TradingMode } from '../trading-settings/trading-settings.service';

@Injectable()
export class ParseModePipe implements PipeTransform<string, TradingMode> {
  transform(value: string): TradingMode {
    if (value !== 'live' && value !== 'sandbox') {
      throw new BadRequestException(`mode must be 'live' or 'sandbox', got '${value}'`);
    }
    return value;
  }
}
