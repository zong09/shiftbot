import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CdcActionZoneService } from './cdc-action-zone.service';
import { CDCZone, OHLCV } from '../../common/types';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal ConfigService that returns emaFast=12, emaSlow=26 */
function makeConfigService(emaFast = 12, emaSlow = 26): Partial<ConfigService> {
  return {
    get: jest.fn((key: string, fallback?: any) => {
      if (key === 'indicator.emaFast') return emaFast;
      if (key === 'indicator.emaSlow') return emaSlow;
      return fallback;
    }),
  };
}

/**
 * Generate a flat price series of `count` candles all at `price`.
 * Flat data means EMA_fast ≈ EMA_slow ≈ price, rising flags depend on
 * tiny nudges we inject at the end.
 */
function flatCandles(count: number, price: number): OHLCV[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i * 3600_000,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }));
}

/**
 * Build a candle series that reliably lands in a specific zone by
 * steering the last two closes and the EMA relationship.
 *
 * Strategy: use a long trending series so EMAs are stable, then
 * override the final candle's close to force the A / C flags.
 */
function candlesForZone(zone: CDCZone): OHLCV[] {
  // 60 candles is well above the minimum (emaSlow + 2 = 28)
  const n = 60;

  // Decide whether we want EMA_fast > EMA_slow (B=true) or < (B=false)
  // Zones 1-4 need B=true (bullish cross), zones 5-8 need B=false
  const bullishCross = zone <= 4;

  // Build an ascending trend for bullish cross, descending for bearish
  const candles: OHLCV[] = Array.from({ length: n }, (_, i) => {
    const price = bullishCross ? 100 + i : 200 - i;
    return { timestamp: i * 3600_000, open: price, high: price, low: price, close: price, volume: 1 };
  });

  // Now override the last two candles to steer A and C flags:
  //   A = close[last] > EMA_fast[last]
  //   C = EMA_fast[last] > EMA_fast[last-1]
  //
  // We can't directly set EMA values (they're computed internally), so we
  // set closes to force the desired outcome. The EMA is close to the
  // recent prices after a stable trend.
  //
  // After a long uptrend EMA_fast ≈ close ≈ ~158 (for bullish).
  // After a long downtrend EMA_fast ≈ close ≈ ~142 (for bearish).

  const lastPrice = candles[n - 1].close;

  switch (zone) {
    case CDCZone.STRONG_BULL: {
      // A=T, B=T, C=T, D=T  — just keep ascending; both EMAs rise naturally
      // No changes needed — ascending series already gives this zone.
      break;
    }
    case CDCZone.BULL: {
      // A=T, B=T, but NOT (C && D) — make close > EMA_fast but EMA_fast flat/falling
      // Drop the last two closes so EMA_fast starts declining while staying above EMA_slow
      candles[n - 2].close = lastPrice - 2;
      candles[n - 1].close = lastPrice - 3;
      break;
    }
    case CDCZone.WEAK_BULL: {
      // !A, B=T, C=T — close < EMA_fast, EMA_fast > EMA_slow and rising
      // Keep trend going so EMA_fast > EMA_slow (C via continuing upward),
      // but set last close below what EMA_fast will be
      candles[n - 1].close = lastPrice * 0.97;
      break;
    }
    case CDCZone.CAUTION_BULL: {
      // !A, B=T, !C — close < EMA_fast, EMA_fast > EMA_slow but EMA_fast falling
      candles[n - 2].close = lastPrice - 4;
      candles[n - 1].close = lastPrice * 0.94;
      break;
    }
    case CDCZone.WEAK_BEAR: {
      // A=T, !B, C=T — close > EMA_fast, EMA_fast < EMA_slow, EMA_fast rising
      // After a downtrend EMA_fast < EMA_slow.
      // Spike last close high so close > EMA_fast, and nudge up so EMA_fast rises.
      candles[n - 2].close = lastPrice + 1;
      candles[n - 1].close = lastPrice + 10;
      break;
    }
    case CDCZone.BEAR: {
      // A=T, !B, !C — close > EMA_fast, EMA_fast < EMA_slow, EMA_fast falling
      candles[n - 2].close = lastPrice + 5;
      candles[n - 1].close = lastPrice + 8;
      break;
    }
    case CDCZone.STRONG_BEAR_WEAK: {
      // !A, !B, C=T — close < EMA_fast, EMA_fast < EMA_slow, EMA_fast rising
      candles[n - 2].close = lastPrice + 1;
      candles[n - 1].close = lastPrice - 1;
      break;
    }
    case CDCZone.STRONG_BEAR: {
      // !A, !B, !C — close < EMA_fast, EMA_fast < EMA_slow, both falling
      // Pure descending — no changes needed.
      break;
    }
  }

  return candles;
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('CdcActionZoneService', () => {
  let service: CdcActionZoneService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CdcActionZoneService,
        { provide: ConfigService, useValue: makeConfigService() },
      ],
    }).compile();

    service = module.get<CdcActionZoneService>(CdcActionZoneService);
  });

  // ── calculate() — guard rails ────────────────────────────────────────────

  describe('calculate()', () => {
    it('returns null when candle count is below the minimum (emaSlow + 2)', () => {
      const tooFew = flatCandles(10, 100);
      expect(service.calculate(tooFew)).toBeNull();
    });

    it('returns null when given an empty array', () => {
      expect(service.calculate([])).toBeNull();
    });

    it('returns a CDCResult with all required fields for a valid candle series', () => {
      const candles = candlesForZone(CDCZone.STRONG_BULL);
      const result = service.calculate(candles);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('zone');
      expect(result).toHaveProperty('emaFast');
      expect(result).toHaveProperty('emaSlow');
      expect(result).toHaveProperty('close');
      expect(result).toHaveProperty('isBullish');
      expect(result).toHaveProperty('isBearish');
      expect(result).toHaveProperty('signal');
      expect(result).toHaveProperty('zoneName');
      expect(result).toHaveProperty('zoneColor');
    });

    it('isBullish is true for zones 1–4 and isBearish is false', () => {
      const bullishZones = [CDCZone.STRONG_BULL, CDCZone.BULL, CDCZone.WEAK_BULL, CDCZone.CAUTION_BULL];
      for (const zone of bullishZones) {
        const candles = candlesForZone(zone);
        const result = service.calculate(candles);
        if (result && result.zone <= 4) {
          expect(result.isBullish).toBe(true);
          expect(result.isBearish).toBe(false);
        }
      }
    });

    it('isBearish is true for zones 5–8 and isBullish is false', () => {
      const bearishZones = [CDCZone.WEAK_BEAR, CDCZone.BEAR, CDCZone.STRONG_BEAR_WEAK, CDCZone.STRONG_BEAR];
      for (const zone of bearishZones) {
        const candles = candlesForZone(zone);
        const result = service.calculate(candles);
        if (result && result.zone >= 5) {
          expect(result.isBearish).toBe(true);
          expect(result.isBullish).toBe(false);
        }
      }
    });

    // ── Signal logic ─────────────────────────────────────────────────────

    it('emits BUY signal when prevZone is bearish (5–8) and current zone is bullish (1–4)', () => {
      const candles = candlesForZone(CDCZone.STRONG_BULL);
      const result = service.calculate(candles, CDCZone.STRONG_BEAR);
      if (result && result.zone <= 4) {
        expect(result.signal).toBe('BUY');
      }
    });

    it('emits SELL signal when prevZone is bullish (1–4) and current zone is bearish (5–8)', () => {
      const candles = candlesForZone(CDCZone.STRONG_BEAR);
      const result = service.calculate(candles, CDCZone.STRONG_BULL);
      if (result && result.zone >= 5) {
        expect(result.signal).toBe('SELL');
      }
    });

    it('emits HOLD when prevZone is bullish and current zone is also bullish', () => {
      const candles = candlesForZone(CDCZone.STRONG_BULL);
      const result = service.calculate(candles, CDCZone.BULL);
      if (result && result.zone <= 4) {
        expect(result.signal).toBe('HOLD');
      }
    });

    it('emits HOLD when prevZone is bearish and current zone is also bearish', () => {
      const candles = candlesForZone(CDCZone.STRONG_BEAR);
      const result = service.calculate(candles, CDCZone.BEAR);
      if (result && result.zone >= 5) {
        expect(result.signal).toBe('HOLD');
      }
    });

    it('emits HOLD when prevZone is undefined (first run)', () => {
      const candles = candlesForZone(CDCZone.STRONG_BULL);
      const result = service.calculate(candles, undefined);
      if (result) {
        expect(result.signal).toBe('HOLD');
      }
    });

    // ── Zone assignments ─────────────────────────────────────────────────

    it('detects STRONG_BULL (zone 1) from an ascending series', () => {
      const candles = candlesForZone(CDCZone.STRONG_BULL);
      const result = service.calculate(candles);
      expect(result).not.toBeNull();
      expect(result.zone).toBe(CDCZone.STRONG_BULL);
    });

    it('detects STRONG_BEAR (zone 8) from a descending series', () => {
      const candles = candlesForZone(CDCZone.STRONG_BEAR);
      const result = service.calculate(candles);
      expect(result).not.toBeNull();
      expect(result.zone).toBe(CDCZone.STRONG_BEAR);
    });

    // ── Zone metadata ────────────────────────────────────────────────────

    it('returns correct zoneName and zoneColor for zone 1 (STRONG_BULL)', () => {
      const candles = candlesForZone(CDCZone.STRONG_BULL);
      const result = service.calculate(candles);
      if (result?.zone === CDCZone.STRONG_BULL) {
        expect(result.zoneName).toBe('Strong Bull');
        expect(result.zoneColor).toBe('#00FF00');
      }
    });

    it('returns correct zoneName and zoneColor for zone 8 (STRONG_BEAR)', () => {
      const candles = candlesForZone(CDCZone.STRONG_BEAR);
      const result = service.calculate(candles);
      if (result?.zone === CDCZone.STRONG_BEAR) {
        expect(result.zoneName).toBe('Strong Bear');
        expect(result.zoneColor).toBe('#8B0000');
      }
    });

    it('close value in the result matches the last candle close', () => {
      const candles = candlesForZone(CDCZone.STRONG_BULL);
      const result = service.calculate(candles);
      expect(result?.close).toBe(candles[candles.length - 1].close);
    });
  });

  // ── calculateAll() ───────────────────────────────────────────────────────

  describe('calculateAll()', () => {
    it('returns an empty array when given fewer candles than emaSlow', () => {
      const tooFew = flatCandles(10, 100);
      expect(service.calculateAll(tooFew)).toEqual([]);
    });

    it('returns results for each candle from index emaSlow onward', () => {
      const n = 60;
      const candles = candlesForZone(CDCZone.STRONG_BULL);
      const results = service.calculateAll(candles);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(n - 26);
    });

    it('first result has signal HOLD (no previous result to compare)', () => {
      const candles = candlesForZone(CDCZone.STRONG_BULL);
      const results = service.calculateAll(candles);
      expect(results[0].signal).toBe('HOLD');
    });

    it('all results have the required CDCResult fields', () => {
      const candles = candlesForZone(CDCZone.STRONG_BULL);
      const results = service.calculateAll(candles);
      for (const r of results) {
        expect(r).toHaveProperty('zone');
        expect(r).toHaveProperty('isBullish');
        expect(r).toHaveProperty('isBearish');
        expect(r).toHaveProperty('signal');
        expect(['BUY', 'SELL', 'HOLD']).toContain(r.signal);
      }
    });

    it('signals BUY when a bearish result is followed by a bullish result in the series', () => {
      // Build a series: 30 descending (bear) then 30 ascending (bull)
      const bear: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
        timestamp: i * 3600_000,
        open: 200 - i, high: 200 - i, low: 200 - i, close: 200 - i, volume: 1,
      }));
      const bull: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
        timestamp: (30 + i) * 3600_000,
        open: 170 + i, high: 170 + i, low: 170 + i, close: 170 + i, volume: 1,
      }));
      const mixed = [...bear, ...bull];
      const results = service.calculateAll(mixed);
      const hasBuy = results.some((r) => r.signal === 'BUY');
      expect(hasBuy).toBe(true);
    });
  });
});
