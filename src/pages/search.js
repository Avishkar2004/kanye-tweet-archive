// Search page (#/ and #/search?…): one search box over the whole archive, in the manner of yecombinator. The
// data is local, so it searches on every keystroke. Filters sit behind the icon cell, and the view is kept in
// the URL for sharing.
import { boot, renderPost, fmtNum, plural, ui } from '../lib/common.js';
import { href, replace } from '../lib/router.js';

const PAGE_SIZE = 50;
const SORTS = ['newest', 'oldest', 'engaged'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// "try" candidates, best first. Each is offered only if it matches MIN_MATCHES posts; the first SLOTS show
// and the rest wait in a queue to rotate in.
const SUGGESTIONS = [
  'yeezy', 'sunday service', 'ego', 'god', 'family', 'love', 'fashion', 'freedom', 'music', 'design',
  'jesus is king', 'adidas', 'chicago', 'free thought', 'album', 'donda', 'kids', 'respect',
];
const MIN_MATCHES = 3;
const SLOTS = 6;
const PHONE_SLOTS = 4; // the rest are hidden below 520px, see suggestionChip()
const ROTATE_MS = 6000;
const URL_DELAY_MS = 300; // Safari throws after 100 replaceState calls in 30s, so keystrokes are batched
// A rotating suggestion fades out, changes word, then fades back in while its chip has data-swapping
// (see rotateSuggestion).
const SWAP_TEXT = '[transition:opacity_180ms_ease,filter_180ms_ease,text-decoration-color_120ms_ease] group-data-swapping:opacity-0 group-data-swapping:blur-[2px]';

const $ = (id) => document.getElementById(id);

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Same breakpoint as the `max-[520px]:hidden` class, which Tailwind compiles to (width < 520px).
const phone = matchMedia('(width < 520px)');
const coarse = matchMedia('(pointer: coarse)');

// Elements and state of the mounted page; mount() resets all of them each time the page is shown.
let box, toggle, panel, controls, topics, tryRow, metaRow, metaCount, metaTime, clearBtn, noResults, list, moreBtn;
// `all` = "browse all": list every post while the box is empty. A non-default sort does the same.
let state;
let data = null;
let params;
let signal;
let terms = [];
let results = [];
let idle = true;
// The default list: posts with recorded likes, most liked first (0 means "not recorded", not "nobody").
let mostLiked = [];
let shown = 0;
let elapsed = 0;
let urlTimer = 0;
let queue = [];
let slot = 0;
// Result rows by post id, reused between keystrokes so cards already on screen don't replay their entrance.
let rows;
let drawnWith; // row -> the search terms its card was highlighted for

export async function mount(ctx) {
  ({ params, signal } = ctx);
  box = $('q');
  toggle = $('filter-toggle');
  panel = $('filters');
  controls = { year: $('year'), sort: $('sort'), from: $('from'), to: $('to') };
  topics = $('topics');
  tryRow = $('try');
  metaRow = $('meta-row');
  metaCount = $('meta-count');
  metaTime = $('meta-time');
  clearBtn = $('clear');
  noResults = $('no-results');
  list = $('results');
  moreBtn = $('more');
  state = { q: '', year: '', from: '', to: '', tag: '', sort: 'newest', all: false };
  data = null;
  terms = [];
  results = [];
  idle = true;
  mostLiked = [];
  shown = 0;
  urlTimer = 0;
  queue = [];
  slot = 0;
  rows = new Map();
  drawnWith = new WeakMap();
  signal.addEventListener('abort', () => clearTimeout(urlTimer));

  // The box works before the archive arrives: it shows the linked query, "/" and Escape are live, and
  // anything typed is kept.
  box.value = params.get('q') ?? '';
  box.addEventListener('input', () => {
    state.q = box.value;
    state.all = false;
    if (data) apply({ typing: true });
  });
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Handled here rather than left to type=search, so every browser clears first and blurs second.
    e.preventDefault();
    if (!box.value) {
      box.blur();
      return;
    }
    box.value = '';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Leaving the box (say, to click a result) writes any pending URL change first.
  box.addEventListener('blur', flushUrl);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable]')) return;
      e.preventDefault();
      box.focus();
    },
    { signal },
  );

  // The box takes focus, as on the reference: on first load unless the link asked for a particular view,
  // and whenever you come back to search. Not on touch screens, where focus would throw up the keyboard.
  const takeFocus = !coarse.matches && (ctx.first ? !params.toString() && document.activeElement === document.body : true);
  if (takeFocus) box.focus();

  // Last, so every helper is initialised before the first search runs.
  data = await boot(list);
  if (signal.aborted) return;
  if (data) start();
  else fail();
}

