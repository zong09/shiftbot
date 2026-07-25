import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { useTheme } from '../ThemeContext.jsx';
import { zoneByNumber, zoneBadgeStyle } from '../theme.js';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

const CHART_HEIGHT = 380;

// Where the two price scales put their series inside the plot area. Kept next to the
// applyOptions calls below that set them — the zone band has to line up with these.
const PRICE_MARGINS = { top: 0.05, bottom: 0.2 };
const VOL_MARGINS   = { top: 0.82, bottom: 0 };

// Legend swatch — the 6-stop condensed zone ramp from the design handoff
const ZONE_RAMP = 'linear-gradient(90deg,#3f9e6b,#84b98c,#c9c48a,#dcbf82,#cf8570,#c1614e)';

// Volume bars reuse the candle's zone color at 42% (design handoff)
function zoneRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Fixed Asia/Bangkok offset (UTC+7, no DST) — keeps chart times aligned with the
// tables, which format explicitly in Asia/Bangkok regardless of the browser TZ
const TZ_OFFSET_SEC = 7 * 3600;

// Returns null when the event falls farther than one bar from any loaded candle,
// so off-range fills don't glue a misleading marker to the edge candle
function snapToNearestCandle(openTimeMs, series) {
  if (!series.length) return null;
  const targetSec = Math.floor(new Date(openTimeMs).getTime() / 1000) + TZ_OFFSET_SEC;
  const nearest = series.reduce((a, candle) =>
    Math.abs(candle.time - targetSec) < Math.abs(a.time - targetSec) ? candle : a
  );
  const barSec = series.length > 1 ? series[1].time - series[0].time : 3600;
  return Math.abs(nearest.time - targetSec) <= barSec ? nearest : null;
}

// Entry/close marker geometry, verbatim from the design handoff (ShiftBot.dc.html):
// entry = filled triangle offset from the fill price, close = hollow diamond on the
// price, joined by a dashed connector.
const MK = { r: 6.5, offset: 14, closeR: 6, hitR: 11 };

// Close-type actions. The log records SL_HIT / TP_HIT / SYNC_CLOSE without a side, so
// pairing leans on maxPositions = 1 — the close belongs to the one pending open.
const CLOSE_ACTIONS = ['CLOSE_LONG', 'CLOSE_SHORT', 'SL_HIT', 'TP_HIT', 'SYNC_CLOSE'];

// Folds the flat action log into entry→close legs. An open with no close yet (a live
// position) keeps its entry marker and draws no diamond or connector, as in the design.
function pairTrades(trades) {
  const legs = [];
  let pending = null;
  [...trades]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .forEach(t => {
      if (t.action === 'OPEN_LONG' || t.action === 'OPEN_SHORT') {
        if (pending) legs.push({ entry: pending, close: null });
        pending = t;
      } else if (CLOSE_ACTIONS.includes(t.action) && pending) {
        legs.push({ entry: pending, close: t });
        pending = null;
      }
    });
  if (pending) legs.push({ entry: pending, close: null });
  return legs.map(l => ({ ...l, long: l.entry.action === 'OPEN_LONG' }));
}

