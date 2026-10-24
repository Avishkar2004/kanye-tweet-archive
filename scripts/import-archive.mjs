#!/usr/bin/env node
// Builds public/data/tweets.json from an exported archive. No dependencies; needs Node 18+.
//
//   node scripts/import-archive.mjs --input path/to/tweets.js [--input more.csv] [options]
//
// Accepted inputs:
//   - an X data export: its data/ folder, or tweets.js / tweet.js plus any tweets-part1.js, ...
//     note-tweet.js adds the full text of posts over 280 characters. deleted-tweets.js is skipped.
//   - a JSON array of archive objects, or a file already in this site's format
//   - a CSV or TSV with a header row: id, text, created_at (or date), likes, retweets, tags
//     Comma, semicolon or tab separated; UTF-8 or UTF-16.
//
// Options:
//   --input, -i <path>    Source file, or an export's data/ folder. Repeat for several.
//   --out <file>          Output path (default: public/data/tweets.json)
//   --handle <name>       Account handle used to build links and spot his own threads (default: kanyewest)
//   --merge               Keep posts already in the output file and add or update from the input
//   --retag               Re-run keyword tagging on every post, replacing tags from the file and the input
//   --include-retweets    Keep reposts of other accounts (skipped by default)
//   --exclude-replies     Drop replies to other accounts. Thread posts replying to himself are kept.
//   --dry-run             Print the summary without writing anything
//
// Relative paths are resolved from the folder you run the command in.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAGS_FILE = resolve(ROOT, 'scripts/tags.json');
// npm runs scripts from the project root; INIT_CWD is the folder the command was typed in.
const CWD = process.env.INIT_CWD || process.cwd();