function start() {
  for (const y of [...data.years].reverse()) controls.year.add(new Option(String(y), String(y)));
  if (!data.hasEngagement) controls.sort.querySelector('[value="engaged"]').disabled = true;
  // The date pickers open on the archive's own range rather than today.
  for (const c of [controls.from, controls.to]) {
    c.min = isoDay(data.tweets.at(-1).d);
    c.max = isoDay(data.tweets[0].d);
  }
  mostLiked = data.tweets.filter((t) => t.likes > 0).sort((a, b) => b.likes - a.likes || b.ts - a.ts);
  renderTopics();
  renderSuggestions();

  readUrl();
  // The box already holds the linked query, or whatever was typed over it while the archive loaded.
  state.q = box.value;
  syncControls();
  setPanel(panelActive());
  apply();

  toggle.addEventListener('click', () => setPanel(panel.hidden));
  for (const [key, c] of Object.entries(controls)) {
    c.addEventListener('change', () => {
      state[key] = (key === 'from' || key === 'to') && !isDay(c.value) ? '' : c.value;
      apply();
    });
  }
  topics.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    state.tag = state.tag === b.dataset.tag ? '' : b.dataset.tag;
    syncControls();
    apply();
  });
  tryRow.addEventListener('click', onSuggestion);
  clearBtn.addEventListener('click', () => {
    Object.assign(state, { year: '', from: '', to: '', tag: '', sort: 'newest', all: false });
    syncControls();
    apply();
    // The button hides itself, so focus moves on to the box (not on touch screens: see onSuggestion).
    if (!coarse.matches) box.focus();
  });
  moreBtn.addEventListener('click', showMore);
  if (queue.length) {
    const timer = setInterval(rotateSuggestion, ROTATE_MS);
    signal.addEventListener('abort', () => clearInterval(timer));
  }
}

// boot() has already put the explanation where the results go.
function fail() {
  metaRow.hidden = true;
  box.disabled = toggle.disabled = true;
}

// ---------- Search ----------

const parseTerms = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
// Every word must start a word somewhere in the post, so "ego" finds "egos" but not "negotiation".
const wordStarts = new Map();
function startsWord(w) {
  let re = wordStarts.get(w);
  if (!re) {
    if (wordStarts.size > 500) wordStarts.clear(); // one entry per typed prefix; keep it bounded
    re = new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u');
    wordStarts.set(w, re);
  }
  return re;
}
const matches = (t, words) => words.every((w) => startsWord(w).test(t.lower));

function search() {
  const year = state.year ? Number(state.year) : null;
  // A range entered backwards still means the days between the two dates.
  const [lo, hi] = state.from && state.to && state.from > state.to ? [state.to, state.from] : [state.from, state.to];
  const from = lo ? Date.parse(`${lo}T00:00:00Z`) : -Infinity;
  const to = hi ? Date.parse(`${hi}T23:59:59.999Z`) : Infinity;
  const found = data.tweets.filter(
    (t) =>
      (year === null || t.year === year) &&
      t.ts >= from &&
      t.ts <= to &&
      (!state.tag || t.tags.includes(state.tag)) &&
      matches(t, terms),
  );
  // data.tweets is newest-first and filter() returns a new array, so reversing is safe.
  if (state.sort === 'oldest') found.reverse();
  else if (state.sort === 'engaged') found.sort((a, b) => b.engagement - a.engagement || b.ts - a.ts);
  return found;
}

const hasFilters = () => Boolean(state.year || state.from || state.to || state.tag);
const panelActive = () => hasFilters() || state.sort !== 'newest';

function apply({ typing = false } = {}) {
  // terms, not state.q, so a box holding only spaces counts as empty.
  terms = parseTerms(state.q);
  // Nothing asked for yet: the page shows suggestions and, under them, the most liked posts.
  idle = !terms.length && !hasFilters() && !state.all && state.sort === 'newest';
  const t0 = performance.now();
  results = idle ? mostLiked : search();
  elapsed = performance.now() - t0;

  tryRow.hidden = !idle;
  metaRow.hidden = idle && !mostLiked.length;
  clearBtn.hidden = !panelActive();
  syncToggle();

  shown = Math.min(PAGE_SIZE, results.length);
  showRows(results.slice(0, shown));
  updateMore();
  updateMeta();
  updateNoResults();

  clearTimeout(urlTimer);
  if (typing) urlTimer = setTimeout(writeUrl, URL_DELAY_MS);
  else writeUrl();
}

