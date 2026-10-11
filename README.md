# Vault Picker

Minimale PWA, um auf dem Android-Handy einen lokalen Obsidian-Vault zu öffnen, Notizen zu durchsuchen und zu bearbeiten. Reines HTML/CSS/JS, kein Build-Schritt. Die Dateien bleiben auf dem Gerät – nichts wird hochgeladen.

**App:** https://haucky.github.io/picker/

## Installation auf dem Handy

1. Die URL oben in **Chrome** auf Android öffnen.
2. Menü **⋮** → **Zum Startbildschirm hinzufügen** (bzw. **App installieren**) → **Installieren**.
3. Die App vom Startbildschirm starten. Sie läuft danach im eigenen Fenster und startet auch offline.

## Benutzung

- **Vault öffnen** tippen und im Ordner-Dialog **nur den Vault-Ordner** auswählen (den Ordner, der `.obsidian/` enthält) – nicht „Interner Speicher“, „Documents“ o. Ä. Die App bekommt Lese- *und Schreib*zugriff auf genau diesen Ordner samt Unterordnern; gib ihr nicht mehr als nötig.
- Der Ordner wird gemerkt. Nach einem Neustart fragt Chrome evtl. erneut nach der Berechtigung → **Zugriff erneut erlauben** tippen.
- Notiz antippen → bearbeiten → **Speichern** schreibt die Datei direkt zurück. Die Android-Zurück-Geste führt zurück zur Liste (mit Warnung bei ungespeicherten Änderungen).
- Die Suche filtert nach Dateinamen. `.obsidian/`, `.trash/` und `.git/` werden ausgeblendet.

## Unterstützte Browser

Benötigt die File System Access API (`showDirectoryPicker`):

| Browser | Status |
|---|---|
| Chrome / Edge / Brave auf **Android** | ✅ |
| Chrome / Edge auf Windows, macOS, Linux | ✅ |
| **Firefox** (alle Plattformen) | ❌ |
| **Safari** und alle Browser auf **iOS/iPadOS** | ❌ |

In nicht unterstützten Browsern zeigt die App einen entsprechenden Hinweis.

## Deployment

`.github/workflows/pages.yml` deployt bei jedem Push auf `main` die Repo-Root nach GitHub Pages (Voraussetzung: **Settings → Pages → Source: GitHub Actions**). Bei Änderungen an der App-Shell die `CACHE`-Version in `service-worker.js` erhöhen.
