"""ROW design overhaul coverage: which admin pages and app screens still carry old-design patterns.

    python -I kb/tools/design_coverage.py [--list]

A page counts as converted when none of the patterns below appear in its own file. Shared components are
not counted (they are converted once, centrally). Patterns follow row/website/design.md section 8 and the
FRONTEND-RULES block in CLAUDE.md. It is a smell detector, not proof: the browser check per batch still applies.
"""
import os, re, sys, collections

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'row')

ADMIN = {
    # Page-level loading only: a large RotaryLoader or a bare "Loading..." line. Small spinners inside
    # buttons ("Saving...") are fine and not counted.
    'spinner (no skeleton)': re.compile(r'<RotaryLoader\b[^>]*size="(lg|xl)"|<p[^>]*>\s*Loading[^<]{0,40}(\.\.\.|…)'),
    'all-caps table header': re.compile(r'<th[^>]*\buppercase\b|<thead[^>]*\buppercase\b'),
    'old table header': re.compile(r'<thead\b(?![^>]*(bg-\[#EDF4FB\]|\{t\.head|\$\{t\.head))'),
    'non-pill button radius': re.compile(r'<(button|Button)\b[^>]*className="[^"]*\brounded-(md|lg|xl)\b'),
    'off-palette fill': re.compile(r'\bbg-(purple|pink|teal|cyan|orange|lime|fuchsia|indigo|violet)-[1-9]00\b'),
}
APP = {
    'text under 13px': re.compile(r'fontSize:\s*(?:[0-9]|1[0-2])(?:\.\d+)?\b'),
    'gradient fill': re.compile(r'\b(LinearGradient|RadialGradient|AppGradients\.)'),
    'drop shadow': re.compile(r'\bBoxShadow\(|elevation:\s*[1-9]'),
    'non-pill button shape': re.compile(r'RoundedRectangleBorder\(borderRadius: BorderRadius\.circular\((?:[0-9]|1[0-9])\)\)'),
    'spinner (no skeleton)': re.compile(r'CircularProgressIndicator\(\)'),
}


def scan(base, exts, patterns, only=None):
    res = {}
    for d, _, fs in os.walk(base):
        for f in fs:
            if not f.endswith(exts) or (only and f != only):
                continue
            p = os.path.join(d, f)
            s = open(p, encoding='utf-8', errors='ignore').read()
            hits = {k: len(rx.findall(s)) for k, rx in patterns.items()}
            res[os.path.relpath(p, base).replace(os.sep, '/')] = {k: v for k, v in hits.items() if v}
    return res


def report(name, res):
    left = {p: h for p, h in res.items() if h}
    tot = collections.Counter()
    for h in left.values():
        tot.update(h)
    print(f'{name}: {len(res) - len(left)} of {len(res)} clean, {len(left)} with old patterns')
    for k, v in tot.most_common():
        print(f'  {k}: {v} hits')
    return left


admin = report('Admin pages', scan(os.path.join(ROOT, 'admin', 'src', 'app'), ('.tsx',), ADMIN, only='page.tsx'))
app = report('App screens', scan(os.path.join(ROOT, 'mobile', 'lib', 'presentation', 'screens'), ('.dart',), APP))
if '--list' in sys.argv:
    for p, h in sorted({**{'admin/' + k: v for k, v in admin.items()}, **{'app/' + k: v for k, v in app.items()}}.items()):
        print(p, h)
