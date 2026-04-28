"""
Fetch AMFI NAVAll.txt, parse the pipe-style (semicolon-delimited) feed,
and write a compact JSON file the frontend can read.

AMFI line formats:
  HEADER:    Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
  CATEGORY:  Open Ended Schemes(Equity Scheme - Large Cap Fund)
  AMC NAME:  Aditya Birla Sun Life Mutual Fund
  DATA ROW:  119551;INF209KB1ZH9;-;<scheme name>;15.4321;28-Apr-2026
  BLANK:     (skipped)

Run:
    python scripts/fetch_nav.py
"""

from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
OUTPUT = Path(__file__).resolve().parent.parent / "data" / "nav.json"
TIMEOUT_SECONDS = 60


def fetch(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "amfi-portfolio-tracker/1.0 (+github action)"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse(text: str):
    """Return (schemes, latest_date, category_index)."""
    schemes = []
    current_category = ""
    current_amc = ""
    latest_date = ""

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue

        # Header row — skip
        if line.startswith("Scheme Code"):
            continue

        # Data row: 6 fields separated by ';'
        if ";" in line:
            parts = [p.strip() for p in line.split(";")]
            if len(parts) >= 6 and parts[0].isdigit():
                code, isin_g, isin_r, name, nav, date = parts[:6]
                # Skip schemes without a usable NAV
                try:
                    nav_value = float(nav)
                except ValueError:
                    continue

                schemes.append({
                    "code": code,
                    "isin_growth": isin_g if isin_g and isin_g != "-" else None,
                    "isin_reinvest": isin_r if isin_r and isin_r != "-" else None,
                    "name": name,
                    "nav": nav_value,
                    "date": date,
                    "amc": current_amc,
                    "category": current_category,
                })
                if date > latest_date:  # rough lexicographic — fine since all dates in same window
                    latest_date = date
                continue

        # No semicolons → either category header or AMC name.
        # Category lines almost always contain '(' and ')' or words like 'Schemes'.
        if "(" in line and ")" in line and "Scheme" in line:
            current_category = line
        else:
            # Anything else with no semicolons we treat as an AMC name.
            current_amc = line

    return schemes, latest_date


def main() -> int:
    print(f"Fetching {NAV_URL} ...")
    text = fetch(NAV_URL)
    print(f"Downloaded {len(text):,} bytes")

    schemes, latest_date = parse(text)
    print(f"Parsed {len(schemes):,} schemes; latest date in feed: {latest_date}")

    if not schemes:
        print("ERROR: parsed zero schemes — refusing to overwrite existing data", file=sys.stderr)
        return 2

    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": NAV_URL,
        "nav_date": latest_date,
        "scheme_count": len(schemes),
        "schemes": schemes,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    size_kb = OUTPUT.stat().st_size / 1024
    print(f"Wrote {OUTPUT} ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
