import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../ThemeContext.jsx';
import { zoneByNumber, zoneBadgeStyle, mixHex, DEFAULT_ACCENT } from '../theme.js';
import {
  CHART_H, PAD, GRID_LINES, TIME_STRIDE_DIV, TICK_LEN, AXIS_LABEL_DY,
  PRICE_LABEL_DX, PRICE_LABEL_DY, DOMAIN_PAD_PCT, BAND_OPACITY, AREA_OPACITY,
  LINE_WIDTH, LAST_DOT, EMA, MARKER, MARKER_STROKE, MARKER_OPACITY,
  CONNECTOR_DASH, LAST_LINE, CROSS, PRICE_TAG, TIME_TAG, FONT,
  VIEW_SIZE, PAN_STEP, NAV_BTN,
} from '../chartSpec.js';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

/** 26×26 pan arrow — design: chartNav(off) */
function NavButton({ label, disabled, onClick, d }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex items-center justify-center rounded-[7px] border border-border bg-surface text-secondary transition-colors duration-150"
      style={{
        width: NAV_BTN.size,
        height: NAV_BTN.size,
        ...(disabled ? { opacity: NAV_BTN.offOpacity, cursor: 'not-allowed' } : { cursor: 'pointer' }),
      }}
    >
      <svg width={NAV_BTN.icon} height={NAV_BTN.icon} viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
}

// Bar duration per timeframe. Used for the time-axis labels and to decide whether a
// trade's fill is close enough to a loaded candle to place a marker on it.
const TF_MS = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000,
  '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
};

// Legend swatch — the 6-stop condensed zone ramp from the design handoff
const ZONE_RAMP = 'linear-gradient(90deg,#3f9e6b,#84b98c,#c9c48a,#dcbf82,#cf8570,#c1614e)';

// Axis, crosshair, tag and up/down colors are all theme-derived in the design (tints of
// --text-dim, --text on --surface, --pos/--neg) — they live in theme.js as colors.chart.*.
const MONO = 'IBM Plex Mono,monospace';

// Axis labels are formatted in Asia/Bangkok so the chart agrees with the trade and
// position tables. hourCycle 'h23' is required: hour12:false alone yields "24:00" for
// midnight in some engines, which would defeat the midnight-boundary test below.
const BKK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23',
});

function bkkParts(ms) {
  const out = {};
  for (const { type, value } of BKK.formatToParts(ms)) out[type] = value;
  return out;
}

// Returns the index of the closest candle, or null when the event falls farther than one
// bar from every loaded candle — so off-range fills don't glue a misleading marker to the
// edge candle. The bar width comes from the timeframe rather than from the first two
// candles, which would break on a single candle and lie across an exchange data gap.
function snapToNearestCandle(when, candles, barMs) {
  if (!candles.length) return null;
  const target = new Date(when).getTime();
  if (!Number.isFinite(target)) return null;
  let best = 0;
  for (let i = 1; i < candles.length; i++) {
    if (Math.abs(candles[i].timestamp - target) < Math.abs(candles[best].timestamp - target)) best = i;
  }
  return Math.abs(candles[best].timestamp - target) <= barMs ? best : null;
}

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

