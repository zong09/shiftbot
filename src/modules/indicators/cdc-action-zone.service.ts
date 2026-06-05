import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CDCZone, CDCResult, OHLCV } from '../../common/types';

/**
 * CDC Action Zone V3 2020 Indicator
 *
 * อ้างอิง logic จาก TradingView script "CDC Action Zone V3 2020" โดย pholio
 *
 * 8 Zones กำหนดจาก 3 เงื่อนไข:
 *   A = close > EMA_fast
 *   B = EMA_fast > EMA_slow
 *   C = EMA_fast กำลังขึ้น (rising)
 *   D = EMA_slow กำลังขึ้น (rising)
 *
 * Zone 1 (Lime  / Strong Bull):  A  B  C  D
 * Zone 2 (Green / Bull):         A  B  C !D  OR  A  B !C  D  OR  A  B !C !D
 * Zone 3 (Olive / Weak Bull):   !A  B  C  *
 * Zone 4 (Dark Green / Caution): !A  B !C  *
 * Zone 5 (Orange / Weak Bear):   A !B  C  *
 * Zone 6 (Red-Org / Bear):       A !B !C  *
 * Zone 7 (Red / Strong Bear):   !A !B  C  *
 * Zone 8 (DkRed / Strong Bear): !A !B !C  * (ทั้ง EMA ลง)
 */
@Injectable()
export class CdcActionZoneService {
  private readonly logger = new Logger(CdcActionZoneService.name);
  private emaFastPeriod: number;
  private emaSlowPeriod: number;

  constructor(private configService: ConfigService) {
    this.emaFastPeriod = this.configService.get<number>('indicator.emaFast', 12);
    this.emaSlowPeriod = this.configService.get<number>('indicator.emaSlow', 26);
  }

  /**
   * คำนวณ EMA (Exponential Moving Average)
   */
  private calculateEMA(values: number[], period: number): number[] {
    if (values.length < period) return [];
    const k = 2 / (period + 1);
    const ema: number[] = new Array(values.length).fill(null);

    // seed ด้วย SMA ของ period แรก
    let seed = 0;
    for (let i = 0; i < period; i++) seed += values[i];
    ema[period - 1] = seed / period;

    for (let i = period; i < values.length; i++) {
      ema[i] = values[i] * k + ema[i - 1] * (1 - k);
    }
    return ema;
  }

  /**
   * แปลง zone number เป็นชื่อและสี
   */
  private getZoneInfo(zone: CDCZone): { name: string; color: string } {
    const info = {
      [CDCZone.STRONG_BULL]:      { name: 'Strong Bull',   color: '#00FF00' },
      [CDCZone.BULL]:             { name: 'Bull',           color: '#008000' },
      [CDCZone.WEAK_BULL]:        { name: 'Weak Bull',      color: '#808000' },
      [CDCZone.CAUTION_BULL]:     { name: 'Caution Bull',   color: '#006400' },
      [CDCZone.WEAK_BEAR]:        { name: 'Weak Bear',      color: '#FFA500' },
      [CDCZone.BEAR]:             { name: 'Bear',           color: '#FF4500' },
      [CDCZone.STRONG_BEAR_WEAK]: { name: 'Strong Bear (w)',color: '#FF0000' },
      [CDCZone.STRONG_BEAR]:      { name: 'Strong Bear',    color: '#8B0000' },
    };
    return info[zone] ?? { name: 'Unknown', color: '#888888' };
  }

  /**
   * กำหนด Zone จากเงื่อนไข 4 ตัว
   */
  private determineZone(
    close: number,
    emaFast: number,
    emaSlow: number,
    emaFastPrev: number,
    emaSlowPrev: number,
  ): CDCZone {
    const A = close > emaFast;         // close เหนือ EMA fast
    const B = emaFast > emaSlow;       // EMA fast เหนือ EMA slow (bullish cross)
    const C = emaFast > emaFastPrev;   // EMA fast กำลังขึ้น
    const D = emaSlow > emaSlowPrev;   // EMA slow กำลังขึ้น

    if (A && B && C && D) return CDCZone.STRONG_BULL;
    if (A && B)           return CDCZone.BULL;           // C หรือ D อย่างน้อยหนึ่งตัวไม่เป็น true
    if (!A && B && C)     return CDCZone.WEAK_BULL;
    if (!A && B && !C)    return CDCZone.CAUTION_BULL;
    if (A && !B && C)     return CDCZone.WEAK_BEAR;
    if (A && !B && !C)    return CDCZone.BEAR;
    if (!A && !B && C)    return CDCZone.STRONG_BEAR_WEAK;
    return CDCZone.STRONG_BEAR;
  }

