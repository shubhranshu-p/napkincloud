#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dist_root="$project_root/dist"
rm -rf "$dist_root"
mkdir -p "$dist_root/server"
cp "$project_root/worker/index.js" "$dist_root/server/index.js"
echo "Built $dist_root"
