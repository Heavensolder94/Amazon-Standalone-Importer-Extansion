# Amazon Standalone Importer v1.2.30: vorhandene Drafts ohne erneute Amazon-ASIN abgleichen

Die frühere Meldung „Keine gültige Amazon-ASIN gefunden“ erschien
bereits **vor** der Kommunikation mit dem Seller Tool. Nach dem Schließen
der Chrome-Erweiterung konnte die aktuelle Amazon-Seite aus dem
Speicher verschwinden, obwohl eBay den FX_DRAFT bereits erfolgreich
verarbeitet hatte.

## Neuer sicherer Ablauf

1. Auf **Vorhandenen Entwurf mit ELYON abgleichen** klicken.
2. Bei fehlender ASIN fragt der Importer die letzten FX_DRAFT-Tasks über
   die bereits authentifizierte Seller-Tool-Schnittstelle
   `list-draft-recovery-candidates` ab.
3. Ist genau ein Kandidat vorhanden, wird dessen **Original-Task-ID**
   und **AMZ-SKU** über `recover-draft` bei eBay überprüft.
4. Bei mehreren Kandidaten erscheint ein Auswahlfeld **im bestehenden
   Popup**. Erst nach expliziter Auswahl wird eine Task verifiziert.
5. Ein beschädigter oder fehlender Importer-Speicher wird durch
   **read-only** eBay-Historie überbrückt. Es wird niemals ein neuer
   `FX_DRAFT`-, `FX_LISTING`- oder Publish-Aufruf ausgeführt.
6. Sind ASIN-Angaben widersprüchlich, bleibt der Vorgang blockiert.
   Ohne eindeutige Kandidaten wird weiterhin die Original-ASIN verlangt.

Wichtig: Die Browser-Erweiterung ist lokal installiert. Das Seller Tool
kann serverseitig aktualisiert werden, aber die Änderungen an
`direct-ebay-bridge.js` kommen nur durch **Aktualisieren des lokalen
Erweiterungsordners auf v1.2.30** an. Chrome unter
`chrome://extensions` auf „Neu laden“ klicken, nachdem die Dateien
ausgetauscht wurden. Neue Erweiterungsberechtigungen sind nicht nötig.

Der eBay-Entwurf selbst bleibt erhalten und wird nicht veröffentlicht.

## v1.2.31 – Sichtbare, dauerhafte Auswahl (23.11.2026)

**Fehlerursache:** v1.2.30 platzierte das dynamische `<select>` als drittes
Kind einer zweispaltigen Schaltflächenzeile. Die Statusmeldung dagegen stand
im Kopf des Popups. Im kleinen Chrome-Fenster war die Auswahl dadurch nicht
erkennbar; nach Schließen des Popups ging die Auswahl vollständig verloren.

**Behoben:**
- Feste, kontrastreiche Auswahl direkt unter `#status` im Popup-Header.
- Automatisches Scrollen zum Auswahlfeld bei mehreren Treffern.
- Gesonderter Button „Ausgewählten Entwurf mit ELYON abgleichen“
  (erst nach bewusster Auswahl freigegeben).
- Die Liste der bereits identifizierten eBay-Task-IDs und Amazon-SKUs wird
  lokal maximal 24 Stunden zwischengespeichert und beim erneuten Öffnen des
  Popups wieder eingeblendet. Sie ist keine Bestätigung: Die tatsächliche
  Zuordnung erfolgt weiter ausschließlich nach eBay-Prüfung der Task-ID
  und Original-CSV.
- Nach erfolgreicher Registrierung wird die Auswahl ausgeblendet und der
  Zwischenspeicher gelöscht.
- Keine neuen eBay-Entwürfe, Veröffentlichungen oder extra Berechtigungen.

**Einmalige Aktualisierung bei Git-Klon:** `git pull origin main` im
Erweiterungsordner, danach `chrome://extensions` → „Neu laden“.
Die installierte Erweiterung muss **v1.2.31** anzeigen.
