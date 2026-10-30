"""Screenshots of the signed-out admin pages (sign in, forgot / reset password, invite) at desktop and phone width.

    python -I kb/tools/design_signed_out.py <admin base> <out dir>
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

base, out = sys.argv[1].rstrip('/'), Path(sys.argv[2])
PAGES = {'login': '/login', 'forgot_password': '/forgot-password', 'reset_password': '/reset-password?token=preview',
         'invite': '/invite/preview', 'public_home': '/',
         **{'public' + r.replace('/', '_').replace('-', '_'): r for r in (
             '/about-us', '/committee', '/contact-us', '/district-governors', '/download', '/events',
             '/international-national', '/our-leaders', '/past-events', '/projects', '/prospective-member',
             '/regional-leaders', '/tutorial', '/websites')}}
with sync_playwright() as p:
    b = p.chromium.launch()
    for wname, (w, h) in {'desktop': (1440, 900), 'phone': (390, 844)}.items():
        d = out / wname
        d.mkdir(parents=True, exist_ok=True)
        page = b.new_context(viewport={'width': w, 'height': h}).new_page()
        for name, path in PAGES.items():
            page.goto(base + path, wait_until='networkidle')
            page.screenshot(path=str(d / f'{name}.png'), full_page=True)
    b.close()
print('saved', out)
