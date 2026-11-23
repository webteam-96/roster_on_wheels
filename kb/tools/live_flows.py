"""Recorded add -> list -> delete checks on the club "Add" forms (v2), as one signed-in club admin.

Usage:  python -I kb/tools/live_flows.py <admin base> <out dir> <club id>
Login from ROW_CRAWL_EMAIL / ROW_CRAWL_PASSWORD (owner allowed live writes on the test club, 2026-11-23).

Per form: fills every field the form shows (title "QA TEST <form> <stamp>", dates tomorrow / +30 days, times, the first
option of required radio groups), presses the save button, records the API write and its status, opens the list page
and looks for the title, then deletes the record through the same API the list page uses. Writes results.json,
video/, trace.zip and a screenshot after each save.
"""
import json, os, re, sys, time
from datetime import date, timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright

base, out, club = sys.argv[1].rstrip('/'), Path(sys.argv[2]), sys.argv[3]
api_base = base.rsplit('/admin', 1)[0]
stamp = time.strftime('%H%M%S')
d1, d2 = date.today() + timedelta(days=1), date.today() + timedelta(days=30)
TEST_PNG = out / 'qa-test-photo.png'

YEAR = os.environ.get('ROW_YEAR_ID', '47')  # current Rotary year (2026-27); service projects are stored per year
# form path, list page, records API (list ?search= and DELETE /{id}), radios to pick (label text), save button text
FORMS = [
    ('announcements', 'announcements/v2/add', 'announcements/v2', 'announcements', [], 'Save'),
    ('upcoming-events', 'upcoming-events/v2/add', 'upcoming-events/v2', 'upcoming-events', [], 'Save Event'),
    ('newsletters', 'newsletters/v2/add', 'newsletters/v2', 'newsletters', [], 'Save Newsletter'),
    ('club-service', 'club-service/v2/add', 'club-service/v2', f'projects/{YEAR}', ['Regular'], 'Save'),
    ('community-service', 'community-service/v2/add', 'community-service/v2', f'projects/{YEAR}', ['One Time Project'], 'Save'),
    ('potential-members', 'rotary-network/potential-members/v2/add', 'rotary-network/potential-members/v2', 'potential-members', [], 'Add Potential Member'),
]
VALUES = [
    (re.compile(r'title|name of|full name|event name|meeting title', re.I), None),  # None = the QA title
    (re.compile(r'https?://|url|link', re.I), 'https://example.com/qa-test'),
    (re.compile(r'email', re.I), 'qa-test@example.com'),
    (re.compile(r'\+1|phone|mobile', re.I), '+1 555 123 4567'),
    (re.compile(r'venue|location|city', re.I), 'QA test venue'),
]


def fill_form(page, title, past=False):
    # meetings and projects record what already happened: their dates must not be in the future
    first, second = (date.today() - timedelta(days=1), date.today()) if past else (d1, d2)
    for el in page.query_selector_all('input:visible, textarea:visible'):
        kind = (el.get_attribute('type') or 'text').lower()
        ph = el.get_attribute('placeholder') or ''
        if kind in ('checkbox', 'radio', 'file', 'hidden', 'search') or el.is_disabled() or 'search' in ph.lower():
            continue
        if kind == 'time':
            el.fill('10:00' if not el.input_value() else el.input_value())
            continue
        if kind in ('date', 'datetime-local'):
            if not el.input_value():
                el.fill(first.isoformat() + ('T10:00' if kind == 'datetime-local' else ''))
            continue
        if kind == 'number':
            if not el.input_value():
                el.fill('10')
            continue
        if ph == 'dd/mm/yyyy':
            if not el.input_value():
                n = sum(1 for e in page.query_selector_all('input[placeholder="dd/mm/yyyy"]') if e.input_value())
                el.fill((first if n == 0 else second).strftime('%d/%m/%Y'))
            continue
        if el.input_value():
            continue
        if el.evaluate('e => e.tagName') == 'TEXTAREA':
            el.fill('QA test entry made by the automated live test. It is deleted at the end of the run.')
            continue
        value = next((title if v is None else v for rx, v in VALUES if rx.search(ph)), None)
        el.fill(value if value is not None else title)
    # radio groups left empty: "No" when offered (joint project, send email), else the first option
    page.evaluate("""() => {
      const groups = {};
      const key = new Map(); let n = 0;
      for (const r of document.querySelectorAll('input[type=radio]')) {
        if (!r.offsetParent) continue;
        // unnamed radios (the pill buttons): one group per wrapping row of pills
        const box = r.name || (r.closest('label')?.parentElement ?? r.parentElement);
        if (!key.has(box)) key.set(box, 'g' + n++);
        (groups[key.get(box)] ||= []).push(r);
      }
      for (const rs of Object.values(groups)) {
        if (rs.some(r => r.checked)) continue;
        const label = r => (r.closest('label')?.innerText || r.parentElement?.innerText || '').trim();
        (rs.find(r => /^no/i.test(label(r))) || rs[0]).click();
      }
    }""")
    # dropdowns left empty: the first real option
    for sel in page.query_selector_all('select:visible'):
        if not sel.input_value():
            opts = [o for o in sel.eval_on_selector_all('option', 'os => os.map(o => o.value)') if o]
            if opts:
                sel.select_option(opts[0])
    # photos and files: a small generated PNG wherever an image is accepted
    for f in page.query_selector_all('input[type=file]'):
        accept = (f.get_attribute('accept') or '').lower()
        if not accept or 'image' in accept or '.png' in accept or '.jpg' in accept:
            try:
                f.set_input_files(str(TEST_PNG))
                page.wait_for_timeout(1500)
                done = page.get_by_role('button', name=re.compile(r'^(Save|Apply|Crop|Done|Use)', re.I))
                if page.get_by_role('dialog').count() and done.count():
                    done.last.click()
                    page.wait_for_timeout(1000)
            except Exception:
                pass
    # the second time field (expiry, end) must be after the first
    times = page.query_selector_all('input[type="time"]:visible')
    for i, t in enumerate(times[1:], 1):
        t.fill('18:00')


