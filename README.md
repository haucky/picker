# Vault Picker

Minimale PWA, um auf dem Android-Handy einen lokalen Obsidian-Vault schnell zu durchsuchen (Dateiname **und** Inhalt), Notizen zu bearbeiten, TILs mit `#diary/…`-Tags einzusortieren und Notizen per Spaced Repetition zu wiederholen. Reines HTML/CSS/JS, kein Build-Schritt. Die Dateien bleiben auf dem Gerät – nichts wird hochgeladen.

**App:** https://oma.app/

## Installation auf dem Handy

1. Die URL oben in **Chrome** auf Android öffnen.
2. Menü **⋮** → **Zum Startbildschirm hinzufügen** (bzw. **App installieren**) → **Installieren**.
3. Die App vom Startbildschirm starten. Sie läuft danach im eigenen Fenster und startet auch offline.

## Benutzung

- **Vault öffnen** tippen und im Ordner-Dialog **nur den Vault-Ordner** auswählen (den Ordner, der `.obsidian/` enthält) – nicht „Interner Speicher“, „Documents“ o. Ä. Die App bekommt Lese- *und Schreib*zugriff auf genau diesen Ordner samt Unterordnern; gib ihr nicht mehr als nötig.
Unten wechselst du zwischen den Modulen **Suche**, **Study**, **Review**, **Diary** (darin **Taggen** und **Streams**) und **Settings**.

### Suche

- Ein Suchfeld. Getippter Text wird mit Dateinamen und Inhalt aller Notizen abgeglichen (Teilstring, ohne Groß-/Kleinschreibung; mehrere Wörter müssen alle vorkommen). Treffer im Namen stehen oben, darunter ein Textausschnitt mit markierter Fundstelle. Enter öffnet den ersten Treffer.
- Treffer antippen → Notiz bearbeiten → **Speichern** schreibt die Datei direkt zurück. Die Android-Zurück-Geste führt zurück zur Suche (mit Warnung bei ungespeicherten Änderungen).
- `.obsidian/`, `.trash/` und `.git/` werden ignoriert.

### Diary → Taggen

- Zeigt TILs mit dem Filter-Tag (voreingestellt `#life/diary`, inkl. Untertags), neueste zuerst nach `#date/JJJJ/MM/TT` (ohne Datums-Tag: Änderungsdatum der Datei).
- „nur ohne #diary/…“ (standardmäßig an) blendet TILs aus, die schon einen `#diary/…`-Tag haben.
- Rechts neben jedem TIL stehen die Tags dieser Sitzung und die 5 häufigsten `#diary/…`-Tags. Antippen weist zu bzw. nimmt die Zuweisung zurück. „+ neu“ öffnet ein Eingabefeld mit Vorschlägen (nur `#diary/…`), das Präfix `diary/` wird automatisch ergänzt.
- TIL links antippen klappt den ganzen Inhalt auf.
- Geschrieben wird erst über **Prüfen & bestätigen**: Die Tags werden an die Tag-Zeile in Zeile 1 (bzw. der ersten Zeile nach einer Frontmatter) angehängt (gibt es keine, wird dort eine neue Zeile eingefügt). Es wird nur hinzugefügt, nie entfernt. Wurde eine Datei inzwischen geändert, werden die Tags auf den aktuellen Stand gesetzt und die Datei wird gemeldet.
- Offene Zuweisungen bleiben gespeichert, auch wenn die App geschlossen wird.

### Diary → Streams

Ein Stream zeigt einen Tag über die Zeit, z. B. `#diary/mental` (Untertags zählen mit). Die Streams stehen in `Streams.md` im obersten Ordner des Vaults, aufgebaut wie `Review.md`, mit optionalen Kapiteln:

```markdown
## Mental
- tag: #diary/mental
- kapitel: 2026-01-12 bis 2026-02-20 Prüfungsphase
- kapitel: 2026-10-06 bis heute Wintersemester
```

