#!/bin/sh
# Fetch the OpenStreetMap data the Berlin map is made from (© OpenStreetMap
# contributors, ODbL), then run: npx tsx tools/berlin/generate.ts
set -e
cd "$(dirname "$0")"
mkdir -p cache
curl -sf https://overpass-api.de/api/interpreter \
  -H 'User-Agent: garden-map-generator/1.0 (bernhard.esperester.de)' \
  -H 'Accept: application/json' \
  --data-urlencode data@query.overpassql -o cache/osm.json
echo "wrote cache/osm.json"
