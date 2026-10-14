#!/bin/sh
# Baut vendor/codemirror.js (ES-Modul, minifiziert) aus den Versionen in package.json.
set -e
cd "$(dirname "$0")"
npm install --no-audit --no-fund
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=eof --outfile=../codemirror.js