- **Übersicht:** alle Streams mit Anzahl, letztem Eintrag und einer Kurve „Einträge pro Woche“ (12 Monate). **+ Neuer Stream** schlägt die 10 häufigsten `#diary/…`-Tags vor und trägt den Stream in `Streams.md` ein (die Datei wird bei Bedarf angelegt).
- **Zeitleiste:** oben ein Streifen mit einem Kästchen pro Woche (26 Wochen; antippen springt hin), darunter die Einträge nach Monaten (ältere werden beim Scrollen nachgeladen). Titel antippen klappt den Eintrag auf, **Bearbeiten** öffnet ihn im Editor. Kapitel erscheinen als violettes Band; **+ Kapitel** → ersten und letzten Eintrag antippen (oder „bis heute“) → Name.
- **Heute sehe ich das so …** (✍️ an jedem Eintrag): hängt wie im Review `::TT.MM.JJJJ::` + Antwort an die Notiz. Unter dem Eintrag steht die neueste Antwort, aufgeklappt alle.
- **Damals:** Einträge von vor 1 Monat, 3 Monaten und 1 Jahr (±7 Tage), ein zufälliger Eintrag mit „Was würdest du heute dazu sagen?“ und **Damals ↔ Heute**: Zu einem Stichwort (Vorschläge = Wörter, die früh und spät im Stream oft vorkommen, oder selbst eintippen) steht der früheste Eintrag neben einem späteren; ‹ › blättert durch alle dazwischen.
- **Muster:** auffällige Wörter pro Kapitel bzw. Quartal – Wörter, die dort deutlich häufiger vorkommen als im Rest des Stream. Füllwörter (die 400 häufigsten Wörter der deutschen und englischen Wortliste), Wörter unter 4 Buchstaben, Tags und Links zählen nicht. Ein Wort antippen zeigt es als Faden unter Damals.

### Study

Vorlesungen nacharbeiten. Die Stapel sind dieselben wie im Review (aus `Review.md`), eine **VL** sind alle Notizen eines Stapels mit demselben `#date/JJJJ/MM/TT` (Notizen ohne Datums-Tag stehen unter „Ohne Datum“).

- **Übersicht:** Stapel mit Zahl der offenen Todos, VLs und Fragen, dazu ein schmaler Balken mit dem Review-Status der Fragen (gelb offen, grün bereit, grau nicht abfragen) und „N offen“ – so sieht man, was noch nachzuarbeiten ist. Dasselbe pro VL in der Liste des Stapels. Gibt es keine offenen Fragen mehr, wird der Eintrag dezent hervorgehoben (leicht grüner Hintergrund, ein kleiner ✦ hüpft herum).
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

  **Tags hinter der Frage:** Die Grund-Tags der VL (Stapel-Tag bzw. dessen Untertag und `#date/…`) werden nicht angezeigt. Alle anderen Tags aus der Tag-Zeile einer Notiz stehen hinter ihrer Frage und lassen sich dort ändern, hinzufügen oder löschen (z. B. `#not-for-exam`).

  Farben (Solarized): Fragen blau, Tags cyan, Todos orange, Antwort-Daten magenta, Code cyan, Fehler rot unterkringelt.

**Review-Status:** Jede Frage ist *offen* (unbearbeitet, Standard), *bereit* (wird im Review abgefragt) oder *nicht abfragen* (z. B. „Welche Modalitäten hat die Klausur?“). Den Punkt vor der Frage antippen schaltet weiter: offen (leerer Kreis) → bereit (grün, Zeile leicht grün) → nicht abfragen (grau, Zeile leicht grau) → offen. Neben dem Titel steht, wie viele Fragen der VL noch offen sind. Gespeichert wird der Status mit **Speichern** (bis dahin im Entwurf) in der Frontmatter der Notiz: `review-state: ready` bzw. `review-state: skip`, bei offen gibt es kein Feld. Notizen ohne Feld, die schon einen SR-Stand haben (also schon wiederholt wurden), gelten als bereit; wird so eine Notiz auf offen gestellt, steht dort `review-state: open`.

