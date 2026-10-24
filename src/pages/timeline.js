// Timeline page: a year index with a 12-month bar strip per year, and each year's posts on demand.
import {
  boot, renderText, permalink, escapeHtml, fmtNum, fmtDateTime, plural, pad, MONTHS, MONTHS_SHORT, bindTip, rovingFocus, ui,
} from '../lib/common.js';
import { href, replace } from '../lib/router.js';

const POSTS_PER_YEAR = 300; // Cap per expanded year; the rest are one link away in search.
const TOP_N = 5;

// Class strings for the markup this page builds. Behaviour hooks are data attributes (data-month), not these.
const CLS = {
  // One row per year, ruled like the reference's /years index.
  year: 'scroll-mt-4 border-b border-rule-soft pt-[18px] pb-3',
  // The baseline is painted on the list rather than on each track, so it runs unbroken under the 6px gaps
  // and ends flush with the column.
  months: 'm-0 grid list-none grid-cols-12 gap-x-1.5 bg-[linear-gradient(var(--rule),var(--rule))] bg-[position:0_72px] bg-[size:100%_1px] bg-no-repeat p-0',
  month: 'group block text-meta no-underline focus-visible:outline-offset-0',
  monthLink: 'hover:text-ink focus-visible:text-ink',
  track: 'flex h-18 items-end forced-colors:border-b forced-colors:border-[CanvasText]',
  bar: 'w-full rounded-t-[2px] bg-viz transition-[background-color] duration-120 ease-[ease] group-hover:bg-viz-hover group-focus-visible:bg-viz-hover forced-colors:bg-[CanvasText] forced-colors:group-hover:bg-[Highlight] forced-colors:group-focus-visible:bg-[Highlight]',
  // 5px of top padding, 1px of it the baseline.
  label: 'block pt-[5px] text-center text-micro forced-colors:pt-1',
  // Sits over the empty tracks of a year with no posts.
  empty: 'pointer-events-none absolute inset-x-0 top-0 m-0 flex h-18 items-center justify-center text-caption text-meta',
  details: 'group/year open:pb-3',
  summary: 'group mt-2 inline-flex cursor-pointer list-none items-center gap-1.5 py-1.5 text-caption text-text transition-[color] duration-120 ease-[ease] select-none hover:text-ink [&::-webkit-details-marker]:hidden',
  summaryText: 'underline decoration-underline underline-offset-3 group-hover:decoration-underline-hover',
  postsH: 'mt-9 mb-1 text-[15px] leading-[1.4] font-medium text-ink first:mt-4',
  // Month headings inside the list sit closer than the shared section-heading spacing.
  monthH: 'mt-6 mb-0 text-[13px] leading-[1.4] font-normal tracking-[0.04em] text-meta uppercase',
  // The year's own rule closes the list, and month headings separate the groups.
  row: `${ui.rowItem} last:border-b-0`,
};

const CHEVRON =
  '<svg class="transition-[transform] duration-160 ease-snap group-open/year:transform-[rotate(180deg)]" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>';

let root, jump, intro, data;

// #/timeline, or #/timeline/2018 to open scrolled to a year.
export async function mount({ parts, signal }) {
  root = document.getElementById('timeline');
  jump = document.getElementById('year-jump');
  intro = document.getElementById('intro');
  data = await boot(root);
  if (signal.aborted || !data) return;
  render();
  if (parts[0]) document.getElementById(`y${parts[0]}`)?.scrollIntoView();
  // Jumping to a year scrolls in place and records it in the address, without re-rendering the page,
  // so years already opened stay open.
  jump.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-year]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    document.getElementById(`y${a.dataset.year}`)?.scrollIntoView();
    replace(a.getAttribute('href'));
  });
}

