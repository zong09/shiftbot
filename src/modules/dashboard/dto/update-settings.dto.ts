import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const VALID_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export const SYMBOL_PATTERN = /^[A-Z0-9]+\/USDT:USDT$/;

export class UpdateSettingsDto {
  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol must look like BTC/USDT:USDT' })
  symbol: string;

  @IsOptional()
  @IsIn(VALID_TIMEFRAMES)
  timeframe?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  leverage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5)
  @Max(100000)
  orderSizeUsdt?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxPositions?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(50)
  stopLossPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(50)
  takeProfitPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(200)
  emaFast?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(200)
  emaSlow?: number;

  @IsOptional()
  @IsIn(['on', 'pause', 'off'])
  status?: string;
}
