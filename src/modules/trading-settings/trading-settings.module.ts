import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradingSettingsEntity } from '../../database/entities/trading-settings.entity';
import { TradingSettingsService } from './trading-settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([TradingSettingsEntity])],
  providers: [TradingSettingsService],
  exports: [TradingSettingsService],
})
export class TradingSettingsModule {}
