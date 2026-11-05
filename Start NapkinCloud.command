#!/bin/zsh
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 24 or newer from https://nodejs.org, then open this file again."
  read "?Press Return to close."
  exit 1
fi
open "http://localhost:8787"
node scripts/dev.mjs
