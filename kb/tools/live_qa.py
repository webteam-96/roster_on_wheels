"""Live QA crawl with recording: sign in as one role and open its admin pages at 1440, 768 and 375 px.

Usage:  python -I kb/tools/live_qa.py <admin base> <out dir> club=<id> district=<id> [prefix=/club-admin-dashboard,/clubs]
Login from ROW_CRAWL_EMAIL / ROW_CRAWL_PASSWORD. Unlike admin_crawl.py this one may run against the live test host
(owner's request 2026-11-23); it only opens pages, it never submits a form.

Writes to <out dir>: results.json, video/ (one .webm per page group), trace.zip (open with
`npx playwright show-trace trace.zip`), shots/<page>@<width>.png for every page at 1440 and 375, and for any width
where the page scrolls sideways.
"""
import json, os, re, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
base, out = sys.argv[1].rstrip('/'), Path(sys.argv[2])
args = dict(a.split('=', 1) for a in sys.argv[3:])
ids = {k: v for k, v in args.items() if k in ('club', 'district')}
prefixes = tuple(args.get('prefix', '/').split(','))
APP = Path(__file__).resolve().parents[2] / 'row' / 'admin' / 'src' / 'app'
PARENT = {'clubs': 'club', 'districts': 'district'}
# Sign-in and token pages end the session; payment checkout pages need a real order.
SKIP = re.compile(r'^/(login|sso|exec-signin|reset-password|forgot-password|pay/)')
ERROR_TEXT = re.compile(r'something went wrong|application error|unhandled runtime error|not available|access denied|page not found', re.I)
WIDTHS = (1440, 768, 375)


def routes():
    found = set()
    for page in APP.rglob('page.tsx'):
        segs = [s for s in page.parent.relative_to(APP).parts if not (s.startswith('(') and s.endswith(')'))]
        path = []
        for i, s in enumerate(segs):
            if s.startswith('['):
                key = PARENT.get(segs[i - 1]) if i and s == '[id]' else None
                if key not in ids:
                    break
                path.append(ids[key])
            else:
                path.append(s)
        else:
            url = '/' + '/'.join(path)
            if url.startswith(prefixes) and not SKIP.search(url):
                found.add(url)
    return sorted(found)


OVERFLOW_JS = """(w) => {
  const sw = document.documentElement.scrollWidth;
  if (sw <= w + 1) return null;
  const offenders = [...document.querySelectorAll('body *')].filter(el => {
    const b = el.getBoundingClientRect(); return b.right > w + 2 && b.width > 0 && b.width < sw;
  }).slice(0, 4).map(el => el.tagName.toLowerCase() + ' "' + (el.innerText || '').trim().slice(0, 30) + '"');
  return { sw, offenders };
}"""


def main():
    out.mkdir(parents=True, exist_ok=True)
    (out / 'shots').mkdir(exist_ok=True)
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=os.environ.get('ROW_CRAWL_HEADED') != '1')
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, record_video_dir=str(out / 'video'),
                                  record_video_size={'width': 1280, 'height': 800})
        ctx.tracing.start(screenshots=True, snapshots=True)
        page = ctx.new_page()
        page.goto(base + '/login', wait_until='networkidle', timeout=120000)
        page.fill('input[type="email"]', os.environ['ROW_CRAWL_EMAIL'])
        page.fill('input[type="password"]', os.environ['ROW_CRAWL_PASSWORD'])
        page.click('button[type="submit"]')
        page.wait_for_url(lambda u: '/login' not in u, timeout=60000)

        for url in routes():
            rec = {'url': url, 'console': [], 'pageerror': [], 'api': [], 'assets': [], 'overflow': {}}
            hooks = [
                ('console', lambda m: m.type == 'error' and rec['console'].append(m.text[:300])),
                ('pageerror', lambda e: rec['pageerror'].append(str(e)[:300])),
                ('response', lambda r: r.status >= 400 and rec['api' if '/api/' in r.url else 'assets']
                 .append(f'{r.status} {r.request.method} {r.url.replace(base, "")[:160]}')),
            ]
            for ev, fn in hooks:
                page.on(ev, fn)
            t = time.time()
            page.set_viewport_size({'width': 1440, 'height': 900})
            try:
                page.goto(base + url, wait_until='domcontentloaded', timeout=60000)
                page.wait_for_load_state('networkidle', timeout=20000)
            except Exception as e:
                rec['pageerror'].append(f'navigation: {str(e)[:200]}')
            rec['ms'] = int((time.time() - t) * 1000)
            name = re.sub(r'\W+', '_', url).strip('_') or 'root'
            try:
                body = page.inner_text('body')
                m = ERROR_TEXT.search(body)
                rec.update(final=page.url.replace(base, ''), screen=m.group(0) if m else '', blank=len(body.strip()) < 40)
                for w in WIDTHS:
                    page.set_viewport_size({'width': w, 'height': 900})
                    page.wait_for_timeout(300)
                    o = page.evaluate(OVERFLOW_JS, w)
                    if o:
                        rec['overflow'][w] = o
                    if w in (1440, 375) or o:
                        page.screenshot(path=str(out / 'shots' / f'{name}@{w}.png'), full_page=w == 375)
            except Exception as e:
                rec['pageerror'].append(f'inspect: {str(e)[:200]}')
            for ev, fn in hooks:
                page.remove_listener(ev, fn)
            results.append(rec)
            bad = rec['console'] or rec['pageerror'] or rec['api'] or rec.get('screen') or rec.get('blank') or rec['overflow']
            print(('FAIL ' if bad else 'ok   ') + url + (('  ' + json.dumps({k: rec[k] for k in ('final', 'screen', 'api', 'pageerror', 'overflow') if rec.get(k)})[:600]) if bad else ''), flush=True)
            (out / 'results.json').write_text(json.dumps(results, indent=1), encoding='utf-8')

        ctx.tracing.stop(path=str(out / 'trace.zip'))
        ctx.close()
        browser.close()
    print(f'{len(results)} pages -> {out}')


if __name__ == '__main__':
    main()
