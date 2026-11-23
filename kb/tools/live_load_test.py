"""Read-only load test of the ROW API: steps of concurrent virtual users, each looping over realistic GET requests.

Usage:  python -I kb/tools/live_load_test.py <api base> <out.json> [steps=5,10,25,50] [seconds=60]
Logins (optional, one sign-in per account for the whole run: the API allows 10 sign-ins a minute per IP):
  ROW_LOAD_LOGINS="email1|password1;email2|password2"   club ids for the signed-in reads: ROW_LOAD_CLUB (default 31753)
Safety: GET only, never writes. Stops early when a step has > 5 % errors or p95 > 8 s, so a struggling server is not
pushed further. The test host shares its server and database with production: run it outside working hours.
Reports per step: requests, errors (by status), requests/s, p50 / p95 / p99 / max latency, and the slowest endpoints.
"""
import json, os, random, statistics, sys, threading, time, urllib.error, urllib.request
from collections import Counter, defaultdict

base = sys.argv[1].rstrip('/')
out = sys.argv[2]
args = dict(a.split('=', 1) for a in sys.argv[3:])
steps = [int(s) for s in args.get('steps', '5,10,25,50').split(',')]
seconds = int(args.get('seconds', '60'))
club = os.environ.get('ROW_LOAD_CLUB', '31753')

PUBLIC = [
    '/api/health',
    '/api/public/district/1/clubs',
    '/api/public/district/1/site',
    '/api/public/district/1/events?year=2026&month=11',  # the district site's calendar, one month
    f'/api/public/club/{club}/v2/about?yearId=47',
    '/api/public/project-stats/overview',
]
SIGNED_IN = [
    '/api/auth/my-context',
    f'/api/clubs/{club}/members?page=1&pageSize=20',
    f'/api/clubs/{club}/announcements?page=1&pageSize=10',
    f'/api/clubs/{club}/upcoming-events?page=1&pageSize=10',
    f'/api/clubs/{club}/newsletters?page=1&pageSize=10',
    f'/api/clubs/{club}/projects?moduleId=12&yearId=47&page=1&pageSize=20',
    '/api/i18n/en',
    '/api/features',  # needs a sign-in
]


def login(email, password):
    req = urllib.request.Request(base + '/api/auth/login', json.dumps({'email': email, 'password': password}).encode(),
                                 {'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())['token']


def get(path, token=None):
    req = urllib.request.Request(base + path, headers={'Authorization': 'Bearer ' + token} if token else {})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
    except Exception:
        status = 0  # timeout / connection error
    return status, (time.perf_counter() - t) * 1000


def run_step(users, tokens):
    samples, lock, stop = [], threading.Lock(), time.time() + seconds

    def user(i):
        token = tokens[i % len(tokens)] if tokens else None
        paths = PUBLIC + (SIGNED_IN if token else [])
        while time.time() < stop:
            p = random.choice(paths)
            s, ms = get(p, token if p in SIGNED_IN else None)
            with lock:
                samples.append((p, s, ms))
            time.sleep(random.uniform(0.2, 1.0))  # think time, like a person clicking around

    threads = [threading.Thread(target=user, args=(i,)) for i in range(users)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    lat = sorted(ms for _, _, ms in samples)
    errors = Counter(s for _, s, _ in samples if s == 0 or (s >= 400 and s != 429))
    limited = sum(1 for _, s, _ in samples if s == 429)  # rate limit answers by design, counted apart
    per = defaultdict(list)
    for p, _, ms in samples:
        per[p].append(ms)
    q = lambda f: round(lat[min(len(lat) - 1, int(f * len(lat)))]) if lat else None
    return {
        'users': users, 'requests': len(samples), 'rps': round(len(samples) / seconds, 1),
        'errors': dict(errors), 'rate_limited': limited, 'error_rate': round(sum(errors.values()) / max(1, len(samples)), 4),
        'p50_ms': q(0.5), 'p95_ms': q(0.95), 'p99_ms': q(0.99), 'max_ms': round(lat[-1]) if lat else None,
        'slowest': sorted(((round(statistics.median(v)), p) for p, v in per.items()), reverse=True)[:4],
    }


def main():
    tokens = []
    for pair in filter(None, os.environ.get('ROW_LOAD_LOGINS', '').split(';')):
        email, password = pair.split('|', 1)
        tokens.append(login(email, password))
    results = []
    for users in steps:
        r = run_step(users, tokens)
        results.append(r)
        print(json.dumps(r), flush=True)
        if r['error_rate'] > 0.05 or (r['p95_ms'] or 0) > 8000:
            print(f'stopped after {users} users: error rate or p95 over the safety limit', flush=True)
            break
        time.sleep(10)  # let the server settle between steps
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'base': base, 'seconds_per_step': seconds, 'signed_in_users': len(tokens), 'steps': results}, f, indent=1)


if __name__ == '__main__':
    main()
