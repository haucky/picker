# Vault Picker

Minimale PWA, um auf dem Android-Handy einen lokalen Obsidian-Vault schnell zu durchsuchen (Dateiname **und** Inhalt), Notizen zu bearbeiten, TILs mit `#diary/…`-Tags einzusortieren und Notizen per Spaced Repetition zu wiederholen. Reines HTML/CSS/JS, kein Build-Schritt. Die Dateien bleiben auf dem Gerät – nichts wird hochgeladen.

**App:** https://oma.app/

## Installation auf dem Handy

1. Die URL oben in **Chrome** auf Android öffnen.
2. Menü **⋮** → **Zum Startbildschirm hinzufügen** (bzw. **App installieren**) → **Installieren**.
3. Die App vom Startbildschirm starten. Sie läuft danach im eigenen Fenster und startet auch offline.

## Benutzung

- **Vault öffnen** tippen und im Ordner-Dialog **nur den Vault-Ordner** auswählen (den Ordner, der `.obsidian/` enthält) – nicht „Interner Speicher“, „Documents“ o. Ä. Die App bekommt Lese- *und Schreib*zugriff auf genau diesen Ordner samt Unterordnern; gib ihr nicht mehr als nötig.
Unten wechselst du zwischen den Modulen **Home** (mit der Suche), **Study**, **Review**, **Diary** (darin **Schreiben**, **Taggen** und **Streams**) und **Settings**. Beim Öffnen der App startet sie immer auf **Home**.

### Suche (auf Home)

- Das Suchfeld steht oben auf **Home**; solange etwas drinsteht, zeigt Home nur die Treffer (Escape oder ✕ leert es). Ganz unten auf Home stehen der Stand des Abgleichs, ggf. „Zugriff erlauben“ und **Vault wechseln**.
- Getippter Text wird mit Dateinamen und Inhalt aller Notizen abgeglichen (Teilstring, ohne Groß-/Kleinschreibung; mehrere Wörter müssen alle vorkommen). Treffer im Namen stehen oben, darunter ein Textausschnitt mit markierter Fundstelle. Enter öffnet den ersten Treffer.
- Treffer antippen → Notiz bearbeiten → **Speichern** schreibt die Datei direkt zurück. Die Android-Zurück-Geste führt zurück zu Home (mit Warnung bei ungespeicherten Änderungen).
- `.obsidian/`, `.trash/` und `.git/` werden ignoriert.

### Diary → Schreiben

Neue Diary-Einträge im selben Editor wie eine VL (Study), auch mehrere auf einmal:

```
Wie war der Tag?
- gut

Was habe ich gelernt? #review/monthly
- SQL

14.10.2026

Wie war die Vorlesung?
- lang
```

