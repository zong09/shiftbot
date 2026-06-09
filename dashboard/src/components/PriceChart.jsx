import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

const UP_COLOR   = '#0ECB81';
const DOWN_COLOR = '#F6465D';
const BG_COLOR   = '#161A1E';
const GRID_COLOR = '#1E2329';
const TEXT_COLOR = '#848E9C';

const ZONE_COLORS = {
  1: { up: '#0ECB81', down: '#06a659' },
  2: { up: '#00b894', down: '#009174' },
  3: { up: '#26d9b0', down: '#1aaa87' },
  4: { up: '#2ecc71', down: '#27ae60' },
  5: { up: '#f39c12', down: '#d68910' },
  6: { up: '#e67e22', down: '#ca6f1e' },
  7: { up: '#F6465D', down: '#d63031' },
  8: { up: '#c0392b', down: '#a93226' },
};

function snapToNearestCandle(openTimeMs, series) {
  const targetSec = Math.floor(new Date(openTimeMs).getTime() / 1000);
  return series.reduce((nearest, candle) =>
    Math.abs(candle.time - targetSec) < Math.abs(nearest.time - targetSec) ? candle : nearest
  );
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
  symbol,
  chartTimeframe = '1h',
  onTimeframeChange,
}) {
  const containerRef  = useRef(null);
  const chartRef      = useRef(null);
  const candleRef     = useRef(null);
  const volumeRef     = useRef(null);
  const ema12Ref      = useRef(null);
  const ema26Ref      = useRef(null);
  const priceLineRefs = useRef([]);
  const seriesData    = useRef([]);

  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 460,
      layout: {
        background: { color: BG_COLOR },
        textColor:  TEXT_COLOR,
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        fontSize:   11,
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      crosshair: {
        mode:     CrosshairMode.Normal,
        vertLine: { color: '#4a5568', labelBackgroundColor: '#2d3748' },
        horzLine: { color: '#4a5568', labelBackgroundColor: '#2d3748' },
      },
      rightPriceScale: {
        borderColor:  GRID_COLOR,
        scaleMargins: { top: 0.05, bottom: 0.2 },
      },
      timeScale: {
        borderColor:    GRID_COLOR,
        timeVisible:    true,
        secondsVisible: false,
        barSpacing:     8,
      },
    });

    candleRef.current = chart.addCandlestickSeries({
      upColor:          UP_COLOR,
      downColor:        DOWN_COLOR,
      borderUpColor:    UP_COLOR,
      borderDownColor:  DOWN_COLOR,
      wickUpColor:      UP_COLOR,
      wickDownColor:    DOWN_COLOR,
      priceLineVisible: true,
      priceLineColor:   '#4a5568',
    });

    volumeRef.current = chart.addHistogramSeries({
      priceFormat:  { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    ema12Ref.current = chart.addLineSeries({
      color:            '#F5AC37',
      lineWidth:        1,
      priceLineVisible: false,
      lastValueVisible: false,
      title:            'MA12',
    });

    ema26Ref.current = chart.addLineSeries({
      color:            '#C084FC',
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

  useEffect(() => {
    if (!candleRef.current || !candles.length) return;

    const indMap = new Map(indicators.map(d => [Math.floor(d.timestamp / 1000), d]));

    const series = candles.map(c => {
      const timeSec = Math.floor(c.timestamp / 1000);
      const ind     = indMap.get(timeSec);
      const isUp    = c.close >= c.open;
      if (ind) {
        const zc = ZONE_COLORS[ind.zone];
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
        time:  Math.floor(c.timestamp / 1000),
        value: c.volume ?? 0,
        color: c.close >= c.open
          ? 'rgba(14,203,129,0.35)'
          : 'rgba(246,70,93,0.35)',
      })));
    }

    const cdcMarkers = indicators
      .filter(d => d.signal === 'BUY' || d.signal === 'SELL')
      .map(d => ({
        time:     Math.floor(d.timestamp / 1000),
        position: d.signal === 'BUY' ? 'belowBar' : 'aboveBar',
        color:    d.signal === 'BUY' ? UP_COLOR   : DOWN_COLOR,
        shape:    d.signal === 'BUY' ? 'arrowUp'  : 'arrowDown',
        text:     d.signal,
        size:     1,
      }));

    const posMarkers = positions
      .filter(p => p.openTime)
      .map(p => {
        const nearest = snapToNearestCandle(p.openTime, series);
        return {
          time:     nearest.time,
          position: p.side === 'long' ? 'belowBar' : 'aboveBar',
          color:    p.side === 'long' ? UP_COLOR   : DOWN_COLOR,
          shape:    p.side === 'long' ? 'arrowUp'  : 'arrowDown',
          text:     `${p.side === 'long' ? 'L' : 'S'} @${Number(p.entryPrice).toLocaleString()}`,
          size:     2,
        };
      });

    candleRef.current.setMarkers([...cdcMarkers, ...posMarkers].sort((a, b) => a.time - b.time));

    priceLineRefs.current.forEach(pl => { try { candleRef.current.removePriceLine(pl); } catch (_) {} });
    priceLineRefs.current = [];
    positions.forEach(p => {
      if (p.stopLoss) priceLineRefs.current.push(candleRef.current.createPriceLine({
        price: p.stopLoss, color: DOWN_COLOR, lineWidth: 1, lineStyle: 2, title: 'SL',
      }));
      if (p.takeProfit) priceLineRefs.current.push(candleRef.current.createPriceLine({
        price: p.takeProfit, color: UP_COLOR, lineWidth: 1, lineStyle: 2, title: 'TP',
      }));
    });

    chartRef.current.timeScale().fitContent();
  }, [candles, indicators, positions]);

  useEffect(() => {
    if (!ema12Ref.current || !ema26Ref.current || !indicators.length) return;
    ema12Ref.current.setData(indicators.map(d => ({ time: Math.floor(d.timestamp / 1000), value: d.emaFast })));
    ema26Ref.current.setData(indicators.map(d => ({ time: Math.floor(d.timestamp / 1000), value: d.emaSlow })));
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
  const ohlcColor = displayData?.isUp ? UP_COLOR : DOWN_COLOR;

  return (
    <div style={{ background: BG_COLOR, borderRadius: 4, marginBottom: 8, overflow: 'hidden' }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: `1px solid ${GRID_COLOR}`,
        padding: '0 12px', height: 36,
      }}>
        {symbol && (
          <span style={{
            fontSize: 13, fontWeight: 700, color: '#EAECEF',
            paddingRight: 12, marginRight: 4,
            borderRight: `1px solid ${GRID_COLOR}`,
          }}>
            {symbol.replace(':USDT', '')}
          </span>
        )}
        <div style={{ display: 'flex', paddingLeft: symbol ? 8 : 0 }}>
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => onTimeframeChange?.(tf)}
              style={{
                padding:      '0 10px',
                height:       36,
                border:       'none',
                cursor:       'pointer',
                fontSize:     12,
                fontWeight:   chartTimeframe === tf ? 700 : 400,
                background:   'transparent',
                color:        chartTimeframe === tf ? '#F0B90B' : TEXT_COLOR,
                borderBottom: chartTimeframe === tf ? '2px solid #F0B90B' : '2px solid transparent',
              }}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {lastInd && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 3,
            background: (lastInd.zoneColor ?? '#334155') + '33',
            color:      lastInd.zoneColor ?? '#94a3b8',
            border:     `1px solid ${(lastInd.zoneColor ?? '#334155')}55`,
          }}>
            Zone {lastInd.zone}
          </span>
        )}
      </div>

      {/* OHLCV info */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10,
        padding: '3px 12px',
        fontSize: 11,
        borderBottom: `1px solid ${GRID_COLOR}`,
        minHeight: 24,
      }}>
        {displayData ? (
          <>
            <span style={{ color: TEXT_COLOR }}>O&nbsp;<b style={{ color: ohlcColor }}>{formatPrice(displayData.open)}</b></span>
            <span style={{ color: TEXT_COLOR }}>H&nbsp;<b style={{ color: ohlcColor }}>{formatPrice(displayData.high)}</b></span>
            <span style={{ color: TEXT_COLOR }}>L&nbsp;<b style={{ color: ohlcColor }}>{formatPrice(displayData.low)}</b></span>
            <span style={{ color: TEXT_COLOR }}>C&nbsp;<b style={{ color: ohlcColor }}>{formatPrice(displayData.close)}</b></span>
            {displayData.volume != null && (
              <span style={{ color: TEXT_COLOR }}>Vol&nbsp;<b style={{ color: '#EAECEF' }}>{formatVolume(displayData.volume)}</b></span>
            )}
            {lastInd && (
              <>
                <span style={{ color: '#F5AC37' }}>MA12&nbsp;{formatPrice(lastInd.emaFast)}</span>
                <span style={{ color: '#C084FC' }}>MA26&nbsp;{formatPrice(lastInd.emaSlow)}</span>
              </>
            )}
          </>
        ) : (
          <span style={{ color: '#4a5568' }}>—</span>
        )}
      </div>

      {/* Chart canvas */}
      <div style={{ position: 'relative' }}>
        {candles.length === 0 && (
          <div style={{
            height: 460, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#4a5568', fontSize: 12, position: 'absolute', inset: 0, zIndex: 1,
          }}>
            Loading candles…
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', visibility: candles.length === 0 ? 'hidden' : 'visible' }} />
      </div>

      {/* Open positions */}
      {positions.length > 0 && (
        <div style={{ borderTop: `1px solid ${GRID_COLOR}`, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {positions.map((p, i) => (
            <div key={p.id ?? i} style={{ display: 'flex', gap: 20, fontSize: 11, alignItems: 'center' }}>
              <span style={{ color: p.side === 'long' ? UP_COLOR : DOWN_COLOR, fontWeight: 700, fontSize: 12, minWidth: 44 }}>
                {p.side === 'long' ? 'LONG' : 'SHORT'}
              </span>
              <span style={{ color: TEXT_COLOR }}>Entry&nbsp;<b style={{ color: '#EAECEF' }}>{formatPrice(p.entryPrice)}</b></span>
              <span style={{ color: TEXT_COLOR }}>SL&nbsp;<b style={{ color: DOWN_COLOR }}>{Number(p.stopLoss).toFixed(2)}</b></span>
              <span style={{ color: TEXT_COLOR }}>TP&nbsp;<b style={{ color: UP_COLOR }}>{Number(p.takeProfit).toFixed(2)}</b></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