**Menü an der Frage:** Den Punkt vor einer Frage lang drücken (am Computer: Rechtsklick) öffnet ein Menü:
- **KI-Aktionen:** die obersten 3 Abkürzungen aus `Prompts.md` direkt als Knöpfe, darüber ein Feld für einen eigenen Prompt oder eine andere Abkürzung (auch auf dem Handy). Geschickt wird die ganze Frage samt Inhalt und eigenen Antworten (ohne Todos und Tags); **Einfügen** setzt die Antwort ans Ende dieser Frage.
- **Umbenennen:** ändert die Frage, ohne dass der Lernstand verloren geht – beim Speichern zieht die Notiz mit Frontmatter (SR-Stand, Status) und Tags unter den neuen Namen um (Links in Obsidian auf den alten Namen werden dabei nicht angepasst).

Fragen mit Status *bereit* sind gegen versehentliches Ändern gesperrt (der Text bis zum „?“); Inhalt und Tags dahinter bleiben frei. Ändern geht über **Umbenennen** – oder den Status vorher auf offen stellen.

- **Speichern** gleicht über den Dateinamen ab (Dateiname = Frage ohne `?`):
  - gleiche Frage → nur der Inhalt wird ersetzt; Frontmatter (SR-Stand) und Tag-Zeile bleiben,
  - neue Frage → neue Notiz im Ordner der anderen TILs der VL (bei neuer VL: Ordner der neuesten Notiz im Stapel) mit den Grund-Tags der VL plus den Tags hinter der Frage,
  - fehlende Frage → Datei wandert nach Rückfrage in den Papierkorb `.trash/` (wie in Obsidian).

  Eine direkt im Text umformulierte Frage ist also eine neue Notiz (der SR-Stand der alten geht verloren) – zum Umformulieren mit Lernstand **Umbenennen** im Menü an der Frage nehmen. Die Reihenfolge im Text wird als `study-order` in der Frontmatter gespeichert. Wurden Dateien seit dem Öffnen außerhalb geändert (z. B. per Obsidian Sync), fragt die App vor dem Überschreiben. Ungespeicherter Text bleibt als Entwurf im Browser erhalten und wird beim nächsten Öffnen der VL wiederhergestellt.
- Nicht erlaubt (Speichern wird verhindert): Text vor der ersten Frage, doppelte Fragen, Zeichen, die in Dateinamen verboten sind (`\ / : * " < > |` und `?` mitten in der Frage), Fragen, deren Datei es woanders im Vault schon gibt.
- **PDF** (im VL-Editor oben) exportiert die VL so, wie sie gerade im Editor steht, als schlichtes Dokument im LaTeX-Stil (Schrift Latin Modern, A4) – z. B. um sie anderen Studis zu geben. Es öffnet sich der Druckdialog, dort **Als PDF speichern** wählen. Oben stehen Stapel-Name, dein Name (aus **Settings**) und das Datum der VL, darunter jede Frage nummeriert mit ihrem Inhalt und Bildern (`small` = drei nebeneinander, `normal` ≈ ¾ Seitenbreite, `big` = volle Breite). Eigene Antworten stehen mit drin („Antwort vom …“). Todos (`!!!`) und die Tags hinter den Fragen lässt der Export weg.

### Review

Notizen wie Karteikarten wiederholen: **Vorderseite = Dateiname**, **Rückseite = Inhalt** (ohne Frontmatter und Tag-Zeile, als Markdown mit Bildern). Alle Angaben stehen in den Notizen selbst, daher funktioniert es auf Handy und Laptop gleich (über Obsidian Sync).

**Welche Notizen?** Das steht in `Review.md` im obersten Ordner des Vaults (die App bietet an, sie anzulegen). Jede Überschrift ist ein Stapel:

```markdown
## Datenbanken WS26
- tag: #uni/dbs

## Analysis I
- tag: #uni/ana1
```

