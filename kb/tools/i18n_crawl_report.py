"""Compare admin_crawl.py runs in several languages with the English run.

    python -I kb/tools/i18n_crawl_report.py <en.json> <lang.json>... > report.md

Per language: pages crawled, pages that scroll sideways, translate calls refused (429), and how much of each page's
text is still the English text. Text that is the same in both runs is either untranslated UI text or data that is
meant to stay as entered (names, numbers, dates); the strings that stay English on the most pages are listed, as those
are almost always UI text.
"""
import json, re, sys
from collections import Counter
from pathlib import Path

WORD = re.compile(r'[A-Za-z]{3,}')


def load(p):
    return {r['url']: r for r in json.loads(Path(p).read_text(encoding='utf-8'))}


def main():
    en = load(sys.argv[1])
    for path in sys.argv[2:]:
        runs = load(path)
        lang = Path(path).stem
        same_counter, ratios, worst = Counter(), [], []
        overflow = [u for u, r in runs.items() if r.get('overflow')]
        refused = sum(1 for r in runs.values() for a in r['api'] if a.startswith('429'))
        errors = [u for u, r in runs.items() if r['pageerror'] or r['screen']]
        for url, r in runs.items():
            base = set(en.get(url, {}).get('text', []))
            words = [s for s in r.get('text', []) if WORD.search(s)]
            same = [s for s in words if s in base]
            same_counter.update(same)
            if words:
                ratio = len(same) / len(words)
                ratios.append(ratio)
                worst.append((ratio, url))
        avg = sum(ratios) / len(ratios) if ratios else 0
        print(f'## {lang}\n')
        print(f'- pages: {len(runs)}; same as English on average: {avg:.0%}; sideways scroll: {len(overflow)}; '
              f'translate calls refused (429): {refused}; error screens or page errors: {len(errors)}')
        print('- most English-looking pages: ' + ', '.join(f'{u} ({x:.0%})' for x, u in sorted(worst, reverse=True)[:10]))
        if overflow:
            print('- sideways scroll: ' + ', '.join(overflow[:30]))
        print('- text left in English on the most pages: ' +
              '; '.join(f'"{s}" ({n})' for s, n in same_counter.most_common(40)) + '\n')


if __name__ == '__main__':
    main()
