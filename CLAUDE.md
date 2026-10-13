## Start here

Read `kb/README.md` first: it maps the codebases (ROW api / admin / club-website / mobile, the ROW .NET edition in
`row-dotnet/`, and the RIZones reference API + Flutter app), the generated ROW-vs-RIZones diffs, the document index and the
testing record. Progress and decisions live in `row/STATUS.md` and `row/api/ROW-CHANGES.md`; pending work and why it is pending is in `row/PENDING-WORK.md`.
Do not re-read whole codebases to orient: use the diffs in `kb/` and the graphify queries below.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.
graphify is at `~/.local/bin/graphify.exe` (not on PATH). `graphify-out/graph.json` merges eight graphs; each node's `repo`
says which codebase it is from. To stay inside one codebase pass `--graph graphify-out/parts/<tag>/graphify-out/graph.json`
(tags: row-api, row-admin, row-club-website, row-mobile, dotnet-api, dotnet-workers, ref-api, ref-mobile). The .NET
edition's admin and club website are copies of row/admin and row/club-website, so they have no separate graph.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `bash kb/rebuild.sh` (graphs + diffs; `--no-graphs` for diffs only). Code-only, no API cost.
