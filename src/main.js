// Entry point: one index.html, five pages. Each page's markup is a <template> in index.html; the router
// swaps it into <main> and calls the page's mount(), and an AbortController cleans up when you leave.
import { hideTip } from './lib/common.js';
import { current } from './lib/router.js';
import * as search from './pages/search.js';
import * as timeline from './pages/timeline.js';
import * as stats from './pages/stats.js';
import * as random from './pages/random.js';
import * as about from './pages/about.js';

const PAGES = { search, timeline, stats, random, about };
const main = document.getElementById('main');
let controller = null;
let first = true;

// Links from when every page was its own file (index.html?q=ego, stats.html?year=2018, random.html#<id>).
// Only index.html still exists, so these can only arrive with a query string or an old-style hash.
function upgradeOldLink() {
  if (location.hash.startsWith('#/')) return;
  const path = location.pathname.match(/(timeline|stats|random|about)\.html$/)?.[1];
  let hash = '';
  if (path === 'random' && location.hash.length > 1) hash = `#/random/${location.hash.slice(1)}`;
  else if (path) hash = `#/${path}${location.search}`;
  else if (location.search) hash = `#/search${location.search}`;
  if (hash) history.replaceState(null, '', `./${hash}`);
}

async function route() {
  const { name, parts, params } = current();
  controller?.abort();
  controller = new AbortController();
  const tpl = document.getElementById(`page-${name}`);

  hideTip();
  main.className = tpl.dataset.mainClass;
  main.replaceChildren(tpl.content.cloneNode(true));
  document.title = tpl.dataset.title;
  for (const a of document.querySelectorAll('[data-route]')) {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const arrived = !first;
  if (arrived) window.scrollTo(0, 0);

  await PAGES[name].mount({ root: main, parts, params, signal: controller.signal, first });
  first = false;

  // After a link to another page, focus starts at its heading, as a page load would, unless the page
  // placed it already (search puts it in the box).
  if (arrived && !controller.signal.aborted && !main.contains(document.activeElement)) {
    const h1 = main.querySelector('h1');
    if (h1) {
      h1.tabIndex = -1;
      h1.focus({ preventScroll: true });
    }
  }
}

// The skip link targets <main> directly: a plain #main would be read as a route.
document.querySelector('[data-skip]')?.addEventListener('click', (e) => {
  e.preventDefault();
  main.tabIndex = -1;
  main.focus();
});

upgradeOldLink();
window.addEventListener('hashchange', route);
route();
