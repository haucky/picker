#!/bin/sh
# Baut vendor/tinfoil.js (ES-Modul, minifiziert) aus der Version in package.json.
# zlib bleibt extern: der Verifier nutzt im Browser DecompressionStream, zlib ist nur der Node-Fallback.
set -e
cd "$(dirname "$0")"
npm install --no-audit --no-fund
npx esbuild entry.js --bundle --format=esm --platform=browser --minify --external:zlib --legal-comments=eof --outfile=../tinfoil.js
