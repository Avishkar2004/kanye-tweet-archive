// Hash routes, so the site is one index.html that works on any static host without server rewrites:
//   #/  or  #/search?q=ego&tag=faith     search
//   #/timeline  or  #/timeline/2018      tweets by year (scrolled to a year)
//   #/stats?year=2018                    stats
//   #/random  or  #/random/<post id>     a random post, or one post's own page
//   #/about                              about

export const ROUTES = ['search', 'timeline', 'stats', 'random', 'about'];

// A malformed escape (say "%E0%A4%A") stays as typed, so the page can say the link is broken.
const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function current() {
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = '', ...parts] = path.split('/').filter(Boolean).map(decode);
  return { name: ROUTES.includes(name) ? name : 'search', parts, params: new URLSearchParams(qs) };
}

// href('search', { params: { q: 'ego' } }) → "#/search?q=ego"; href('random', { parts: [id] }) → "#/random/<id>".
export function href(name, { parts = [], params } = {}) {
  const qs = params ? new URLSearchParams(params).toString() : '';
  if (name === 'search' && !qs) return '#/';
  return `#/${[name, ...parts].map(encodeURIComponent).join('/')}${qs ? `?${qs}` : ''}`;
}

// Rewrites the address without a hashchange, so the page doesn't re-render (filters, shuffles).
export function replace(hash) {
  if (hash === location.hash || (hash === '#/' && !location.hash)) return;
  try {
    history.replaceState(history.state, '', hash);
  } catch {
    // Over the browser's rate limit: the page still works, the address bar just lags.
  }
}
