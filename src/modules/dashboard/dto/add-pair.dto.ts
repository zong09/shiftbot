import { IsString, Matches } from 'class-validator';
import { SYMBOL_PATTERN } from './update-settings.dto';

export class AddPairDto {
  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol must look like BTC/USDT:USDT' })
  symbol: string;
}
