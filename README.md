# Elyon Amazon Standalone Importer v1.3.0

Eigenständige Chrome-Erweiterung für Amazon-Produktrecherche, Preisberechnung, Listing-Vorbereitung, sicheren Company-OS-Nova-Import und ausdrücklich freigegebene eBay-Entwürfe.

## v1.3.0 – Company OS + eBay-Draft-Guard + verlässliche Batch-Status

### Company OS: direkter Import in den Nova-Eingang

1. Amazon-Produkt importieren.
2. Den **gleichen Company-OS-Sync-Code wie im Ziel-Arbeitsbereich** in der Erweiterung eingeben.
3. **In Nova-Eingang importieren** wählen. Die Erweiterung sendet den Recherche-Payload per HTTPS an die bestehende Company-OS-Import-API und wertet nur eine bestätigte Antwort mit Status **nova_inbox** als Erfolg.

Der Code wird nur in **chrome.storage.session** für die laufende Browser-Sitzung gehalten (nicht in localStorage, nicht in GitHub oder in Listing-Payloads). Unter **Sitzungscode löschen** lässt er sich sofort entfernen. Nach Neustart von Chrome muss er neu eingegeben werden. Ohne übereinstimmenden Code wird ein anderer Company-OS-Arbeitsbereich angesprochen.

Alternativ gibt es weiterhin **JSON als Alternative kopieren**. Ein bloßes Kopieren wird nicht als erfolgreicher Import gemeldet.

### Sammelmodus: Company-OS-Import bis 20 Produkte

Bis zu 50 Amazon-Treffer können gesammelt, davon bis zu 20 pro Durchlauf mit Listing Designer vorbereitet und anschließend explizit per **Auswahl an Company OS** in den Nova-Eingang importiert werden. Pro Produkt wird die API-Bestätigung separat gespeichert.

Statusanzeigen unterscheiden:
- **Bereit zur Prüfung**: ausschließlich lokal vorbereitet, noch kein vollständiger eBay-Entwurf.
- **Company OS: importiert**: Server hat den Nova-Import bestätigt.
- **eBay: Verarbeitung läuft**: eBay-Feed läuft noch, Entwurf noch nicht bestätigt.
- **eBay: Entwurf bestätigt**: eBay-Status meldet draftVisible=true.
- **Fehler**: Import oder eBay-Feed hat eine explizite Fehlermeldung geliefert.

### eBay: Vorabprüfung beim direkten Seller-Hub-Entwurf

Der direkte eBay-Button blockiert vor dem API-Aufruf bei fehlender Kategorie, Artikelzustand, positivem Preis, Pflichtmerkmalen, geprüften HTTPS-Bildern, Inhalts-/Rechtebestätigung oder fehlenden Versand-, Zahlungs-, Rücknahme- und Inventory-Einstellungen. Änderungen am Listing führen nicht zur Wiederverwendung einer alten Feed-Aufgabe. Nur von eBay bestätigte Entwürfe werden als erstellt dargestellt. **Kein automatischer Live-Publish**: Die Veröffentlichungs-Schaltfläche öffnet die Entwürfe im eBay Seller Hub.

Wichtig: Amazon ist eine **Retail-Recherchequelle**. Übernommene Bilder/Texte benötigen eigene Nutzungsrechte; Zulässigkeit der Beschaffung, GPSR-Angaben, eBay-Dropshipping-Regeln und der tatsächliche Versand müssen eigenständig geprüft werden. Die Erweiterung veröffentlicht nichts automatisch.

### Prüfungen und Installation

CI prüft JavaScript-Syntax, Manifest und DOM-Verkabelung sowie separate Regressionstests für Company-OS-Sitzung, echte Import-Antworten, eBay-Pflichtfeldblocker und korrekte Batch-Status. Das ersetzt keinen manuellen Browser-End-to-End-Test mit tatsächlicher eBay- und Company-OS-Anmeldung.

Nach einem Update per git pull die Erweiterung auf chrome://extensions neu laden. Auf dem Entwicklungsbranch keine Live-Listings oder produktiven Daten verändern.

---

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
- Der Standalone-Button **Entwürfe öffnen** führt zu eBay Seller Hub. Diese 1.3.0-Version veröffentlicht keine Angebote automatisch.
- Veröffentlichte Angebote werden über den normalen eBay-Abgleich des Seller Tools als **Aktive Listings** sichtbar.
- Versand-, Zahlungs-, Rücknahmerichtlinie und eBay-Inventory-Standort sind in den Einstellungen auswählbar.
- Amazon-Bild-URLs werden zur Prüfung vorausgefüllt, aber erst nach der bewussten Inhalts-/Rechtebestätigung in einen eBay-Draft übernommen.
- Amazon-Inhalte bleiben Quelldaten. Die automatisch erzeugten Listing-Texte und Preisvorschläge sind Arbeitswerte und müssen vor Nutzung geprüft werden.

## Sicherheit

- Keine automatische Veröffentlichung.
- Kein Live-Publish aus der direkten eBay-Bridge; Veröffentlichung nur außerhalb der Erweiterung nach eigener Prüfung.
- Kein eBay-Token, Seller-Tool-Zugriffstoken oder DeepSeek-Key in der Extension. Der vom Nutzer eingegebene Company-OS-Sync-Code liegt ausschließlich im flüchtigen Chrome-Sitzungsspeicher.
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
