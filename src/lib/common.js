// Shared helpers for every page: data loading, theme toggle, post rendering, tooltips.
import { href } from './router.js';

// Both files live in public/data, which Vite serves as is and copies into dist/.
const DATA_URL = `${import.meta.env.BASE_URL}data/tweets.json`;
// Snapshot of which posts X still serves ({ checked, live: [ids] }). Optional: without it every post links to X.
const STATUS_URL = `${import.meta.env.BASE_URL}data/x-status.json`;

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const numberFmt = new Intl.NumberFormat('en-US');
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

export const fmtNum = (n) => numberFmt.format(n);
export const fmtCompact = (n) => (n < 10000 ? numberFmt.format(n) : compactFmt.format(n));
export const fmtDate = (d) => dateFmt.format(d);
export const fmtDateTime = (d) => `${dateTimeFmt.format(d)} UTC`;
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
// "12:34 PM UTC · Jun 14, 2018", the order a post card uses.
export const fmtCardTime = (d) => `${timeFmt.format(d)} UTC · ${dateFmt.format(d)}`;
export const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;
export const pad = (n) => String(n).padStart(2, '0');

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Data ----------

let dataPromise;

export function loadData() {
  dataPromise ??= Promise.all([
    fetch(DATA_URL, { cache: 'no-cache' }).then(async (res) => {
      if (!res.ok) throw new Error(`${DATA_URL} returned HTTP ${res.status}`);
      return res.json();
    }),
    fetch(STATUS_URL, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null),
  ]).then(([raw, status]) => normalize(raw, status));
  return dataPromise;
}

function normalize(raw, status) {
  const list = Array.isArray(raw) ? raw : raw.tweets ?? [];
  const live = Array.isArray(status?.live) ? new Set(status.live.map(String)) : null;
  const tweets = [];
  for (const t of list) {
    const d = new Date(t.date);
    if (!t.id || !t.text || Number.isNaN(d.getTime())) continue;
    const likes = Number.isFinite(t.likes) ? t.likes : null;
    const retweets = Number.isFinite(t.retweets) ? t.retweets : null;
    tweets.push({
      id: String(t.id),
      text: String(t.text),
      lower: String(t.text).toLowerCase(),
      url: typeof t.url === 'string' && t.url.startsWith('https://') ? t.url : null,
      tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
      // true or false when the snapshot exists, null when nobody has checked.
      onX: live ? live.has(String(t.id)) : null,
      likes,
      retweets,
      engagement: (likes ?? 0) + (retweets ?? 0),
      d,
      ts: d.getTime(),
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
    });
  }
  tweets.sort((a, b) => b.ts - a.ts);
  return {
    meta: Array.isArray(raw) ? {} : raw.meta ?? {},
    tweets,
    tags: [...new Set(tweets.flatMap((t) => t.tags))].sort(),
    years: [...new Set(tweets.map((t) => t.year))].sort((a, b) => a - b),
    hasEngagement: tweets.some((t) => t.likes !== null || t.retweets !== null),
    xChecked: live ? status.checked ?? null : null,
  };
}

// Loads the dataset for a page. On failure, explains the problem inside `container` and returns null.
export async function boot(container) {
  try {
    const data = await loadData();
    if (data.meta.sample) showSampleNotice();
    if (!data.tweets.length) {
      showMessage(container, 'No posts yet', '<p><code>public/data/tweets.json</code> has no posts. Import an archive with <code>npm run import</code> — see the README.</p>');
      return null;
    }
    return data;
  } catch (err) {
    console.error(err);
    showMessage(
      container,
      'Could not load the archive',
      '<p>The site reads <code>data/tweets.json</code>, which browsers block when a page is opened straight from disk.</p>' +
        '<p>Serve the folder instead: run <code>npm start</code> and open <code>http://localhost:8000</code>.</p>',
    );
    return null;
  }
}

function showMessage(container, title, bodyHtml) {
  if (!container) return;
  container.innerHTML = `<div class="${ui.empty}"><h2 class="${ui.emptyH}">${escapeHtml(title)}</h2>${bodyHtml}</div>`;
}

function showSampleNotice() {
  const el = document.getElementById('data-notice');
  if (!el) return;
  el.innerHTML =
    '<p class="mt-4 mb-0 border border-rule px-3.5 py-2.5 text-[13px]"><strong>Sample data.</strong> These entries are placeholders for testing the layout, not real posts. ' +
    'The README explains how to import an archive.</p>';
  el.hidden = false;
}

// ---------- Theme ----------

