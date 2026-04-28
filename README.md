# NAV Ledger

A static, GitHub-Pages-friendly tool to value an Indian mutual fund portfolio
against AMFI's daily NAV file.

You search for schemes from the official AMFI list, enter your unit holdings,
and the page computes the current value, weight per scheme, and total
portfolio value. Holdings persist in `localStorage` and can be exported /
imported as JSON.

## How it works

Browsers cannot fetch `https://www.amfiindia.com/spages/NAVAll.txt` directly
because AMFI does not send permissive CORS headers. This repo solves that
with a GitHub Action that runs once a day, downloads the file, parses it to
a compact JSON, and commits the result to `data/nav.json`. The static site
reads that JSON.

```
amfi-portfolio-tracker/
├── index.html
├── styles.css
├── app.js
├── data/
│   └── nav.json              ← refreshed daily by GitHub Actions
├── scripts/
│   └── fetch_nav.py          ← parser
└── .github/workflows/
    └── update-nav.yml        ← cron job
```

## Setup (GitHub Pages)

1. Create a new repo on GitHub and push this folder to it.
2. **Settings → Pages →** *Build and deployment* → Source: **Deploy from a branch**, Branch: `main` / `(root)`.
3. **Settings → Actions → General →** *Workflow permissions*: select **Read and write permissions** (so the cron job can commit `data/nav.json`).
4. Open the **Actions** tab → *Update AMFI NAV* → **Run workflow** once manually to generate the first `data/nav.json`. After that it runs daily at 22:30 IST.
5. Open `https://<your-username>.github.io/<repo-name>/`.

## Deploy on Railway

This repo ships with a tiny zero-dependency Node static server (`server.js`) and
a `railway.json`, so it deploys to [Railway](https://railway.app) out of the
box.

1. Create a new Railway project → **Deploy from GitHub repo** and pick this repo.
2. Railway auto-detects Node via `package.json` and runs `npm start`
   (`node server.js`), binding to `$PORT`.
3. Click **Generate Domain** under the service's **Settings → Networking** tab to
   get a public URL.
4. The `data/nav.json` file is committed by the GitHub Action on a daily cron, so
   redeploys pick up fresh NAV data automatically. You can also trigger
   *Update AMFI NAV* manually from the **Actions** tab.

Local run:

```bash
npm start            # serves the site at http://localhost:3000
python scripts/fetch_nav.py   # refresh data/nav.json locally
```

## Usage notes

- Use the **Direct / Regular** and **Growth / IDCW** chips to narrow the scheme picker — the AMFI list has ~12,000 entries.
- Click any units value in the table to edit it inline.
- **Export JSON** lets you back up your portfolio; **Import JSON** restores it. Files are also handy for sharing between devices since `localStorage` is per-browser.
- If a scheme you previously added gets dropped from a later AMFI feed (rare — usually only on merger/wind-up), the row will show "missing" and you can either keep waiting or remove it.

## Caveats

- AMFI publishes the NAV in the evening (typically 9–10 PM IST on business days). The Action runs at 22:30 IST and falls back to whatever the latest feed says — Saturdays / Sundays / holidays will keep the previous business-day NAV.
- IDCW (post-record-date) and pending corporate actions can show stale values for a day. This is a property of the AMFI feed, not the tool.
- This is a personal valuation aid. Not investment advice, not a substitute for your CAS, and not a SEBI-registered anything.

## License

MIT — do whatever you want.
