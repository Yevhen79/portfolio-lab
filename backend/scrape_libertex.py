"""Scrape https://libertex.org/cfd-specification using Playwright + Edge.

The Libertex spec page is a Drupal SPA behind Cloudflare. The DOM structure is
custom div-based (cfd-table / cfd-tr / cfd-td) — not a real <table>. We:
  1. Launch Edge (Chromium-based, preinstalled on Win11 — no VC++ deps).
  2. Navigate, wait for Cloudflare to clear.
  3. Switch the platform filter to MT5 Market.
  4. Scroll to force virtualized rows to materialize.
  5. Extract every row's cells + the column headers.

Output: backend/data/libertex_raw.json with `{ headers: [...], rows: [[...], ...] }`.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


URL = "https://libertex.org/cfd-specification"
OUT_PATH = Path(__file__).parent / "data" / "libertex_raw.json"


JS_EXTRACT = r"""
() => {
  const headers = Array.from(document.querySelectorAll('.cfd-thead .cfd-th'))
    .map(el => el.textContent.trim().replace(/\s+/g, ' '));
  const trs = Array.from(document.querySelectorAll('.cfd-tbody .cfd-tr'));
  const rows = trs.map(tr =>
    Array.from(tr.querySelectorAll('.cfd-td')).map(td => td.textContent.trim().replace(/\s+/g, ' '))
  );
  // Also detect platform/group filter state for documentation
  const platformLabels = Array.from(document.querySelectorAll('.cfd-filter--platform .cfd-option-text'))
    .map(el => el.textContent.trim());
  const platformSelected = Array.from(document.querySelectorAll('.cfd-filter--platform .cfd-option.is-selected .cfd-option-text'))
    .map(el => el.textContent.trim());
  return { headers, rows, platformLabels, platformSelected };
}
"""


def launch_browser(p):
    last_err = None
    for channel in ("msedge", "chrome", None):
        try:
            kwargs = {
                "headless": False,
                "args": [
                    "--disable-blink-features=AutomationControlled",
                ],
            }
            if channel:
                kwargs["channel"] = channel
            br = p.chromium.launch(**kwargs)
            print(f"Launched browser via channel={channel or 'bundled-chromium'}", flush=True)
            return br
        except Exception as e:
            last_err = e
            print(f"channel={channel or 'bundled'} failed: {e}", flush=True)
    raise RuntimeError(f"All channels failed; last: {last_err}")


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = launch_browser(p)
        ctx = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
            ),
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            timezone_id="Europe/Kyiv",
        )
        ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
        )
        page = ctx.new_page()

        print(f"Navigating to {URL} ...", flush=True)
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)

        # Wait for the cfd-table rows to appear (after Cloudflare + JS hydration)
        print("Waiting for cfd-tr to materialize ...", flush=True)
        try:
            page.wait_for_selector(".cfd-tbody .cfd-tr", timeout=45000)
        except Exception as e:
            print(f"WARN: timeout waiting for rows: {e}", flush=True)

        # Discover available PLATFORMS
        print("Discovering platforms ...", flush=True)
        page.query_selector(".cfd-filter--platform .cfd-selector").click()
        page.wait_for_timeout(600)
        platforms = page.evaluate(
            """() => Array.from(document.querySelectorAll('.cfd-filter--platform .cfd-dropdown .cfd-option .cfd-option-text'))
                .map(el => el.textContent.trim())
                .filter(t => t)"""
        )
        print(f"Platforms found ({len(platforms)}): {platforms}", flush=True)
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        all_rows = []
        seen = set()
        headers = None
        platform_stats = {}

        for plat in platforms:
            print(f"\n========== PLATFORM: {plat} ==========", flush=True)
            try:
                # Select this single platform (radio behaviour — only one at a time)
                page.query_selector(".cfd-filter--platform .cfd-selector").click()
                page.wait_for_timeout(500)
                option = page.locator(".cfd-dropdown .cfd-option-text", has_text=plat).first
                option.click(timeout=5000)
                page.wait_for_timeout(1000)
                page.keyboard.press("Escape")
                page.wait_for_timeout(1500)
            except Exception as e:
                print(f"  Could not select platform {plat}, skipping: {e}", flush=True)
                continue

            # Discover groups available under this platform
            try:
                page.query_selector(".cfd-filter--group .cfd-selector").click()
                page.wait_for_timeout(600)
                groups = page.evaluate(
                    """() => Array.from(document.querySelectorAll('.cfd-filter--group .cfd-dropdown .cfd-option .cfd-option-text'))
                        .map(el => el.textContent.trim())
                        .filter(t => t && t !== 'All')"""
                )
                page.keyboard.press("Escape")
                page.wait_for_timeout(400)
                print(f"  Groups under {plat}: {groups}", flush=True)
            except Exception as e:
                print(f"  Could not list groups for {plat}: {e}", flush=True)
                continue

            plat_added = 0
            for grp in groups:
                try:
                    page.query_selector(".cfd-filter--group .cfd-selector").click()
                    page.wait_for_timeout(400)
                    page.evaluate(
                        """(target) => {
                            const opts = document.querySelectorAll('.cfd-filter--group .cfd-dropdown .cfd-option');
                            opts.forEach(el => {
                                const txt = (el.querySelector('.cfd-option-text')?.textContent || '').trim();
                                const selected = el.classList.contains('is-selected');
                                if (txt === target && !selected) el.click();
                                else if (txt !== target && selected) el.click();
                            });
                        }""",
                        grp,
                    )
                    page.wait_for_timeout(700)
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(500)

                    # Enable ALL subgroups under this group
                    sub_sel = page.query_selector(".cfd-filter--subgroups .cfd-selector")
                    if sub_sel:
                        sub_sel.click()
                        page.wait_for_timeout(400)
                        page.evaluate(
                            """() => {
                                document.querySelectorAll('.cfd-filter--subgroups .cfd-dropdown .cfd-option').forEach(el => {
                                    if (!el.classList.contains('is-selected')) el.click();
                                });
                            }"""
                        )
                        page.wait_for_timeout(700)
                        page.keyboard.press("Escape")
                        page.wait_for_timeout(700)

                    # Scroll to materialise rows
                    for _ in range(40):
                        page.evaluate("window.scrollBy(0, 1500)")
                        page.wait_for_timeout(50)
                    page.evaluate("window.scrollTo(0, 0)")
                    page.wait_for_timeout(300)
                    page.evaluate(
                        """() => {
                            document.querySelectorAll('.cfd-tbody, .cfd-scroller-content, .cfd-wrapper').forEach(el => {
                                for (let i = 0; i < 80; i++) el.scrollTop = el.scrollHeight;
                            });
                        }"""
                    )
                    page.wait_for_timeout(700)

                    result = page.evaluate(JS_EXTRACT)
                    if headers is None:
                        headers = result["headers"]
                    added = 0
                    for row in result["rows"]:
                        if not row:
                            continue
                        sym = row[0]
                        # Dedup by (group, symbol). Same instrument under different
                        # platforms keeps first seen — for our yfinance-mapping
                        # purposes the underlying asset is identical.
                        key = (grp, sym)
                        if key in seen:
                            continue
                        seen.add(key)
                        all_rows.append({"platform": plat, "group": grp, "cells": row})
                        added += 1
                    plat_added += added
                except Exception as e:
                    print(f"    [{plat} / {grp}] failed: {e}", flush=True)
            print(f"  >> {plat}: +{plat_added} new instruments (running total {len(all_rows)})", flush=True)
            platform_stats[plat] = plat_added

        out = {
            "headers": headers or [],
            "platforms_seen": platforms,
            "platform_stats": platform_stats,
            "rows": all_rows,
        }
        html = page.content()
        (OUT_PATH.parent / "libertex_raw.html").write_text(html, encoding="utf-8")
        OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nSaved: {OUT_PATH}", flush=True)
        print(f"  total rows: {len(all_rows)}", flush=True)
        print(f"  headers: {headers}", flush=True)
        from collections import Counter
        cnt = Counter(r["group"] for r in all_rows)
        print(f"  by group:")
        for g, n in cnt.most_common():
            print(f"    {g}: {n}", flush=True)
        print(f"  by platform (new instruments contributed):")
        for p, n in platform_stats.items():
            print(f"    {p}: {n}", flush=True)

        browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(1)
