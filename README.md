# Tweet Log

A static, text-only fan archive of Kanye West's posts on X: a search page, timeline, stats, and a random-post page. The layout is inspired by [yecombinator.com](https://yecombinator.com).

> **Unofficial fan project. Not affiliated with or endorsed by Kanye West or X.**

A [Vite](https://vite.dev) project: a multi-page app with vanilla JavaScript modules and [Tailwind CSS](https://tailwindcss.com) v4 (through the `@tailwindcss/vite` plugin). No UI framework. Every post is in one JSON file.

## Run it locally

Needs Node 20.19+ or 22.12+.

```sh
npm install      # once
npm run dev      # Vite dev server at http://localhost:8000, with hot reload
npm run build    # production build into dist/
npm run preview  # serve dist/ at http://localhost:4173 to check the build
```

`npm start` is the same as `npm run dev`. Edit anything in `src/` or the HTML pages and the browser updates on its own.

Opening `index.html` straight from disk doesn't work: Vite has to process the stylesheet and the scripts. If an old server from an earlier version of this project is still running on port 8000, stop it first.

## Add or update posts

The site ships with **1,875 posts from May 2013 to Dec 2022**, imported from the public [yetweets](https://github.com/gergogyulai/yetweets) archive (itself built from Internet Archive snapshots and PolitiTweet). That file has no license, so check you're comfortable publishing it. To replace or extend the posts:

1. Get an archive file (see [Where to get data](#where-to-get-data)).
2. Run the importer on the unzipped export's `data` folder, so every part and the full text of long posts come along:
   ```sh
   npm run import -- --input path/to/export/data
   ```
   A single file works too: `--input path/to/tweets.js`.
3. Reload the site.

To add a newer export later without losing hand-edited tags:

```sh
npm run import -- --input path/to/new-export/data --merge
```

Run `npm run import -- --dry-run --input …` first to see the counts without writing anything. Relative paths are read from the folder you run the command in. `npm test` runs the importer's tests.

### Importer options

| Option | What it does |
|---|---|
| `--input`, `-i <path>` | Source file, or an export's `data` folder. Repeat it to combine several. |
| `--merge` | Keep posts already in `public/data/tweets.json`, then add new ones and update text and counts on existing ones. A long post that arrives cut off with "…" keeps the full text it already had. Filters such as `--exclude-replies` only apply to the input: posts already in the file stay. |
| `--retag` | Re-run keyword tagging on every post, replacing existing tags and tags from the input file. |
| `--handle <name>` | Handle used to build "View on X" links and to recognise his own threads. Default: `kanyewest`. |
| `--include-retweets` | Keep reposts of other accounts. They're skipped by default because they aren't his words. |
| `--exclude-replies` | Drop replies to other accounts. Replies to himself (threads) are kept. |
| `--out <file>` | Write somewhere other than `public/data/tweets.json`. |
| `--dry-run` | Print the summary only. |

### Accepted input formats

- **X data export**: point `--input` at its `data` folder and the importer reads:
  - `tweets.js` (older exports: `tweet.js`) and, for big accounts, `tweets-part1.js`, `tweets-part2.js`, …
  - `note-tweet.js`: the full text of posts over 280 characters. `tweets.js` only has them cut off with "…". The two files share no id, so each note is matched to its post by creation time and opening text.
  - `deleted-tweets.js` is never read: the author removed those posts.

  If you pass `tweets.js` alone, the importer names any parts you left out. Media links are removed from the text, `t.co` links are expanded, and HTML entities like `&amp;` are decoded. Of an edited post, only the latest version is kept.
- **CSV** (or `.tsv`/`.txt`) with a header row. Commas, semicolons and tabs all work, as do UTF-8 (with or without BOM) and Excel's UTF-16 "Unicode Text". Column names are matched loosely, ignoring case, spaces and dashes (`Tweet ID` = `tweet_id`):

  | Field | Accepted column names |
  |---|---|
  | id (required) | `id`, `id_str`, `tweet_id`, `status_id`, `post_id`, or a `url`/`link` column with `/status/<id>` |
  | text (required) | `text`, `full_text`, `content`, `tweet`, `tweet_text`, `body` |
  | date (required) | `created_at`, `date`, `timestamp`, `datetime`, `date_time`, `time`, `posted_at` |
  | likes | `likes`, `like_count`, `favorite_count`, `favorites` |
  | reposts | `retweets`, `retweet_count`, `reposts`, `repost_count` |
  | tags | `tags`, `topics` (separate with `;`, `|` or `,`) |
  | flags | `is_retweet`, `is_reply`, `in_reply_to_status_id`, `in_reply_to_screen_name` |

  Dates without a time zone are treated as UTC. Spreadsheet dates like `10/31/2018 20:19` work; a file is read as day-first (`31/10/2018`) when any date starts with a number above 12, and `31.10.2018` is always day-first. Counts may use `1,234`, `1.234` or `2.5K`.

  Keep ids as text. Excel rounds long numbers: `1.04905E+18` stops the import with the row that has it, and ids padded with zeros after the 15th digit get a warning. Both mean the real ids are gone, so re-export, or in Excel use *Data → From Text/CSV* and set the id column to Text.
- **JSON**: an array of archive objects, or a file already in this site's format. Ids written as bare numbers keep every digit.

The importer skips posts with a bad id or date, empty or media-only posts, reposts, older versions of edited posts, and duplicates. It prints how many it skipped of each, and the file and line of the first few bad rows.

### Topics

Tags come from keyword rules in [scripts/tags.json](scripts/tags.json). A post gets a tag when it contains any listed word or phrase (whole words, case-insensitive, optional plural `s`). Edit the lists, then run the import again with `--retag`.

You can also fix tags by hand in `public/data/tweets.json`. Each post is on its own line, so diffs stay readable. `--merge` keeps hand-edited tags unless you also pass `--retag`. A `tags` column in a CSV wins over keyword rules, but `--retag` replaces it too.

### Data format

```json
{"meta":{"handle":"kanyewest","generated":"2026-10-24T00:00:00.000Z","count":1,"sample":false},"tweets":[
{"id":"1049045474418380801","date":"2018-10-10T20:19:24.000Z","text":"Post text","likes":1200,"retweets":300,"tags":["music"],"url":"https://x.com/kanyewest/status/1049045474418380801"}
]}
```

`likes` and `retweets` may be `null`. If no post has engagement data, the "Most engaged" sort is disabled. Cards hide counts when both are 0, because archives often captured posts before anyone had liked them. `"sample": true` turns on a placeholder banner.

### Which posts are still on X

`public/data/x-status.json` lists the posts X still served when they were last checked:

```json
{"checked":"2026-10-24","live":["1072292910031360000","1018176769843593216"]}
```

Cards for those posts link to X. Every other card says "No longer on X" and links to the Wayback Machine instead. On 2026-10-24 only 2 of the 1,875 posts were still on X. Edit the file by hand when that changes; delete it and every card links to X again.

## Where to get data

- **Your own account**: X → Settings → Your account → *Download an archive of your data*. That export only contains your own posts. It arrives as a zip: unzip it and pass its `data` folder to `--input`.
- **Someone else's account**: you need a dataset you have the right to use. Don't scrape X: it breaks X's terms of service, and this project is designed around exported files for that reason.
- **Copyright**: post text belongs to its author. The site shows text only, links every entry to the original, and copies no images or media. Publishing a curated selection is easier to defend than mirroring a whole account. You can trim the input file before importing.

## Before you publish

1. Check the contact address for removal requests in the `page-about` template in [index.html](index.html).
2. Decide whether you're comfortable publishing the bundled dataset (no license; it includes his 2022 posts).
3. Optional: rename the site. "Tweet Log" appears in the `<title>` of each HTML page.

## Deploy

```sh
npm run build
```

This writes the finished site to `dist/`: `index.html`, one hashed CSS and one JavaScript file in `dist/assets/`, and `dist/data/tweets.json`. Pages use hash routes (`#/stats`), so any static host works with no rewrite rules. Run `npm run preview` to check the build at <http://localhost:4173>.

Upload the contents of `dist/` to any static host (GitHub Pages, Netlify, Cloudflare Pages). Links are relative, so it also works from a sub-path such as `https://<user>.github.io/<repo>/`. Run `npm run build` again after importing new posts.

## Project layout

```
index.html                   The only page: shared head and footer, plus one <template> per page
src/
  main.js                    Entry point: picks the page for the current #/route and mounts it
  lib/router.js              Hash routes: #/ or #/search?q=…, #/timeline[/2018], #/stats?year=…,
                             #/random[/<post id>], #/about
  pages/*.js                 One module per page, each exporting mount()
  lib/common.js              Data loading, post card, theme toggle, tooltips, "Copy link"
  styles/style.css           Tailwind entry: tokens, base styles, shared components
  styles/pages/*.css         Page-specific styles
  fonts/                     Inter (SIL Open Font License, see OFL.txt)
public/                      Copied into dist/ as is
  favicon.svg
  data/tweets.json           The dataset, fetched at data/tweets.json
  data/x-status.json         Which posts X still serves (see above)
scripts/import-archive.mjs   Builds public/data/tweets.json from an export (npm run import)
scripts/tags.json            Topic keyword rules
vite.config.js               Vite setup: Tailwind plugin, relative URLs
dist/                        Build output (npm run build); not checked in
```

## Design and accessibility

- A quiet white page with warm grey text, modelled on yecombinator.com, with a dark theme from the footer toggle (remembered per browser). Post cards are dark in both themes.
- Text colours are a few steps darker than the reference site's so that every one meets WCAG AA contrast. Colours are tokens at the top of `src/styles/style.css`, exposed as Tailwind utilities (`bg-page`, `text-ink`, `text-meta`, `border-rule`, `bg-card`, …); the `dark:` variant follows the site's toggle, not the OS.
- Post cards are drawn by the site from the archive. They load nothing from X, show counts only when the archive recorded them, and use real posting times.
- Search filters are stored in the URL, so a filtered view can be shared or bookmarked.
- Keyboard: <kbd>/</kbd> focuses search and <kbd>Esc</kbd> clears it. Each chart is one Tab stop, and the arrow keys step through its bars or months.
- Every chart has a text version: direct labels, `aria-label`s, or a "Show data table" panel.
- All dates and times are in UTC, so the hour and weekday charts don't change with the visitor's time zone.