- Jede Frage wird beim **Speichern** eine eigene Notiz im obersten Ordner mit `#life/diary #date/…` von heute. Eine Zeile `TT.MM.JJJJ` (allein, nicht eingerückt) gilt für alle Fragen darunter: Sie bekommen dieses Datum. Text zwischen Datumszeile und nächster Frage ist ein Fehler. Weitere Tags hinter die Frage.
- **Wiederholen:** Chips „nein · täglich · wöchentlich · monatlich · alle 2/3 Monate · jährlich“ (gemerkt) setzen ein festes Intervall für alle neuen Einträge; eine Frage mit eigenem `#review/…` dahinter behält ihres. Einträge mit Intervall bekommen gleich `#reviewed/` mit ihrem Datum (sonst wären sie sofort fällig).
- **Frage gibt es schon:** wie im VL-Editor („!“ hinter der Frage, vorhandener Eintrag im Nebenfenster, Link einfügen; [[Links]] öffnen ebenfalls das Nebenfenster). Statt Zusammenführen gibt es **↪ Als Antwort anhängen:** beim Speichern wird dein Text als `::TT.MM.JJJJ::`-Antwort (Datum des Eintrags) an den vorhandenen Eintrag gehängt, und in dessen Frontmatter steht `asked-again: [JJJJ-MM-TT, …]` – so ist festgehalten, dass du dir die Frage von dir aus noch einmal gestellt hast (anders als eine Antwort über „Heute sehe ich das so …“). Ausgewertet wird das noch nicht.
- Sonst wird hier nur angelegt (kein Review-Status, nichts wird geändert oder gelöscht). Danach ist der Editor leer; was nicht angelegt werden konnte (z. B. Name gibt es schon), bleibt stehen. Der Text bleibt als Entwurf erhalten, auch wenn die App geschlossen wird.

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

  **Todos:** `!!! Text bis Zeilenende` (am Zeilenanfang, nach einem Listenzeichen oder nach einem Leerzeichen; „Wichtig!!!“ zählt nicht). Erledigt = Zeile löschen. Die Zahl der Ausrufezeichen ist die Priorität: `!!!` normal (orange), `!!!!` wichtig (magenta), `!!!!!` unbedingt schnell (rot, fett). In den Todo-Listen stehen die wichtigsten oben; alle ab „wichtig“ erscheinen zusätzlich auf **Home**.

  **Datumszeile:** Eine Zeile `TT.MM.JJJJ` (allein, nicht eingerückt, violett) beendet die Frage davor; alle Fragen darunter bekommen beim Speichern dieses `#date/…` und gehören danach zu der VL dieses Tages (der Editor lädt die VL danach neu und meldet, wie viele Fragen weggezogen sind). So lassen sich z. B. Fragen nachtragen oder falsch einsortierte verschieben.

  **Frage gibt es schon:** Sobald du die Zeile einer Frage verlässt, wird geprüft, ob es im Vault schon eine Notiz mit diesem Namen gibt (Groß-/Kleinschreibung egal; die Fragen dieser VL selbst zählen nicht). Dann ist die Frage orange unterkringelt und dahinter steht ein **!**. Antippen öffnet die vorhandene Frage im **Nebenfenster** (kein Overlay, der Editor bleibt bedienbar; am Computer rechts am Rand, auf dem Handy unten): oben Ordner und Datum, darunter Frage, Tag-Zeile (z. B. `#uni/dbs #date/2026/10/14`, daran sieht man die VL) und Inhalt – alles direkt bearbeitbar, mit Tag-Vorschlägen. **Speichern** speichert sofort nur diese Notiz (umbenennen nimmt Lernstand und Tags mit), **In den Papierkorb** löscht sie. Ist der Name danach frei, verschwindet das „!“. Die Optionen stehen am Computer als Menü neben dem „!“, auf dem Handy als Knöpfe oben im Fenster:
  - **↪ Zusammenführen:** beim Speichern wird dein Inhalt an die vorhandene Frage angehängt (vor ihren eigenen Antworten, ihre Tags bekommen deine zusätzlichen Tags); sie bleibt in ihrer VL und behält ihren Lernstand. Die Frage verschwindet dann aus dieser VL.
  - **⇢ Zusammenführen und hierher holen:** genauso, und die vorhandene Frage zieht in diese VL um (Datum und Stapel-Tag dieser VL).
  - **🔗 Link einfügen:** setzt `[[Vorhandene Frage]]` als eigene Zeile ans Ende deiner Frage. Der Namenskonflikt bleibt – deine Frage anders formulieren (einfach im Editor) oder zusammenführen.

  Zusammenführen wird erst mit **Speichern** ausgeführt; bis dahin zeigt das Badge die Entscheidung (grünes ↪ bzw. ⇢), sie lässt sich ändern oder aufheben. Fragen mit „!“ ohne Entscheidung verhindern das Speichern. **[[Links]]** im VL-Editor (und im Nebenfenster) öffnen die verlinkte Notiz ebenfalls im Nebenfenster.

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

### Home

Startbildschirm, beim Öffnen der App immer zuerst. Oben die Suche (siehe oben), darunter:

