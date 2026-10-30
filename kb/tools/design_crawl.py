"""Design crawl: open every admin page as a role, at desktop and phone width, and record what looks broken.

    python -I kb/tools/design_crawl.py <admin base> <out dir> <role> club=<id> district=<id> zone=<id> member=<id>

<role> is a label for the output files. The session comes from ROW_DESIGN_TOKEN (a JWT the local API accepts;
local copies only, never production). Routes come from admin_crawl.routes(). Per page and width it records the
final URL, page errors, console errors, an error screen, horizontal overflow (scrollWidth > viewport) and saves a
screenshot to <out dir>/<role>/<w>/<n>.png for review.
"""
import json, os, re, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

base, out_dir, role = sys.argv[1].rstrip('/'), Path(sys.argv[2]), sys.argv[3]
sys.argv = [sys.argv[0], base, os.devnull] + sys.argv[4:]   # admin_crawl reads ids from argv[3:]
os.environ.setdefault('ROW_CRAWL_EMAIL', '-'); os.environ.setdefault('ROW_CRAWL_PASSWORD', '-')
sys.path.insert(0, str(Path(__file__).parent))
import admin_crawl  # noqa: E402  (routes() and the error-text pattern)

token = os.environ['ROW_DESIGN_TOKEN']
UI_CHECKS = (Path(__file__).parent / 'ui_checks.js').read_text(encoding='utf-8').split('\n', 5)[5]  # drop header comment
WIDTHS = {'desktop': (1440, 900), 'phone': (390, 844)}


def main():
    pages = admin_crawl.routes()
    pages = [r for r in pages if r != '/']  # the public home sends a signed-in user to /login, which signs out
    prefixes = [x for x in os.environ.get('ROW_DESIGN_PREFIX', '').split(',') if x]
    if prefixes:  # optional: limit a role to its own area (e.g. /club-admin-dashboard,/clubs/)
        pages = [r for r in pages if any(r.startswith(x) for x in prefixes)]
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for wname, (w, h) in WIDTHS.items():
            ctx = browser.new_context(viewport={'width': w, 'height': h})
            page = ctx.new_page()
            page.goto(base + '/privacy-policy')
            page.evaluate("""t => { localStorage.clear(); localStorage.setItem('auth_token', t);
                localStorage.setItem('session_expiry', String(Date.now() + 8 * 3600 * 1000)); }""", token)
            shots = out_dir / role / wname
            shots.mkdir(parents=True, exist_ok=True)
            cur = {'errors': [], 'console': []}
            page.on('pageerror', lambda e: cur['errors'].append(str(e)[:200]))
            page.on('console', lambda m: cur['console'].append(m.text[:200]) if m.type == 'error' else None)
            for n, route in enumerate(pages):
                cur['errors'], cur['console'] = [], []
                errors, console = cur['errors'], cur['console']
                try:
                    page.goto(base + route, wait_until='networkidle', timeout=60000)
                except Exception as e:  # timeouts still leave a page to look at
                    errors.append('goto: ' + str(e)[:120])
                time.sleep(0.8)
                if not page.evaluate("() => !!localStorage.getItem('auth_token')"):  # a page signed us out: sign back in
                    page.evaluate("""t => { localStorage.setItem('auth_token', t);
                        localStorage.setItem('session_expiry', String(Date.now() + 8 * 3600 * 1000)); }""", token)
                info = page.evaluate("""() => ({
                    over: document.documentElement.scrollWidth - window.innerWidth,
                    text: document.body ? document.body.innerText.slice(0, 4000) : '' })""")
                try:
                    ui = page.evaluate(UI_CHECKS)
                except Exception as e:  # page navigated away mid-check
                    ui = {'lowContrast': [], 'innerScroll': [], 'covered': [], 'pagination': None, 'error': str(e)[:120]}
                slug = re.sub(r'[^A-Za-z0-9]+', '_', route).strip('_') or 'home'
                page.screenshot(path=str(shots / f'{n:03d}_{slug}.png'))
                results.append({
                    'role': role, 'width': wname, 'n': n, 'route': route, 'final': page.url.replace(base, ''),
                    'overflow_px': info['over'], 'error_screen': bool(admin_crawl.ERROR_TEXT.search(info['text'])),
                    'page_errors': errors, 'console_errors': console[:5],
                    'low_contrast': ui['lowContrast'], 'inner_scroll': ui['innerScroll'],
                    'covered': ui['covered'], 'pagination': ui['pagination'],
                })
            ctx.close()
        browser.close()
    (out_dir / f'{role}.json').write_text(json.dumps(results, indent=1), encoding='utf-8')
    bad = [r for r in results if r['overflow_px'] > 2 or r['error_screen'] or r['page_errors']
           or r['low_contrast'] or r['inner_scroll'] or r['covered'] or r['pagination'] == 'custom']
    print(f'{role}: {len(pages)} routes x {len(WIDTHS)} widths, {len(bad)} entries flagged')


if __name__ == '__main__':
    main()
