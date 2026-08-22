# Elyon Amazon Standalone Importer v1.1.9

Eigenständige Chrome-Erweiterung für Amazon-Produktrecherche, automatische Listing-Vorbereitung und optionalen eBay-Workflow. Dieses Projekt ist **der Amazon Standalone Importer** – keine Nova-Oberfläche und kein Seller-Tool-Frontend.

## v1.1.9 – Automatischer Listing Designer

Nach einem Amazon-Import kann der Listing Designer automatisch durchlaufen:

1. Amazon-Fakten, Varianten, Breadcrumbs und technische Angaben strukturieren.
2. Einen eBay-Arbeitsentwurf für Titel und Beschreibung erzeugen.
3. Über die bestehende Standalone-Taxonomy-Schnittstelle automatisch passende `EBAY_DE`-Kategorien suchen.
4. Den ersten eBay-Vorschlag als **automatischen Vorschlag** einsetzen und die Kategorie-Metadaten laden.
5. Erkannte Produktfakten auf passende eBay-Artikelmerkmale abbilden und fehlende Pflichtmerkmale sichtbar lassen.
6. Eine Readiness-Liste anzeigen, bis Zustand, Verkaufspreis, geprüfte Bilder, Inhalts-/Rechteprüfung und eBay-Setup vollständig sind.

Der automatische Lauf **erstellt keinen eBay-Entwurf und veröffentlicht nichts**. Draft und Publish bleiben getrennte bewusste Aktionen.

### Zusätzliche Designer-Felder

Der Standalone Importer übernimmt – soweit auf der Amazon-Seite tatsächlich erkannt – unter anderem:

- Marke
- Abteilung
- Stil
- Material
- Modell / MPN
- Farbe / Größe / Varianten
- Produkttyp / Amazon-Breadcrumbs
- Herstellername
- technische Produktangaben

Herstelleranschrift oder EU-Verantwortlicher werden **nicht geraten**. Dafür gibt es eigene manuelle GPSR-Felder. Diese Daten werden bei eBay-Aktionen in den bestehenden Seller-Backend-Payload übernommen.

## Automatik einstellen

Unter **Einstellungen → Listing Designer** ist der automatische Lauf standardmäßig aktiviert. Er kann deaktiviert werden. Zusätzlich kann der Designer jederzeit über **Designer erneut** manuell neu ausgeführt werden.

## eBay

- Kategoriesuche und Pflichtmerkmal-Prüfung laufen vollständig unabhängig von einer geöffneten Seller-Tool-Seite.
- eBay-Entwürfe laufen weiterhin über die angemeldete Seller-Tool-Browsersitzung, damit erfolgreiche Drafts im Elyon-Draft-Register landen.
- Optional kann unter **Einstellungen → eBay** die Sofort-Veröffentlichung bewusst aktiviert werden. Vor jedem Livegang folgt eine ausdrückliche Bestätigung.
- Veröffentlichte Angebote werden über den normalen eBay-Abgleich des Seller Tools als **Aktive Listings** sichtbar.
- Versand-, Zahlungs-, Rücknahmerichtlinie und eBay-Inventory-Standort sind in den Einstellungen auswählbar.
- Amazon-Bilder werden nicht automatisch an eBay übertragen. Nur manuell eingetragene/geprüfte HTTPS-Bild-URLs werden gesendet.
- Amazon-Inhalte bleiben Quelldaten. Die automatisch erzeugten Listing-Texte sind Arbeitsentwürfe und müssen vor Nutzung geprüft werden.

## Sicherheit

- Keine automatische Veröffentlichung.
- Kein Publish ohne aktivierte Sofort-Veröffentlichung und zusätzliche Bestätigung.
- Kein eBay-Token, Seller-Tool-Zugriffstoken, DeepSeek-Key oder Company-OS-Sync-Code in der Extension.
- Kategorie-/Taxonomy-Schritte sind read-only.
- Bilder, Rechte, Artikelzustand, Verkaufspreis und Versandmodell bleiben bewusst manuelle Freigabepunkte.
- Der eBay-Server prüft beim Draft/Publish zusätzlich Kategorie-, Listing- und regulatorische Anforderungen.

## Lokale Installation über Git

Empfohlen ist ein lokaler Clone dieses Repositories. Dadurch sind für Updates keine neuen ZIP-Ordner nötig.

```bash
git clone https://github.com/Heavensolder94/Amazon-Standalone-Importer-Extansion.git
cd Amazon-Standalone-Importer-Extansion
```

Danach in Chrome:

1. `chrome://extensions` öffnen.
2. Entwicklermodus aktivieren.
3. **Entpackte Erweiterung laden** wählen.
4. Den geklonten Repository-Ordner auswählen.

Für spätere Updates genügt im Repository:

```bash
git pull
```

Anschließend in `chrome://extensions` bei der Erweiterung **Neu laden** drücken.

Alternativ kann eine veröffentlichte Release-ZIP heruntergeladen und entpackt werden.

## Entwicklung und CI

Neue Funktionen sollen auf einem eigenen Branch entwickelt und über einen Pull Request nach `main` übernommen werden.

Die GitHub Action **Extension CI** prüft bei Pull Requests und Änderungen auf `main` automatisch:

- notwendige Extension-Dateien,
- gültiges Manifest V3,
- Versionsformat,
- JavaScript-Syntax,
- statische DOM-ID-Referenzen,
- bekannte Secret-Muster in den ausgelieferten Extension-Dateien.

Die gleiche Validierung kann lokal ausgeführt werden:

```bash
node scripts/validate-extension.mjs
```

## Releases

Ein Tag im Format `vX.Y.Z` löst automatisch den Release-Workflow aus. Die Tag-Version muss exakt der Version aus `manifest.json` entsprechen.

Beispiel:

```bash
git tag v1.2.0
git push origin v1.2.0
```

Danach validiert GitHub die Extension, erzeugt automatisch eine ZIP-Datei und veröffentlicht sie als GitHub Release. Ein fehlgeschlagener Validierungsschritt verhindert das Release.