// Light is the default; the head script applies a saved choice before the first paint.
function initThemeToggle() {
  const btn = document.querySelector('[data-theme-toggle]');
  if (!btn) return;
  const root = document.documentElement;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const sync = () => {
    const dark = root.dataset.theme === 'dark';
    btn.textContent = dark ? 'light mode' : 'dark mode';
    // Keeps the mobile browser bar matching the page background.
    themeColor?.setAttribute('content', dark ? '#0f0f0e' : '#ffffff');
  };
  btn.addEventListener('click', () => {
    const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Storage can be blocked; the toggle still works for this page view.
    }
    sync();
  });
  sync();
}

initThemeToggle();

// ---------- Rendering ----------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCT = /[.,:;!?)\]]+$/;

function termsRegex(terms) {
  if (!terms.length) return null;
  // Longest first, so searching "ab abc" marks all of "abc" rather than stopping at its prefix.
  const parts = [...terms].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Only at the start of a word, matching how search matches.
  return new RegExp(`(?<![\\p{L}\\p{N}])(${parts.join('|')})`, 'giu');
}

function highlight(segment, re) {
  if (!re) return escapeHtml(segment);
  // split() with one capture group puts the matches at odd indexes.
  return segment
    .split(re)
    .map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join('');
}

// Escapes post text, turns URLs into links and wraps search terms in <mark>.
export function renderText(text, terms = []) {
  const re = termsRegex(terms);
  let html = '';
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const trail = match[0].match(TRAILING_PUNCT)?.[0] ?? '';
    const url = match[0].slice(0, match[0].length - trail.length);
    const label = url.replace(/^https?:\/\/(www\.)?/, '');
    html += highlight(text.slice(last, match.index), re);
    html += `<a href="${escapeHtml(url)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(label.length > 40 ? `${label.slice(0, 39)}…` : label)}<span class="sr-only"> (opens in a new tab)</span></a>`;
    last = match.index + url.length;
  }
  return html + highlight(text.slice(last), re);
}

// Simple 18px line icons drawn for this site.
const ICON = {
  heart: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 20.5s-7.5-4.6-9.4-9.1C1.4 8.3 3.3 4.8 6.7 4.6c2.1-.1 3.9 1 5.3 2.9 1.4-1.9 3.2-3 5.3-2.9 3.4.2 5.3 3.7 4.1 6.8-1.9 4.5-9.4 9.1-9.4 9.1z"/></svg>',
  repost: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V7a2 2 0 0 1 2-2h12l-3-3M20 15v2a2 2 0 0 1-2 2H6l3 3"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
};

// The archive's own page for one post: the random page shows a specific post when given its id.
export const permalink = (id) => href('random', { parts: [id] });

// Tailwind classes for the pieces every page builds in JS, so pages don't retype them.
export const ui = {
  btn: 'inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-none border border-line bg-page px-[18px] leading-none text-ink transition-[background-color,transform] duration-150 ease-snap hover:bg-wash active:scale-[0.98] disabled:cursor-default disabled:opacity-50',
  control: 'h-12 rounded-none border border-line bg-page px-2.5 leading-[normal] text-ink',
  controlSm: 'h-9 rounded-none border border-line bg-page px-2.5 text-[13px] leading-[normal] text-ink',
  chip: 'group -mx-1.5 -my-2.5 inline-grid px-1.5 py-2.5 text-text no-underline transition-[color,transform] duration-150 ease-snap hover:text-ink active:scale-[0.97] aria-pressed:text-ink focus-visible:text-ink focus-visible:-outline-offset-2',
  chipText: 'whitespace-nowrap underline decoration-underline underline-offset-3 group-hover:decoration-underline-hover group-focus-visible:decoration-underline-hover group-aria-pressed:decoration-underline-hover group-aria-pressed:decoration-2 forced-colors:group-aria-pressed:decoration-[Highlight]',
  pill: 'inline-flex items-center gap-1.5 rounded-full border border-rule-soft px-2.5 py-1 text-[13px] leading-[1.4] text-text no-underline hover:border-underline-hover hover:text-ink',
  row: 'border-b border-rule p-2.5',
  rows: 'm-0 list-none p-0',
  rowItem: 'border-b border-rule-soft py-3',
  sectionH: 'mt-12 mb-3 text-[13px] leading-[1.4] font-normal tracking-[0.04em] text-meta uppercase',
  // decoration-current: the old rule's `text-decoration: underline` shorthand also reset the line to the text colour.
  crumbLink: 'inline-block py-1 no-underline hover:underline hover:decoration-current',
  h1: 'mt-5 mb-1 text-[24px] leading-[1.3] font-medium text-ink',
  intro: 'm-0 max-w-[600px] text-[13px] leading-normal text-meta',
  empty: 'py-8 [&_p]:m-0 [&_p]:mb-2 [&_p]:text-[14px]',
  emptyH: 'm-0 mb-1 text-[18px] font-medium text-ink',
};

