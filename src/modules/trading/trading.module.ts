import { Module } from '@nestjs/common';
import { TradingService } from './trading.service';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [MarketDataModule],
  providers: [TradingService],
  exports: [TradingService],
})
export class TradingModule {}
