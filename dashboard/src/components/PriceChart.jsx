import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { useTheme } from '../ThemeContext.jsx';
import { zoneByNumber } from '../theme.js';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

// Fixed Asia/Bangkok offset (UTC+7, no DST) — keeps chart times aligned with the
// tables, which format explicitly in Asia/Bangkok regardless of the browser TZ
const TZ_OFFSET_SEC = 7 * 3600;

// Returns null when the event falls farther than one bar from any loaded candle,
// so off-range positions/trades don't glue a misleading marker to the edge candle
function snapToNearestCandle(openTimeMs, series) {
  if (!series.length) return null;
  const targetSec = Math.floor(new Date(openTimeMs).getTime() / 1000) + TZ_OFFSET_SEC;
  const nearest = series.reduce((a, candle) =>
    Math.abs(candle.time - targetSec) < Math.abs(a.time - targetSec) ? candle : a
  );
  const barSec = series.length > 1 ? series[1].time - series[0].time : 3600;
  return Math.abs(nearest.time - targetSec) <= barSec ? nearest : null;
}

function formatPrice(v) {
  if (!v && v !== 0) return '—';
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function formatVolume(v) {
  if (!v && v !== 0) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + 'K';
  return Number(v).toFixed(2);
}

export default function PriceChart({
  candles = [],
  indicators = [],
  positions = [],
  trades = [],
  symbol,
  chartTimeframe = '1h',
  onTimeframeChange,
}) {
  const { colors } = useTheme();
  const containerRef  = useRef(null);
  const chartRef      = useRef(null);
  const candleRef     = useRef(null);
  const volumeRef     = useRef(null);
  const ema12Ref      = useRef(null);
  const ema26Ref      = useRef(null);
  const priceLineRefs = useRef([]);
  const seriesData    = useRef([]);
  const colorsRef     = useRef(colors);
  const dataKeyRef    = useRef('');
  colorsRef.current = colors;

  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const c = colorsRef.current;

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 460,
      layout: {
        background: { color: c.surface },
        textColor:  c.textSecondary,
        fontFamily: "'Inter Variable', 'Segoe UI', sans-serif",
        fontSize:   11,
      },
      grid: {
        vertLines: { color: c.chart.grid },
        horzLines: { color: c.chart.grid },
      },
      crosshair: {
        mode:     CrosshairMode.Normal,
        vertLine: { color: c.chart.crosshair, labelBackgroundColor: c.chart.crosshairLabel },
        horzLine: { color: c.chart.crosshair, labelBackgroundColor: c.chart.crosshairLabel },
      },
      rightPriceScale: {
        borderColor:  c.chart.grid,
        scaleMargins: { top: 0.05, bottom: 0.2 },
      },
      timeScale: {
        borderColor:    c.chart.grid,
        timeVisible:    true,
        secondsVisible: false,
        barSpacing:     8,
      },
      localization: {
        timeFormatter: (timestamp) => {
          return new Date(timestamp * 1000).toLocaleString('th-TH', {
            timeZone: 'UTC',
          });
        },
      },
    });

    candleRef.current = chart.addCandlestickSeries({
      upColor:          c.bull,
      downColor:        c.bear,
      borderUpColor:    c.bull,
      borderDownColor:  c.bear,
      wickUpColor:      c.bull,
      wickDownColor:    c.bear,
      priceLineVisible: true,
      priceLineColor:   c.chart.crosshair,
    });

    volumeRef.current = chart.addHistogramSeries({
      priceFormat:  { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    ema12Ref.current = chart.addLineSeries({
      color:            c.chart.emaFast,
      lineWidth:        1,
      priceLineVisible: false,
      lastValueVisible: false,
      title:            'MA12',
    });

    ema26Ref.current = chart.addLineSeries({
      color:            c.chart.emaSlow,
      lineWidth:        1,
      priceLineVisible: false,
      lastValueVisible: false,
      title:            'MA26',
    });

    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData) { setHover(null); return; }
      const candle = param.seriesData.get(candleRef.current);
      const vol    = param.seriesData.get(volumeRef.current);
      if (candle) {
        setHover({
          open:   candle.open,
          high:   candle.high,
          low:    candle.low,
          close:  candle.close,
          volume: vol?.value,
          isUp:   candle.close >= candle.open,
        });
      } else {
        setHover(null);
      }
    });

    chartRef.current = chart;

    const ro = new ResizeObserver(entries => {
      chart.applyOptions({ width: entries[0].contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      candleRef.current = null;
      volumeRef.current = null;
      ema12Ref.current  = null;
      ema26Ref.current  = null;
    };
  }, []);

  // re-skin the existing chart on theme change (applyOptions preserves zoom/pan)
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      layout: {
        background: { color: colors.surface },
        textColor:  colors.textSecondary,
      },
      grid: {
        vertLines: { color: colors.chart.grid },
        horzLines: { color: colors.chart.grid },
      },
      crosshair: {
        vertLine: { color: colors.chart.crosshair, labelBackgroundColor: colors.chart.crosshairLabel },
        horzLine: { color: colors.chart.crosshair, labelBackgroundColor: colors.chart.crosshairLabel },
      },
      rightPriceScale: { borderColor: colors.chart.grid },
      timeScale:       { borderColor: colors.chart.grid },
    });
    candleRef.current?.applyOptions({
      upColor:         colors.bull,
      downColor:       colors.bear,
      borderUpColor:   colors.bull,
      borderDownColor: colors.bear,
      wickUpColor:     colors.bull,
      wickDownColor:   colors.bear,
      priceLineColor:  colors.chart.crosshair,
    });
    ema12Ref.current?.applyOptions({ color: colors.chart.emaFast });
    ema26Ref.current?.applyOptions({ color: colors.chart.emaSlow });
  }, [colors]);

  useEffect(() => {
    if (!candleRef.current || !candles.length) return;

    const offsetSec = TZ_OFFSET_SEC;
    const indMap = new Map(indicators.map(d => [Math.floor(d.timestamp / 1000) + offsetSec, d]));

    const series = candles.map(c => {
      const timeSec = Math.floor(c.timestamp / 1000) + offsetSec;
      const ind     = indMap.get(timeSec);
      const isUp    = c.close >= c.open;
      if (ind) {
        const zc = zoneByNumber(ind.zone);
        if (zc) {
          const col = isUp ? zc.up : zc.down;
          return {
            time: timeSec, open: c.open, high: c.high, low: c.low, close: c.close,
            color: col, borderColor: col, wickColor: col,
          };
        }
      }
      return { time: timeSec, open: c.open, high: c.high, low: c.low, close: c.close };
    });

    seriesData.current = series;
    candleRef.current.setData(series);

    if (volumeRef.current) {
      volumeRef.current.setData(candles.map(c => ({
        time:  Math.floor(c.timestamp / 1000) + offsetSec,
        value: c.volume ?? 0,
        color: c.close >= c.open ? colors.chart.volBull : colors.chart.volBear,
      })));
    }

    const cdcMarkers = indicators
      .filter(d => d.signal === 'BUY' || d.signal === 'SELL')
      .map(d => ({
        time:     Math.floor(d.timestamp / 1000) + offsetSec,
        position: d.signal === 'BUY' ? 'belowBar' : 'aboveBar',
        color:    d.signal === 'BUY' ? colors.bull : colors.bear,
        shape:    d.signal === 'BUY' ? 'arrowUp'   : 'arrowDown',
        text:     d.signal,
        size:     1,
      }));

    const posMarkers = positions
      .filter(p => p.openTime)
      .map(p => {
        const nearest = snapToNearestCandle(p.openTime, series);
        if (!nearest) return null;
        return {
          time:     nearest.time,
          position: p.side === 'long' ? 'belowBar' : 'aboveBar',
          color:    p.side === 'long' ? colors.bull : colors.bear,
          shape:    p.side === 'long' ? 'arrowUp'   : 'arrowDown',
          text:     `${p.side === 'long' ? 'L' : 'S'} @${Number(p.entryPrice).toLocaleString()}`,
          size:     2,
        };
      })
      .filter(Boolean);

    const tradeMarkers = trades
      .filter(t => t.timestamp && (t.action.includes('LONG') || t.action.includes('SHORT') || t.action.includes('HIT')))
      .map(t => {
        const nearest = snapToNearestCandle(t.timestamp, series);
        if (!nearest) return null;
        const isLongOpen = t.action === 'OPEN_LONG';
        const isLongClose = t.action === 'CLOSE_LONG' || t.action === 'SL_HIT' || t.action === 'TP_HIT';
        const isShortOpen = t.action === 'OPEN_SHORT';
        const isShortClose = t.action === 'CLOSE_SHORT';
        
        let position = 'belowBar', color = colors.bull, shape = 'circle', text = '';
        if (isLongOpen) {
           position = 'belowBar'; color = colors.bull; shape = 'circle'; text = `En L @${Number(t.price).toLocaleString()}`;
        } else if (isLongClose) {
           position = 'aboveBar'; color = colors.bear; shape = 'square'; text = `Ex L @${Number(t.price).toLocaleString()}`;
        } else if (isShortOpen) {
           position = 'aboveBar'; color = colors.bear; shape = 'circle'; text = `En S @${Number(t.price).toLocaleString()}`;
        } else if (isShortClose) {
           position = 'belowBar'; color = colors.bull; shape = 'square'; text = `Ex S @${Number(t.price).toLocaleString()}`;
        }

        return {
          time:     nearest.time,
          position,
          color,
          shape,
          text,
          size:     1,
        };
      })
      .filter(Boolean);

    candleRef.current.setMarkers([...posMarkers, ...tradeMarkers].sort((a, b) => a.time - b.time));

    priceLineRefs.current.forEach(pl => { try { candleRef.current.removePriceLine(pl); } catch (_) {} });
    priceLineRefs.current = [];
    // SL & TP removed
    // only fit when the underlying data changed — a theme-only re-run must not reset zoom/pan
    const dataKey = `${candles.length}:${candles[0]?.timestamp}:${candles[candles.length - 1]?.timestamp}`;
    if (dataKeyRef.current !== dataKey) {
      dataKeyRef.current = dataKey;
      chartRef.current.timeScale().fitContent();
    }
  }, [candles, indicators, positions, trades, colors]);

  useEffect(() => {
    if (!ema12Ref.current || !ema26Ref.current || !indicators.length) return;
    const offsetSec = TZ_OFFSET_SEC;
    ema12Ref.current.setData(indicators.map(d => ({ time: Math.floor(d.timestamp / 1000) + offsetSec, value: d.emaFast })));
    ema26Ref.current.setData(indicators.map(d => ({ time: Math.floor(d.timestamp / 1000) + offsetSec, value: d.emaSlow })));
  }, [indicators]);

  const lastInd     = indicators[indicators.length - 1];
  const lastCandle  = candles[candles.length - 1];
  const displayData = hover ?? (lastCandle ? {
    open:   lastCandle.open,
    high:   lastCandle.high,
    low:    lastCandle.low,
    close:  lastCandle.close,
    volume: lastCandle.volume,
    isUp:   lastCandle.close >= lastCandle.open,
  } : null);
  const ohlcClass  = displayData?.isUp ? 'text-bull' : 'text-bear';
  const zoneColor  = zoneByNumber(lastInd?.zone)?.color;

  return (
    <div className="bg-surface border border-border rounded-lg mb-4 overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center h-9 px-3 border-b border-border">
        {symbol && (
          <span className="text-[13px] font-semibold pr-3 mr-1 border-r border-border">
            {symbol.replace(':USDT', '')}
          </span>
        )}
        <div className={`flex ${symbol ? 'pl-2' : ''}`}>
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => onTimeframeChange?.(tf)}
              className={`h-9 px-2.5 text-xs cursor-pointer border-b-2 transition-colors duration-150 ${
                chartTimeframe === tf
                  ? 'font-bold text-accent border-accent'
                  : 'font-normal text-secondary border-transparent hover:text-primary'
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {lastInd && (
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded border"
            style={zoneColor
              ? { color: zoneColor, background: zoneColor + '22', borderColor: zoneColor + '55' }
              : undefined}
          >
            Zone {lastInd.zone}
          </span>
        )}
      </div>

      {/* OHLCV info */}
      <div className="flex flex-wrap items-center gap-2.5 px-3 py-1 min-h-6 text-[11px] tabular-nums border-b border-border">
        {displayData ? (
          <>
            <span className="text-secondary">O&nbsp;<b className={ohlcClass}>{formatPrice(displayData.open)}</b></span>
            <span className="text-secondary">H&nbsp;<b className={ohlcClass}>{formatPrice(displayData.high)}</b></span>
            <span className="text-secondary">L&nbsp;<b className={ohlcClass}>{formatPrice(displayData.low)}</b></span>
            <span className="text-secondary">C&nbsp;<b className={ohlcClass}>{formatPrice(displayData.close)}</b></span>
            {displayData.volume != null && (
              <span className="text-secondary">Vol&nbsp;<b className="text-primary">{formatVolume(displayData.volume)}</b></span>
            )}
            {lastInd && (
              <>
                <span style={{ color: colors.chart.emaFast }}>MA12&nbsp;{formatPrice(lastInd.emaFast)}</span>
                <span style={{ color: colors.chart.emaSlow }}>MA26&nbsp;{formatPrice(lastInd.emaSlow)}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-secondary/60">—</span>
        )}
      </div>

      {/* Chart canvas */}
      <div className="relative">
        {candles.length === 0 && (
          <div className="absolute inset-0 z-10 flex h-[460px] items-center justify-center text-xs text-secondary/70">
            Loading candles…
          </div>
        )}
        <div ref={containerRef} className={`w-full ${candles.length === 0 ? 'invisible' : 'visible'}`} />
      </div>

      {/* Open positions */}
      {positions.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2">
          {positions.map((p, i) => (
            <div key={p.id ?? i} className="flex items-center gap-5 text-[11px] tabular-nums">
              <span className={`min-w-11 text-xs font-bold ${p.side === 'long' ? 'text-bull' : 'text-bear'}`}>
                {p.side === 'long' ? 'LONG' : 'SHORT'}
              </span>
              <span className="text-secondary">Entry&nbsp;<b className="text-primary">{formatPrice(p.entryPrice)}</b></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
