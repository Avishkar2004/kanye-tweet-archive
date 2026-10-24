// About page (#/about): fills in the dataset facts line from the data itself.
import { boot, fmtNum, fmtDate } from '../lib/common.js';

// A date string, or null when it is missing or not a real date.
const when = (s) => {
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime()) ? fmtDate(d) : null;
};

export async function mount({ signal }) {
  const facts = document.getElementById('facts');
  const data = await boot(null);
  if (signal.aborted || !data) return;
  const { tweets, meta, xChecked } = data;
  let text = `It currently holds ${fmtNum(tweets.length)} posts, from ${fmtDate(tweets.at(-1).d)} to ${fmtDate(tweets[0].d)}.`;
  const updated = when(meta.generated);
  if (updated) text += ` The dataset was last updated ${updated}.`;
  const checked = when(xChecked);
  if (checked) {
    const live = tweets.filter((t) => t.onX === true).length;
    text += live
      ? ` When X was last checked, on ${checked}, it still served ${fmtNum(live)} of them.`
      : ` When X was last checked, on ${checked}, it served none of them.`;
  }
  facts.textContent = text;
}
