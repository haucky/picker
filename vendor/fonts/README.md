# Latin Modern

Für den PDF-Export einer VL (Druckansicht im LaTeX-Stil). Aus den OTF-Dateien von [Latin Modern](https://www.gust.org.pl/projects/e-foundry/latin-modern) (GUST Font License) auf Latein, Latein-1/Erweitert, Griechisch, Pfeile, Satzzeichen und Mathe-Operatoren reduziert und als WOFF2 gespeichert:

```sh
pyftsubset lmroman10-regular.otf --unicodes="U+0020-007E,U+00A0-024F,U+0370-03FF,U+2010-2044,U+20AC,U+2190-21FF,U+2200-22FF,U+2122" \
  --flavor=woff2 --layout-features='*' --output-file=lmroman10-regular.woff2
```

(ebenso `lmroman10-bold`, `lmroman10-italic`, `lmroman10-bolditalic`, `lmmono10-regular`).
