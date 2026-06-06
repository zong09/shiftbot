import { Module } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { TradingModule } from '../trading/trading.module';
import { NotificationModule } from '../notification/notification.module';
import { TradingSettingsModule } from '../trading-settings/trading-settings.module';

@Module({
  imports: [MarketDataModule, IndicatorsModule, TradingModule, NotificationModule, TradingSettingsModule],
  providers: [StrategyService],
  exports: [StrategyService],
})
export class StrategyModule {}
