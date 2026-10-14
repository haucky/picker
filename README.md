# Vault Picker

Minimale PWA, um auf dem Android-Handy einen lokalen Obsidian-Vault schnell zu durchsuchen (Dateiname **und** Inhalt), Notizen zu bearbeiten, TILs mit `#diary/…`-Tags einzusortieren und Notizen per Spaced Repetition zu wiederholen. Reines HTML/CSS/JS, kein Build-Schritt. Die Dateien bleiben auf dem Gerät – nichts wird hochgeladen.

**App:** https://haucky.github.io/picker/

## Installation auf dem Handy

1. Die URL oben in **Chrome** auf Android öffnen.
2. Menü **⋮** → **Zum Startbildschirm hinzufügen** (bzw. **App installieren**) → **Installieren**.
3. Die App vom Startbildschirm starten. Sie läuft danach im eigenen Fenster und startet auch offline.

## Benutzung

- **Vault öffnen** tippen und im Ordner-Dialog **nur den Vault-Ordner** auswählen (den Ordner, der `.obsidian/` enthält) – nicht „Interner Speicher“, „Documents“ o. Ä. Die App bekommt Lese- *und Schreib*zugriff auf genau diesen Ordner samt Unterordnern; gib ihr nicht mehr als nötig.
Unten wechselst du zwischen den Modulen **Suche**, **Taggen**, **Study**, **Review** und **Sync**.

### Suche

- Ein Suchfeld. Getippter Text wird mit Dateinamen und Inhalt aller Notizen abgeglichen (Teilstring, ohne Groß-/Kleinschreibung; mehrere Wörter müssen alle vorkommen). Treffer im Namen stehen oben, darunter ein Textausschnitt mit markierter Fundstelle. Enter öffnet den ersten Treffer.
- Treffer antippen → Notiz bearbeiten → **Speichern** schreibt die Datei direkt zurück. Die Android-Zurück-Geste führt zurück zur Suche (mit Warnung bei ungespeicherten Änderungen).
- `.obsidian/`, `.trash/` und `.git/` werden ignoriert.

### Taggen

- Zeigt TILs mit dem Filter-Tag (voreingestellt `#life/diary`, inkl. Untertags), neueste zuerst nach `#date/JJJJ/MM/TT` (ohne Datums-Tag: Änderungsdatum der Datei).
- „nur ohne #diary/…“ (standardmäßig an) blendet TILs aus, die schon einen `#diary/…`-Tag haben.
- Rechts neben jedem TIL stehen die Tags dieser Sitzung und die 5 häufigsten `#diary/…`-Tags. Antippen weist zu bzw. nimmt die Zuweisung zurück. „+ neu“ öffnet ein Eingabefeld mit Vorschlägen (nur `#diary/…`), das Präfix `diary/` wird automatisch ergänzt.
- TIL links antippen klappt den ganzen Inhalt auf.
- Geschrieben wird erst über **Prüfen & bestätigen**: Die Tags werden an die Tag-Zeile in Zeile 1 (bzw. der ersten Zeile nach einer Frontmatter) angehängt (gibt es keine, wird dort eine neue Zeile eingefügt). Es wird nur hinzugefügt, nie entfernt. Wurde eine Datei inzwischen geändert, werden die Tags auf den aktuellen Stand gesetzt und die Datei wird gemeldet.
- Offene Zuweisungen bleiben gespeichert, auch wenn die App geschlossen wird.

### Study

Vorlesungen nacharbeiten. Die Stapel sind dieselben wie im Review (aus `Review.md`), eine **VL** sind alle Notizen eines Stapels mit demselben `#date/JJJJ/MM/TT` (Notizen ohne Datums-Tag stehen unter „Ohne Datum“).