// Axis and tag labels take their decimal count from the price span, not the magnitude:
// the design rounds to an integer, which is right for BTC but would print "0" on every
// gridline of a sub-$1 pair. Enough digits that adjacent ticks differ.
function axisFormatter(span) {
  const digits = span > 0 ? Math.max(0, 1 - Math.floor(Math.log10(span / (GRID_LINES - 1)))) : 2;
  return v => Number(v).toLocaleString(undefined, {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

export default function PriceChart({
  candles: allCandles = [],
  indicators: allIndicators = [],
  trades = [],
  symbol,
  accent = DEFAULT_ACCENT.live,
  chartTimeframe = '1h',
  onTimeframeChange,
}) {
  const { colors } = useTheme();

  // The design paints EMA 12 with --accent and derives EMA 26 and the trade-close markers from
  // it. --accent is per-mode and user-overridable, so these can't be static tokens.
  const series = useMemo(() => ({
    emaFast:    accent,
    emaSlow:    mixHex(colors.textPrimary, accent, 55),
    closeLong:  accent,
    closeShort: mixHex(colors.bear, accent, 65),
  }), [accent, colors]);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  // Crosshair position: bar index plus the raw mouse y, both in SVG pixels.
  const [cross, setCross] = useState(null);
  const [markerHover, setMarkerHover] = useState(null);

  // ── History window ────────────────────────────────────────────────────────
  // viewEnd is the index one past the newest visible candle; null pins the window
  // to the latest, so an appended candle scrolls the view instead of leaving it behind.
  const [viewEnd, setViewEnd] = useState(null);
  const dragRef = useRef(null);

  const win = useMemo(() => {
    const n = allCandles.length;
    const size = Math.min(VIEW_SIZE, n);
    // Clamp: viewEnd can outlive a timeframe switch or a shorter series
    const end = Math.max(size, Math.min(n, viewEnd ?? n));
    return { start: end - size, end, size, n, atLatest: end >= n };
  }, [allCandles.length, viewEnd]);

  // Every derived value below — price domain, CDC gradient, EMA paths, time axis,
  // markers, the O/H/L/C readout — is built from these, so slicing here is all it takes.
  const candles = useMemo(() => allCandles.slice(win.start, win.end), [allCandles, win.start, win.end]);
  const indicators = useMemo(() => allIndicators.slice(win.start, win.end), [allIndicators, win.start, win.end]);

  // A timeframe or symbol switch returns to the newest window (design: tf chips reset it).
  useEffect(() => { setViewEnd(null); }, [chartTimeframe, symbol]);

  // Shared by the ‹ / › buttons and the drag: clamp, then collapse "at the end" to null.
  const panTo = end => {
    const ne = Math.max(win.size, Math.min(win.n, end));
    if (ne === win.end) return;
    setViewEnd(ne >= win.n ? null : ne);
    setCross(null);
    setMarkerHover(null);
  };
  // ':' is legal in a React id but not inside a url(#…) reference
  const gid = 'zgrad-' + useId().replace(/:/g, '');

  // Measured in a layout effect so the real width is in state before the first paint —
  // with useEffect the chart would paint once at width 0 and visibly jump.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(Math.round(el.clientWidth));
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      // A window drag fires this every frame with sub-pixel widths; bailing on an
      // unchanged rounded width keeps it from rebuilding the whole chart each time.
      setWidth(prev => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Every 30s refresh shifts the candle array, so a parked crosshair would silently
  // start labelling a different bar. Timeframe and symbol switches change this key too.
  const dataKey = candles.length
    ? `${candles.length}:${candles[0].timestamp}:${candles[candles.length - 1].timestamp}`
    : '';
  useEffect(() => {
    setCross(null);
    setMarkerHover(null);
  }, [dataKey]);

  // The static layer: everything that doesn't move when the mouse does. Memoized so a
  // crosshair move reuses these element objects and React skips reconciling them.
  // x, y and idxByTs are built in here on purpose — declared in the component body they
  // would be new closures every render, making `geom` a new object and defeating the
  // marker memo below.
  const chart = useMemo(() => {
    const n = candles.length;
    const iw = width - PAD.L - PAD.R;
    const ih = CHART_H - PAD.T - PAD.B;
    if (!n || iw <= 0) return null;

    const ph = ih;
    const axisY = PAD.T + ih;

    let mn = Infinity, mx = -Infinity;
    for (const c of candles) {
      if (c.low  < mn) mn = c.low;
      if (c.high > mx) mx = c.high;
    }
    const domainPad = (mx - mn) * DOMAIN_PAD_PCT;
    mn -= domainPad;
    mx += domainPad;
    // A single flat bar leaves a zero-width domain, which makes every y() NaN
    if (!(mx - mn > 0)) { mn -= 1; mx += 1; }

    const x = i => PAD.L + ((i + 0.5) / n) * iw;
    const y = p => PAD.T + ((mx - p) / (mx - mn)) * ph;
    const idxByTs = new Map(candles.map((c, i) => [c.timestamp, i]));
    const fmtAxis = axisFormatter(mx - mn);

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
    const zoneColors = zones.map(z => zoneByNumber(z ?? firstKnown)?.color ?? colors.textSecondary);

    // One gradient stop per bar, so the band, the area fill and the line stroke all
    // travel the same zone sequence the bars do. Pinned to user space rather than left
    // on the default objectBoundingBox: the band spans the full plot while the paths span
    // only x(0)…x(n-1), so per-bbox sampling would misalign their color transitions.
    const defs = (
      <defs key="defs">
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={PAD.L} y1="0" x2={PAD.L + iw} y2="0">
          {zoneColors.map((hex, i) => (
            <stop key={i} offset={`${(n > 1 ? (i / (n - 1)) * 100 : 0).toFixed(2)}%`} stopColor={hex} />
          ))}
        </linearGradient>
      </defs>
    );

    const zoneBand = (
      <rect key="band" x={PAD.L} y={PAD.T} width={iw} height={ph}
            fill={`url(#${gid})`} opacity={BAND_OPACITY} />
    );

    const grid = [];
    const lbl = [];
    const divisions = GRID_LINES - 1;
    for (let g = 0; g <= divisions; g++) {
      const gy = PAD.T + (g / divisions) * ph;
      const pv = mx - (g / divisions) * (mx - mn);
      grid.push(
        <line key={`g${g}`} x1={PAD.L} x2={PAD.L + iw} y1={gy} y2={gy}
              stroke={colors.chart.grid} strokeWidth="1" />,
      );
      lbl.push(
        <text key={`pl${g}`} x={width - PAD.R + PRICE_LABEL_DX} y={gy + PRICE_LABEL_DY}
              fill={colors.chart.axisText} fontSize={FONT.axis} fontFamily={MONO}>
          {fmtAxis(pv)}
        </text>,
      );
    }

    // Time axis: labels walk backwards from the newest bar so the right edge always
    // carries one. Intraday shows HH:MM, switching to a bold DD/MM at Bangkok midnight.
    const intraday = (TF_MS[chartTimeframe] ?? TF_MS['1h']) < TF_MS['1d'];
    const tstep = Math.ceil(n / TIME_STRIDE_DIV);
    for (let i = n - 1; i >= 0; i -= tstep) {
      const p = bkkParts(candles[i].timestamp);
      const dd = `${p.day}/${p.month}`;
      const atBoundary = intraday ? (p.hour === '00' && p.minute === '00') : true;
      const label = intraday ? (atBoundary ? dd : `${p.hour}:${p.minute}`) : dd;
      grid.push(
        <line key={`vg${i}`} x1={x(i)} x2={x(i)} y1={PAD.T} y2={axisY} stroke={colors.chart.gridV} strokeWidth="1" />,
        <line key={`tk${i}`} x1={x(i)} x2={x(i)} y1={axisY} y2={axisY + TICK_LEN} stroke={colors.chart.tick} strokeWidth="1" />,
      );
      lbl.push(
        <text key={`tl${i}`} x={x(i)} y={axisY + AXIS_LABEL_DY} textAnchor="middle"
              fill={colors.chart.axisText} fontSize={FONT.axis} fontFamily={MONO}
              fontWeight={atBoundary ? FONT.boundaryWeight : FONT.normalWeight}>
          {label}
        </text>,
      );
    }

    // Price as a smooth line plus a filled area, both painted with the zone gradient.
    // The curve is a horizontal-tangent cubic: both control points sit at the segment's
    // x-midpoint, taking their y from the two endpoints.
    const pts = candles.map((c, i) => [x(i), y(c.close)]);
    let lineD = '';
    pts.forEach((p, i) => {
      if (!i) { lineD = `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`; return; }
      const q = pts[i - 1];
      const midX = ((q[0] + p[0]) / 2).toFixed(1);
      lineD += ` C${midX} ${q[1].toFixed(1)} ${midX} ${p[1].toFixed(1)} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    });
    const areaBase = PAD.T + ph;
    const areaD = `${lineD} L${pts[pts.length - 1][0].toFixed(1)} ${areaBase} L${pts[0][0].toFixed(1)} ${areaBase} Z`;
    const lastPt = pts[pts.length - 1];
    const lastZoneColor = zoneColors[n - 1];
    const priceEls = [
      <path key="area" d={areaD} fill={`url(#${gid})`} opacity={AREA_OPACITY} />,
      <path key="line" d={lineD} fill="none" stroke={`url(#${gid})`} strokeWidth={LINE_WIDTH}
            strokeLinejoin="round" strokeLinecap="round" />,
      <circle key="halo" cx={lastPt[0]} cy={lastPt[1]} r={LAST_DOT.haloR}
              fill={lastZoneColor} opacity={LAST_DOT.haloOpacity} />,
      <circle key="dot" cx={lastPt[0]} cy={lastPt[1]} r={LAST_DOT.r}
              fill={lastZoneColor} stroke={colors.surface} strokeWidth={LAST_DOT.strokeWidth} />,
    ];

    // EMA rows are joined to candles on timestamp, never on index: calculateHistory omits
    // the first emaSlow bars, so indicators is ~26 rows shorter. An unmatched row would
    // put NaN in the path, and an invalid `d` renders nothing at all with no error.
    const emaPath = key => {
      const parts = [];
      for (const d of indicators) {
        const i = idxByTs.get(d.timestamp);
        if (i === undefined || !Number.isFinite(d[key])) continue;
        parts.push(`${parts.length ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`);
      }
      return parts.join(' ');
    };
    const emaEls = [
      <path key="emaFast" d={emaPath('emaFast')} fill="none"
            stroke={series.emaFast} strokeWidth={EMA.width} opacity={EMA.opacity} />,
      <path key="emaSlow" d={emaPath('emaSlow')} fill="none"
            stroke={series.emaSlow} strokeWidth={EMA.width} opacity={EMA.opacity} />,
    ];

    const lastCandle = candles[n - 1];
    const lastY = y(lastCandle.close);
    const lastCol = lastCandle.close >= lastCandle.open ? colors.chart.up : colors.chart.dn;
    const lastLine = (
      <line key="lastLine" x1={PAD.L} x2={PAD.L + iw} y1={lastY} y2={lastY} stroke={lastCol}
            strokeWidth={LAST_LINE.width} strokeDasharray={LAST_LINE.dash} opacity={LAST_LINE.opacity} />
    );
    const lastTag = (
      <g key="lastTag">
        <rect x={width - PAD.R} y={lastY - PRICE_TAG.h / 2} width={PAD.R} height={PRICE_TAG.h}
              rx={PRICE_TAG.rx} fill={lastCol} />
        <text x={width - PAD.R + PAD.R / 2} y={lastY + PRICE_TAG.dy} textAnchor="middle"
              fill="#fff" fontSize={PRICE_TAG.fontSize} fontWeight="600" fontFamily={MONO}>
          {fmtAxis(lastCandle.close)}
        </text>
      </g>
    );

    return {
      geom: { n, iw, ph, axisY, mn, mx, x, y, fmtAxis },
      defs, zoneBand, grid, priceEls, emaEls, lastLine, lastTag, lbl,
    };
  }, [candles, indicators, width, colors, series, chartTimeframe, gid]);

  const geom = chart?.geom ?? null;

  // Trade markers: the design's stems, hollow diamonds and dashed entry→close connectors
  // ride in the same SVG as the series now. Memoized against geom so a crosshair move
  // doesn't rebuild them.
  const markerLayer = useMemo(() => {
    if (!geom) return [];
    const barMs = TF_MS[chartTimeframe] ?? TF_MS['1h'];
    const at = t => {
      // Older SYNC_CLOSE rows were written with price 0; placing a marker there drags it
      // and its connector off the price scale
      if (!(Number(t.price) > 0)) return null;
      const i = snapToNearestCandle(t.timestamp, candles, barMs);
      return i == null ? null : { x: geom.x(i), y: geom.y(Number(t.price)) };
    };

    const els = [];
    pairTrades(trades).forEach((leg, k) => {
      const e = at(leg.entry);
      if (!e) return;
      const { long } = leg;
      const col = long ? colors.bull : colors.bear;
      const closeCol = long ? series.closeLong : series.closeShort;
      const r = MARKER.r;
      const ty = e.y + (long ? MARKER.offset : -MARKER.offset);
      const tri = long
        ? `${e.x - r},${ty + r} ${e.x + r},${ty + r} ${e.x},${ty - r}`
        : `${e.x - r},${ty - r} ${e.x + r},${ty - r} ${e.x},${ty + r}`;

      const c = leg.close ? at(leg.close) : null;
      if (c) {
        const cr = MARKER.closeR;
        const enterClose = () => setMarkerHover({ kind: 'close', trade: leg.close, long, x: c.x, y: c.y, above: true });
        els.push(
          <line key={`cn${k}`} x1={e.x} y1={e.y} x2={c.x} y2={c.y} stroke={closeCol}
                strokeWidth={MARKER_STROKE.stem} strokeDasharray={CONNECTOR_DASH}
                opacity={MARKER_OPACITY.connector} />,
          <polygon key={`cm${k}`}
                   points={`${c.x},${c.y - cr} ${c.x + cr},${c.y} ${c.x},${c.y + cr} ${c.x - cr},${c.y}`}
                   fill={colors.surface} stroke={closeCol} strokeWidth={MARKER_STROKE.diamond} />,
          <circle key={`ch${k}`} cx={c.x} cy={c.y} r={MARKER.hitR} fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={enterClose} onMouseLeave={() => setMarkerHover(null)} />,
        );
      }
      const enterEntry = () => setMarkerHover({ kind: 'entry', trade: leg.entry, long, x: e.x, y: e.y, above: long });
      els.push(
        <line key={`ml${k}`} x1={e.x} y1={e.y} x2={e.x} y2={ty + (long ? -r : r)}
              stroke={col} strokeWidth={MARKER_STROKE.stem} opacity={MARKER_OPACITY.stem} />,
        <polygon key={`mt${k}`} points={tri} fill={col} stroke={colors.surface}
                 strokeWidth={MARKER_STROKE.tri} />,
        <circle key={`mh${k}`} cx={e.x} cy={ty} r={MARKER.hitR} fill="transparent"
                className="cursor-pointer"
                onMouseEnter={enterEntry} onMouseLeave={() => setMarkerHover(null)} />,
      );
    });
    return els;
  }, [trades, candles, colors, series, geom, chartTimeframe]);

  // Drag-to-pan. `per` is candles-per-pixel, so dragging the full plot width moves a
  // full window regardless of how wide the card is (design: cs.length / rect.width).
  const onDown = e => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    dragRef.current = { x: e.clientX, end: win.end, per: win.size / rect.width };
  };
  const endDrag = () => { dragRef.current = null; };

  const onMove = e => {
    if (dragRef.current) {
      const d = dragRef.current;
      panTo(d.end + Math.round((d.x - e.clientX) * d.per));
      return;
    }
    if (!geom) return;
    const rect = wrapRef.current.getBoundingClientRect();
    if (!rect.width) return;
    // Only ever ~1 while a resize is still propagating to `width`
    const scale = width / rect.width;
    const vx = (e.clientX - rect.left) * scale;
    const vy = (e.clientY - rect.top) * scale;
    let i = Math.round(((vx - PAD.L) / geom.iw) * geom.n - 0.5);
    i = Math.max(0, Math.min(geom.n - 1, i));
    const yv = Math.max(PAD.T, Math.min(geom.axisY, vy));
    // Returning the previous object makes React bail out of the whole re-render — this is
    // the design's "only when the bar or y moved enough" throttle.
    setCross(prev => (!prev || prev.i !== i || Math.abs(prev.yv - yv) > 2 ? { i, yv } : prev));
  };

  // Crosshair is the only thing that moves with the mouse, so it is built per render
  // rather than memoized.
  let crossEls = null;
  if (geom && cross && cross.i < geom.n) {
    const cxx = geom.x(cross.i);
    const cy = cross.yv;
    const p = bkkParts(candles[cross.i].timestamp);
    const pv = geom.mx - (Math.min(cy - PAD.T, geom.ph) / geom.ph) * (geom.mx - geom.mn);
    crossEls = [
      <line key="cxv" x1={cxx} x2={cxx} y1={PAD.T} y2={geom.axisY} stroke={colors.chart.crosshair}
            strokeWidth={CROSS.width} strokeDasharray={CROSS.dash} />,
      <line key="cxh" x1={PAD.L} x2={PAD.L + geom.iw} y1={cy} y2={cy} stroke={colors.chart.crosshair}
            strokeWidth={CROSS.width} strokeDasharray={CROSS.dash} />,
      <rect key="cbr" x={cxx - TIME_TAG.dx} y={geom.axisY + TIME_TAG.top} width={TIME_TAG.w}
            height={TIME_TAG.h} rx={TIME_TAG.rx} fill={colors.chart.tagBg} />,
      <text key="cbt" x={cxx} y={geom.axisY + TIME_TAG.dy} textAnchor="middle" fill={colors.chart.tagText}
            fontSize={TIME_TAG.fontSize} fontWeight="600" fontFamily={MONO}>
        {`${p.day}/${p.month} ${p.hour}:${p.minute}`}
      </text>,
    ];
    if (cy <= PAD.T + geom.ph + 4) {
      crossEls.push(
        <rect key="cxr" x={width - PAD.R} y={cy - PRICE_TAG.h / 2} width={PAD.R}
              height={PRICE_TAG.h} rx={PRICE_TAG.rx} fill={colors.chart.tagBg} />,
        <text key="cxt" x={width - PAD.R + PAD.R / 2} y={cy + PRICE_TAG.dy} textAnchor="middle"
              fill={colors.chart.tagText} fontSize={PRICE_TAG.fontSize} fontWeight="600" fontFamily={MONO}>
          {geom.fmtAxis(pv)}
        </text>,
      );
    }
  }

  // The zone badge and EMA legend report the CURRENT indicator state, so they read the
  // newest candle even while the view is panned back (design: zoneOf(candles.length-1)).
  const lastInd     = allIndicators[allIndicators.length - 1];
  // The O/H/L/C readout, by contrast, follows the crosshair and falls back to the last
  // VISIBLE candle (design: ci = cross ? start+cross.i : end-1).
  const displayData = (cross && candles[cross.i]) || candles[candles.length - 1] || null;
  const lastZone    = zoneByNumber(lastInd?.zone);
  const badgeStyle  = zoneBadgeStyle(lastInd?.zone);

  return (
    <div className="bg-surface border border-border rounded-[14px] px-[18px] py-4 min-w-0">
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

          {/* History panning — divider, ‹ / ›, "ล่าสุด", and the current offset */}
          <div className="flex items-center gap-[5px] pl-1 border-l border-border">
            <NavButton label="เลื่อนย้อนหลัง" disabled={win.start <= 0}
                       onClick={() => panTo(win.end - PAN_STEP)} d="M15 6l-6 6 6 6" />
            <NavButton label="เลื่อนไปข้างหน้า" disabled={win.atLatest}
                       onClick={() => panTo(win.end + PAN_STEP)} d="M9 6l6 6-6 6" />
            <button
              onClick={() => { setViewEnd(null); setCross(null); setMarkerHover(null); }}
              disabled={win.atLatest}
              className="px-[11px] py-[5px] rounded-[7px] text-[11px] font-semibold leading-none border transition-colors duration-150"
              style={win.atLatest
                ? { borderColor: 'var(--border)', background: 'transparent', color: 'var(--text-secondary)', opacity: 0.5, cursor: 'default' }
                : { borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)', cursor: 'pointer' }}
            >
              ล่าสุด
            </button>
            <span className="text-[10.5px] font-mono text-secondary">
              {win.atLatest ? 'ล่าสุด' : `ย้อนหลัง ${win.n - win.end} แท่ง`}
            </span>
          </div>
        </div>
        {lastZone && (
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-[7px]" style={badgeStyle}>
            Zone {lastInd.zone} · {lastZone.name}
          </span>
        )}
      </div>

      {/* OHLC readout — follows the crosshair, falls back to the last candle */}
      <div className="flex flex-wrap items-center gap-3.5 text-[11px] font-mono tabular-nums text-secondary mb-2">
        {displayData ? (
          <>
            <span>O&nbsp;<b className="text-primary">{formatPrice(displayData.open)}</b></span>
            <span>H&nbsp;<b className="text-bull">{formatPrice(displayData.high)}</b></span>
            <span>L&nbsp;<b className="text-bear">{formatPrice(displayData.low)}</b></span>
            <span>C&nbsp;<b style={{ color: displayData.close >= displayData.open ? colors.chart.up : colors.chart.dn }}>
              {formatPrice(displayData.close)}
            </b></span>
            <span className="ml-auto inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-[5px]">
                <span className="w-[44px] h-2 rounded-[4px]" style={{ background: ZONE_RAMP }} />
                CDC Zone
              </span>
              {lastInd && (
                <>
                  <span style={{ color: series.emaFast }}>— EMA 12&nbsp;{formatPrice(lastInd.emaFast)}</span>
                  <span style={{ color: series.emaSlow }}>— EMA 26&nbsp;{formatPrice(lastInd.emaSlow)}</span>
                </>
              )}
            </span>
          </>
        ) : (
          <span className="text-secondary/60">—</span>
        )}
      </div>

      {/* The wrapper always renders so the ResizeObserver has a box to measure, and its
          fixed height reserves the layout before the first width lands. overflow-hidden
          clips the frame after a grid-track shrink, where `width` is still the old
          larger value and would otherwise push the parent grid wider. */}
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden"
        style={{ height: CHART_H, cursor: 'crosshair' }}
        onMouseMove={onMove}
        onMouseDown={onDown}
        onMouseUp={endDrag}
        onMouseLeave={() => { endDrag(); setCross(null); }}
      >
        {candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-secondary/70">
            Loading candles…
          </div>
        )}
        {chart && (
          <svg width={width} height={CHART_H} viewBox={`0 0 ${width} ${CHART_H}`} style={{ display: 'block' }}>
            {chart.defs}
            {chart.zoneBand}
            {chart.grid}
            {chart.priceEls}
            {chart.emaEls}
            {chart.lastLine}
            {crossEls}
            {markerLayer}
            {chart.lbl}
            {chart.lastTag}
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
