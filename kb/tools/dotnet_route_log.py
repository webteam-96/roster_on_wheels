"""Emit the ROW .NET API route table in the "Mapped {path, Verb}" format that
app_diff.py expects, parsed statically from the C# controllers (no server boot).

Replaces the old step that booted the NestJS app to read its "Mapped {...}" lines;
ROW's backend is now ASP.NET Core, so the routes come straight from the controllers.

usage: python -I dotnet_route_log.py <Controllers dir> <out.log>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I drops the script dir
from route_diff import dotnet_routes  # noqa: E402


def main(cs_dir, out_log):
    seen = set()
    lines = []
    for verb, path, _ctrl in dotnet_routes(cs_dir):
        key = (verb, path)
        if key in seen:
            continue
        seen.add(key)
        p = path.lstrip("~").lstrip("/")
        lines.append("Mapped {%s, %s}" % (p, verb.capitalize()))
    open(out_log, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"wrote {len(lines)} routes to {out_log}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
