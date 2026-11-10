#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null; then
  print "Node.js 22.13 or later is required. Install Node 22 or 24, then try again."
  read -k 1 "?Press any key to close"
  exit 1
fi
node scripts/run.mjs dev