- **Wichtige Todos:** alle Todos mit `!!!!` (wichtig) und `!!!!!` (unbedingt schnell) aus dem ganzen Vault, die dringendsten oben, darunter die älteste Notiz zuerst. Darunter steht, wo das Todo steht (Stapel · Datum · Frage). Antippen öffnet die VL im Study-Editor an der Stelle des Todos; gehört die Notiz zu keinem Stapel, öffnet sie sich im normalen Editor. Normale Todos (`!!!`) stehen weiter nur im Study-Tab.
- **Angepinnt:** alle Notizen mit `#pinned` (oder einem Untertag davon). Zusätzliche Tags legen fest, wie sie erscheinen:
  - nur `#pinned`: Titel, antippen klappt Inhalt und eigene Antworten auf (bleibt beim Neuzeichnen offen), darin **✏️ Bearbeiten**.
  - `#pinned/recent-answer`: Titel (antippen öffnet die Notiz) und nur die neueste eigene Antwort (`::TT.MM.JJJJ::`-Block).
  - mit festem Intervall (`#pinned` + `#review/weekly` usw.): erscheint nur, wenn die Karte fällig ist (dann ganz oben, blau umrandet), mit einem Antwortfeld. **Bestätigen** hängt `::TT.MM.JJJJ::` + Antwort an und setzt `#reviewed/…` auf heute – wie „✅ Erledigt“ im Review, das Intervall bleibt; danach verschwindet die Karte bis zum nächsten Termin. Ohne Antwort fragt die App nach, ob nur erledigt werden soll. Mit `#pinned/recent-answer` steht die neueste Antwort über dem Feld. Im Review-Tab erscheinen diese Karten weiterhin.
  - `#pinned/always` (nur mit festem Intervall wirksam): die Karte bleibt auch an den übrigen Tagen sichtbar, dann ohne Antwortfeld mit „📅 wöchentlich · wieder am TT.MM.JJJJ“ – mit `#pinned/recent-answer` samt neuester Antwort, sonst wie ein normales `#pinned`. Beispiel: `#review/weekly #pinned/recent-answer #pinned/always`. Jeder Untertag von `#pinned` zählt schon als angepinnt, ein zusätzliches `#pinned` braucht es nicht.

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

**Feste Intervalle** wie bisher in Obsidian: `#review/daily`, `#review/weekly`, `#review/monthly`, `#review/yearly` oder frei als Zahl + Einheit, z. B. `#review/3d`, `#review/2w`, `#review/3m`, `#review/2y` (d = Tage, w = Wochen, m = Monate, y = Jahre), dazu `#reviewed/JJJJ/MM/TT`. Fällig, wenn seit dem letzten Review das Intervall vergangen ist; Monate und Jahre zählen nach dem Kalender (15.01. + 3 Monate = 15.04.). Notizen mit festem Intervall werden nie zusätzlich per Spaced Repetition abgefragt. Fehlt `#reviewed/…`, gilt die Notiz als heute fällig; „Startdatum verteilen“ setzt (nach Rückfrage) ein zufälliges Datum innerhalb des Intervalls.

- **Erledigt mit Auswahl:** Unter „✅ Erledigt – wieder:“ stehen täglich, wöchentlich, 1/2/3 Monate und jährlich (jeweils mit dem nächsten Datum); das bisherige Intervall ist hervorgehoben (ist es ein anderes, z. B. 2 Wochen, steht es zusätzlich vorne). Antippen setzt `#reviewed/…` auf heute und den `#review/…`-Tag auf das gewählte Intervall (für 1 Tag/Woche/Monat/Jahr als `daily`/`weekly`/`monthly`/`yearly`, sonst z. B. `3m`).
- **Intervall ändern, ohne zu erledigen:** Auf der Karte das Intervall (📅 monatlich ✎) antippen: Chips für 1 T, 1/2 W, 1/2/3/6 M, 1/2 J oder frei „alle N Tage/Wochen/Monate/Jahre“. Ersetzt sofort den `#review/…`-Tag; beides ist rückgängig machbar. Im Editor kann man den Tag natürlich auch direkt ändern.

**Ablauf:** Übersicht mit „Alle“, je einem Eintrag pro Stapel und „Feste Intervalle“ (fällig / neu). Pro Karte:

