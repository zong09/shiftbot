import { Module } from '@nestjs/common';
import { CdcActionZoneService } from './cdc-action-zone.service';

@Module({
  providers: [CdcActionZoneService],
  exports: [CdcActionZoneService],
})
export class IndicatorsModule {}