  /**
   * คำนวณ CDC Action Zone V3 สำหรับ candle ล่าสุด
   * @param candles - OHLCV data (เรียงจากเก่า → ใหม่)
   * @param prevZone - zone ของ candle ก่อนหน้า (สำหรับหา signal)
   */
  calculate(candles: OHLCV[], prevZone?: CDCZone): CDCResult | null {
    const minCandles = this.emaSlowPeriod + 2;
    if (candles.length < minCandles) {
      this.logger.warn(`ต้องการ candle อย่างน้อย ${minCandles} แท่ง`);
      return null;
    }

    const closes = candles.map((c) => c.close);
    const emaFastArr = this.calculateEMA(closes, this.emaFastPeriod);
    const emaSlowArr = this.calculateEMA(closes, this.emaSlowPeriod);

    const last = candles.length - 1;
    const emaFast     = emaFastArr[last];
    const emaSlow     = emaSlowArr[last];
    const emaFastPrev = emaFastArr[last - 1];
    const emaSlowPrev = emaSlowArr[last - 1];
    const close       = closes[last];

    if (!emaFast || !emaSlow || !emaFastPrev || !emaSlowPrev) return null;

    const zone = this.determineZone(close, emaFast, emaSlow, emaFastPrev, emaSlowPrev);
    const isBullish = zone <= 4;
    const isBearish = zone >= 5;
    const { name: zoneName, color: zoneColor } = this.getZoneInfo(zone);

    // Signal: เปลี่ยน zone จาก bearish → bullish = BUY, bullish → bearish = SELL
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (prevZone !== undefined) {
      const wasBullish = prevZone <= 4;
      const wasBearish = prevZone >= 5;
      if (wasBearish && isBullish) signal = 'BUY';
      if (wasBullish && isBearish) signal = 'SELL';
    }

    this.logger.log(
      `CDC Zone: ${zoneName} (${zone}) | EMA${this.emaFastPeriod}=${emaFast.toFixed(2)} EMA${this.emaSlowPeriod}=${emaSlow.toFixed(2)} | Close=${close} | Signal=${signal}`,
    );

    return { zone, emaFast, emaSlow, close, isBullish, isBearish, signal, zoneName, zoneColor };
  }

  /**
   * คำนวณ CDC สำหรับทุก candle (สำหรับ backtest / history)
   */
  calculateAll(candles: OHLCV[]): CDCResult[] {
    const closes = candles.map((c) => c.close);
    const emaFastArr = this.calculateEMA(closes, this.emaFastPeriod);
    const emaSlowArr = this.calculateEMA(closes, this.emaSlowPeriod);
    const results: CDCResult[] = [];

    for (let i = this.emaSlowPeriod; i < candles.length; i++) {
      const emaFast     = emaFastArr[i];
      const emaSlow     = emaSlowArr[i];
      const emaFastPrev = emaFastArr[i - 1];
      const emaSlowPrev = emaSlowArr[i - 1];
      if (!emaFast || !emaSlow || !emaFastPrev || !emaSlowPrev) continue;

      const zone = this.determineZone(closes[i], emaFast, emaSlow, emaFastPrev, emaSlowPrev);
      const isBullish = zone <= 4;
      const isBearish = zone >= 5;
      const { name: zoneName, color: zoneColor } = this.getZoneInfo(zone);

      let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      if (results.length > 0) {
        const prev = results[results.length - 1];
        if (prev.isBearish && isBullish) signal = 'BUY';
        if (prev.isBullish && isBearish) signal = 'SELL';
      }

      results.push({ zone, emaFast, emaSlow, close: closes[i], isBullish, isBearish, signal, zoneName, zoneColor });
    }

    return results;
  }
}