- Titel antippen öffnet die Notiz, **Antwort zeigen** deckt die Rückseite auf. Eigene Antworten (`::TT.MM.JJJJ::`-Blöcke) stehen eingeklappt darunter.
- **✍️ Antwort notieren** hängt `::TT.MM.JJJJ::` + `- Antwort` ans Dateiende (wie „New Answer“ im Obsidian-Snippet).
- **Schwer / Gut / Leicht** zeigen den nächsten Abstand und schreiben sofort in die Datei. **↶ Rückgängig** stellt die letzte Bewertung wieder her (nur, wenn die Datei seitdem nicht geändert wurde). **↷ Überspringen** lässt die Karte unverändert. **⊘ Aussortieren** setzt den Review-Status auf *nicht abfragen* (z. B. für Orga-Fragen; rückgängig machbar, im Study-Editor wieder änderbar).
- Fällige Karten kommen zuerst (am längsten überfällige oben), danach neue: älteste VL (`#date/…`) zuerst, innerhalb einer VL in der Reihenfolge aus dem Study-Editor (`study-order`).
- Tastatur am Laptop: Leertaste/Enter = Antwort zeigen, 1/2/3 = Schwer/Gut/Leicht, Enter = Erledigt (bisheriges Intervall), 1–7 = Erledigt mit Intervall aus der Auswahl, u = Rückgängig.

### Editor