Jeder Stapel hat genau einen Tag hinter `tag:` (bei `tags:` mit mehreren zählt der erste). Eine Notiz gehört zum Stapel, wenn sie diesen Tag hat (Untertags zählen mit). Abgefragt werden nur Notizen mit Review-Status *bereit* (siehe Study); offene und „nicht abfragen“ kommen nie dran. `Review.md` selbst wird nie abgefragt. (Frühere `ohne:`-Zeilen werden ignoriert.)

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
- **Schwer / Gut / Leicht** zeigen den nächsten Abstand und schreiben sofort in die Datei. **↶ Rückgängig** stellt die letzte Bewertung wieder her (nur, wenn die Datei seitdem nicht geändert wurde). **↷ Überspringen** lässt die Karte unverändert. **⊘ Aussortieren** setzt den Review-Status auf *nicht abfragen* (z. B. für Orga-Fragen; rückgängig machbar, im Study-Editor wieder änderbar).
- Fällige Karten kommen zuerst (am längsten überfällige oben), danach neue: älteste VL (`#date/…`) zuerst, innerhalb einer VL in der Reihenfolge aus dem Study-Editor (`study-order`).
- Tastatur am Laptop: Leertaste/Enter = Antwort zeigen, 1/2/3 = Schwer/Gut/Leicht, Enter = Erledigt, u = Rückgängig.

### Editor

