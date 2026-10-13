"""GET sweep: call every parameterless GET route on two ROW APIs (NestJS and .NET) and compare status codes.

Usage:  python -I kb/tools/get_sweep.py <nest base> <dotnet base> <jwt secret> [out.json]
        e.g. python -I kb/tools/get_sweep.py http://localhost:5998 http://localhost:5101 <secret>

Routes come from kb/row-api-routes.log (the NestJS route table). Both APIs get the same token: a SuperAdmin
member 1, signed with the JWT secret both were started with (issuer / audience as in appsettings.json).
Prints the status-class totals per API and every route whose status differs. Throwaway test databases only.
"""
import base64, hashlib, hmac, json, re, sys, time, urllib.request, urllib.error
from pathlib import Path

nest, dotnet, secret = sys.argv[1].rstrip('/'), sys.argv[2].rstrip('/'), sys.argv[3]
out = sys.argv[4] if len(sys.argv) > 4 else None

def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

def token() -> str:
    head = {"alg": "HS256", "typ": "JWT"}
    body = {"memberId": "1", "name": "Sweep Admin", "email": "sweep@example.org", "roles": "SuperAdmin",
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 3600}
    signing = f"{b64(json.dumps(head).encode())}.{b64(json.dumps(body).encode())}"
    sig = hmac.new(secret.encode(), signing.encode(), hashlib.sha256).digest()
    return f"{signing}.{b64(sig)}"

log = Path(__file__).resolve().parents[1] / "row-api-routes.log"
routes = sorted({m.group(1) for m in re.finditer(r"Mapped \{(/[^,]+), GET\}", log.read_text(encoding="utf-8"))
                 if ":" not in m.group(1)})
tok = token()

def call(base: str, path: str) -> int:
    req = urllib.request.Request(base + path, headers={"Authorization": f"Bearer {tok}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0

results = []
for p in routes:
    results.append((p, call(nest, p), call(dotnet, p)))

def classes(i):
    c = {}
    for r in results:
        k = f"{r[i] // 100}xx" if r[i] else "error"
        c[k] = c.get(k, 0) + 1
    return dict(sorted(c.items()))

print(f"{len(routes)} parameterless GET routes")
print("NestJS:", classes(1))
print(".NET:  ", classes(2))
diff = [r for r in results if r[1] // 100 != r[2] // 100]
print(f"status class differs on {len(diff)} routes")
for p, a, b in diff:
    print(f"  {p}: nest {a}, dotnet {b}")
if out:
    Path(out).write_text(json.dumps(results, indent=1), encoding="utf-8")
