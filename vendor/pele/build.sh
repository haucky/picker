#!/bin/sh
# Holt vendor/pele.js (Pele, Mermaid-Renderer von Obsidian, MIT) in der Version aus package.json.
# Das Paket bringt schon ein fertiges ES-Modul mit allen Diagrammtypen mit – nur kopieren, nicht neu bündeln.
set -e
cd "$(dirname "$0")"
npm install --no-audit --no-fund
cp node_modules/pele/dist/pele.js ../pele.js
cp node_modules/pele/LICENSE ../pele.LICENSE 2>/dev/null || cp node_modules/pele/LICENSE.md ../pele.LICENSE