// The post card, part by part. Links and highlights inside the text come from renderText, so they are
// styled from the paragraph.
const CARD = {
  root: 'my-6 w-full max-w-card rounded-xl border border-card-border bg-card px-4 py-3 font-card text-card-text scheme-dark transition-[background-color] duration-200 hover:bg-card-hover [&_:focus-visible]:outline-white forced-colors:border-[CanvasText]',
  head: 'flex items-center gap-3 pb-3',
  // A plain monogram rather than anyone's photo.
  avatar: 'grid size-12 flex-none place-items-center rounded-full border border-card-border bg-[#0f1419] text-[15px] leading-none font-bold tracking-[-0.01em]',
  name: 'block text-[15px] leading-5 font-bold',
  handle: 'block text-[15px] leading-5 text-card-dim',
  text: 'm-0 text-[length:clamp(17px,16px_+_0.5vw,20px)] leading-[1.2] whitespace-pre-wrap wrap-anywhere [&_a]:text-card-link [&_a]:no-underline [&_a:hover]:text-card-link [&_a:hover]:underline [&_mark]:rounded-[2px] [&_mark]:bg-card-mark [&_mark]:px-[0.1em] [&_mark]:text-inherit',
  time: 'mt-0.5 py-1.5 text-[15px] leading-5 text-card-dim [&_a]:text-inherit [&_a]:no-underline [&_a:hover]:text-inherit [&_a:hover]:underline',
  actions: 'mt-1 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-card-border pt-2 pb-1 text-[14px] leading-4 font-bold text-card-dim',
  stat: 'inline-flex min-h-7 items-center gap-1.5 text-card-dim [&_svg]:flex-none',
  tags: 'm-0 inline-flex list-none flex-wrap gap-x-3 gap-y-1 p-0 [&_a]:font-normal [&_a]:text-card-dim [&_a]:no-underline [&_a:hover]:text-card-text [&_a:hover]:underline',
  pill: 'mt-2 mb-1 flex min-h-8 items-center justify-center rounded-full border border-card-border px-4 py-1 text-center text-[15px] leading-5 no-underline',
  pillLive: 'font-bold text-card-link hover:bg-[rgb(107_201_251/0.1)] hover:text-card-link',
  pillGone: 'font-normal text-card-dim hover:bg-[rgb(139_152_165/0.1)] hover:text-card-text',
};

// A post as a dark card in the shape of a social-media embed. Everything on it is real: counts only
// appear when the archive recorded them, and a post X no longer serves says so instead of linking to it.
export function renderPost(t, { terms = [] } = {}) {
  const el = document.createElement('article');
  el.className = CARD.root;
  el.id = `post-${t.id}`;
  el.setAttribute('aria-label', `Post from ${fmtDate(t.d)}`);

  const stats = [];
  // Archives often capture a post seconds after it went up, so 0 likes and 0 reposts means "not recorded".
  if (t.engagement > 0) {
    if (t.likes) stats.push(`<span class="${CARD.stat} [&_svg]:text-card-red">${ICON.heart}${fmtCompact(t.likes)}<span class="sr-only"> likes</span></span>`);
    if (t.retweets) stats.push(`<span class="${CARD.stat}">${ICON.repost}${fmtCompact(t.retweets)}<span class="sr-only"> reposts</span></span>`);
  }

  const tags = t.tags.length
    ? `<ul class="${CARD.tags}" aria-label="Topics">${t.tags
        .map((tag) => `<li><a href="${escapeHtml(href('search', { params: { tag } }))}">${escapeHtml(tag)}</a></li>`)
        .join('')}</ul>`
    : '';

  let pill = '';
  if (t.onX === false) {
    const wayback = `https://web.archive.org/web/*/twitter.com/kanyewest/status/${encodeURIComponent(t.id)}*`;
    pill = `<a class="${CARD.pill} ${CARD.pillGone}" href="${escapeHtml(wayback)}" target="_blank" rel="noopener noreferrer">No longer on X · try the Wayback Machine<span class="sr-only"> (opens in a new tab)</span></a>`;
  } else if (t.url) {
    pill = `<a class="${CARD.pill} ${CARD.pillLive}" href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer">View on X<span class="sr-only"> (opens in a new tab)</span></a>`;
  }

  el.innerHTML = `
    <header class="${CARD.head}">
      <span class="${CARD.avatar}" aria-hidden="true">ye</span>
      <span><span class="${CARD.name}">ye</span><span class="${CARD.handle}">@kanyewest</span></span>
    </header>
    <p class="${CARD.text}">${renderText(t.text, terms)}</p>
    <p class="${CARD.time}"><a href="${permalink(t.id)}"><time datetime="${t.d.toISOString()}">${fmtCardTime(t.d)}</time></a></p>
    <footer class="${CARD.actions}">
      ${stats.join('')}
      <button class="${CARD.stat} cursor-pointer hover:text-card-text" type="button" data-copy="${escapeHtml(t.id)}">${ICON.link}<span>Copy link</span></button>
      ${tags}
    </footer>
    ${pill}`;
  return el;
}

