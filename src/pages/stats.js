// Stats page: headline numbers, monthly volume, posting hour and weekday, most-used words.
// Every chart has the same values in an aria-label, a direct label, or a data table.
import {
  boot, fmtNum, fmtDate, plural, pad, escapeHtml,
  MONTHS, MONTHS_SHORT, WEEKDAYS, bindTip, showTip, hideTip, rovingFocus, renderTable,
} from '../lib/common.js';
import { href, replace } from '../lib/router.js';

const $ = (id) => document.getElementById(id);
const tickFmt = new Intl.NumberFormat('en-US', { notation: 'compact' });
let scope;

// Common English words plus post noise. Apostrophes are stripped before lookup.
const STOP_WORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both
  but by can cannot could did do does doing down during each few for from further get got had has have having he her
  here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of
  off on once only or other ought our ours ourselves out over own same she should so some such than that the their
  theirs them themselves then there these they this those through to too under until up us very was we were what when
  where which while who whom why will with would you your yours yourself yourselves
  im ive id ill youre youve youll hes shes theyre theyve weve were wont dont doesnt didnt cant couldnt shouldnt wouldnt
  isnt arent wasnt werent hasnt havent hadnt thats whats lets theres heres
  rt amp via u ur yall gonna wanna`.split(/\s+/),
);
// Words that only appear because of the placeholder dataset.
const SAMPLE_WORDS = new Set(['sample', 'post', 'placeholder', 'text']);

// Tailwind classes for the markup built here. Charts are one quiet series: viz marks, hairline rule-soft gridlines,
// text in the text tokens only. Bars get a 2px corner on the data end and stay square on the baseline.
// Behaviour hooks are data attributes (data-col, data-cursor, data-hit), never these classes.
const KPI = {
  // A size container, so a long value ("Wednesday") shrinks to its column instead of overflowing it.
  // Hairlines between figures, none before the first in each row: two per row, four from 40rem.
  item: 'min-w-0 border-l border-l-rule-soft px-4 @container max-sm:odd:border-l-0 max-sm:odd:pl-0 sm:first:border-l-0 sm:first:pl-0',
  label: 'text-micro text-meta uppercase',
  value: 'mt-1.5 text-[length:clamp(20px,17cqi,30px)] leading-[1.15] font-medium tracking-[-0.01em] whitespace-nowrap text-ink',
  sub: 'mt-1 text-caption text-meta',
};
const AREA = {
  svg: 'block h-auto w-full touch-pan-y overflow-visible focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-solid focus-visible:outline-focus',
  text: 'fill-meta font-sans text-[11px] tabular-nums',
  // Hairlines stay one device pixel wide (with the half-pixel positions in drawVolume).
  grid: 'stroke-rule-soft stroke-1 [shape-rendering:crispEdges] forced-colors:stroke-[GrayText]',
  base: 'stroke-underline stroke-1 [shape-rendering:crispEdges]',
  wash: 'fill-viz/10',
  line: 'fill-none stroke-viz stroke-2 [stroke-linecap:round] [stroke-linejoin:round] forced-colors:stroke-[CanvasText]',
  dot: 'fill-viz stroke-page stroke-2 forced-colors:fill-[CanvasText]',
  dotActive: 'fill-viz-hover stroke-page stroke-2 forced-colors:fill-[CanvasText]',
  // A page-coloured halo keeps the label readable where it crosses a gridline or the line.
  peak: 'fill-ink font-sans text-[11px] font-medium tabular-nums stroke-page stroke-4 [paint-order:stroke] [stroke-linejoin:round]',
  crosshair: 'stroke-meta stroke-1 [shape-rendering:crispEdges]',
};
// Hour and weekday columns. The 36px gutter (pl-9 on #hours and #weekdays) matches the monthly chart's plot edge,
// 18px above the tracks leaves room for the peak label, and every track is 8.5rem tall (h-34).
const COLS = {
  grid: 'pointer-events-none absolute top-[18px] right-0 left-9 h-34',
  tick: 'absolute right-0 left-0 h-0 border-t border-t-rule-soft forced-colors:border-[GrayText]',
  tickBase: 'absolute right-0 left-0 h-0 border-t border-t-underline forced-colors:border-[GrayText]',
  tickText: 'absolute top-0 right-[calc(100%+8px)] -translate-y-1/2 text-[11px] leading-none whitespace-nowrap text-meta tabular-nums',
  row: 'relative grid grid-cols-[repeat(var(--n),minmax(0,1fr))] pt-[18px]',
  // The whole slot is the hover and focus target, wider than the bar it holds; the focus ring goes on the track.
  col: 'group flex min-w-0 flex-col items-center gap-1.5 focus:outline-none',
  track: 'relative flex h-34 w-full items-end justify-center group-focus-visible:outline-2 group-focus-visible:outline-offset-1 group-focus-visible:outline-focus',
  // Never fills the slot: a third of it stays air, and no bar is wider than 24px.
  bar: 'w-[min(24px,66%)] rounded-t-[2px] bg-viz transition-[background-color] duration-120 ease-[ease] group-hover:bg-viz-hover group-focus-visible:bg-viz-hover forced-colors:bg-[CanvasText]',
  value: 'absolute left-1/2 -translate-x-1/2 text-[11px] leading-none font-medium whitespace-nowrap text-ink tabular-nums',
  label: 'min-h-[1.4em] text-[11px] leading-[1.4] whitespace-nowrap text-meta tabular-nums',
};
// Most-used words: a ranked list with a thin bar, on narrower columns below 30rem.
const WORD = {
  item: 'grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3.5rem] items-center gap-x-4 border-b border-b-rule-soft py-[7px] leading-normal max-[30rem]:grid-cols-[minmax(0,6rem)_minmax(0,1fr)_3rem] max-[30rem]:gap-x-3',
  text: 'truncate text-[15px] text-ink',
  track: 'block min-w-0',
  bar: 'block h-1.5 w-[calc(var(--p)*100%)] min-w-[2px] rounded-r-[2px] bg-viz forced-colors:bg-[CanvasText]',
  count: 'text-right text-[13px] text-meta tabular-nums',
  empty: 'py-3 text-[14px]',
};

let data;
let series = [];

// #/stats, or #/stats?year=2018 for one year.
export async function mount({ params, signal }) {
  scope = $('scope');
  series = [];
  data = await boot($('stats'));
  if (signal.aborted || !data) return;
  start(params, signal);
}

function start(params, signal) {
  const first = data.tweets.at(-1);
  const last = data.tweets[0];
  $('stats-range').textContent = `${plural(data.tweets.length, 'post')} from ${MONTHS[first.month]} ${first.year} to ${MONTHS[last.month]} ${last.year}.`;

  for (const y of [...data.years].reverse()) scope.add(new Option(String(y), String(y)));
  const initial = params.get('year');
  if (data.years.includes(Number(initial))) scope.value = initial;
  scope.addEventListener('change', () => {
    replace(href('stats', { params: scope.value ? { year: scope.value } : undefined }));
    render();
  });
  render();

  keepTipOnScroll(signal);

  let lastWidth = 0;
  const resize = new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (w !== lastWidth) {
      lastWidth = w;
      drawVolume();
    }
  });
  resize.observe($('volume-chart'));
  signal.addEventListener('abort', () => resize.disconnect());
}

// common.js hides the fixed tooltip on every scroll, and tabbing to a chart below the fold scrolls the page,
// so the tooltip would vanish the moment it appeared. Once the scroll settles, the focused mark shows it again,
// unless the reader dismissed it with Escape.
function keepTipOnScroll(signal) {
  let dismissed = false;
  document.addEventListener(
    'keydown',
    (e) => {
      dismissed = e.key === 'Escape' ? true : e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' ? false : dismissed;
    },
    { signal },
  );
  document.addEventListener(
    'focusin',
    () => {
      dismissed = false;
    },
    { signal },
  );
  window.addEventListener(
    'scrollend',
    () => {
      const el = document.activeElement;
      if (!dismissed && el?.matches('#volume-chart svg, [data-col]')) el.dispatchEvent(new FocusEvent('focus'));
    },
    { signal },
  );
}

function render() {
  const year = scope.value ? Number(scope.value) : null;
  const posts = year ? data.tweets.filter((t) => t.year === year) : data.tweets;
  $('volume-sub').textContent = year ? `Each point is one month of ${year}.` : 'Each point is one month.';
  renderKpis(posts);
  series = monthlySeries(posts, year);
  drawVolume();
  renderTable($('volume-table'), ['Month', 'Posts'], series.map((d) => [`${MONTHS[d.m]} ${d.y}`, fmtNum(d.value)]), 'Posts per month');
  renderHours(posts);
  renderWeekdays(posts);
  renderWords(posts);
}

// ---------- Headline numbers ----------

function renderKpis(posts) {
  const perMonth = new Map();
  const perDay = new Array(7).fill(0);
  for (const t of posts) {
    const key = t.year * 12 + t.month;
    perMonth.set(key, (perMonth.get(key) ?? 0) + 1);
    perDay[t.d.getUTCDay()]++;
  }
  // Ties go to the earliest month and to the first day in Monday-first order, matching the charts' peak labels.
  const [bestMonth, bestMonthCount] = [...perMonth].reduce((a, b) => (b[1] > a[1] || (b[1] === a[1] && b[0] < a[0]) ? b : a));
  const bestDay = [1, 2, 3, 4, 5, 6, 0].reduce((a, b) => (perDay[b] > perDay[a] ? b : a));
  const newest = posts[0];
  const oldest = posts.at(-1);

  const figures = [
    { label: 'Posts', value: fmtNum(posts.length), sub: `${fmtDate(oldest.d)} – ${fmtDate(newest.d)}` },
    { label: 'Busiest month', value: `${MONTHS_SHORT[bestMonth % 12]} ${Math.floor(bestMonth / 12)}`, sub: plural(bestMonthCount, 'post') },
    { label: 'Busiest weekday', value: WEEKDAYS[bestDay], sub: `${Math.round((perDay[bestDay] / posts.length) * 100)}% of posts` },
    { label: 'Per active month', value: (posts.length / perMonth.size).toFixed(1), sub: `${plural(perMonth.size, 'month')} with posts` },
  ];
  $('kpis').innerHTML = figures
    .map((f) => `<div class="${KPI.item}"><dt class="${KPI.label}">${f.label}</dt><dd class="${KPI.value}">${f.value}</dd><dd class="${KPI.sub}">${f.sub}</dd></div>`)
    .join('');
}

// ---------- Shared scale helpers ----------

// Axis ticks from 0 to a round top: 2–5 steps of 1, 2, 2.5 or 5 × 10ⁿ, picking the top with the least
// empty headroom (a 410 peak gets 0/250/500, not 0/200/400/600), then the step count nearest `target`.
// Post counts are whole numbers, so the step is never below 1 (no 0.5 ticks).
function scaleTicks(maxV, target) {
  const v = Math.max(1, maxV);
  let best = null;
  for (let p = 1; p <= v; p *= 10) {
    for (const k of [1, 2, 2.5, 5, 10]) {
      const step = k * p;
      const n = Math.ceil(v / step);
      if (!Number.isInteger(step) || n > 5 || (n < 2 && v > 1)) continue;
      const top = n * step;
      if (!best || top < best.top || (top === best.top && Math.abs(n - target) < Math.abs(best.n - target))) {
        best = { top, step, n };
      }
    }
  }
  const ticks = [];
  for (let t = 0; t <= best.top; t += best.step) ticks.push(t);
  return { top: best.top, ticks };
}

// ---------- Posts per month (area chart) ----------

function monthlySeries(posts, year) {
  if (!posts.length) return [];
  const oldest = posts.at(-1);
  const newest = posts[0];
  let y = year ?? oldest.year;
  let m = year ? 0 : oldest.month;
  const endKey = year ? year * 12 + 11 : newest.year * 12 + newest.month;
  const out = [];
  const index = new Map();
  while (y * 12 + m <= endKey) {
    index.set(y * 12 + m, out.length);
    out.push({ y, m, value: 0 });
    m = (m + 1) % 12;
    if (m === 0) y++;
  }
  for (const t of posts) out[index.get(t.year * 12 + t.month)].value++;
  return out;
}

function xLabels(s, x) {
  const yearScoped = Boolean(scope.value);
  const candidates = s
    .map((d, i) => ({ i, text: yearScoped ? MONTHS_SHORT[d.m] : String(d.y), keep: yearScoped || d.m === 0 || i === 0 }))
    .filter((c) => c.keep);
  const minGap = yearScoped ? 34 : 44;
  const kept = [];
  for (const c of candidates) {
    if (!kept.length || x(c.i) - x(kept.at(-1).i) >= minGap) kept.push(c);
    // A first year that doesn't start in January gives way to the next January's label only when they crowd,
    // so a series starting in, say, February still says which year its first eleven months are in.
    else if (kept.length === 1 && kept[0].i === 0 && !yearScoped && s[0].m !== 0) kept[0] = c;
  }
  return kept;
}

function drawVolume() {
  const wrap = $('volume-chart');
  const s = series;
  if (!s.length) {
    wrap.replaceChildren();
    return;
  }
  const W = Math.max(280, Math.round(wrap.clientWidth));
  const H = W < 480 ? 200 : 240;
  const m = { t: 24, r: 8, b: 28, l: 36 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const maxV = Math.max(1, ...s.map((d) => d.value));
  const { top, ticks } = scaleTicks(maxV, 4);
  const x = (i) => m.l + (s.length === 1 ? iw / 2 : (i * iw) / (s.length - 1));
  const y = (v) => m.t + ih - (v / top) * ih;
  const f = (n) => n.toFixed(1);
  // Hairlines on the half pixel stay one device pixel wide instead of blurring across two.
  const gy = (v) => f(Math.round(y(v)) + 0.5);

  const line = s.map((d, i) => `${i ? 'L' : 'M'}${f(x(i))},${f(y(d.value))}`).join('');
  const area = `${line}L${f(x(s.length - 1))},${f(y(0))}L${f(x(0))},${f(y(0))}Z`;

  // The first month with the most posts, the same tie rule as the "Busiest month" figure.
  const peakI = s.reduce((best, d, i) => (d.value > s[best].value ? i : best), 0);
  const peak = s[peakI];
  const px = x(peakI);
  const anchor = px < m.l + 60 ? 'start' : px > W - m.r - 60 ? 'end' : 'middle';
  const first = s[0];
  const last = s.at(-1);

  wrap.innerHTML = `
    <svg class="${AREA.svg}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img"
      aria-label="Posts per month from ${MONTHS[first.m]} ${first.y} to ${MONTHS[last.m]} ${last.y}. Peak: ${MONTHS[peak.m]} ${peak.y} with ${plural(peak.value, 'post')}. Use the arrow keys to read each month.">
      <g>
        ${ticks
          .map((v) => `<line class="${v === 0 ? AREA.base : AREA.grid}" x1="${m.l}" x2="${W - m.r}" y1="${gy(v)}" y2="${gy(v)}"/>
          <text class="${AREA.text}" x="${m.l - 8}" y="${f(y(v))}" dy="0.32em" text-anchor="end">${tickFmt.format(v)}</text>`)
          .join('')}
      </g>
      <path class="${AREA.wash}" d="${area}"/>
      <path class="${AREA.line}" d="${line}"/>
      <g>
        ${xLabels(s, x)
          .map((l) => {
            const lx = x(l.i);
            const a = lx > W - m.r - 16 ? 'end' : 'middle';
            return `<text class="${AREA.text}" x="${f(lx)}" y="${H - 8}" text-anchor="${a}">${l.text}</text>`;
          })
          .join('')}
      </g>
      ${peak.value ? `<circle class="${AREA.dot}" cx="${f(px)}" cy="${f(y(peak.value))}" r="4"/>
      <text class="${AREA.peak}" x="${f(px)}" y="${f(y(peak.value) - 12)}" text-anchor="${anchor}">${fmtNum(peak.value)} · ${MONTHS_SHORT[peak.m]} ${peak.y}</text>` : ''}
      <g data-cursor visibility="hidden">
        <line class="${AREA.crosshair}" y1="${m.t}" y2="${m.t + ih}"/>
        <circle class="${AREA.dotActive}" r="4"/>
      </g>
      <rect data-hit x="${m.l}" y="0" width="${iw}" height="${m.t + ih}" fill="transparent"/>
    </svg>`;

  const svg = wrap.querySelector('svg');
  const cursor = svg.querySelector('[data-cursor]');
  const vline = cursor.querySelector('line');
  const dot = cursor.querySelector('circle');
  let active = -1;

  const show = (i) => {
    active = Math.max(0, Math.min(s.length - 1, i));
    const d = s[active];
    const cx = f(x(active));
    vline.setAttribute('x1', cx);
    vline.setAttribute('x2', cx);
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', f(y(d.value)));
    cursor.setAttribute('visibility', 'visible');
    const r = svg.getBoundingClientRect();
    const scale = r.width / W;
    showTip(plural(d.value, 'post'), `${MONTHS[d.m]} ${d.y}`, r.left + x(active) * scale, r.top + y(d.value) * scale);
  };
  const hide = () => {
    cursor.setAttribute('visibility', 'hidden');
    hideTip();
  };
  const fromPointer = (e) => {
    const r = svg.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (W / r.width);
    show(s.length === 1 ? 0 : Math.round(((sx - m.l) / iw) * (s.length - 1)));
  };

  const hit = svg.querySelector('[data-hit]');
  hit.addEventListener('pointermove', fromPointer);
  hit.addEventListener('pointerdown', fromPointer);
  hit.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(active >= 0 ? active : s.length - 1));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    const next = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: s.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    show(next);
    // The tooltip is aria-hidden, so keyboard moves are announced through the page's live region.
    $('volume-live').textContent = `${MONTHS[s[active].m]} ${s[active].y}: ${plural(s[active].value, 'post')}`;
  });
}

// ---------- Hour and weekday (column charts) ----------

function columns(container, items) {
  const max = Math.max(...items.map((it) => it.value));
  const { top, ticks } = scaleTicks(max, 3);
  const peakI = max ? items.findIndex((it) => it.value === max) : -1;
  const pct = (v) => ((v / top) * 100).toFixed(2);

  // Gridlines sit behind the bars in the same box, so a tick at 50% lines up with half the track.
  const grid = document.createElement('div');
  grid.className = COLS.grid;
  grid.setAttribute('aria-hidden', 'true');
  grid.innerHTML = ticks
    .map((v) => `<span class="${v === 0 ? COLS.tickBase : COLS.tick}" style="bottom:${pct(v)}%"><span class="${COLS.tickText}">${tickFmt.format(v)}</span></span>`)
    .join('');

  const row = document.createElement('div');
  row.className = COLS.row;
  row.style.setProperty('--n', items.length);
  row.append(
    ...items.map((it, i) => {
      const col = document.createElement('div');
      col.className = COLS.col;
      col.dataset.col = '';
      col.setAttribute('role', 'img');
      col.setAttribute('aria-label', `${it.label}: ${plural(it.value, 'post')}`);
      const height = it.value ? `max(2px, ${pct(it.value)}%)` : '0px';
      const peakLabel = i === peakI ? `<span class="${COLS.value}" style="bottom:calc(${pct(it.value)}% + 4px)">${fmtNum(it.value)}</span>` : '';
      col.innerHTML = `<span class="${COLS.track}">${peakLabel}<span class="${COLS.bar}" style="height:${height}"></span></span><span class="${COLS.label}" aria-hidden="true">${it.tick}</span>`;
      bindTip(col, plural(it.value, 'post'), it.label);
      return col;
    }),
  );
  container.replaceChildren(grid, row);
  rovingFocus(container, '[data-col]');
}

function renderHours(posts) {
  const counts = new Array(24).fill(0);
  for (const t of posts) counts[t.d.getUTCHours()]++;
  const items = counts.map((value, h) => ({ value, label: `${pad(h)}:00–${pad(h)}:59 UTC`, tick: h % 3 === 0 ? pad(h) : '' }));
  columns($('hours'), items);
  renderTable($('hours-table'), ['Hour (UTC)', 'Posts'], items.map((it) => [it.label.replace(' UTC', ''), fmtNum(it.value)]), 'Posts by hour (UTC)');
}

function renderWeekdays(posts) {
  const counts = new Array(7).fill(0);
  for (const t of posts) counts[t.d.getUTCDay()]++;
  const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  const items = order.map((d) => ({ value: counts[d], label: WEEKDAYS[d], tick: WEEKDAYS[d].slice(0, 3) }));
  columns($('weekdays'), items);
  renderTable($('weekdays-table'), ['Weekday', 'Posts'], items.map((it) => [it.label, fmtNum(it.value)]), 'Posts by weekday (UTC)');
}

// ---------- Most-used words ----------

function topWords(posts, limit = 20) {
  const counts = new Map();
  for (const t of posts) {
    const text = t.lower.replace(/https?:\/\/\S+/g, ' ').replace(/@\w+/g, ' ');
    // Any script's letters (and combining accents), so "beyoncé" isn't cut to "beyonc".
    for (const [token] of text.matchAll(/\p{L}[\p{L}\p{M}'’]*[\p{L}\p{M}]/gu)) {
      const word = token.replace(/['’]s$/, '').replace(/['’]/g, '');
      if (word.length < 3 || STOP_WORDS.has(word)) continue;
      if (data.meta.sample && SAMPLE_WORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function renderWords(posts) {
  const words = topWords(posts);
  const max = words[0]?.[1] ?? 1;
  $('words').innerHTML = words.length
    ? words
        .map(([w, n]) => `<li class="${WORD.item}">
          <span class="${WORD.text}" title="${escapeHtml(w)}">${escapeHtml(w)}</span>
          <span class="${WORD.track}" aria-hidden="true"><span class="${WORD.bar}" style="--p:${(n / max).toFixed(4)}"></span></span>
          <span class="${WORD.count}">${fmtNum(n)}<span class="sr-only"> uses</span></span>
        </li>`)
        .join('')
    : `<li class="${WORD.empty}">Not enough text to count.</li>`;
}
