// Daily activity buckets behind the Consistency heatmap (ShiftBot.dc.html `heat()`).
// Days are Asia/Bangkok (UTC+7, no DST), expressed as an integer day number so no Intl
// call is involved — th-TH already returns Buddhist-era years, and the +543 below would
// then be applied twice.

const MS_DAY = 86400000;
const BKK = 7 * 3600000;
const dayNum = (ms) => Math.floor((ms + BKK) / MS_DAY);
// Calendar fields of a day number come from the UTC getters of its shifted date.
const dateOf = (n) => new Date(n * MS_DAY);

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const EN_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function buildHeatmap(trades, now = new Date()) {
  const today = dayNum(now.getTime());
  const end = today + (6 - dateOf(today).getUTCDay());   // Saturday on/after today
  const first = today - 364;
  const start = first - dateOf(first).getUTCDay();       // Sunday on/before the window start

  // Only closing rows carry pnl; opens are not "trades" for this grid.
  // `!= null` (not `!== null`) so an absent pnl can't sum to NaN — same predicate as PortfolioSummary.
  const buckets = new Map();
  for (const t of trades) {
    if (t.pnl == null) continue;
    const d = dayNum(Date.parse(t.timestamp));
    if (d < start || d > end) continue;
    let b = buckets.get(d);
    if (!b) { b = { trades: 0, pnl: 0, wins: 0, losses: 0 }; buckets.set(d, b); }
    b.trades += 1;
    b.pnl += t.pnl;
    if (t.pnl > 0) b.wins += 1;
    if (t.pnl < 0) b.losses += 1;
  }

  const cells = [];
  for (let n = start; n <= end; n++) {
    const b = buckets.get(n) || { trades: 0, pnl: 0, wins: 0, losses: 0 };
    const future = n > today;
    const dt = dateOf(n);
    const level = b.trades === 0 ? 0 : b.trades < 3 ? 1 : b.trades < 6 ? 2 : b.trades < 10 ? 3 : 4;
    cells.push({
      key: dt.toISOString().slice(0, 10),
      future,
      level,
      trades: future ? 0 : b.trades,
      pnl: future ? 0 : b.pnl,
      wins: future ? 0 : b.wins,
      losses: future ? 0 : b.losses,
      date: `${dt.getUTCDate()} ${THAI_MONTHS[dt.getUTCMonth()]} ${String(dt.getUTCFullYear() + 543).slice(-2)}`,
      dow: 'วัน' + THAI_DAYS[dt.getUTCDay()],
    });
  }

  // activeDays / bestStreak over first..today only
  let activeDays = 0;
  let streak = 0;
  let bestStreak = 0;
  for (let n = first; n <= today; n++) {
    const b = buckets.get(n);
    const has = b && b.trades > 0;
    if (has) { activeDays += 1; streak += 1; if (streak > bestStreak) bestStreak = streak; }
    else streak = 0;
  }

  // One label per column, named for the month owning that column's mid-week day.
  const months = [];
  let prevMonth = -1;
  for (let c = 0; c * 7 < cells.length; c++) {
    const m = dateOf(start + c * 7 + 3).getUTCMonth();
    if (m !== prevMonth) {
      months.push({ col: c + 1, label: EN_MONTHS[m] });
      prevMonth = m;
    }
  }
  // The first label would sit on top of the second one.
  if (months.length > 1 && months[1].col - months[0].col < 3) months.shift();

  return { cols: cells.length / 7, cells, months, activeDays, bestStreak, totalDays: 365 };
}
