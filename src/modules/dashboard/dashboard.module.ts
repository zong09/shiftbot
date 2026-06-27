import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { TradingModule } from '../trading/trading.module';
import { StrategyModule } from '../strategy/strategy.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { TradingSettingsModule } from '../trading-settings/trading-settings.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TradingModule, StrategyModule, MarketDataModule, IndicatorsModule, TradingSettingsModule, AuthModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
