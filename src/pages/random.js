// Random page (#/random), and every post's own page (#/random/<id>), so a pick can be shared.
import { boot, renderPost, permalink, fmtDate, fmtNum, fmtCardTime, plural, pad, MONTHS, ui } from '../lib/common.js';
import { href, replace } from '../lib/router.js';

const $ = (id) => document.getElementById(id);
let stage, note, title, crumb, miss, shuffleBtn, topic;
const RELATED = 5;
// A "More from this month" row: two lines of post text at most, underlined on hover like other links.
const ROW = {
  link: 'group block no-underline',
  text: 'line-clamp-2 text-[15px] leading-normal font-medium text-ink wrap-anywhere underline decoration-transparent underline-offset-3 transition-[text-decoration-color] duration-120 ease-[ease] group-hover:decoration-underline-hover',
  time: 'mt-1 block text-micro text-meta',
};

let data;
let pool = [];
let current = null;
let signal;

// Following a link to another post re-mounts the page through the router, which also scrolls to the top
// and moves focus to the heading.
export async function mount(ctx) {
  signal = ctx.signal;
  stage = $('stage');
  note = $('note');
  title = $('title');
  crumb = $('crumb');
  miss = $('miss');
  shuffleBtn = $('shuffle');
  topic = $('topic');
  current = null;
  data = await boot(stage);
  if (signal.aborted) return;
  if (data) start(ctx.parts[0]);
  else shuffleBtn.disabled = topic.disabled = true;
}

function start(askedId) {
  const counts = new Map();
  for (const t of data.tweets) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  for (const tag of data.tags) topic.add(new Option(`${tag} (${fmtNum(counts.get(tag))})`, tag));
  if (!data.tags.length) $('topic-field').hidden = true;
  pool = data.tweets;

  const linked = askedId ? data.tweets.find((t) => t.id === askedId) : null;
  if (linked) {
    show(linked, true);
  } else {
    pick();
    // A link to a post that isn't here (or a garbled one) says so rather than quietly showing another.
    miss.hidden = !askedId;
  }

  shuffleBtn.addEventListener('click', () => {
    miss.hidden = true;
    pick();
  });
  topic.addEventListener('change', () => filterBy(topic.value));
  note.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-topic]');
    if (!btn) return;
    topic.value = btn.dataset.topic;
    filterBy(btn.dataset.topic);
    // The new post is from the same topic, so its note has the same button: keep focus there.
    note.querySelector(`[data-topic="${CSS.escape(btn.dataset.topic)}"]`)?.focus();
  });
}

function filterBy(tag) {
  miss.hidden = true;
  pool = tag ? data.tweets.filter((t) => t.tags.includes(tag)) : data.tweets;
  pick();
}

function pick() {
  if (!pool.length) {
    current = null;
    stage.innerHTML = `<div class="${ui.empty}"><h2 class="${ui.emptyH}">No posts in this topic</h2><p>Choose another topic, or any topic.</p></div>`;
    note.hidden = true;
    $('month').hidden = true;
    return;
  }
  let next;
  do next = pool[Math.floor(Math.random() * pool.length)];
  while (pool.length > 1 && next === current);
  show(next, false);
}

// `linked`: the post was asked for by its link, so the page names it instead of calling it random.
function show(t, linked) {
  current = t;
  const card = renderPost(t);
  card.classList.add('animate-result-in', 'motion-reduce:animate-none');
  stage.replaceChildren(card);
  if (!signal.aborted) replace(permalink(t.id));

  crumb.textContent = linked ? 'post' : 'random';
  title.textContent = linked ? `Post from ${fmtDate(t.d)}` : 'Random post';
  document.title = linked ? `“${clip(t.text, 60)}” — Tweet Log` : 'Random post — Tweet Log';

  renderNote(t);
  renderMonth(t);
}

function clip(text, max) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function renderNote(t) {
  // The card's own "No longer on X" pill already says when X dropped the post, so no extra line here.
  const parts = [];
  if (t.tags.length) {
    const p = document.createElement('p');
    p.className = 'm-0 mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1';
    const label = document.createElement('span');
    label.textContent = 'Shuffle within';
    p.append(label);
    for (const tag of t.tags) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${ui.chip} cursor-pointer`;
      btn.dataset.topic = tag;
      const span = document.createElement('span');
      span.className = ui.chipText;
      span.textContent = tag;
      btn.append(span);
      p.append(btn);
    }
    parts.push(p);
  }
  note.replaceChildren(...parts);
  note.hidden = !parts.length;
}

// The posts closest in time to this one, from the same UTC month, in posting order.
function renderMonth(t) {
  const section = $('month');
  const same = data.tweets.filter((o) => o.year === t.year && o.month === t.month);
  const near = same
    .filter((o) => o !== t)
    .sort((a, b) => Math.abs(a.ts - t.ts) - Math.abs(b.ts - t.ts))
    .slice(0, RELATED)
    .sort((a, b) => a.ts - b.ts);
  section.hidden = !near.length;
  if (!near.length) return;

  const monthName = `${MONTHS[t.month]} ${t.year}`;
  $('month-h').textContent = `More from ${monthName}`;
  $('month-list').replaceChildren(...near.map(monthRow));

  const last = new Date(Date.UTC(t.year, t.month + 1, 0)).getUTCDate();
  const ym = `${t.year}-${pad(t.month + 1)}`;
  const all = $('month-all');
  all.href = href('search', { params: { from: `${ym}-01`, to: `${ym}-${pad(last)}` } });
  all.textContent = `All ${plural(same.length, 'post')} from ${monthName} `;
  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  all.append(arrow);
}

function monthRow(o) {
  const li = document.createElement('li');
  li.className = ui.rowItem;
  const a = document.createElement('a');
  a.href = permalink(o.id);
  a.className = ROW.link;
  const text = document.createElement('span');
  text.className = ROW.text;
  // Links shortened the way the card shows them.
  text.textContent = clip(o.text.replace(/https?:\/\/(www\.)?/g, ''), 200);
  const time = document.createElement('time');
  time.className = ROW.time;
  time.dateTime = o.d.toISOString();
  time.textContent = fmtCardTime(o.d);
  a.append(text, time);
  li.append(a);
  return li;
}