function render() {
  const first = data.years[0];
  const last = data.years.at(-1);
  // Every year in the range gets a row, so a year with nothing archived shows as a gap.
  const years = [];
  for (let y = first; y <= last; y++) years.push({ year: y, months: Array.from({ length: 12 }, () => []), total: 0 });
  // data.tweets is newest-first; walk it backwards so each month's list reads oldest to newest.
  for (let i = data.tweets.length - 1; i >= 0; i--) {
    const t = data.tweets[i];
    const y = years[t.year - first];
    y.months[t.month].push(t);
    y.total++;
  }

  // One scale for every year, so bar heights compare across the whole timeline.
  const peak = Math.max(...years.flatMap((y) => y.months.map((m) => m.length)));

  const oldest = data.tweets.at(-1).d;
  const newest = data.tweets[0].d;
  intro.textContent =
    `${fmtNum(data.tweets.length)} archived posts, ${monthYear(oldest)} – ${monthYear(newest)}. ` +
    'Each bar is one month, on one scale for every year; select one to read that month in search. Months and times are UTC.';

  // One flex row, so the label and the years wrap together like the search page's "try" row.
  jump.innerHTML = `
    <div class="flex flex-wrap items-baseline gap-x-3.5 gap-y-2 text-caption">
      <span class="select-none text-micro text-faint" aria-hidden="true">jump to</span>
      ${years.map(({ year }) => `<a class="${ui.chip}" href="${href('timeline', { parts: [year] })}" data-year="${year}"><span class="${ui.chipText}">${year}</span></a>`).join('')}
    </div>`;
  jump.hidden = false;

  root.replaceChildren(...years.map((y) => yearRow(y, peak)));
}