function formatPrice(v) {
  if (!v && v !== 0) return '—';
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

// Marker tooltips print a whole-number price as the design does (62,871, not 62,871.0).
// The handoff only ever shows BTC, so sub-$1000 pairs keep two decimals to stay readable —
// rounding DOGE to an integer would print 0.
function formatMarkerPrice(v) {
  const n = Number(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 2 });
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
  const [markerHover, setMarkerHover] = useState(null);
  // Bumped whenever the trade markers' pixel coordinates go stale (pan, zoom, resize,
  // new data) — the overlay reads them from the chart during render.
  const [coordTick, setCoordTick] = useState(0);
  const [bandGradient, setBandGradient] = useState(null);
  // Plot-area insets measured off the chart: the right price scale and the bottom time
  // axis are not plot area, and the zone band must not bleed under either.
  const [plotInset, setPlotInset] = useState({ right: 0, bottom: 0 });

  const measurePlot = () => {
    const chart = chartRef.current;
    if (!chart) return;
    setPlotInset({
      right:  chart.priceScale('right').width(),
      bottom: chart.timeScale().height(),
    });
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const c = colorsRef.current;

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: CHART_HEIGHT,
      layout: {
        // transparent so the CDC zone gradient band behind the canvas shows through
        background: { color: 'rgba(0,0,0,0)' },
        textColor:  c.textSecondary,
        fontFamily: "'IBM Plex Mono', monospace",
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
        scaleMargins: PRICE_MARGINS,
      },
      timeScale: {
        borderColor:    c.chart.grid,
        timeVisible:    true,
        secondsVisible: false,
        barSpacing:     8,
      },
      localization: {
        timeFormatter: (timestamp) => {
          return new Date(timestamp * 1000).toLocaleString('th-TH', { timeZone: 'UTC' });
        },
      },
    });

    // Candles are colored per-bar by CDC zone (design handoff): rising bars are filled
    // with the zone color, falling bars are hollow with a zone-colored border. Those
    // colors ride on each data point, so no series-level up/down colors are set here.
    candleRef.current = chart.addCandlestickSeries({
      priceLineVisible: true,
      priceLineColor:   c.chart.crosshair,
    });

    volumeRef.current = chart.addHistogramSeries({
      priceFormat:  { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: VOL_MARGINS });

    ema12Ref.current = chart.addLineSeries({
      color:            c.chart.emaFast,
      lineWidth:        1,
      priceLineVisible: false,
      lastValueVisible: false,
      title:            'EMA12',
    });

    ema26Ref.current = chart.addLineSeries({
      color:            c.chart.emaSlow,
      lineWidth:        1,
      priceLineVisible: false,
      lastValueVisible: false,
      title:            'EMA26',
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

    // rAF-coalesced: pan/zoom fires per frame, one re-render per frame is enough.
    // An open marker tooltip is anchored to the coordinates it was opened at, so it has
    // to close here — the marker underneath it has moved.
    let raf = 0;
    const bumpCoords = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setMarkerHover(null);
        setCoordTick(t => t + 1);
      });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(bumpCoords);

    const ro = new ResizeObserver(entries => {
      chart.applyOptions({ width: entries[0].contentRect.width });
      measurePlot();
      bumpCoords();
    });
    ro.observe(containerRef.current);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(bumpCoords);
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
        background: { color: 'rgba(0,0,0,0)' },
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
    // Per-bar zone colors live on the data points; only the price line needs re-skinning.
    candleRef.current?.applyOptions({ priceLineColor: colors.chart.crosshair });
    ema12Ref.current?.applyOptions({ color: colors.chart.emaFast });
    ema26Ref.current?.applyOptions({ color: colors.chart.emaSlow });
  }, [colors]);

  useEffect(() => {
    if (!candleRef.current || !candles.length) return;

    const offsetSec = TZ_OFFSET_SEC;

    // Zone per candle, keyed by candle open time. calculateHistory only emits rows from
    // index emaSlow onward, so the leading warm-up candles have no zone of their own —
    // carry the last known zone forward, then back-fill the leading gap with the first
    // known zone so every bar is colored, as in the design.
    const zoneAt = new Map(indicators.map(d => [d.timestamp, d.zone]));
    let carried = null;
    const zones = candles.map(c => {
      carried = zoneAt.get(c.timestamp) ?? carried;
      return carried;
    });
    const firstKnown = zones.find(z => z != null) ?? null;
    const barColors = zones.map(z => zoneByNumber(z ?? firstKnown)?.color ?? colors.textSecondary);

    // The zone band behind the canvas: one gradient stop per candle, so the backdrop
    // tracks the same zone sequence the bars do. lightweight-charts can't draw this,
    // so it lives in a div behind the transparent chart.
    setBandGradient(
      barColors.length > 1
        ? `linear-gradient(90deg,${barColors
            .map((hex, i) => `${hex} ${((i / (barColors.length - 1)) * 100).toFixed(2)}%`)
            .join(',')})`
        : null,
    );

    // Zone-colored candles: rising bars filled with the zone color, falling bars hollow
    // (surface fill, zone-colored border) — per the design handoff.
    const series = candles.map((c, i) => {
      const zoneColor = barColors[i];
      const rising    = c.close >= c.open;
      return {
        time:      Math.floor(c.timestamp / 1000) + offsetSec,
        open:      c.open,
        high:      c.high,
        low:       c.low,
        close:     c.close,
        color:       rising ? zoneColor : colors.surface,
        borderColor: zoneColor,
        wickColor:   zoneColor,
      };
    });

    seriesData.current = series;
    candleRef.current.setData(series);

    if (volumeRef.current) {
      volumeRef.current.setData(candles.map((c, i) => ({
        time:  Math.floor(c.timestamp / 1000) + offsetSec,
        value: c.volume ?? 0,
        color: zoneRgba(barColors[i], 0.42),
      })));
    }

    priceLineRefs.current.forEach(pl => { try { candleRef.current.removePriceLine(pl); } catch (_) {} });
    priceLineRefs.current = [];
    // only fit when the underlying data changed — a theme-only re-run must not reset zoom/pan
    const dataKey = `${candles.length}:${candles[0]?.timestamp}:${candles[candles.length - 1]?.timestamp}`;
    if (dataKeyRef.current !== dataKey) {
      dataKeyRef.current = dataKey;
      chartRef.current.timeScale().fitContent();
    }
    // price-scale width depends on the label text, so re-measure whenever data changes
    measurePlot();
    // series data is only on the chart now that this effect has run — the marker overlay
    // could not have read valid coordinates during the render that preceded it
    setCoordTick(t => t + 1);
  }, [candles, indicators, trades, colors]);

  useEffect(() => {
    if (!ema12Ref.current || !ema26Ref.current || !indicators.length) return;
    const offsetSec = TZ_OFFSET_SEC;
    ema12Ref.current.setData(indicators.map(d => ({ time: Math.floor(d.timestamp / 1000) + offsetSec, value: d.emaFast })));
    ema26Ref.current.setData(indicators.map(d => ({ time: Math.floor(d.timestamp / 1000) + offsetSec, value: d.emaSlow })));
  }, [indicators]);

  // Trade markers ride in an SVG overlay rather than series markers: the design's stems,
  // hollow diamonds and dashed entry→close connectors are all beyond what
  // lightweight-charts' built-in marker shapes can draw. Coordinates come straight off
  // the chart, so the layer recomputes whenever coordTick moves.
  const markerLayer = useMemo(() => {
    const chart  = chartRef.current;
    const cSer   = candleRef.current;
    const series = seriesData.current;
    if (!chart || !cSer || !series.length) return [];

    const ts = chart.timeScale();
    // null when the fill falls outside the loaded candles — never clamped, so a marker is
    // either on its own candle or absent. A fill that is loaded but panned off-screen
    // returns an out-of-bounds coordinate instead, which the SVG's own clip hides.
    const at = t => {
      const nearest = snapToNearestCandle(t.timestamp, series);
      if (!nearest) return null;
      const x = ts.timeToCoordinate(nearest.time);
      const y = cSer.priceToCoordinate(Number(t.price));
      return x == null || y == null ? null : { x, y };
    };

    const els = [];
    pairTrades(trades).forEach((leg, k) => {
      const e = at(leg.entry);
      if (!e) return;
      const { long } = leg;
      const col      = long ? colors.bull : colors.bear;
      const closeCol = long ? colors.chart.closeLong : colors.chart.closeShort;
      const r  = MK.r;
      const ty = e.y + (long ? MK.offset : -MK.offset);
      const tri = long
        ? `${e.x - r},${ty + r} ${e.x + r},${ty + r} ${e.x},${ty - r}`
        : `${e.x - r},${ty - r} ${e.x + r},${ty - r} ${e.x},${ty + r}`;

      const c = leg.close ? at(leg.close) : null;
      if (c) {
        const cr = MK.closeR;
        els.push(
          <line key={`cn${k}`} x1={e.x} y1={e.y} x2={c.x} y2={c.y}
                stroke={closeCol} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />,
          <polygon key={`cm${k}`}
                   points={`${c.x},${c.y - cr} ${c.x + cr},${c.y} ${c.x},${c.y + cr} ${c.x - cr},${c.y}`}
                   fill={colors.surface} stroke={closeCol} strokeWidth="1.8" />,
          <circle key={`ch${k}`} cx={c.x} cy={c.y} r={MK.hitR} fill="transparent"
                  className="pointer-events-auto cursor-pointer"
                  onMouseEnter={() => setMarkerHover({ kind: 'close', trade: leg.close, long, x: c.x, y: c.y, above: true })}
                  onMouseLeave={() => setMarkerHover(null)} />,
        );
      }
      els.push(
        <line key={`ml${k}`} x1={e.x} y1={e.y} x2={e.x} y2={ty + (long ? -r : r)}
              stroke={col} strokeWidth="1" opacity="0.55" />,
        <polygon key={`mt${k}`} points={tri} fill={col} stroke={colors.surface} strokeWidth="1.2" />,
        <circle key={`mh${k}`} cx={e.x} cy={ty} r={MK.hitR} fill="transparent"
                className="pointer-events-auto cursor-pointer"
                onMouseEnter={() => setMarkerHover({ kind: 'entry', trade: leg.entry, long, x: e.x, y: e.y, above: long })}
                onMouseLeave={() => setMarkerHover(null)} />,
      );
    });
    return els;
  }, [trades, colors, coordTick]);

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
  const lastZone   = zoneByNumber(lastInd?.zone);
  const badgeStyle = zoneBadgeStyle(lastInd?.zone);

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-[0_1px_2px_rgba(40,48,58,0.05),0_14px_36px_-28px_rgba(40,48,58,0.3)] mb-4 px-[18px] py-4 min-w-0">
      {/* Header: symbol + timeframe chips, zone badge pushed right */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          {symbol && (
            <span className="text-[14px] font-mono font-semibold">
              {symbol.replace(':USDT', '')}
            </span>
          )}
          <div className="flex gap-[3px]">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => onTimeframeChange?.(tf)}
                className={`px-[11px] py-[5px] rounded-[7px] text-[11px] font-mono font-semibold leading-none cursor-pointer border transition-all duration-150 ${
                  chartTimeframe === tf
                    ? 'bg-accent text-white border-transparent'
                    : 'text-secondary border-border'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        {lastZone && (
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-[7px]" style={badgeStyle}>
            Zone {lastInd.zone} · {lastZone.name}
          </span>
        )}
      </div>

      {/* OHLCV readout */}
      <div className="flex flex-wrap items-center gap-3.5 text-[11px] font-mono tabular-nums text-secondary mb-2">
        {displayData ? (
          <>
            <span>O&nbsp;<b className="text-primary">{formatPrice(displayData.open)}</b></span>
            <span>H&nbsp;<b className="text-bull">{formatPrice(displayData.high)}</b></span>
            <span>L&nbsp;<b className="text-bear">{formatPrice(displayData.low)}</b></span>
            <span>C&nbsp;<b style={{ color: displayData.isUp ? '#26a69a' : '#ef5350' }}>{formatPrice(displayData.close)}</b></span>
            {displayData.volume != null && (
              <span>Vol&nbsp;<b className="text-primary">{formatVolume(displayData.volume)}</b></span>
            )}
            <span className="ml-auto inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-[5px]">
                <span className="w-[44px] h-2 rounded-[4px]" style={{ background: ZONE_RAMP }} />
                CDC Zone
              </span>
              {lastInd && (
                <>
                  <span style={{ color: colors.chart.emaFast }}>— EMA 12&nbsp;{formatPrice(lastInd.emaFast)}</span>
                  <span style={{ color: colors.chart.emaSlow }}>— EMA 26&nbsp;{formatPrice(lastInd.emaSlow)}</span>
                </>
              )}
            </span>
          </>
        ) : (
          <span className="text-secondary/60">—</span>
        )}
      </div>

      {/* Chart canvas, over the CDC zone gradient band */}
      <div className="relative">
        {bandGradient && candles.length > 0 && (() => {
          // Plot area = canvas minus the time axis; the two bands then follow the same
          // scale margins the price and volume scales use.
          const plotH = CHART_HEIGHT - plotInset.bottom;
          const band  = (top, height, opacity) => (
            <div
              key={top}
              className="absolute left-0 pointer-events-none"
              style={{ right: plotInset.right, top: plotH * top, height: plotH * height, background: bandGradient, opacity }}
            />
          );
          return [
            band(PRICE_MARGINS.top, 1 - PRICE_MARGINS.top - PRICE_MARGINS.bottom, 0.16),
            band(VOL_MARGINS.top, 1 - VOL_MARGINS.top - VOL_MARGINS.bottom, 0.1),
          ];
        })()}
        {candles.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-secondary/70" style={{ height: CHART_HEIGHT }}>
            Loading candles…
          </div>
        )}
        <div ref={containerRef} className={`relative w-full ${candles.length === 0 ? 'invisible' : 'visible'}`} />
        {/* Trade marker overlay. Transparent to the mouse apart from the marker hit
            circles, so the crosshair keeps feeding the OHLCV readout above. */}
        {markerLayer.length > 0 && (
          <svg
            className="absolute left-0 top-0 z-10 pointer-events-none overflow-hidden"
            style={{ right: plotInset.right, height: CHART_HEIGHT - plotInset.bottom }}
          >
            {markerLayer}
          </svg>
        )}
        {markerHover && (() => {
          const { kind, trade, long, above } = markerHover;
          const isClose = kind === 'close';
          const sideCol = long ? colors.bull : colors.bear;
          const pnlCol  = trade.pnl >= 0 ? colors.bull : colors.bear;
          return (
            <div
              className="absolute z-20 pointer-events-none whitespace-nowrap bg-surface border border-border rounded-[9px] px-[11px] py-2 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.45)]"
              style={{
                left: markerHover.x,
                top: markerHover.y,
                transform: `translate(-50%,${above ? '-118%' : '18%'})`,
              }}
            >
              <div className="flex items-center gap-[7px] mb-[5px]">
                <span className="text-[11px] font-bold tracking-[0.04em]" style={{ color: isClose ? pnlCol : sideCol }}>
                  {isClose ? 'CLOSE' : 'ENTRY'} · {long ? 'LONG' : 'SHORT'}
                </span>
                <span className="text-[10px] font-semibold px-[7px] py-[2px] rounded-[5px]" style={zoneBadgeStyle(trade.zone)}>
                  Zone {trade.zone}
                </span>
              </div>
              <div className="font-mono text-[13px] font-semibold text-primary">
                {symbol?.replace(':USDT', '')} · {formatMarkerPrice(trade.price)}
              </div>
              {isClose ? (
                <div className="text-[11px] mt-[3px]">
                  <span className="text-secondary">PnL </span>
                  <span className="font-mono font-semibold" style={{ color: pnlCol }}>
                    {trade.pnl >= 0 ? '+' : ''}{Number(trade.pnl ?? 0).toFixed(2)} USDT
                  </span>
                </div>
              ) : (
                <div className="text-[10px] text-secondary mt-[3px]">qty {trade.quantity}</div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