def main():
    out.mkdir(parents=True, exist_ok=True)
    from PIL import Image  # a plain 1600x900 image: passes the upload type and size checks
    Image.new('RGB', (1600, 900), (23, 69, 143)).save(TEST_PNG)
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

        def call(method, path):
            return page.evaluate("""async ([m, u]) => { const r = await fetch(u, { method: m, headers: { Authorization:
                'Bearer ' + localStorage.getItem('auth_token') } }); let b = null; try { b = await r.json(); } catch (e) {}
                return { status: r.status, body: b }; }""", [method, api_base + path])

        for name, form, listing, api, radios, save in FORMS:
            title = f'QA TEST {name} {stamp}'[:50]
            rec = {'form': name, 'title': title, 'writes': [], 'errors': []}
            on_resp = lambda r: r.request.method in ('POST', 'PUT') and '/api/' in r.url and rec['writes'].append(
                f'{r.status} {r.request.method} {r.url.replace(api_base, "")[:120]}')
            on_err = lambda e: rec['errors'].append(str(e)[:200])
            page.on('response', on_resp)
            page.on('pageerror', on_err)
            try:
                page.goto(f'{base}/clubs/{club}/{form}', wait_until='networkidle', timeout=60000)
                for label in radios:
                    page.get_by_text(label, exact=True).first.click()
                fill_form(page, title, past=api.startswith('projects/'))
                page.get_by_role('button', name=re.compile('^' + re.escape(save))).last.click()
                page.wait_for_timeout(4000)
                body = page.inner_text('body')
                m = re.search(r'[^\n]*(required|invalid|failed|error|must be|cannot)[^\n]*', body, re.I)
                rec['message'] = m.group(0).strip()[:200] if m else ''
                page.screenshot(path=str(out / f'{name}-after-save.png'), full_page=True)
                rec['saved'] = any(w[:1] == '2' for w in rec['writes'])
                page.goto(f'{base}/clubs/{club}/{listing}', wait_until='networkidle', timeout=60000)
                rec['in_list'] = title in page.inner_text('body')
            except Exception as e:
                rec['errors'].append(f'flow: {str(e)[:300]}')
            # cleanup: find the record by title through the list API and delete it
            q = title.replace(' ', '%20')
            if api.startswith('projects/'):  # projects are listed per module and year: look in every module
                mods = call('GET', '/api/modules')['body'] or []
                mods = mods if isinstance(mods, list) else mods.get('items') or mods.get('data') or []
                lists = [call('GET', f'/api/clubs/{club}/projects?moduleId={m.get("id")}&yearId={YEAR}&page=1&pageSize=50&search={q}')['body'] for m in mods]
            else:
                lists = [call('GET', f'/api/clubs/{club}/{api}?search={q}&pageSize=50')['body']]
            items = [i for b in lists for i in (b if isinstance(b, list) else (b or {}).get('items') or (b or {}).get('data') or [])]
            ids = sorted({i.get('id') or i.get('Id') for i in items if title in json.dumps(i)})
            rec['cleanup'] = [f"{call('DELETE', f'/api/clubs/{club}/{api}/{i}')['status']} id {i}" for i in ids]
            page.remove_listener('response', on_resp)
            page.remove_listener('pageerror', on_err)
            ok = rec.get('saved') and rec.get('in_list') and rec['cleanup'] and all(c.startswith('2') for c in rec['cleanup'])
            print(('PASS ' if ok else 'FAIL ') + json.dumps(rec)[:700], flush=True)
            results.append(rec)
            (out / 'results.json').write_text(json.dumps(results, indent=1), encoding='utf-8')

        ctx.tracing.stop(path=str(out / 'trace.zip'))
        ctx.close()
        browser.close()


if __name__ == '__main__':
    main()
