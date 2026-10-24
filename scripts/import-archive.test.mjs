// Tests for import-archive.mjs. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./import-archive.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'tweet-log-import-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

function write(name, content) {
  const path = join(dir, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  return path;
}

// Runs the importer; returns { code, out, posts } where posts come from the written file.
function run(args, name = 'out.json') {
  const out = join(dir, name);
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--out', out], { encoding: 'utf8', env: { ...process.env, INIT_CWD: dir } });
  let posts = [];
  try {
    posts = JSON.parse(readFileSync(out, 'utf8')).tweets;
  } catch {}
  return { code: r.status, out: r.stdout + r.stderr, posts };
}

const tweet = (id, text, extra = {}) => ({
  tweet: { id_str: id, id, created_at: 'Wed Oct 10 20:19:24 +0000 2018', full_text: text, favorite_count: '7', retweet_count: '2', entities: { urls: [] }, ...extra },
});
const ytd = (name, list) => `window.YTD.${name} = ${JSON.stringify(list, null, 2)}`;

test('export folder: parts, note-tweet full text, edits, deleted, reposts, threads', () => {
  const long = 'Every structure we build should serve the family first. '.repeat(8).trim();
  const ed = { editTweetIds: ['1700000000000000001', '1700000000000000002'] };
  write('export/data/tweets.js', ytd('tweets.part0', [
    tweet('1650000000000000001', `${long.slice(0, 270)}…`, { created_at: 'Mon May 01 12:00:00 +0000 2023' }),
    tweet('1049045474418380801', 'Album &amp;amp; tour soon \nhttps://t.co/m1', { entities: { urls: [], media: [{ url: 'https://t.co/m1' }] } }),
    tweet('1049045474418380802', '2/ thread', { in_reply_to_status_id_str: '1049045474418380801', in_reply_to_screen_name: 'kanyewest' }),
    tweet('1049045474418380803', '@someone thanks', { in_reply_to_status_id_str: '1', in_reply_to_screen_name: 'someone' }),
  ]));
  write('export/data/tweets-part1.js', ytd('tweets.part1', [
    tweet('1700000000000000001', 'Sunday service', { edit_info: { initial: ed } }),
    tweet('1700000000000000002', 'Sunday Service is back', { edit_info: { edit: { initialTweetId: '1700000000000000001', editControlInitial: ed } } }),
    tweet('1100000000000000000', 'RT @other: not his words'),
  ]));
  write('export/data/note-tweet.js', ytd('note_tweet.part0', [
    { noteTweet: { noteTweetId: '1650000000999999999', createdAt: '2023-05-01T12:00:00.000Z', core: { text: long, urls: [] } } },
  ]));
  write('export/data/deleted-tweets.js', ytd('deleted_tweets.part0', [tweet('1690000000000000001', 'gone', { deleted_at: 'x' })]));

  const r = run(['--input', 'export/data', '--exclude-replies']);
  assert.equal(r.code, 0, r.out);
  const byId = Object.fromEntries(r.posts.map((p) => [p.id, p]));
  assert.equal(byId['1650000000000000001'].text, long);
  assert.equal(byId['1049045474418380801'].text, 'Album & tour soon');
  assert.ok(byId['1049045474418380802'], 'his own thread survives --exclude-replies');
  assert.ok(!byId['1049045474418380803'], 'reply to someone else is dropped');
  assert.ok(byId['1700000000000000002'] && !byId['1700000000000000001'], 'only the newest edit is kept');
  assert.ok(!byId['1100000000000000000'] && !byId['1690000000000000001']);
  assert.equal(byId['1049045474418380801'].likes, 7);

  // Passing only tweets.js points at the parts left behind.
  assert.match(run(['--input', 'export/data/tweets.js', '--dry-run']).out, /also has note-tweet\.js, tweets-part1\.js/);
});

test('merge keeps full text when a later import is truncated', () => {
  const r = run(['--input', 'export/data/tweets.js', '--merge'], 'out.json');
  assert.equal(r.code, 0, r.out);
  assert.ok(!r.posts.find((p) => p.id === '1650000000000000001').text.endsWith('…'));

  // Without --out it merges into the site's dataset in public/data. --dry-run keeps that file untouched.
  const site = spawnSync(process.execPath, [SCRIPT, '-i', 'export/data/tweets.js', '--merge', '--dry-run'], { encoding: 'utf8', env: { ...process.env, INIT_CWD: dir } });
  assert.match(site.stdout, /Merged with [\d,]+ posts already in the file/, site.stdout + site.stderr);
});

test('bare numeric ids above 2^53 keep every digit', () => {
  write('big.json', '[{"id": 1049045474418380801, "text": "x", "date": "2018-10-10T20:19:24Z"}]');
  assert.equal(run(['-i', 'big.json']).posts[0].id, '1049045474418380801');
});

test('CSV: BOM, CRLF, semicolons, header names, quotes, day-first dates, counts', () => {
  write('semi.csv', '\ufeffTweet ID;Full Text;Created At;Like Count\r\n="1049045474418380801";"Hello; ""world""\r\nline two";31/10/2018 20:19;1.234\r\n1049045474418380805;5" screen;01/11/2018;2.5K\r\n\r\n');
  const r = run(['-i', 'semi.csv']);
  assert.equal(r.code, 0, r.out);
  const [b, a] = r.posts;
  assert.deepEqual([a.id, a.text, a.date, a.likes], ['1049045474418380801', 'Hello; "world"\nline two', '2018-10-31T20:19:00.000Z', 1234]);
  assert.deepEqual([b.text, b.date, b.likes], ['5" screen', '2018-11-01T00:00:00.000Z', 2500]);
});

test('CSV: UTF-16 tab-separated text from Excel', () => {
  const body = Buffer.from('id\ttext\tdate\r\n1049045474418380806\tCafé 🙏\t2018-10-12 10:00\r\n', 'utf16le');
  write('unicode.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), body]));
  const [p] = run(['-i', 'unicode.txt']).posts;
  assert.deepEqual([p.text, p.date], ['Café 🙏', '2018-10-12T10:00:00.000Z']);
});

test('CSV problems are reported with file and line', () => {
  write('sci.csv', 'id,text,date\n1.04905E+18,hello,2018-10-10\n');
  const sci = run(['-i', 'sci.csv', '--dry-run']);
  assert.equal(sci.code, 1);
  assert.match(sci.out, /scientific notation \(first: sci\.csv line 2/);

  write('bad.csv', 'id,text,date\n,no id,2018-10-10\n1049045474418380807,bad date,31/31/2018\n');
  assert.match(run(['-i', 'bad.csv', '--dry-run']).out, /bad\.csv line 2: no id[\s\S]*line 3: date "31\/31\/2018"/);

  write('quote.csv', 'id,text,date\n1049045474418380808,"never closed,2018-10-10\n');
  assert.match(run(['-i', 'quote.csv', '--dry-run']).out, /quote\.csv line 2: a quoted field never closes/);

  write('cols.csv', 'foo,bar\n1,2\n');
  assert.match(run(['-i', 'cols.csv', '--dry-run']).out, /no id column\. The header row has: foo, bar/);
});

test('every written post passes the front end checks', () => {
  for (const p of run(['-i', 'export/data', '-i', 'semi.csv']).posts) {
    assert.ok(p.id && p.text && !Number.isNaN(new Date(p.date).getTime()) && p.url.startsWith('https://'), JSON.stringify(p));
    assert.ok(Array.isArray(p.tags));
  }
});