function monthYear(d) {
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function yearRow({ year, months, total }, peak) {
  const section = document.createElement('section');
  section.className = CLS.year;
  section.id = `y${year}`;
  section.setAttribute('aria-labelledby', `y${year}-h`);
  section.innerHTML = `
    <div class="flex items-baseline justify-between gap-4">
      <h2 id="y${year}-h" class="m-0 text-[18px] leading-[1.4] font-medium text-ink">${year}</h2>
      <p class="m-0 text-caption text-meta">${plural(total, 'tweet')}</p>
    </div>`;
  section.append(monthStrip(year, months, total, peak));
  if (total) section.append(disclosure(year, months, total));
  return section;
}

function monthStrip(year, months, total, peak) {
  const wrap = document.createElement('div');
  wrap.className = 'relative mt-3';
  const list = document.createElement('ol');
  list.className = CLS.months;
  list.setAttribute('aria-label', `Posts per month in ${year}. Arrow keys move between months.`);
  months.forEach((posts, m) => list.append(monthItem(year, m, posts.length, peak)));
  // One Tab stop per year; arrows, Home and End move between its months, empty ones included.
  rovingFocus(list, '[data-month]');
  // Tab lands on the first month that has posts rather than on an empty January.
  const firstLink = list.querySelector('a[data-month]');
  if (firstLink) {
    list.querySelector('[tabindex="0"]').tabIndex = -1;
    firstLink.tabIndex = 0;
  }
  wrap.append(list);
  if (!total) {
    // Without this, a row of empty tracks could pass for a chart that failed to draw.
    const note = document.createElement('p');
    note.className = CLS.empty;
    note.setAttribute('aria-hidden', 'true');
    note.textContent = `No posts in the archive from ${year}`;
    wrap.append(note);
  }
  return wrap;
}

function monthItem(year, m, n, peak) {
  const li = document.createElement('li');
  const el = document.createElement(n ? 'a' : 'span');
  el.className = n ? `${CLS.month} ${CLS.monthLink}` : CLS.month;
  el.dataset.month = `${year}-${pad(m + 1)}`;
  el.setAttribute('aria-label', `${MONTHS[m]} ${year}: ${plural(n, 'post')}`);
  if (n) el.href = monthHref(year, m);
  else el.setAttribute('role', 'img');
  // A percentage of a fixed-height track, so the bar can't collapse; 2px keeps a one-post month visible.
  const bar = n ? `<span class="${CLS.bar}" style="height:max(2px, ${((n / peak) * 100).toFixed(2)}%)"></span>` : '';
  el.innerHTML = `
    <span class="${CLS.track}">${bar}</span>
    <span class="${CLS.label}" aria-hidden="true"><span class="min-[480px]:hidden">${MONTHS_SHORT[m][0]}</span><span class="hidden min-[480px]:inline">${MONTHS_SHORT[m]}</span></span>`;
  bindTip(el, plural(n, 'post'), `${MONTHS[m]} ${year}`);
  li.append(el);
  return li;
}

function monthHref(year, m) {
  const mm = pad(m + 1);
  // Day 0 of the next month is this month's last day, so February gets 29 in leap years.
  const lastDay = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
  return href('search', { params: { from: `${year}-${mm}-01`, to: `${year}-${mm}-${pad(lastDay)}`, sort: 'oldest' } });
}

function disclosure(year, months, total) {
  const details = document.createElement('details');
  details.className = CLS.details;
  details.innerHTML = `<summary class="${CLS.summary}"><span class="${CLS.summaryText}">read the ${plural(total, 'post')} from ${year}</span>${CHEVRON}</summary>`;
  const body = document.createElement('div');
  details.append(body);
  // Rendered on first open: a few hundred rows per year would slow the first paint for nothing.
  details.addEventListener('toggle', () => {
    if (details.open && !body.childElementCount) fillYear(body, year, months, total);
  });
  return details;
}

function fillYear(body, year, months, total) {
  const parts = [];

  // Archives often capture a post before anyone liked it, so 0 means "not recorded" and is left out.
  const top = months
    .flat()
    .filter((t) => t.likes > 0)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, TOP_N);
  if (top.length) {
    const title = top.length === 1 ? 'Most liked' : `Top ${top.length} by likes`;
    parts.push(`<h3 class="${CLS.postsH}">${title}</h3><ol class="${ui.rows}">${top.map(postRow).join('')}</ol>`);
  }

  const capped = total > POSTS_PER_YEAR;
  parts.push(`<h3 class="${CLS.postsH}">${capped ? `The first ${POSTS_PER_YEAR} posts` : 'Every post'}, oldest first</h3>`);
  let left = POSTS_PER_YEAR;
  months.forEach((posts, m) => {
    if (!posts.length || left <= 0) return;
    const shown = posts.slice(0, left);
    left -= shown.length;
    const count = shown.length < posts.length ? `${fmtNum(shown.length)} of ${plural(posts.length, 'post')}` : plural(posts.length, 'post');
    parts.push(`<h4 class="${CLS.monthH}">${MONTHS[m]} · ${count}</h4><ol class="${ui.rows}">${shown.map(postRow).join('')}</ol>`);
  });

  if (capped) {
    parts.push(
      `<p class="mt-6 mb-0 text-caption text-meta">Showing the first ${POSTS_PER_YEAR} of ${fmtNum(total)}. ` +
        `<a href="${escapeHtml(href('search', { params: { year, sort: 'oldest' } }))}">Read all ${fmtNum(total)} from ${year} in search</a>.</p>`,
    );
  }
  body.innerHTML = parts.join('');
}

// A compact text row: the post, then its date (the archive's own link to it) and only what was recorded.
function postRow(t) {
  const link = 'inline-block -my-[5px] py-[5px]'; // A 24px hit area without changing the line's height.
  const meta = [
    `<a class="${link}" href="${escapeHtml(permalink(t.id))}"><time datetime="${t.d.toISOString()}">${fmtDateTime(t.d)}</time></a>`,
  ];
  if (t.likes > 0) meta.push(`<span>${plural(t.likes, 'like')}</span>`);
  if (t.onX === false) meta.push('<span>no longer on X</span>');
  else if (t.url) {
    meta.push(`<a class="${link}" href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer">view on X<span class="sr-only"> (opens in a new tab)</span></a>`);
  }
  return `
    <li class="${CLS.row}">
      <p class="m-0 text-base/normal whitespace-pre-wrap text-ink wrap-anywhere">${renderText(t.text)}</p>
      <p class="mt-1.5 mb-0 flex flex-wrap gap-x-3 gap-y-0.5 text-micro text-meta">${meta.join('')}</p>
    </li>`;
}