const { values: opts } = parseArgs({
  options: {
    input: { type: 'string', short: 'i', multiple: true },
    out: { type: 'string', default: resolve(ROOT, 'public/data/tweets.json') },
    handle: { type: 'string', default: 'kanyewest' },
    merge: { type: 'boolean', default: false },
    retag: { type: 'boolean', default: false },
    'include-retweets': { type: 'boolean', default: false },
    'exclude-replies': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opts.help || !opts.input?.length) {
  // The header comment above doubles as the help text.
  const lines = (await readFile(fileURLToPath(import.meta.url), 'utf8')).split(/\r?\n/).slice(1);
  const usage = lines.slice(0, lines.findIndex((l) => !l.startsWith('//')));
  console.log(usage.map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(opts.help ? 0 : 1);
}
if (!/^\w{1,15}$/.test(opts.handle)) fail(`--handle must be a valid X handle without "@", got "${opts.handle}"`);

// ---------- Text ----------

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

function decodeEntities(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, e) => {
    if (e[0] !== '#') return NAMED_ENTITIES[e.toLowerCase()] ?? match;
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

// Zero-width spaces, word joiners and stray BOMs are invisible noise. ZWJ (U+200D) stays: emoji sequences need it.
const INVISIBLE = /[\u200b\u2060\ufeff]/g;

function cleanText(s, decode = true) {
  let text = String(s ?? '');
  // At most two passes: some tools encode twice ("&amp;amp;").
  for (let i = 0; decode && i < 2 && /&(#x?[\da-f]+|[a-z]+);/i.test(text); i++) text = decodeEntities(text);
  return text.replace(INVISIBLE, '').replace(/\r\n?/g, '\n').replace(/[ \t\u00a0]+$/gm, '').trim();
}

function expandLinks(text, mediaUrls, links) {
  let out = text;
  // Media links point at images/video; drop them rather than reproduce or link the media.
  for (const m of mediaUrls) out = out.split(m).join('');
  for (const [short, long] of links) if (short && long) out = out.split(short).join(long);
  return out;
}

// Comparable form of a post's text: no links, no ellipsis, single spaces.
const textKey = (s) => String(s).replace(/https?:\/\/\S+/g, ' ').replace(/[\s…]+/g, ' ').trim().toLowerCase();
const isTruncationOf = (short, long) =>
  short.endsWith('…') && long.length > short.length && textKey(long).startsWith(textKey(short));

// ---------- Values ----------

const pad = (n) => String(n).padStart(2, '0');

function parseDate(value, dayFirst = false) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    const d = new Date(value < 1e12 ? value * 1000 : value); // epoch s or ms
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  let s = String(value).trim();
  if (/^\d+$/.test(s)) return parseDate(Number(s));
  // X's export format: "Wed Oct 10 20:19:24 +0000 2018"
  const legacy = s.match(/^\w{3} (\w{3}) (\d{1,2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4}) (\d{4})$/);
  const sheet = s.match(/^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i);
  if (legacy) s = `${legacy[1]} ${legacy[2]} ${legacy[5]} ${legacy[3]} GMT${legacy[4]}`;
  // A date-time with no zone would be read as local time; treat it as UTC.
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.replace(' ', 'T')}Z`;
  else if (sheet) {
    // Spreadsheet dates: 10/31/2018 20:19, 31/10/2018 or 31.10.2018, read as UTC.
    const [a, b] = [Number(sheet[1]), Number(sheet[3])];
    const [day, month] = dayFirst || sheet[2] === '.' || a > 12 ? [a, b] : [b, a];
    let hour = Number(sheet[5] ?? 0);
    if (sheet[8]) hour = (hour % 12) + (/p/i.test(sheet[8]) ? 12 : 0);
    const d = new Date(`${sheet[4]}-${pad(month)}-${pad(day)}T${pad(hour)}:${sheet[6] ?? '00'}:${sheet[7] ?? '00'}Z`);
    return Number.isNaN(d.getTime()) || d.getUTCDate() !== day ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toCount(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;
  let s = String(v).trim().replace(/[\s\u00a0'’]/g, '');
  // Some scrapers write 1.2K or 3M.
  const short = s.match(/^(\d+(?:[.,]\d+)?)([km])$/i);
  if (short) return Math.round(parseFloat(short[1].replace(',', '.')) * (/k/i.test(short[2]) ? 1e3 : 1e6));
  // Counts are whole numbers, so 1.234 and 1,234 are both thousands separators.
  if (/^\d{1,3}([.,])\d{3}(\1\d{3})*$/.test(s)) s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

const truthy = (v) => /^(true|1|yes)$/i.test(String(v ?? '').trim());

// JSON.parse rounds integers above 2^53, which corrupts ids written as bare numbers; read them as strings.
const quoteBigInts = (s) => s.replace(/(?<!\\)("[\w-]+"\s*:\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"');

// ---------- Parsing ----------

function fromArchive(t) {
  // API-collected datasets keep the untruncated text of long posts in extended_tweet.
  const ext = t.extended_tweet ?? {};
  const raw = ext.full_text ?? t.full_text ?? t.text ?? '';
  const entities = ext.entities ?? t.entities ?? {};
  const extendedMedia = ext.extended_entities?.media ?? t.extended_entities?.media ?? [];
  const mediaUrls = [...(entities.media ?? []), ...extendedMedia].map((m) => m.url).filter(Boolean);
  const links = (entities.urls ?? []).map((u) => [u.url, u.expanded_url]);
  return {
    id: String(t.id_str ?? t.id ?? ''),
    text: cleanText(expandLinks(raw, mediaUrls, links)),
    date: parseDate(t.created_at),
    dateRaw: t.created_at,
    likes: toCount(t.favorite_count),
    retweets: toCount(t.retweet_count),
    // The archive's "retweeted" flag is always false; reposts show up as "RT @user: ..." text.
    isRetweet: /^RT @/.test(raw) || Boolean(t.retweeted_status),
    isReply: Boolean(t.in_reply_to_status_id_str ?? t.in_reply_to_status_id),
    replyTo: t.in_reply_to_screen_name,
    // Every version of an edited post is its own entry listing the same ids; the newest has the highest id.
    editIds: t.edit_info?.initial?.editTweetIds ?? t.edit_info?.edit?.editControlInitial?.editTweetIds,
    deleted: Boolean(t.deleted_at),
    mediaUrls,
  };
}

// note-tweet.js entry: { noteTweet: { noteTweetId, createdAt, core: { text, urls: [{ shortUrl, expandedUrl }] } } }
function fromNote(n) {
  const links = (n.core?.urls ?? []).map((u) => [u.shortUrl, u.expandedUrl]);
  return { text: cleanText(expandLinks(n.core?.text ?? '', [], links)), date: parseDate(n.createdAt) };
}

function fromSite(t) {
  const text = cleanText(t.text, false);
  return {
    id: String(t.id ?? ''),
    text,
    date: parseDate(t.date),
    dateRaw: t.date,
    likes: toCount(t.likes),
    retweets: toCount(t.retweets),
    tags: Array.isArray(t.tags) ? t.tags.map(String) : undefined,
    isRetweet: /^RT @/.test(text),
    isReply: false,
  };
}

const ID_COLUMNS = ['id', 'id_str', 'tweet_id', 'status_id', 'post_id'];
const URL_COLUMNS = ['url', 'link', 'permalink', 'tweet_url', 'post_url'];
const TEXT_COLUMNS = ['text', 'full_text', 'content', 'tweet', 'tweet_text', 'body'];
const DATE_COLUMNS = ['created_at', 'date', 'timestamp', 'datetime', 'date_time', 'time', 'posted_at'];

// Excel writes semicolons or tabs in many locales, and sometimes a "sep=;" line first.
function detectDelimiter(text) {
  const hint = text.match(/^sep=(.)\r?\n/i);
  if (hint) return { delimiter: hint[1], body: text.slice(hint[0].length) };
  const header = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const [best] = [',', ';', '\t'].map((d) => [d, header.split(d).length]).sort((a, b) => b[1] - a[1]);
  return { delimiter: best[0], body: text };
}

function parseCsv(file, text, delimiter) {
  const rows = [];
  let fields = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === '') {
      // A quote only opens a field at its start; elsewhere (5" screen) it is a literal character.
      quoted = true;
      quoteLine = line;
    } else if (c === delimiter) {
      fields.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      fields.push(field);
      rows.push({ fields, line: rowLine });
      rowLine = ++line;
      fields = [];
      field = '';
    } else field += c;
  }
  if (quoted) fail(`${file} line ${quoteLine}: a quoted field never closes. Look for a stray " in that row.`);
  if (field || fields.length) rows.push({ fields: [...fields, field], line: rowLine });
  const [header, ...body] = rows.filter((r) => r.fields.some((f) => f.trim() !== ''));
  if (!header) return [];
  // "Tweet ID", "tweet-id" and "TWEET_ID" all become tweet_id.
  const keys = header.fields.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  return body.map((r) => ({ line: r.line, row: Object.fromEntries(keys.map((k, i) => [k, (r.fields[i] ?? '').trim()])) }));
}

function pick(row, names) {
  for (const n of names) if (row[n] !== undefined && row[n] !== '') return row[n];
  return undefined;
}

function fromCsvRow(row, dayFirst) {
  const text = pick(row, TEXT_COLUMNS) ?? '';
  const tags = pick(row, ['tags', 'topics']);
  // ="123" and '123 are the usual tricks for keeping a long number as text in a spreadsheet.
  let id = String(pick(row, ID_COLUMNS) ?? '').replace(/^[='"]+|"$/g, '');
  if (!id) id = String(pick(row, URL_COLUMNS) ?? '').match(/\/status(?:es)?\/(\d+)/)?.[1] ?? '';
  const dateRaw = pick(row, DATE_COLUMNS);
  return {
    id,
    text: cleanText(text),
    date: parseDate(dateRaw, dayFirst),
    dateRaw,
    likes: toCount(pick(row, ['likes', 'like_count', 'favorite_count', 'favorites'])),
    retweets: toCount(pick(row, ['retweets', 'retweet_count', 'reposts', 'repost_count'])),
    tags: tags === undefined ? undefined : [...new Set(tags.split(/[;|,]/).map((s) => s.trim().toLowerCase()).filter(Boolean))],
    isRetweet: /^RT @/.test(text) || truthy(pick(row, ['is_retweet', 'isretweet', 'is_repost'])),
    isReply: truthy(pick(row, ['is_reply', 'isreply'])) || Boolean(pick(row, ['in_reply_to_status_id', 'in_reply_to_status_id_str', 'in_reply_to_tweet_id'])),
    replyTo: pick(row, ['in_reply_to_screen_name', 'in_reply_to_user', 'reply_to']),
    fromCsv: true,
  };
}

function readCsv(file, text) {
  const { delimiter, body } = detectDelimiter(text);
  const records = parseCsv(file, body, delimiter);
  if (!records.length) return [];
  const columns = Object.keys(records[0].row);
  const need = (names, what) => {
    if (!names.some((n) => columns.includes(n))) fail(`${file}: no ${what} column. The header row has: ${columns.join(', ')}. Rename one to ${names.slice(0, 3).join(', ')} (see README).`);
  };
  need([...ID_COLUMNS, ...URL_COLUMNS], 'id');
  need(TEXT_COLUMNS, 'text');
  need(DATE_COLUMNS, 'date');
  // Day-first files (31/10/2018) give themselves away with a first number above 12.
  const dayFirst = records.some(({ row }) => Number(String(pick(row, DATE_COLUMNS) ?? '').match(/^(\d{1,2})\//)?.[1]) > 12);
  return records.map(({ line, row }) => ({ ...fromCsvRow(row, dayFirst), where: `${basename(file)} line ${line}` }));
}

async function readText(file) {
  const buf = await readFile(file);
  // Excel's "Unicode Text" export is UTF-16 with a byte-order mark.
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  return buf.toString('utf8').replace(/^\ufeff/, '');
}

const isPostLike = (x) => ['tweet', 'noteTweet', 'id', 'id_str', 'text', 'full_text'].some((k) => k in x);

async function readSource(file) {
  const text = await readText(file);
  if (['.csv', '.tsv', '.txt'].includes(extname(file).toLowerCase())) return { posts: readCsv(file, text), notes: [] };
  let json;
  try {
    // X exports wrap the JSON in an assignment: window.YTD.tweets.part0 = [ ... ]
    json = JSON.parse(quoteBigInts(text.replace(/^\s*window\.YTD\.[\w.]+\s*=\s*/, '').replace(/;\s*$/, '')));
  } catch (err) {
    fail(`${file}: could not parse JSON (${err.message}). Use the file exactly as it came out of the export.`);
  }
  const list = (Array.isArray(json) ? json : Array.isArray(json?.tweets) ? json.tweets : null)?.filter((x) => x && typeof x === 'object');
  if (!list) fail(`${file}: expected an array of posts, or {"tweets": [...]}`);
  if (list.length && !isPostLike(list[0])) {
    fail(`${file}: entries have "${Object.keys(list[0]).join('", "')}", not posts. Use tweets.js, tweet.js or note-tweet.js from the export's data folder.`);
  }
  // Posts in deleted-tweets.js were removed by their author; don't republish them.
  const deleted = /^deleted[-_]tweets?\b/i.test(basename(file));
  const posts = [];
  const notes = [];
  list.forEach((item, i) => {
    if (item.noteTweet) return notes.push(fromNote(item.noteTweet));
    const p = item.tweet ? fromArchive(item.tweet) : 'full_text' in item || 'id_str' in item ? fromArchive(item) : fromSite(item);
    posts.push({ ...p, deleted: p.deleted || deleted, where: `${basename(file)} entry ${i + 1}` });
  });
  return { posts, notes };
}

// An export's data/ folder holds tweets.js (older: tweet.js), tweets-part1.js, … and note-tweet.js.
const EXPORT_FILE = /^(tweets?|note-tweet)(-part\d+)?\.js$/i;
const sameFile = (f) => (process.platform === 'win32' ? f.toLowerCase() : f);
const exportFiles = (dir) =>
  readdirSync(dir)
    .filter((f) => EXPORT_FILE.test(f))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((f) => resolve(dir, f));

function expandInputs(inputs) {
  const files = new Map();
  for (const input of inputs) {
    const path = resolve(CWD, input);
    if (!existsSync(path)) fail(`Input not found: ${path}`);
    const found = statSync(path).isDirectory() ? exportFiles(path) : [path];
    if (!found.length) fail(`${path}: no tweets.js, tweet.js or note-tweet.js in this folder. Point --input at the "data" folder of the unzipped export, or at a file.`);
    for (const f of found) files.set(sameFile(f), f);
  }
  // Passing only tweets.js from a split export would quietly lose the other parts.
  for (const dir of new Set([...files.values()].filter((f) => EXPORT_FILE.test(basename(f))).map(dirname))) {
    const missed = exportFiles(dir).filter((f) => !files.has(sameFile(f))).map((f) => basename(f));
    if (missed.length) console.warn(`Note: ${dir} also has ${missed.join(', ')}. Add ${missed.length === 1 ? 'it' : 'them'} with --input, or pass the folder to read every part.`);
  }
  return [...files.values()];
}

// note-tweet.js holds the full text of posts over 280 characters; tweets.js has them cut off with "…".
// A note's noteTweetId is not the post id, so match on creation time and check that the texts agree.
function applyNotes(posts, notes) {
  const pool = notes.filter((n) => n.text && n.date).map((n) => ({ ...n, ts: Date.parse(n.date), key: textKey(n.text) }));
  let matched = 0;
  for (const p of posts) {
    if (!pool.length) break;
    if (!p.mediaUrls || !p.date) continue; // archive posts only
    const head = textKey(p.text);
    const ts = Date.parse(p.date);
    const fits = (n) => n.text.length > p.text.length && n.key.startsWith(head);
    let i = head.length >= 10 ? pool.findIndex((n) => Math.abs(n.ts - ts) <= 2000 && fits(n)) : -1;
    // Fall back to the text alone for clearly cut-off posts with enough text to be unambiguous.
    if (i < 0 && p.text.endsWith('…') && head.length >= 40) i = pool.findIndex(fits);
    if (i < 0) continue;
    p.text = cleanText(expandLinks(pool[i].text, p.mediaUrls, []), false);
    pool.splice(i, 1);
    matched++;
  }
  return { matched, unmatched: pool.length };
}

// ---------- Tagging ----------

async function loadTagRules() {
  if (!existsSync(TAGS_FILE)) return [];
  let rules;
  try {
    rules = JSON.parse(await readFile(TAGS_FILE, 'utf8'));
  } catch (err) {
    fail(`${TAGS_FILE}: ${err.message}. Fix the JSON (often a missing comma or quote) and run again.`);
  }
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Object.entries(rules)
    .filter(([tag, words]) => !tag.startsWith('_') && Array.isArray(words) && words.length)
    .map(([tag, words]) => ({
      tag,
      // Whole words or phrases, case-insensitive, with an optional plural "s".
      re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escape).join('|')})s?(?![\\p{L}\\p{N}])`, 'iu'),
    }));
}

// ---------- Main ----------

const tagRules = await loadTagRules();
const autoTags = (text) => tagRules.filter((r) => r.re.test(text)).map((r) => r.tag);
const outPath = resolve(CWD, opts.out);
const inputs = expandInputs(opts.input);
const n = (x) => x.toLocaleString('en-US');

const posts = [];
const notes = [];
for (const file of inputs) {
  const source = await readSource(file);
  posts.push(...source.posts);
  notes.push(...source.notes);
}
const noteResult = applyNotes(posts, notes);

// A spreadsheet that showed ids as 1.04905E+18 has already thrown the real digits away.
const sci = posts.filter((p) => /^\d(\.\d+)?e\+?\d+$/i.test(p.id));
if (sci.length) {
  fail(`${sci.length === 1 ? '1 id is' : `${n(sci.length)} ids are`} in scientific notation (first: ${sci[0].where}, "${sci[0].id}"). Excel rounded them, so the real ids are lost.
Re-export from the original source, or in Excel use Data > From Text/CSV, set the id column to Text, and save again.`);
}
// Excel keeps 15 significant digits and pads the rest with zeros: 1049045474418380801 -> 1049045474418380000.
const longCsvIds = posts.filter((p) => p.fromCsv && p.id.length > 15);
const rounded = longCsvIds.filter((p) => /^\d+$/.test(p.id) && /^0+$/.test(p.id.slice(15)));
if (rounded.length && rounded.length >= longCsvIds.length / 2) {
  console.warn(`Warning: ${n(rounded.length)} ids end in zeros after the 15th digit (first: ${rounded[0].where}), which is how Excel rounds long numbers. Their links will open the wrong post; re-export with the id column formatted as Text.`);
}

const ids = new Set(posts.map((p) => p.id));
const newestEdit = (p) => [].concat(p.editIds ?? []).map(String).filter((x) => /^\d+$/.test(x)).reduce((a, b) => (BigInt(b) > BigInt(a) ? b : a), p.id);
const ownThread = (p) => String(p.replyTo ?? '').replace(/^@/, '').toLowerCase() === opts.handle.toLowerCase();
function problem(p) {
  if (!p.id) return 'no id';
  if (!/^\d+$/.test(p.id)) return `id "${p.id}" is not a number`;
  if (!p.date) return p.dateRaw ? `date "${p.dateRaw}" could not be read` : 'no date';
  return null;
}

const skipped = { invalid: 0, mediaOnly: 0, deleted: 0, edits: 0, retweets: 0, replies: 0, duplicates: 0 };
const problems = [];
const incoming = new Map();
for (const p of posts) {
  const bad = problem(p);
  if (bad) {
    skipped.invalid++;
    problems.push(`${p.where}: ${bad}`);
  } else if (!p.text) skipped.mediaOnly++;
  else if (p.deleted) skipped.deleted++;
  else if (newestEdit(p) !== p.id && ids.has(newestEdit(p))) skipped.edits++;
  else if (p.isRetweet && !opts['include-retweets']) skipped.retweets++;
  else if (p.isReply && !ownThread(p) && opts['exclude-replies']) skipped.replies++;
  else {
    if (incoming.has(p.id)) skipped.duplicates++;
    incoming.set(p.id, p);
  }
}

let existing = [];
if (opts.merge && existsSync(outPath)) {
  let current;
  try {
    current = JSON.parse(await readFile(outPath, 'utf8'));
  } catch (err) {
    fail(`${outPath} is not valid JSON (${err.message}), so it can't be merged into. Fix it, or run without --merge to replace it.`);
  }
  if (current.meta?.sample) console.log('The output file holds sample data, so it is replaced instead of merged.');
  else existing = Array.isArray(current.tweets) ? current.tweets : [];
}

const byId = new Map(existing.map((t) => [String(t.id), t]));
let added = 0;
let updated = 0;
for (const p of incoming.values()) {
  const prev = byId.get(p.id);
  if (prev) updated++;
  else added++;
  byId.set(p.id, {
    id: p.id,
    date: p.date,
    // Without note-tweet.js a long post arrives cut off with "…"; keep the full text from an earlier import.
    text: prev && isTruncationOf(p.text, String(prev.text ?? '')) ? prev.text : p.text,
    likes: p.likes ?? prev?.likes ?? null,
    retweets: p.retweets ?? prev?.retweets ?? null,
    // Tags from the source win, then tags already in the file (which may be hand-edited), then keyword rules.
    tags: p.tags ?? prev?.tags ?? autoTags(p.text),
    url: prev?.url ?? `https://x.com/${opts.handle}/status/${p.id}`,
  });
}
if (opts.retag) for (const t of byId.values()) t.tags = autoTags(t.text);

// Newest first; ties broken by id so the file diffs cleanly between runs.
const byIdDesc = (a, b) => b.id.length - a.id.length || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
const tweets = [...byId.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : byIdDesc(a, b)));
const meta = { handle: opts.handle, generated: new Date().toISOString(), count: tweets.length, sample: false };
// One post per line keeps the file compact and makes diffs readable.
const json = `{"meta":${JSON.stringify(meta)},"tweets":[\n${tweets.map((t) => JSON.stringify(t)).join(',\n')}\n]}\n`;

const count = (x, word) => `${n(x)} ${word}${x === 1 ? '' : 's'}`;
console.log(`Read ${count(posts.length, 'post')} from ${count(inputs.length, 'file')}.`);
if (notes.length) console.log(`Full text for ${count(noteResult.matched, 'long post')} from note-tweet.js${noteResult.unmatched ? ` (${count(noteResult.unmatched, 'note')} matched no post)` : ''}.`);
const labels = { invalid: 'with a bad id or date', mediaOnly: 'empty or media only', deleted: 'deleted by the author', edits: 'older versions of edited posts', retweets: 'reposts', replies: 'replies to others', duplicates: 'duplicates' };
const skips = Object.entries(skipped).filter(([, v]) => v).map(([k, v]) => `${n(v)} ${labels[k]}`);
if (skips.length) console.log(`Skipped: ${skips.join(', ')}.`);
for (const line of problems.slice(0, 5)) console.log(`  ${line}`);
if (problems.length > 5) console.log(`  …and ${n(problems.length - 5)} more.`);
if (existing.length) {
  const note = opts['exclude-replies'] ? ' --exclude-replies only filters the input, so replies already in the file stay.' : '';
  console.log(`Merged with ${n(existing.length)} posts already in the file.${note}`);
}
const untagged = tweets.filter((t) => !t.tags?.length).length;

if (opts['dry-run']) {
  console.log(`Dry run: would write ${count(tweets.length, 'post')} (${n(added)} new, ${n(updated)} updated, ${n(untagged)} untagged).`);
} else {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, json);
  const shown = relative(CWD, outPath);
  console.log(`Wrote ${count(tweets.length, 'post')} to ${shown && !shown.startsWith('..') ? shown : outPath} (${n(added)} new, ${n(updated)} updated, ${n(untagged)} untagged).`);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
