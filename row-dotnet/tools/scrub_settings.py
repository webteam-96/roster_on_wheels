"""Blank every secret or RIZones-identity value in appsettings*.json, keeping the structure.

Values are emptied (strings) so the app still binds its options; real values go in
environment variables on the server (ASP.NET: Section__Key). Comments (_comment) are kept.

usage: python -I tools/scrub_settings.py <dir>
"""
import glob
import json
import os
import re
import sys

SECRET_KEY = re.compile(
    r"pass|secret|key|token|sid|connection|pwd|credential|webhook|salt|user|clientid|accountid|"
    r"email|phone|mobile|recipient|sender|\bcc\b|bcc|otp|peid", re.I)
# \d{10,}: phone numbers and India DLT SMS registration / template ids
IDENTITY_VALUE = re.compile(
    r"rizones|rotaryindia|kaizeninfotech|@|\+?91[\s-]?\d{10}|\b\d{10,}\b|Asia/Kolkata", re.I)


def scrub(node, path=""):
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k.startswith("_comment"):
                # comments are kept unless they carry RIZones names, people or contacts
                if not (isinstance(v, str) and (IDENTITY_VALUE.search(v) or re.search(r"\d{10}", v))):
                    out[k] = v
            else:
                out[k] = scrub(v, f"{path}.{k}")
        return out
    if isinstance(node, list):
        return [scrub(v, path) for v in node]
    if isinstance(node, str) and node and (SECRET_KEY.search(path) or IDENTITY_VALUE.search(node)):
        return ""
    return node


def main(root):
    for f in sorted(glob.glob(os.path.join(root, "**", "appsettings*.json"), recursive=True)):
        raw = open(f, encoding="utf-8-sig").read()
        data = json.loads(raw)
        clean = scrub(data)
        open(f, "w", encoding="utf-8").write(json.dumps(clean, indent=2, ensure_ascii=False) + "\n")
        print("scrubbed", os.path.relpath(f, root))


if __name__ == "__main__":
    main(sys.argv[1])
