#!/usr/bin/env bash
# Rebuild the knowledge base: graphify code graphs + generated diffs + document index.
# Run from anywhere with Git Bash:  bash kb/rebuild.sh            (everything)
#                                   bash kb/rebuild.sh --no-graphs (diffs and index only)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
G="${GRAPHIFY:-$HOME/.local/bin/graphify.exe}"
command -v "$G" >/dev/null 2>&1 || G=graphify
REF=reference/RotaryIndia_Admin_API_Claude
PARTS=(
  "api:row/api"
  "workers:row/workers"
  "admin:row/admin"
  "club-website:row/club-website"
  "mobile:row/mobile"
  "ref-api:$REF"
  "ref-mobile:reference/rotary_zones_45678_flutter"
)

if [[ "${1:-}" != "--no-graphs" ]]; then
  graphs=()
  for spec in "${PARTS[@]}"; do
    name=${spec%%:*}; path=${spec#*:}
    [[ -d "$path" ]] || { echo "skip $name (no $path)"; continue; }
    cp .graphifyignore "$path/.graphifyignore"
    "$G" extract "$path" --code-only --no-gitignore --out "graphify-out/parts/$name" | grep -E "wrote .*graph.json" || true
    rm -f "$path/.graphifyignore"
    "$G" cluster-only "graphify-out/parts/$name" --no-label --no-viz | tail -1   # GRAPH_REPORT.md, no LLM
    graphs+=("graphify-out/parts/$name/graphify-out/graph.json")
  done
  "$G" merge-graphs "${graphs[@]}" --out graphify-out/graph.json
fi

# ROW API route table: extracted statically from the .NET controllers (no server boot).
python -I kb/tools/dotnet_route_log.py row/api/Controllers kb/row-api-routes.log

# Frontend/mobile diffs: which RIZones API paths each client calls that the ROW API serves.
python -I kb/tools/app_diff.py "Mobile app" reference/rotary_zones_45678_flutter row/mobile kb/row-api-routes.log kb/mobile-diff.md .dart
python -I kb/tools/app_diff.py "Admin portal" "$REF/rotary-frontend" row/admin kb/row-api-routes.log kb/admin-diff.md .ts,.tsx,.js,.jsx,.mjs,.css
python -I kb/tools/app_diff.py "Club website" "$REF/club-website" row/club-website kb/row-api-routes.log kb/club-website-diff.md .ts,.tsx,.js,.jsx,.mjs,.css
python -I kb/tools/docs_index.py kb/docs-index.md document row reference
echo "kb rebuilt. Update kb/README.md findings and kb/testing.md by hand if results changed."
