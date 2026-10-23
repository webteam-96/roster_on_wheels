"""Admin error crawl: sign in as one role and open every admin page, logging what breaks.

Usage:  python -I kb/tools/admin_crawl.py <admin base> <out.json> club=<id> district=<id> zone=<id> member=<id>
        e.g. python -I kb/tools/admin_crawl.py http://localhost:3300 crawl.json club=143 district=3 zone=1 member=84
Login comes from ROW_CRAWL_EMAIL / ROW_CRAWL_PASSWORD. Local copies only (row_prod_copy), never production.

Pages come from row/admin/src/app/**/page.tsx. A route's [id] is filled from the segment before it (clubs, districts,
zones, members); routes with any other dynamic segment are detail pages and are skipped. Payment pages are skipped
(payments are on hold). Per page it records: final URL, console errors, page errors, API responses >= 400, and
whether an error screen ("Something went wrong", "Not available", Next.js error overlay) is visible.
"""
import json, os, re, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

base, out = sys.argv[1].rstrip('/'), sys.argv[2]
ids = dict(a.split('=', 1) for a in sys.argv[3:])
email, password = os.environ['ROW_CRAWL_EMAIL'], os.environ['ROW_CRAWL_PASSWORD']

APP = Path(__file__).resolve().parents[2] / 'row' / 'admin' / 'src' / 'app'
PARENT = {'clubs': 'club', 'districts': 'district', 'zones': 'zone', 'members': 'member'}
PAYMENTS = re.compile(r'dues|payment|wallet|razorpay|cashfree|gateway|checkout|purchase', re.I)
ERROR_TEXT = re.compile(r'something went wrong|application error|unhandled runtime error|not available', re.I)


def routes():
    found = set()
    for page in APP.rglob('page.tsx'):
        segs = [s for s in page.parent.relative_to(APP).parts if not (s.startswith('(') and s.endswith(')'))]
        if any(s.startswith('api') for s in segs[:1]):
            continue
        path, ok = [], True
        for i, s in enumerate(segs):
            if s.startswith('['):
                key = PARENT.get(segs[i - 1]) if i and s == '[id]' else None
                if not key or key not in ids:
                    ok = False
                    break
                path.append(ids[key])
            else:
                path.append(s)
        url = '/' + '/'.join(path)
        if ok and not PAYMENTS.search(url) and url not in ('/login',):
            found.add(url)
    return sorted(found)


def wait_for_server(seconds=300):
    end = time.time() + seconds
    while time.time() < end:
        try:
            urllib.request.urlopen(base + '/login', timeout=120)
            return
        except Exception:
            time.sleep(3)


def crawl():
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(base + '/login', wait_until='networkidle', timeout=180000)  # hydrated, or the form posts natively
        page.fill('input[type="email"]', email)
        page.fill('input[type="password"]', password)
        page.click('button[type="submit"]')
        page.wait_for_url(lambda u: '/login' not in u, timeout=30000)

        for url in routes():
            rec = {'url': url, 'console': [], 'pageerror': [], 'api': []}
            on_console = lambda m: m.type == 'error' and rec['console'].append(m.text[:300])
            on_error = lambda e: rec['pageerror'].append(str(e)[:300])
            on_resp = lambda r: r.status >= 400 and '/api/' in r.url and rec['api'].append(f'{r.status} {r.request.method} {r.url}')
            page.on('console', on_console)
            page.on('pageerror', on_error)
            page.on('response', on_resp)
            t = time.time()
            for attempt in (1, 2):
                try:
                    page.goto(base + url, wait_until='domcontentloaded', timeout=60000)
                    page.wait_for_load_state('networkidle', timeout=20000)
                    break
                except Exception as e:
                    # next dev restarts itself near its memory limit: not a page finding, wait for it and go again
                    if attempt == 1 and 'ERR_CONNECTION_REFUSED' in str(e):
                        wait_for_server()
                        for k in ('console', 'pageerror', 'api'):
                            rec[k].clear()
                        continue
                    rec['pageerror'].append(f'navigation: {str(e)[:200]}')
            body = page.inner_text('body') if page.url else ''
            m = ERROR_TEXT.search(body)
            rec.update(final=page.url.replace(base, ''), ms=int((time.time() - t) * 1000), screen=m.group(0) if m else '')
            page.remove_listener('console', on_console)
            page.remove_listener('pageerror', on_error)
            page.remove_listener('response', on_resp)
            results.append(rec)
            bad = rec['console'] or rec['pageerror'] or rec['api'] or rec['screen']
            print(('FAIL ' if bad else 'ok   ') + url, flush=True)
            if bad:
                print('     ' + json.dumps({k: rec[k] for k in ('final', 'screen', 'api', 'pageerror', 'console') if rec[k]})[:1500], flush=True)
        browser.close()
    Path(out).write_text(json.dumps(results, indent=1), encoding='utf-8')
    bad = [r for r in results if r['console'] or r['pageerror'] or r['api'] or r['screen']]
    print(f'{len(results)} pages, {len(bad)} with problems -> {out}')


if __name__ == '__main__':
    crawl()