Notiz-Editor (Suche → Notiz) und VL-Editor (Study) sind derselbe Markdown-Editor ([CodeMirror 6](https://codemirror.net/)) mit Live-Vorschau wie in Obsidian: Markdown wird gerendert, nur wo der Cursor steht, erscheint der Quelltext (fett/kursiv/Code/Links pro Element, Überschriften, Listen und Zitate pro Zeile). Gerendert werden Überschriften, **fett**, *kursiv*, ~~durchgestrichen~~, `Code`, Codeblöcke, Listen (•), Checkboxen (antippen schaltet um), Zitate, Trennlinien, `[[Links]]` (antippen öffnet die Notiz), Bilder (`![[bild.png]]`, `![](pfad)`) und `#Tags`. Tabellen und Formeln bleiben Text, die Frontmatter wird gedämpft angezeigt. Enter in einer Liste setzt sie fort (leerer Punkt beendet sie), Tab/Shift-Tab rückt ein/aus. Strg/Cmd+B macht fett, Strg/Cmd+I kursiv (um die Auswahl bzw. das Wort am Cursor; nochmal drücken entfernt es wieder).

**Tag-Vorschläge:** Beim Tippen von `#` und mindestens einem Zeichen erscheinen bis zu 6 passende Tags aus dem Vault – erst solche, die mit dem Getippten anfangen, dann solche, bei denen ein Teil nach `/` passt (`#dbs` → `#uni/dbs`), jeweils häufigste zuerst. ↑/↓ wählen, Enter oder Tab übernehmen (mit Leerzeichen dahinter), Escape schließt; auf dem Handy antippen. `#date/…` und `#reviewed/…` erscheinen nur, wenn man sie ausdrücklich tippt. Die Liste wird aus den aktuellen Notizen berechnet: Ein neuer Tag taucht auf, sobald eine Notiz damit gespeichert ist; Tags, die in keiner Notiz mehr stehen, verschwinden von selbst. Neue Tags einfach weitertippen. Gilt im Notiz- und im VL-Editor (auch hinter einer Frage), auf Handy und Computer.

**Bilder einfügen:** Ein Bild aus der Zwischenablage (Screenshot, kopiertes Bild) oder per Ziehen landet als `images/Pasted image JJJJMMTTHHMMSS.png` im Vault (Ordner wird angelegt), an der Cursor-Stelle wird `![[Pasted image ….png|small]]` in die Zeile eingefügt (mehrere eingefügte Bilder ergeben eine Reihe; für ein Bild allein vorher Enter) – bzw. ein Markdown-Link, wenn in Obsidian „Wikilinks verwenden“ aus ist. Das Bild wird sofort gespeichert, auch wenn die Notiz danach nicht gespeichert wird.

**Bildgröße** hinter `|` wie in Obsidian: `![[bild.png|100]]` (Breite in px), `![[bild.png|100x145]]`, `![Alt|100](pfad)` – zusätzlich `small`, `normal` (Standard, höchstens 480×320 px) und `big` (volle Breite). Bilder stehen im Text (inline): mehrere `![[…|small]]` in einer Zeile ergeben eine Reihe kleiner Vorschaubilder, z. B. Folien-Ausschnitte. Ein Bild antippen öffnet es groß als Overlay (nochmal antippen = Originalgröße zum Scrollen; Hintergrund, ×, Esc oder Zurück schließt). Stehen mehrere Bilder in derselben Zeile, blättert man dort mit den Pfeilen ‹ ›, den Pfeiltasten ←/→ oder durch Wischen (ohne Umlauf, Anzeige „2 / 3“). Gilt im Editor und auf der Review-Rückseite. Obsidian zeigt `small`/`normal`/`big` einfach in Standardgröße.

**Korrekturvorschläge (nur am Computer):** Steht der Cursor in einem Wort, das weder in den Wortlisten (Deutsch, Englisch, je ~50.000 häufigste Wörter) noch mindestens zweimal im eigenen Vault vorkommt, erscheinen darunter bis zu 4 Vorschläge – kleinster Tippabstand zuerst, dann das häufigste Wort. Klick oder Alt+1…4 ersetzt das Wort. Fachbegriffe, die man öfter in Notizen verwendet, gelten damit automatisch als bekannt. Die rote Unterkringelung kommt weiter vom Browser.

**KI-Korrektur (nur am Computer):** Doppelklick auf ein Wort öffnet ein kleines Menü: oben sofort die Vorschläge aus dem Wörterbuch (wenn das Wort unbekannt ist), darunter bis zu 5 Vorschläge eines Sprachmodells, sobald sie da sind (Duplikate fallen weg). Klick oder Alt+1…9 ersetzt das Wort; Escape, Klick daneben oder Weitertippen schließt das Menü. An das Modell geht nur der Satz um das Wort. Dafür unter **Settings → KI** einen eigenen [Tinfoil](https://tinfoil.sh)-API-Key eintragen (bleibt im Browser; **Testen** prüft Verbindung und Enclave). Ohne Key oder offline gibt es nur die Wörterbuch-Vorschläge; antwortet das Modell nicht innerhalb von 5 Sekunden, steht „KI-Vorschläge nicht verfügbar“ im Menü. Gleiche Anfragen (Wort + Satz) werden bis zum Neuladen gemerkt.

**KI-Prompts auf markierten Text (nur am Computer):** Text markieren – darunter erscheint ein Eingabefeld (es nimmt den Fokus nicht weg, Weitertippen ersetzt wie gewohnt die Markierung; **Strg/Cmd+K** springt hinein). Dort einen eigenen Prompt tippen oder eine Abkürzung wie `summary` oder `explain` (Vorschläge darunter antippen, Tab ergänzt; hinter der Abkürzung sind weitere Anweisungen möglich, z. B. `summary auf Englisch`). Enter schickt Prompt + markierten Text ans Modell, die Antwort erscheint nach und nach in einem kleinen Dialog: **Einfügen** setzt sie in eine neue Zeile unter den Cursor und schließt, **Schließen**/Escape schließt ohne Einfügen, **Kopieren** kopiert sie.

Die Abkürzungen stehen in `Prompts.md` im obersten Ordner des Vaults (ohne die Datei gibt es nur eigene Prompts). Jede `##`-Überschrift ist eine Abkürzung, der Text darunter der Prompt; `{{text}}` steht für den markierten Text (fehlt es, kommt der Text ans Ende):

```markdown
## summary
Fasse den Text in höchstens 5 Stichpunkten zusammen.

## eli5
Erkläre {{text}} so, dass es ein Kind versteht.
```

Die Anfragen laufen über das offizielle Tinfoil-SDK (`vendor/tinfoil.js`, wird erst bei Bedarf geladen): Es prüft die Attestierung der Enclave und verschlüsselt Anfragen Ende-zu-Ende. Der Zugriff aufs Modell steckt in `features/llm.js` (`chat()` mit Streaming, `listModels()`, `extractJSON()`, Standard-Modelle in `DEFAULT_MODELS`) und ist für weitere KI-Funktionen gedacht. Die Modelle für Korrektur und Prompts lassen sich unter **Settings → KI** ändern (Vorschläge aus der aktuellen Modell-Liste von Tinfoil; leer = Standard: `gemma4-31b` für die Korrektur, `deepseek-v4-1-flash` für Prompts). SDK aktualisieren: Version in `vendor/tinfoil/package.json`, dann `vendor/tinfoil/build.sh`.

CodeMirror liegt fertig gebündelt in `vendor/codemirror.js` (die App braucht weiterhin kein npm). Neu bauen bzw. aktualisieren: Versionen in `vendor/codemirror/package.json` anpassen, dann `vendor/codemirror/build.sh`.

### Darstellung

Farbschema [Solarized](https://ethanschoonover.com/solarized/) hell und dunkel. Standard ist „Automatisch“ (folgt der Einstellung des Handys); umstellen unter **Settings → Darstellung**.

### Zwischenspeicher

Damit die Suche schnell ist, hält die App eine Kopie aller Notizen im Browser-Speicher (IndexedDB) – nur auf dem Gerät, nichts wird hochgeladen.

- Beim **ersten** Öffnen eines Vaults wird alles einmal eingelesen; das dauert je nach Größe etwas.
- Bei jedem weiteren Start ist die Suche sofort da. Im Hintergrund prüft die App, was sich geändert hat, und liest nur neue/geänderte Dateien neu ein (Status unten: „aktualisiere …“).
- Mit dem Obsidian-Plugin (siehe unten) prüft die App dabei nur die Dateien, die das Plugin als geändert gemeldet hat. Ohne Plugin wird jede Datei geprüft, was bei einigen tausend Notizen dauert.
- Fragt Chrome nach einem Neustart erneut nach der Berechtigung, ist die Suche trotzdem nutzbar; beim Antippen eines Treffers (oder über „Zugriff erlauben“) wird der Zugriff erneut erteilt.
- Werden die Website-Daten in Chrome gelöscht, baut die App den Zwischenspeicher einfach neu auf.

### Settings

- **Name:** steht beim PDF-Export einer VL unter dem Titel (wird nur im Browser gespeichert).
- **KI:** eigener Tinfoil-API-Key für alle KI-Funktionen (nur im Browser gespeichert) mit **Testen**, Modell für die Korrektur und für Prompts, gefundene Abkürzungen aus `Prompts.md`.
- **Darstellung** (Automatisch / Hell / Dunkel).
- **Abgleich:** wann und wie zuletzt abgeglichen wurde, mit **Jetzt abgleichen** und **Komplett abgleichen**.
- Darunter die letzten Einträge des Plugin-Logs (zur Kontrolle, ob das Plugin läuft).

## Obsidian-Plugin „Picker Changelog“

Das Plugin in `obsidian-plugin/picker-changelog/` schreibt jede Änderung an Notizen (neu, geändert, gelöscht, umbenannt) als Zeile nach `.picker/changes.log` im Vault. Die PWA liest beim Start nur dieses Log und prüft genau die genannten Dateien. Das Plugin ist nur auf Mobilgeräten aktiv; auf dem Desktop tut es nichts.

**Installation (mit Obsidian Sync inkl. Plugin-Sync):**

1. Auf dem Desktop den Ordner `picker-changelog` (mit `manifest.json` und `main.js`) nach `<Vault>/.obsidian/plugins/` kopieren.
2. Warten, bis Obsidian Sync ihn aufs Handy übertragen hat.
3. Auf dem Handy: **Einstellungen → Community-Plugins** → ggf. den eingeschränkten Modus ausschalten → „Picker Changelog“ aktivieren.
4. Kontrolle: Im Tab **Settings** der PWA erscheint unter „Plugin-Log“ ein Eintrag „Obsidian gestartet“.

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

GitHub Pages veröffentlicht direkt aus dem Branch `ccr-24a76550-4wcodz`, Ordner `/ (root)` (**Settings → Pages → Source: Deploy from a branch**), erreichbar unter der eigenen Domain aus `CNAME` (oma.app). Jeder Push auf diesen Branch geht automatisch live. `.nojekyll` sorgt dafür, dass die Dateien unverändert ausgeliefert werden. Bei Änderungen an der App-Shell die `CACHE`-Version in `service-worker.js` erhöhen.