Notiz-Editor (Suche → Notiz) und VL-Editor (Study) sind derselbe Markdown-Editor ([CodeMirror 6](https://codemirror.net/)) mit Live-Vorschau wie in Obsidian: Markdown wird gerendert, nur wo der Cursor steht, erscheint der Quelltext (fett/kursiv/Code/Links pro Element, Überschriften, Listen und Zitate pro Zeile). Gerendert werden Überschriften, **fett**, *kursiv*, ~~durchgestrichen~~, `Code`, Codeblöcke, Listen (•), Checkboxen (antippen schaltet um), Zitate, Trennlinien, `[[Links]]` (antippen öffnet die Notiz), Bilder (`![[bild.png]]`, `![](pfad)`) und `#Tags`. Tabellen und Formeln bleiben Text, die Frontmatter wird gedämpft angezeigt. Enter in einer Liste setzt sie fort (leerer Punkt beendet sie), Tab/Shift-Tab rückt ein/aus. Strg/Cmd+B macht fett, Strg/Cmd+I kursiv (um die Auswahl bzw. das Wort am Cursor; nochmal drücken entfernt es wieder).

**Tag-Vorschläge:** Beim Tippen von `#` und mindestens einem Zeichen erscheinen bis zu 6 passende Tags aus dem Vault – erst solche, die mit dem Getippten anfangen, dann solche, bei denen ein Teil nach `/` passt (`#dbs` → `#uni/dbs`), jeweils häufigste zuerst. ↑/↓ wählen, Enter oder Tab übernehmen (mit Leerzeichen dahinter), Escape schließt; auf dem Handy antippen. `#date/…` und `#reviewed/…` erscheinen nur, wenn man sie ausdrücklich tippt. Die Liste wird aus den aktuellen Notizen berechnet: Ein neuer Tag taucht auf, sobald eine Notiz damit gespeichert ist; Tags, die in keiner Notiz mehr stehen, verschwinden von selbst. Neue Tags einfach weitertippen. Gilt im Notiz- und im VL-Editor (auch hinter einer Frage), auf Handy und Computer.

**Bilder einfügen:** Ein Bild aus der Zwischenablage (Screenshot, kopiertes Bild) oder per Ziehen landet als `images/Pasted image JJJJMMTTHHMMSS.png` im Vault (Ordner wird angelegt), an der Cursor-Stelle wird `![[Pasted image ….png|small]]` in die Zeile eingefügt (mehrere eingefügte Bilder ergeben eine Reihe; für ein Bild allein vorher Enter) – bzw. ein Markdown-Link, wenn in Obsidian „Wikilinks verwenden“ aus ist. Das Bild wird sofort gespeichert, auch wenn die Notiz danach nicht gespeichert wird.

**Bildgröße** hinter `|` wie in Obsidian: `![[bild.png|100]]` (Breite in px), `![[bild.png|100x145]]`, `![Alt|100](pfad)` – zusätzlich `small`, `normal` (Standard, höchstens 480×320 px) und `big` (volle Breite). Bilder stehen im Text (inline): mehrere `![[…|small]]` in einer Zeile ergeben eine Reihe kleiner Vorschaubilder, z. B. Folien-Ausschnitte. Ein Bild antippen öffnet es groß als Overlay (nochmal antippen = Originalgröße zum Scrollen; Hintergrund, ×, Esc oder Zurück schließt). Stehen mehrere Bilder in derselben Zeile, blättert man dort mit den Pfeilen ‹ ›, den Pfeiltasten ←/→ oder durch Wischen (ohne Umlauf, Anzeige „2 / 3“). Gilt im Editor und auf der Review-Rückseite. Obsidian zeigt `small`/`normal`/`big` einfach in Standardgröße.

**Korrekturvorschläge (nur am Computer):** Steht der Cursor in einem Wort, das weder in den Wortlisten (Deutsch, Englisch, je ~50.000 häufigste Wörter) noch mindestens zweimal im eigenen Vault vorkommt, erscheinen darunter bis zu 4 Vorschläge – kleinster Tippabstand zuerst, dann das häufigste Wort. Klick oder Alt+1…4 ersetzt das Wort. Fachbegriffe, die man öfter in Notizen verwendet, gelten damit automatisch als bekannt. Die rote Unterkringelung kommt weiter vom Browser.

**KI-Korrektur (nur am Computer):** Doppelklick auf ein Wort öffnet ein kleines Menü: oben sofort die Vorschläge aus dem Wörterbuch (wenn das Wort unbekannt ist), darunter bis zu 5 Vorschläge eines Sprachmodells, sobald sie da sind (Duplikate fallen weg). Klick oder Alt+1…9 ersetzt das Wort; Escape, Klick daneben oder Weitertippen schließt das Menü. An das Modell geht nur der Satz um das Wort. Dafür unter **Settings → KI** ein lokales Modell oder Tinfoil einrichten (siehe „KI: lokal oder Tinfoil“). Ohne KI gibt es nur die Wörterbuch-Vorschläge; antwortet das Modell nicht innerhalb von 5 Sekunden, steht „KI-Vorschläge nicht verfügbar“ im Menü. Gleiche Anfragen (Wort + Satz) werden bis zum Neuladen gemerkt.

**KI-Prompts auf markierten Text (nur am Computer):** Text markieren – darunter erscheint ein Eingabefeld (es nimmt den Fokus nicht weg, Weitertippen ersetzt wie gewohnt die Markierung; **Strg/Cmd+K** springt hinein). Dort einen eigenen Prompt tippen oder eine Abkürzung wie `summary` oder `explain` (Vorschläge darunter antippen, Tab ergänzt; hinter der Abkürzung sind weitere Anweisungen möglich, z. B. `summary auf Englisch`). Enter schickt Prompt + markierten Text ans Modell, die Antwort erscheint nach und nach in einem kleinen Dialog: **Einfügen** setzt sie in eine neue Zeile unter den Cursor und schließt, **Schließen**/Escape schließt ohne Einfügen, **Kopieren** kopiert sie.

Die Abkürzungen stehen in `Prompts.md` im obersten Ordner des Vaults (ohne die Datei gibt es nur eigene Prompts). Jede `##`-Überschrift ist eine Abkürzung, der Text darunter der Prompt; `{{text}}` steht für den markierten Text (fehlt es, kommt der Text ans Ende):

```markdown
## summary
Fasse den Text in höchstens 5 Stichpunkten zusammen.

## eli5
Erkläre {{text}} so, dass es ein Kind versteht.
```

### KI: lokal oder Tinfoil

Alle KI-Funktionen (Korrektur, Prompts, KI-Aktionen an einer Frage, ähnliche Fragen) laufen über `features/llm.js` (`chat()` mit Streaming). **Standard ist ein lokales Modell** über [Ollama](https://ollama.com) am eigenen Computer – nichts verlässt das Gerät. **Tinfoil** ([tinfoil.sh](https://tinfoil.sh), verschlüsselt, die Enclave wird vor jeder Sitzung geprüft) ist Option B, z. B. am Handy: Es wird nur genutzt, wenn es unter **Settings → KI** eingeschaltet ist (auch mit eingetragenem Key) und lokal aus oder nicht erreichbar ist. Ohne beides gibt es keine KI-Funktionen, alles andere funktioniert normal. Der lokale Server wird erst angesprochen, wenn er eingeschaltet ist – wer kein Ollama hat, bekommt also auch keine Rückfrage von Chrome.

Zwei Stufen, je Anbieter in Settings änderbar (leer = Standard):

| Stufe | wofür | lokal (Standard) | Tinfoil (Standard) |
|---|---|---|---|
| Schnell | Korrektur, Fragen vergleichen | `qwen3.5:4b` (~3,5 GB) | `gemma4-31b` |
| Gut | Prompts, KI-Aktionen | `qwen3.5:9b` (~7 GB) | `deepseek-v4-1-flash` |

Lokal läuft immer ohne „Thinking“ (schneller, für kurze Antworten reicht es). Qwen 3.5 ist mehrsprachig und schreibt gutes Deutsch; beide laufen auf einem M3 (16 GB). Mit 8 GB RAM für beide Stufen `qwen3.5:4b` nehmen. Alternativen zum Ausprobieren: `gemma4:e4b` (schnell), `gemma4:12b` (gut).

**KI lokal einrichten (Mac, einmalig):**

1. Ollama installieren: App von [ollama.com/download](https://ollama.com/download) oder `brew install ollama`.
2. Modelle laden (Terminal): `ollama pull qwen3.5:4b`, `ollama pull qwen3.5:9b` und für ähnliche Fragen `ollama pull qwen3-embedding:0.6b`. Jeweils warten, bis `success` dasteht.
3. Ollama erlauben, Anfragen von der App anzunehmen (sonst blockt der Browser):
   - mit der Ollama-App: `launchctl setenv OLLAMA_ORIGINS "https://oma.app"`, dann die Ollama-App beenden und neu starten (gilt bis zum Neustart des Macs; danach wiederholen oder in ein Login-Skript schreiben);
   - ohne App: Ollama-App beenden und `OLLAMA_ORIGINS="https://oma.app" ollama serve` im Terminal laufen lassen.
4. In der App **Settings → KI → Lokal → Testen**: prüft Server und Modelle (fehlt eins, steht der `ollama pull`-Befehl da) und schaltet „Lokales Modell verwenden“ ein. Chrome fragt beim ersten Mal, ob die Seite auf Geräte im lokalen Netzwerk zugreifen darf → **Zulassen** (zurücksetzen über das Schloss-Symbol neben der Adresse → Website-Einstellungen).

**Wenig Arbeitsspeicher (8–16 GB):** Ollama hält benutzte Modelle ein paar Minuten im Speicher; mehrere gleichzeitig (Embedding, Schnell, Gut) können einen Laptop ausbremsen. Die App hält lokal das Kontextfenster klein und nimmt vor „Mit Sprachmodell prüfen“ die anderen Modelle aus dem Speicher. Reicht das nicht: in Settings für beide Stufen `qwen3.5:4b` eintragen und/oder Ollama nur ein Modell gleichzeitig laden lassen – `launchctl setenv OLLAMA_MAX_LOADED_MODELS 1`, dann Ollama neu starten.

Tinfoil: SDK `vendor/tinfoil.js` (wird erst bei der ersten Tinfoil-Anfrage geladen) prüft die Attestierung und verschlüsselt Ende-zu-Ende. SDK aktualisieren: Version in `vendor/tinfoil/package.json`, dann `vendor/tinfoil/build.sh`.

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
- **KI:** lokal (Ollama: an/aus, Server, Modelle Schnell/Gut, **Testen**) und Tinfoil (an/aus, Key, Modelle, **Testen**), gefundene Abkürzungen aus `Prompts.md` – siehe „KI: lokal oder Tinfoil“.
- **Ähnliche Fragen:** siehe unten.
- **Darstellung** (Automatisch / Hell / Dunkel).
- **Abgleich:** wann und wie zuletzt abgeglichen wurde, mit **Jetzt abgleichen** und **Komplett abgleichen**.
- Darunter die letzten Einträge des Plugin-Logs (zur Kontrolle, ob das Plugin läuft).

### Ähnliche Fragen

Findet Fragen, die dasselbe meinen, aber anders heißen (z. B. „Was ist ein Equi-Join?“ ↔ „Wozu ein Join mit Gleichheitsbedingung?“). Zwei Stufen, beide lokal (siehe „KI lokal einrichten“, Modell `qwen3-embedding:0.6b`):

1. **Embeddings:** Jede Frage (nur der Dateiname, nicht der Inhalt) bekommt einen Vektor. Die Vektoren stehen in `.picker/embeddings.json` im Vault (int8, 1024 Werte, bei 5.000 Fragen ≈ 7 MB; synct mit). Beim nächsten Mal werden nur neue und umbenannte Fragen berechnet; bei einem anderen Modell alle neu. Das findet Kandidaten – aber auch Fragen, die nur dasselbe Thema oder dieselbe Person betreffen.
2. **Sprachmodell (Stufe „schnell“):** entscheidet pro Kandidat, ob beide Fragen wirklich dasselbe fragen.

**Settings → Ähnliche Fragen → Berechnen & vergleichen** berechnet die Vektoren und zeigt die ähnlichsten Paare (Schwelle wählbar, Fragen antippen öffnet sie). **Mit Sprachmodell prüfen** teilt sie in „Dieselbe Frage“ und „Nur verwandt“ (ein Paar nach dem anderen; nochmal tippen bricht ab, geprüfte Paare bleiben in `.picker/embeddings.json` gespeichert und werden beim nächsten Mal übersprungen). Größeres Embedding-Modell: `ollama pull qwen3-embedding:4b` und Namen dort eintragen.

**Im Editor** (VL-Editor, Diary → Schreiben; mit eingeschaltetem lokalem Server und einmal berechneten Vektoren): Beim Verlassen der Zeile einer neuen Frage werden die 3 ähnlichsten vorhandenen Fragen (ab 0,75) dem Sprachmodell vorgelegt. Sagt es „dieselbe Frage“, steht ein violettes **≈** dahinter. Antippen öffnet die vorhandene Frage im Nebenfenster mit denselben Optionen wie beim „!“ (Zusammenführen bzw. als Antwort anhängen – in die ähnliche Frage, Link einfügen) und **✕ Keine Dublette**. Anders als das „!“ blockiert das „≈“ das Speichern nicht. Fragen, die nach dem letzten Berechnen dazukamen, werden erst nach dem nächsten **Berechnen & vergleichen** gefunden.

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
- `features/similar.js` – ähnliche Fragen: Embeddings über Ollama, `.picker/embeddings.json`, Paare finden (Oberfläche in Settings).
- `features/conflicts.js` – Fragen, die es schon gibt: Erkennen, Optionen, Link einfügen; `features/peek.js` – Nebenfenster zum Bearbeiten einer vorhandenen Notiz (Frage, Tags, Inhalt).
- `features/qeditor.js` – gemeinsamer Fragen-Editor (Markierungen, Fehler/Hinweise) für den VL-Editor (Study) und Diary → Schreiben; die Logik dazu (Fragen, Datumszeilen, Speichern planen) in `features/studydoc.js`.
- `features/home.js` – Startbildschirm (Suche aus `features/search.js`, wichtige Todos); weitere Bereiche als eigene Abschnitte dort.
- `obsidian-plugin/picker-changelog/` – Obsidian-Plugin, das Änderungen protokolliert (wird nicht von der PWA geladen).
- `features/*.js` – Feature-Module `{ id, title, mount(root, ui), show() }`, in `app.js` unter `FEATURES` registriert. Module greifen nur über den Core auf Dateien zu.

## Deployment

GitHub Pages veröffentlicht direkt aus dem Branch `ccr-24a76550-4wcodz`, Ordner `/ (root)` (**Settings → Pages → Source: Deploy from a branch**), erreichbar unter der eigenen Domain aus `CNAME` (oma.app). Jeder Push auf diesen Branch geht automatisch live. `.nojekyll` sorgt dafür, dass die Dateien unverändert ausgeliefert werden. Bei Änderungen an der App-Shell die `CACHE`-Version in `service-worker.js` erhöhen.