- **Übersicht:** Stapel mit Zahl der offenen Todos, VLs und Fragen.
- **Stapel antippen:** „+ Neue VL heute“ (bzw. „Heutige VL öffnen“), darunter alle offenen Todos des Stapels (antippen springt im Editor zur Stelle) und die VLs, neueste zuerst.
- **VL antippen:** Alle Fragen der VL als ein Text:

  ```
  Was ist ein Equi-Join?
  - Join mit Gleichheitsbedingung

  Wozu Normalisierung? #not-for-exam
  - Anomalien vermeiden
  !!! Folie 23 nochmal anschauen
  ```

  **Eine Frage** ist jede Zeile, die nicht eingerückt ist, mit `?` endet und kein Markdown-Element ist (beginnt nicht mit `-`, `*`, `+`, `1.`, `>`, `#`, `|`, `` ` ``, `!`, `<`, `~` oder `::`); Zeilen in Codeblöcken zählen nie. Alles bis zur nächsten Frage ist ihr Inhalt. Fragen werden lila hinterlegt, Todos orange, Fehler rot – so sieht man beim Tippen sofort, was als Frage gilt.

  **Todos:** `!!! Text bis Zeilenende` (am Zeilenanfang, nach einem Listenzeichen oder nach einem Leerzeichen; „Wichtig!!!“ zählt nicht). Erledigt = Zeile löschen.

  **Tags hinter der Frage:** Die Grund-Tags der VL (Stapel-Tag bzw. dessen Untertag und `#date/…`) werden nicht angezeigt. Alle anderen Tags aus der Tag-Zeile einer Notiz stehen hinter ihrer Frage und lassen sich dort ändern, hinzufügen oder löschen (z. B. `#not-for-exam`). Mit `- ohne: #not-for-exam` im Stapel in `Review.md` wird so eine Frage nicht mehr abgefragt, bleibt aber in der VL.

  Farben (Solarized): Fragen blau, Tags cyan, Todos orange, Antwort-Daten magenta, Code cyan, Fehler rot unterkringelt.

- **Speichern** gleicht über den Dateinamen ab (Dateiname = Frage ohne `?`):
  - gleiche Frage → nur der Inhalt wird ersetzt; Frontmatter (SR-Stand) und Tag-Zeile bleiben,
  - neue Frage → neue Notiz im Ordner der anderen TILs der VL (bei neuer VL: Ordner der neuesten Notiz im Stapel) mit den Grund-Tags der VL plus den Tags hinter der Frage,
  - fehlende Frage → Datei wandert nach Rückfrage in den Papierkorb `.trash/` (wie in Obsidian).

  Eine umformulierte Frage ist also eine neue Notiz (der SR-Stand der alten geht verloren). Die Reihenfolge im Text wird als `study-order` in der Frontmatter gespeichert. Wurden Dateien seit dem Öffnen außerhalb geändert (z. B. per Obsidian Sync), fragt die App vor dem Überschreiben. Ungespeicherter Text bleibt als Entwurf im Browser erhalten und wird beim nächsten Öffnen der VL wiederhergestellt.
- Nicht erlaubt (Speichern wird verhindert): Text vor der ersten Frage, doppelte Fragen, Zeichen, die in Dateinamen verboten sind (`\ / : * " < > |` und `?` mitten in der Frage), Fragen, deren Datei es woanders im Vault schon gibt.

### Review

Notizen wie Karteikarten wiederholen: **Vorderseite = Dateiname**, **Rückseite = Inhalt** (ohne Frontmatter und Tag-Zeile, als Markdown mit Bildern). Alle Angaben stehen in den Notizen selbst, daher funktioniert es auf Handy und Laptop gleich (über Obsidian Sync).

**Welche Notizen?** Das steht in `Review.md` im obersten Ordner des Vaults (die App bietet an, sie anzulegen). Jede Überschrift ist ein Stapel:

```markdown
## TILs
- tag: #life/diary

## Datenbanken WS26
- tag: #uni/dbs
- ohne: #uni/dbs/orga
```

Jeder Stapel hat genau einen Tag hinter `tag:` (bei `tags:` mit mehreren zählt der erste). Eine Notiz gehört zum Stapel, wenn sie diesen Tag hat (Untertags zählen mit) und keinen hinter `ohne:`. `Review.md` selbst wird nie abgefragt.

**Spaced Repetition** wie im Obsidian-Plugin [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) (Notiz-Review, Algorithmus SM-2-OSR mit dessen Standardwerten: Start-Ease 250, Leicht-Bonus 1,3, Schwer halbiert den Abstand, Lastausgleich). Der Stand steht wie beim Plugin in der Frontmatter:

```markdown
---
sr-due: 2026-10-20
sr-interval: 7
sr-ease: 250
---
#life/diary #date/2026/10/01
…
```

Notizen ohne diese Felder sind „neu“; die Felder werden beim ersten Bewerten angelegt. Wer doch in Obsidian wiederholen will, trägt im Plugin unter „Tags to review“ dieselben Tags ein – es liest dieselben Felder. (Unterschied: Das Plugin leitet die Start-Ease neuer Notizen aus verlinkten Notizen ab, die PWA beginnt immer mit 250.)

**Feste Intervalle** wie bisher in Obsidian: `#review/daily`, `#review/weekly` oder `#review/monthly` plus `#reviewed/JJJJ/MM/TT`. Fällig, wenn das letzte Review mindestens 1/7/30 Tage her ist; „✅ Erledigt“ setzt `#reviewed/…` auf heute. Notizen mit festem Intervall werden nie zusätzlich per Spaced Repetition abgefragt. Fehlt `#reviewed/…`, gilt die Notiz als heute fällig; „Startdatum verteilen“ setzt (nach Rückfrage) ein zufälliges Datum innerhalb des Intervalls.

**Ablauf:** Übersicht mit „Alle“, je einem Eintrag pro Stapel und „Feste Intervalle“ (fällig / neu). Pro Karte:

- Titel antippen öffnet die Notiz, **Antwort zeigen** deckt die Rückseite auf. Eigene Antworten (`::TT.MM.JJJJ::`-Blöcke) stehen eingeklappt darunter.
- **✍️ Antwort notieren** hängt `::TT.MM.JJJJ::` + `- Antwort` ans Dateiende (wie „New Answer“ im Obsidian-Snippet).
- **Schwer / Gut / Leicht** zeigen den nächsten Abstand und schreiben sofort in die Datei. **↶ Rückgängig** stellt die letzte Bewertung wieder her (nur, wenn die Datei seitdem nicht geändert wurde). **↷ Überspringen** lässt die Karte unverändert.
- Fällige Karten kommen zuerst (am längsten überfällige oben), danach neue: älteste VL (`#date/…`) zuerst, innerhalb einer VL in der Reihenfolge aus dem Study-Editor (`study-order`).
- Tastatur am Laptop: Leertaste/Enter = Antwort zeigen, 1/2/3 = Schwer/Gut/Leicht, Enter = Erledigt, u = Rückgängig.

### Editor

Notiz-Editor (Suche → Notiz) und VL-Editor (Study) sind derselbe Markdown-Editor ([CodeMirror 6](https://codemirror.net/)) mit Live-Vorschau wie in Obsidian: Markdown wird gerendert, nur wo der Cursor steht, erscheint der Quelltext (fett/kursiv/Code/Links pro Element, Überschriften, Listen und Zitate pro Zeile). Gerendert werden Überschriften, **fett**, *kursiv*, ~~durchgestrichen~~, `Code`, Codeblöcke, Listen (•), Checkboxen (antippen schaltet um), Zitate, Trennlinien, `[[Links]]` (antippen öffnet die Notiz), Bilder (`![[bild.png]]`, `![](pfad)`) und `#Tags`. Tabellen und Formeln bleiben Text, die Frontmatter wird gedämpft angezeigt. Enter in einer Liste setzt sie fort (leerer Punkt beendet sie), Tab/Shift-Tab rückt ein/aus.

**Bilder einfügen:** Ein Bild aus der Zwischenablage (Screenshot, kopiertes Bild) oder per Ziehen landet als `images/Pasted image JJJJMMTTHHMMSS.png` im Vault (Ordner wird angelegt), an der Cursor-Stelle wird `![[Pasted image ….png]]` eingefügt – bzw. ein Markdown-Link, wenn in Obsidian „Wikilinks verwenden“ aus ist. Das Bild wird sofort gespeichert, auch wenn die Notiz danach nicht gespeichert wird.

**Korrekturvorschläge (nur am Computer):** Steht der Cursor in einem Wort, das weder in den Wortlisten (Deutsch, Englisch, je ~50.000 häufigste Wörter) noch mindestens zweimal im eigenen Vault vorkommt, erscheinen darunter bis zu 4 Vorschläge – kleinster Tippabstand zuerst, dann das häufigste Wort. Klick oder Alt+1…4 ersetzt das Wort. Fachbegriffe, die man öfter in Notizen verwendet, gelten damit automatisch als bekannt. Die rote Unterkringelung kommt weiter vom Browser.

CodeMirror liegt fertig gebündelt in `vendor/codemirror.js` (die App braucht weiterhin kein npm). Neu bauen bzw. aktualisieren: Versionen in `vendor/codemirror/package.json` anpassen, dann `vendor/codemirror/build.sh`.

### Darstellung

Farbschema [Solarized](https://ethanschoonover.com/solarized/) hell und dunkel. Standard ist „Automatisch“ (folgt der Einstellung des Handys); umstellen unter **Sync → Darstellung**.

### Zwischenspeicher

Damit die Suche schnell ist, hält die App eine Kopie aller Notizen im Browser-Speicher (IndexedDB) – nur auf dem Gerät, nichts wird hochgeladen.

- Beim **ersten** Öffnen eines Vaults wird alles einmal eingelesen; das dauert je nach Größe etwas.
- Bei jedem weiteren Start ist die Suche sofort da. Im Hintergrund prüft die App, was sich geändert hat, und liest nur neue/geänderte Dateien neu ein (Status unten: „aktualisiere …“).
- Mit dem Obsidian-Plugin (siehe unten) prüft die App dabei nur die Dateien, die das Plugin als geändert gemeldet hat. Ohne Plugin wird jede Datei geprüft, was bei einigen tausend Notizen dauert.
- Fragt Chrome nach einem Neustart erneut nach der Berechtigung, ist die Suche trotzdem nutzbar; beim Antippen eines Treffers (oder über „Zugriff erlauben“) wird der Zugriff erneut erteilt.
- Werden die Website-Daten in Chrome gelöscht, baut die App den Zwischenspeicher einfach neu auf.

### Sync

- Zeigt, wann und wie zuletzt abgeglichen wurde, mit **Jetzt abgleichen** und **Komplett abgleichen**.
- Darunter die letzten Einträge des Plugin-Logs (zur Kontrolle, ob das Plugin läuft).
- Ganz unten: **Darstellung** (Automatisch / Hell / Dunkel).

## Obsidian-Plugin „Picker Changelog“

Das Plugin in `obsidian-plugin/picker-changelog/` schreibt jede Änderung an Notizen (neu, geändert, gelöscht, umbenannt) als Zeile nach `.picker/changes.log` im Vault. Die PWA liest beim Start nur dieses Log und prüft genau die genannten Dateien. Das Plugin ist nur auf Mobilgeräten aktiv; auf dem Desktop tut es nichts.

**Installation (mit Obsidian Sync inkl. Plugin-Sync):**

1. Auf dem Desktop den Ordner `picker-changelog` (mit `manifest.json` und `main.js`) nach `<Vault>/.obsidian/plugins/` kopieren.
2. Warten, bis Obsidian Sync ihn aufs Handy übertragen hat.
3. Auf dem Handy: **Einstellungen → Community-Plugins** → ggf. den eingeschränkten Modus ausschalten → „Picker Changelog“ aktivieren.
4. Kontrolle: Im Tab **Sync** der PWA erscheint unter „Plugin-Log“ ein Eintrag „Obsidian gestartet“.

**Verhalten:**

- Änderungen werden gesammelt und spätestens alle 5 Sekunden geschrieben (sowie sofort, wenn Obsidian in den Hintergrund geht). Einträge älter als 30 Tage werden entfernt.
- Änderungen von anderen Geräten (Obsidian Sync) landen im Log, sobald Obsidian auf dem Handy sie empfängt.
- Ein vollständiger Abgleich findet weiterhin statt: beim ersten Mal, wenn das Log fehlt oder nicht weit genug zurückreicht, spätestens alle 3 Tage und per Button. Damit werden auch Änderungen gefunden, die am Plugin vorbei passiert sind.
- Eigene Änderungen der PWA (z. B. Tags) kennt die PWA ohnehin; erkennt Obsidian sie später, steht ein `modify` im Log, das die PWA nur kurz prüft.

## Unterstützte Browser

Benötigt die File System Access API (`showDirectoryPicker`):

| Browser | Status |
|---|---|
| Chrome / Edge / Brave auf **Android** | ✅ |
| Chrome / Edge auf Windows, macOS, Linux | ✅ |
| **Firefox** (alle Plattformen) | ❌ |
| **Safari** und alle Browser auf **iOS/iPadOS** | ❌ |

In nicht unterstützten Browsern zeigt die App einen entsprechenden Hinweis.

## Aufbau

- `core.js` – Datenschicht: Vault-Zugriff, Zwischenspeicher (IndexedDB), Abgleich, CRUD (`read`, `create`, `update`, `remove`), Auslesen von Tags/Datum, Events (`change`, `status`).
- `app.js` – Rahmen: Startseite, Tab-Leiste, gemeinsamer Editor.
- `features/srs.js` – Review-Logik ohne DOM (Algorithmus, feste Intervalle, `Review.md`); `features/markdown.js` – Markdown-Renderer für die Rückseite.
- `obsidian-plugin/picker-changelog/` – Obsidian-Plugin, das Änderungen protokolliert (wird nicht von der PWA geladen).
- `features/*.js` – Feature-Module `{ id, title, mount(root, ui), show() }`, in `app.js` unter `FEATURES` registriert. Module greifen nur über den Core auf Dateien zu.

## Deployment

GitHub Pages veröffentlicht direkt aus dem Branch `ccr-24a76550-4wcodz`, Ordner `/ (root)` (**Settings → Pages → Source: Deploy from a branch**). Jeder Push auf diesen Branch geht automatisch live. `.nojekyll` sorgt dafür, dass die Dateien unverändert ausgeliefert werden. Bei Änderungen an der App-Shell die `CACHE`-Version in `service-worker.js` erhöhen.
