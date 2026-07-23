export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export enum CDCZone {
  NONE = 0,
  STRONG_BULL = 1,   // Lime:       close > EMA_fast > EMA_slow, both EMAs rising
  BULL = 2,          // Green:      close > EMA_fast > EMA_slow, one EMA falling
  WEAK_BULL = 3,     // Olive:      close < EMA_fast > EMA_slow, EMA_fast rising
  CAUTION_BULL = 4,  // Dark Green: close < EMA_fast > EMA_slow, EMA_fast falling
  WEAK_BEAR = 5,     // Orange:     close > EMA_fast < EMA_slow, EMA_fast rising
  BEAR = 6,          // Red-Orange: close > EMA_fast < EMA_slow, EMA_fast falling
  STRONG_BEAR_WEAK = 7, // Red:    close < EMA_fast < EMA_slow, EMA_fast rising
  STRONG_BEAR = 8,   // Dark Red:  close < EMA_fast < EMA_slow, both EMAs falling
}

export interface CDCResult {
  zone: CDCZone;
  emaFast: number;
  emaSlow: number;
  close: number;
  isBullish: boolean;  // zone 1-4
  isBearish: boolean;  // zone 5-8
  signal: 'BUY' | 'SELL' | 'HOLD';
  zoneName: string;
  zoneColor: string;
}

export enum SignalType {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD',
}

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  openTime: Date;
  closeTime?: Date;
  closedPnl?: number;
  status: 'open' | 'closing' | 'closed';
  mode: 'live' | 'sandbox';
  slOrderId?: string | null;
  tpOrderId?: string | null;
}

export interface TradeLog {
  id: string;
  timestamp: Date;
  symbol: string;
  action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_LONG' | 'CLOSE_SHORT' | 'SL_HIT' | 'TP_HIT';
  price: number;
  quantity: number;
  pnl?: number;
  zone: CDCZone;
  signal: string;
  orderId?: string;
  mode: 'live' | 'sandbox';
}