// Screen-reader announcements for actions that don't move focus (e.g. "Link copied").
let announcer;
export function announce(message) {
  if (!announcer) {
    announcer = document.createElement('p');
    announcer.className = 'sr-only';
    announcer.setAttribute('aria-live', 'polite');
    document.body.append(announcer);
  }
  announcer.textContent = '';
  // A fresh text node after clearing makes repeated messages announce again.
  requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

// "Copy link" on any card copies the archive's own link to that post.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const label = btn.querySelector('span');
  const url = new URL(permalink(btn.dataset.copy), location.href).href;
  let message;
  try {
    await navigator.clipboard.writeText(url);
    message = 'Link copied';
  } catch {
    message = 'Could not copy';
  }
  label.textContent = message;
  announce(message);
  clearTimeout(btn.resetTimer);
  btn.resetTimer = setTimeout(() => {
    label.textContent = 'Copy link';
  }, 1500);
});

// ---------- Tooltip ----------

let tip;

export function showTip(value, label, x, y) {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'pointer-events-none fixed z-50 max-w-56 border border-line bg-page px-2.5 py-1.5 text-[12px] leading-[1.35] text-text';
    tip.setAttribute('aria-hidden', 'true'); // Every tooltip value is also in an aria-label or table.
    document.body.append(tip);
  }
  const strong = document.createElement('strong');
  strong.className = 'block text-[14px] font-medium text-ink';
  strong.textContent = value;
  const span = document.createElement('span');
  span.textContent = label;
  tip.replaceChildren(strong, span);
  tip.hidden = false;

  const { width, height } = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - width / 2), window.innerWidth - width - 8);
  const top = y - height - 12 < 8 ? y + 16 : y - height - 12;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

export function hideTip() {
  if (tip) tip.hidden = true;
}

// WCAG 1.4.13: a tooltip that appears on focus or hover must be dismissible without moving focus.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideTip();
});
// The tooltip is position: fixed, so it would be left behind when the page scrolls.
window.addEventListener('scroll', hideTip, { passive: true });

export function bindTip(el, value, label) {
  el.addEventListener('pointermove', (e) => showTip(value, label, e.clientX, e.clientY));
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', () => {
    const r = el.getBoundingClientRect();
    showTip(value, label, r.left + r.width / 2, r.top);
  });
  el.addEventListener('blur', hideTip);
}

const rovingContainers = new WeakSet();

// One Tab stop for a row of chart marks; arrow keys, Home and End move between them.
// Safe to call again after re-rendering the marks: the key handler is bound once and finds items live,
// so a second handler can't move focus a second step on the same key press.
export function rovingFocus(container, selector) {
  const items = () => [...container.querySelectorAll(selector)];
  items().forEach((el, i) => {
    el.tabIndex = i === 0 ? 0 : -1;
  });
  if (rovingContainers.has(container)) return;
  rovingContainers.add(container);
  container.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = list[Math.max(0, Math.min(list.length - 1, next))];
    list[i].tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  });
}

export function renderTable(container, headers, rows, caption = '') {
  const table = document.createElement('table');
  if (caption) {
    const cap = table.createCaption();
    cap.className = 'sr-only';
    cap.textContent = caption;
  }
  const head = table.createTHead().insertRow();
  headers.forEach((h, i) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    if (i > 0) th.className = 'num';
    head.append(th);
  });
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    row.forEach((cell, i) => {
      const td = tr.insertCell();
      td.textContent = cell;
      if (i > 0) td.className = 'num';
    });
  }
  container.replaceChildren(table);
}
