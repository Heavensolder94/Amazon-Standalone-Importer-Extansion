# Elyon Amazon Standalone Importer v1.2.2

Eigenständige Chrome-Erweiterung für Amazon-Produktrecherche, automatische Listing-Vorbereitung und optionalen eBay-Workflow. Dieses Projekt ist **der Amazon Standalone Importer** – keine Nova-Oberfläche und kein Seller-Tool-Frontend.

## v1.2.2 – Preis- und Draft-Readiness

Der Importer liest den aktuellen Amazon-Preis jetzt robuster aus mehreren aktuellen Amazon-Layouts, strukturierten Meta-Daten und JSON-LD. Der erkannte Wert wird als **Einkaufspreis** übernommen.

Zusätzlich:

- Amazon-Bild-URLs werden als HTTPS-URLs zur bewussten Prüfung vorausgefüllt.
- Nur echte Amazon-Produktdetailseiten mit ASIN werden importiert.
- eBay-Kategorien werden vor der automatischen Übernahme auf Relevanz geprüft.
- Bei eindeutig normaler Neuware wird der eBay-Zustand `NEW` vorausgewählt; bei Gebraucht-/Renewed-Hinweisen bleibt er offen.
- Aus dem Einkaufspreis wird ein editierbarer Elyon-Verkaufspreisvorschlag erzeugt. Die bestehende Gebührenannahme von 12 % + 0,35 € wird berücksichtigt; der Vorschlag zielt auf mindestens 20 % Marge oder 5 € Gewinn.
- eBay-Pflichtmerkmale werden zusätzlich gegen erkannte Amazon-Details und Varianten gematcht. Unbekannte Werte werden nicht erfunden.
- Wenn ein Draft blockiert wird, zeigt die Extension jetzt **alle** lokalen und serverseitigen Blocker statt nur einer allgemeinen Meldung.

Der automatische Lauf **veröffentlicht nichts**. Draft und Live-Publish bleiben getrennte Aktionen.

## Automatischer Listing Designer

Nach einem Amazon-Import kann der Listing Designer automatisch durchlaufen:

1. Amazon-Fakten, Varianten, Breadcrumbs und technische Angaben strukturieren.
2. Einen eBay-Arbeitsentwurf für Titel und Beschreibung erzeugen.
3. Über die bestehende Standalone-Taxonomy-Schnittstelle passende `EBAY_DE`-Kategorien suchen.
4. Nur ausreichend passende Kategorien automatisch einsetzen und die Kategorie-Metadaten laden.
5. Erkannte Produktfakten und Amazon-Details auf passende eBay-Artikelmerkmale abbilden.
6. Eine Readiness-Liste anzeigen, bis alle für den Draft nötigen Angaben vollständig sind.

### Zusätzliche Designer-Felder

Der Standalone Importer übernimmt – soweit auf der Amazon-Seite tatsächlich erkannt – unter anderem:

- Einkaufspreis
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

- Kategoriesuche und Pflichtmerkmal-Prüfung laufen unabhängig von einer geöffneten Seller-Tool-Seite.
- eBay-Entwürfe laufen über die angemeldete Seller-Tool-Browsersitzung, damit erfolgreiche Drafts im Elyon-Draft-Register landen.
- Optional kann unter **Einstellungen → eBay** die Sofort-Veröffentlichung bewusst aktiviert werden. Vor jedem Livegang folgt eine ausdrückliche Bestätigung.
- Veröffentlichte Angebote werden über den normalen eBay-Abgleich des Seller Tools als **Aktive Listings** sichtbar.
- Versand-, Zahlungs-, Rücknahmerichtlinie und eBay-Inventory-Standort sind in den Einstellungen auswählbar.
- Amazon-Bild-URLs werden zur Prüfung vorausgefüllt, aber erst nach der bewussten Inhalts-/Rechtebestätigung in einen eBay-Draft übernommen.
- Amazon-Inhalte bleiben Quelldaten. Die automatisch erzeugten Listing-Texte und Preisvorschläge sind Arbeitswerte und müssen vor Nutzung geprüft werden.

## Sicherheit

- Keine automatische Veröffentlichung.
- Kein Publish ohne aktivierte Sofort-Veröffentlichung und zusätzliche Bestätigung.
- Kein eBay-Token, Seller-Tool-Zugriffstoken, DeepSeek-Key oder Company-OS-Sync-Code in der Extension.
- Kategorie-/Taxonomy-Schritte sind read-only.
- Unbekannte Pflichtmerkmale, Herstelleranschriften und GPSR-Daten werden nicht erfunden.
- Inhalts-/Rechteprüfung und Versandmodell bleiben bewusste Freigabepunkte.
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

## Entwicklung und CI

Neue Funktionen sollen auf einem eigenen Branch entwickelt und über einen Pull Request nach `main` übernommen werden.

Die GitHub Action **Extension CI** prüft bei Pull Requests und Änderungen auf `main` automatisch:

- notwendige Extension-Dateien,
- gültiges Manifest V3,
- Versionsformat,
- JavaScript-Syntax,
- statische DOM-ID-Referenzen,
- die Bild-, Kategorie-, Preis- und Draft-Handoff-Verträge,
- bekannte Secret-Muster in den ausgelieferten Extension-Dateien.

Die gleiche Validierung kann lokal ausgeführt werden:

```bash
node scripts/validate-extension.mjs
```

## Releases

Ein Tag im Format `vX.Y.Z` löst automatisch den Release-Workflow aus. Die Tag-Version muss exakt der Version aus `manifest.json` entsprechen.