const fmtMs = (ms) => (ms < 1 ? '<1ms' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);

function updateMeta() {
  let count = '';
  let time = '';
  if (idle) {
    count = 'Most liked posts';
  } else if (!results.length) {
    count = 'No results found';
  } else if (!terms.length && !hasFilters()) {
    count = plural(results.length, 'post');
  } else {
    count =
      shown < results.length
        ? `Showing ${fmtNum(shown)} of ${plural(results.length, 'result')}`
        : `Found ${plural(results.length, 'result')}`;
    time = ` · ${fmtMs(elapsed)}`;
  }
  // The count is the live part; the timing is aria-hidden. Rewriting the same text would make screen
  // readers repeat it on every keystroke.
  if (metaCount.textContent !== count) metaCount.textContent = count;
  if (metaTime.textContent !== time) metaTime.textContent = time;
}

function updateNoResults() {
  noResults.hidden = idle || results.length > 0;
  if (noResults.hidden) return;
  noResults.textContent = !terms.length
    ? 'No posts match these filters. Try a wider date range, another year or another topic.'
    : hasFilters()
      ? 'Every word has to appear in the post, within the filters you set. Try fewer words, or clear the filters.'
      : 'Every word has to appear in the post. Try fewer or shorter words.';
}

// ---------- Results ----------

// Puts exactly `posts` in the list, in order, keeping the rows that are already there.
function showRows(posts) {
  const keep = new Set(posts.map((t) => t.id));
  for (const [id, row] of rows) {
    if (keep.has(id)) continue;
    row.remove();
    rows.delete(id);
  }
  const key = terms.join(' ');
  let next = list.firstElementChild;
  let entering = 0;
  for (const t of posts) {
    let row = rows.get(t.id);
    if (!row) row = makeRow(t);
    else if (drawnWith.get(row) !== key) drawCard(row, t);
    // Rows still on their way in (fast typing) are renumbered with the new ones, so the cascade
    // always runs top to bottom.
    if ('entering' in row.dataset) stagger(row, entering++);
    if (row === next) next = next.nextElementSibling;
    else list.insertBefore(row, next);
  }
}

// `i` counts the rows entering together, so they arrive in a quick cascade.
const stagger = (row, i) => {
  row.style.animationDelay = `${Math.min(i, 24) * 30}ms`;
};

function makeRow(t) {
  const row = document.createElement('div');
  row.className = `${ui.row} data-entering:animate-result-in motion-reduce:animate-none`;
  row.dataset.entering = '';
  // Once in, the row drops its animation, so re-sorting or refining later can't replay it.
  row.addEventListener(
    'animationend',
    () => {
      delete row.dataset.entering;
      row.style.animationDelay = '';
    },
    { once: true },
  );
  rows.set(t.id, row);
  drawCard(row, t);
  return row;
}

function drawCard(row, t) {
  row.replaceChildren(renderPost(t, { terms }));
  drawnWith.set(row, terms.join(' '));
}

function showMore() {
  const added = results.slice(shown, shown + PAGE_SIZE).map(makeRow);
  added.forEach(stagger);
  list.append(...added);
  shown += added.length;
  updateMore();
  updateMeta();
  const card = added[0]?.firstElementChild;
  if (card) {
    card.tabIndex = -1;
    card.focus();
  }
}

function updateMore() {
  const left = results.length - shown;
  moreBtn.hidden = left <= 0;
  if (left > 0) moreBtn.textContent = `Show ${fmtNum(Math.min(PAGE_SIZE, left))} more`;
}

// ---------- Filters ----------

function setPanel(open) {
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
}

function syncToggle() {
  const n = [state.year, state.from || state.to, state.tag, state.sort !== 'newest'].filter(Boolean).length;
  toggle.setAttribute('aria-label', n ? `Filters, ${n} active` : 'Filters');
  // A dot on the cell, so a closed panel can't hide an active filter.
  toggle.toggleAttribute('data-active', n > 0);
}

function syncControls() {
  for (const [key, c] of Object.entries(controls)) c.value = state[key];
  for (const b of topics.querySelectorAll('[data-tag]')) {
    b.setAttribute('aria-pressed', String(b.dataset.tag === state.tag));
  }
}

