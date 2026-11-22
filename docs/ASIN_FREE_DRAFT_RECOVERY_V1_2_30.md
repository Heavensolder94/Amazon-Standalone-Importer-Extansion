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
