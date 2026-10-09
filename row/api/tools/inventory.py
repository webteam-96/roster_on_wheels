"""Dependency inventory of the RIZones .NET API, used to plan the port.
Usage: python -I tools/inventory.py <path to RotaryApi> <out.json>"""
import json, re, sys, os
root, out = sys.argv[1], sys.argv[2]
files = {}
for d, _, fs in os.walk(root):
    if any(p in d for p in ("\obj", "/obj", "\bin", "/bin")): continue
    for f in fs:
        if f.endswith(".cs"):
            p = os.path.join(d, f)
            files[os.path.relpath(p, root).replace("\\", "/")] = open(p, encoding="utf-8-sig", errors="replace").read()

classes = {}   # class name -> file
for path, text in files.items():
    for m in re.finditer(r"\b(?:public|internal)\s+(?:sealed\s+|static\s+|partial\s+|abstract\s+)*(?:class|interface)\s+(\w+)", text):
        classes.setdefault(m.group(1), path)

static_helpers = {c for c, p in classes.items() if re.search(r"static\s+(?:partial\s+)?class\s+" + c + r"\b", files[p])}
service_like = {c for c, p in classes.items() if p.startswith("Services/")}

def ctor_deps(text, cls):
    m = re.search(r"public\s+" + cls + r"\s*\(([^)]*)\)", text)
    if not m: return []
    deps = []
    for part in m.group(1).split(","):
        t = part.strip().split(" ")[0] if part.strip() else ""
        t = re.sub(r"<.*", "", t)
        if t.startswith("I") and t[1:] in classes: deps.append(t[1:])
        elif t in classes: deps.append(t)
    return deps

def refs(text):
    return sorted({h for h in static_helpers if re.search(r"\b" + h + r"\.", text)})

report = {"controllers": {}, "services": {}}
for path, text in files.items():
    lines = text.count("\n") + 1
    for m in re.finditer(r"class\s+(\w+)\s*(?::|\{|\()", text):
        cls = m.group(1)
        if classes.get(cls) != path: continue
        entry = {"file": path, "lines": lines, "deps": ctor_deps(text, cls), "static": [h for h in refs(text) if h != cls]}
        if path.startswith("Controllers/") and cls.endswith("Controller"):
            route = re.search(r'\[Route\("([^"]+)"\)\]', text)
            entry["route"] = route.group(1) if route else ""
            entry["endpoints"] = len(re.findall(r"\[Http(Get|Post|Put|Delete|Patch)", text))
            report["controllers"][cls] = entry
        elif path.startswith("Services/"):
            report["services"][cls] = entry
json.dump(report, open(out, "w"), indent=1)
print(len(report["controllers"]), "controllers,", len(report["services"]), "service classes,", len(static_helpers), "static helpers")