function renderTopics() {
  if (!data.tags.length) {
    topics.hidden = true;
    return;
  }
  for (const tag of data.tags) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `${ui.chip} cursor-pointer`;
    b.dataset.tag = tag;
    b.setAttribute('aria-pressed', 'false');
    b.append(textSpan(tag, ui.chipText));
    topics.append(b);
  }
}

function textSpan(text, className) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

// ---------- URL ----------

function readUrl() {
  const get = (k) => params.get(k) ?? '';
  // (q went straight into the box when the page opened.)
  // Normalised so "2018.0" or " 2018" still selects the 2018 option instead of a blank one.
  const year = Number(get('year'));
  state.year = data.years.includes(year) ? String(year) : '';
  state.from = isDay(get('from')) ? get('from') : '';
  state.to = isDay(get('to')) ? get('to') : '';
  state.tag = data.tags.includes(get('tag')) ? get('tag') : '';
  const sort = get('sort');
  state.sort = SORTS.includes(sort) && (sort !== 'engaged' || data.hasEngagement) ? sort : 'newest';
  // "browse all" is written as an explicit ?sort=newest.
  state.all = sort === 'newest';
}

// A real calendar day. Date.parse alone rolls "2023-02-30" over to March 2, while the date input shows it as
// blank, so a shared link would filter by a date nobody can see.
function isDay(s) {
  if (!ISO_DAY.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

const isoDay = (d) => d.toISOString().slice(0, 10);

function writeUrl() {
  urlTimer = 0;
  // A late write from a page that was left would overwrite the new page's address.
  if (signal.aborted) return;
  const p = new URLSearchParams();
  if (terms.length) p.set('q', state.q.trim());
  for (const k of ['year', 'from', 'to', 'tag']) if (state[k]) p.set(k, state[k]);
  if (state.sort !== 'newest' || state.all) p.set('sort', state.sort);
  replace(href('search', { params: p }));
}

function flushUrl() {
  if (!urlTimer) return;
  clearTimeout(urlTimer);
  writeUrl();
}

// ---------- Suggestions ----------

function renderSuggestions() {
  const usable = SUGGESTIONS.filter((s) => data.tweets.filter((t) => matches(t, parseTerms(s))).length >= MIN_MATCHES);
  queue = usable.slice(SLOTS);
  const browse = chipLink('browse all', href('search', { params: { sort: 'newest' } }));
  browse.dataset.all = '';
  tryRow.append(...usable.slice(0, SLOTS).map(suggestionChip), browse);
}

function suggestionChip(text, i) {
  const a = chipLink(text, searchHref(text));
  if (i >= PHONE_SLOTS) a.classList.add('max-[520px]:hidden');
  return a;
}

function chipLink(text, href) {
  const a = document.createElement('a');
  a.className = ui.chip;
  a.href = href;
  a.append(textSpan(text, `${ui.chipText} ${SWAP_TEXT}`));
  return a;
}

const searchHref = (text) => href('search', { params: { q: text } });

// A plain click searches in place; a modified or middle click opens the link as usual.
function onSuggestion(e) {
  const a = e.target.closest('a');
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const browse = 'all' in a.dataset;
  box.value = browse ? '' : a.textContent;
  state.q = box.value;
  state.all = browse;
  apply();
  // The chip is gone now, so focus goes to the box; not on touch screens, where it would raise the keyboard.
  if (!coarse.matches) box.focus();
}

// Every few seconds one visible slot trades its word for a queued one of similar length, so the row
// barely reflows. It holds still while someone is pointing at or inside the row.
function rotateSuggestion() {
  if (tryRow.hidden || document.hidden || reducedMotion.matches) return;
  if (tryRow.matches(':hover') || tryRow.contains(document.activeElement)) return;
  const chips = [...tryRow.querySelectorAll('a:not([data-all])')];
  const count = Math.min(chips.length, phone.matches ? PHONE_SLOTS : SLOTS);
  if (!count) return;
  const a = chips[slot % count];
  slot = (slot + 1) % count;
  const old = a.textContent;
  const near = queue.slice(0, 8).findIndex((s) => Math.abs(s.length - old.length) <= 3);
  const [next] = queue.splice(Math.max(near, 0), 1);
  queue.push(old);
  a.dataset.swapping = '';
  setTimeout(() => {
    a.firstElementChild.textContent = next;
    a.href = searchHref(next);
    delete a.dataset.swapping;
  }, 180);
}
