// Values transcribed from ShiftBot.dc.html buildChart method.
// Colors deliberately live in theme.js instead.

export const CHART_H = 360;  // design L840

export const PAD = { L: 8, R: 64, T: 14, B: 26 };  // design L480

export const GRID_LINES = 5;  // design L492 (loop g<=4 → 5 lines)

export const TIME_STRIDE_DIV = 7;  // design L502 (Math.ceil(cs.length/7))

export const TICK_LEN = 4;  // design L511 (y2: axisY+4)

export const AXIS_LABEL_DY = 15;  // design L512 (y: axisY+15)

export const PRICE_LABEL_DX = 6;  // design L495 (x: W-padR+6)
export const PRICE_LABEL_DY = 3;  // design L495 (y: gy+3)

export const DOMAIN_PAD_PCT = 0.06;  // design L485 ((mx-mn)*0.06)

export const BAND_OPACITY = 0.16;  // design L523 (opacity:.16)

export const AREA_OPACITY = 0.22;  // design L544 (opacity:.22)
export const LINE_WIDTH = 2.2;  // design L545 (strokeWidth:2.2)

export const LAST_DOT = { haloR: 6, haloOpacity: 0.2, r: 3, strokeWidth: 1.4 };  // design L546-547

export const EMA = { width: 1.4, opacity: 0.9 };  // design L576-577 (strokeWidth:1.4, opacity:.9)

export const MARKER = { r: 6.5, offset: 14, closeR: 6, hitR: 11 };  // design L554,L567,L570

export const MARKER_STROKE = { tri: 1.2, stem: 1, diamond: 1.8 };  // design L573,L572,L569

export const MARKER_OPACITY = { stem: 0.55, connector: 0.5 };  // design L572,L565

export const CONNECTOR_DASH = '3 3';  // design L565 (strokeDasharray:'3 3')

export const LAST_LINE = { width: 1, dash: '4 3', opacity: 0.7 };  // design L579

export const CROSS = { width: 1, dash: '2 3' };  // design L587-588

export const PRICE_TAG = { w: 64, h: 18, rx: 3, fontSize: 10, dy: 4 };  // design L581-582

export const TIME_TAG = { w: 72, h: 16, rx: 3, fontSize: 9.5, dx: 36, dy: 13.5, top: 2 };  // design L596-597

export const FONT = { axis: 10, boundaryWeight: 600, normalWeight: 400 };  // design L512

// History panning: the API serves MAX_CANDLES (240) per timeframe, of which the chart
// draws a sliding window of VIEW_SIZE. design: `Math.min(this.state.viewSize||56,n)`
export const VIEW_SIZE = 56;
export const PAN_STEP = 14;  // design: panBack=panBy(-14), panFwd=panBy(14)
export const NAV_BTN = { size: 26, radius: 7, icon: 13, offOpacity: 0.4 };  // design: chartNav()
