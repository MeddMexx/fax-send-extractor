# fax-send-extractor

Google Apps Script. Extrahiert den jeweils einen PDF-Anhang der ausgehenden
Faxe des Postfachinhabers an `*@simple-fax.de` und legt sie als ZIP-Teile in
einem Google-Drive-Ordner ab.

Stand: 2026-10-11 10:45:00 UTC (12:45:00 MESZ)

## Gegenstand

Das Skript hat eine Geschwisterfassung, die die Gegenrichtung abgreift: die
Sendeberichte von `noanswer@simple-fax.de` an das Postfach. Beide können im
selben Apps-Script-Projekt liegen; der Kopfkommentar der Quelldatei beschreibt
unter `TRENNUNG VON DER GESCHWISTERFASSUNG`, was dabei getrennt ist und was
nicht. Die Geschwisterfassung ist nicht Teil dieses Repositorys.

## Aufbau

    src/Fax-Versand-Extractor.gs    das gesamte Skript
    test/pruefstand.js              Prüfstand, siehe unten

Eine `appsscript.json` liegt bewusst nicht bei: Der Inhalt der tatsächlich
verwendeten Manifestdatei (Zeitzone, Laufzeitversion, Dienstversionen,
OAuth-Bereiche) ist hier nicht bekannt und würde geraten.

## Einrichtung

1. Inhalt von `src/Fax-Versand-Extractor.gs` in ein Apps-Script-Projekt einfügen.
2. Projekteinstellungen → „appsscript.json im Editor anzeigen" aktivieren.
3. Gmail API und Drive API unter „Dienste" hinzufügen. Sind in der
   `appsscript.json` `oauthScopes` festgeschrieben, muss dort
   `https://mail.google.com/` enthalten sein.
4. Im Auswahlfeld des Editors `extrahiereFaxVersandPdfs` wählen und ausführen.
5. Bei der Meldung „Bitte erneut Ausführen klicken" erneut ausführen, bis
   „Export vollständig abgeschlossen" erscheint.

Zurücksetzen: Protokolldatei `*_protokoll.json` in Google Drive löschen.

## Konfiguration

Sämtliche Einstellungen stehen im Konfigurationsblock des Namensraums.

| Konstante           | Bedeutung                                                       |
|---------------------|-----------------------------------------------------------------|
| `SOURCE_FILTERED_BY` | Quellfilter: `'email-label'` (eingestellt, Einschluss) oder `'fax-numbers'` (Ausschluss) |
| `INCLUDED_EMAIL_LABEL` | E-Mail-Label des Einschlusses; genau eines           |
| `EXCLUDED_FAX_NSN`  | **Blacklist** der ausgeschlossenen Fax-Nummern, national, ohne Verkehrsausscheidungsziffer |
| `EXPORT_NAME`       | trägt Ordner-, Archiv- und Protokolldateinamen; unterscheidet von der Geschwisterfassung, nicht die Quellfilter |
| `MAILBOX`           | Konto, unter dem der Lauf allein zulässig ist; sonst Abbruch      |
| `FAX_DOMAIN`        | Empfängerdomäne des Fax-Gateways                                  |
| `FROM_DATE`         | Beginn des Zeitraums                                              |
| `FAX_CC`            | Länderkennzahl; gilt für alle Nummern der Liste                   |
| `MAX_RESULTS`       | 0 = alle; für Probeläufe etwa 5                                   |
| `TIME_BUDGET_MS`    | Laufzeitbudget je Ausführung                                      |
| `SIZE_BUDGET_BYTES` | Größenbudget je Teil-ZIP                                          |

Die drei Kodierungen je Nummer (`0…`, `0049…`, `+49…`) erzeugt
`kodierungen_`; daraus entsteht `EXCLUDED_RECIPIENTS`.

## Quellfilter

Zwei Verfahren, umschaltbar über eine Konstante:

- **Einschluss über das E-Mail-Label** (eingestellt). Exportiert werden nur
  Mails, die `INCLUDED_EMAIL_LABEL` tragen. Das Label greift über den
  Parameter `labelIds` der Gmail-API, nicht über den Suchtext — exakt und je
  Nachricht statt je Konversation. Fehlt das Label im Postfach, bricht der
  Lauf ab. `EXCLUDED_FAX_NSN` ruht.
- **Ausschluss über Fax-Nummern.** Exportiert wird alles an die Fax-Domäne
  außer an die Nummern in `EXCLUDED_FAX_NSN`. Die Liste ist eine Blacklist:
  Wer dort einträgt, nimmt den Kanal vom Export aus.

Der Domänenfilter gilt in beiden Verfahren. Die Exportkennung trägt den
Quellfilter nicht; gegen einen Wechsel bei laufendem Zwischenstand schützt
das Feld `sourceFilteredBy` der Protokolldatei. Bericht und README jedes
Teils weisen stets beide Einstellungen aus, die wirksame gekennzeichnet.

## Teile

ZIP und README tragen den zweistelligen Index ihres Teils mit Vornull:

    2026-06-12_export_09-15-30_faxversand.01.zip
      README.01.txt

Ab Teil 100 bricht der Lauf ab, statt den Index wachsen zu lassen — eine
dritte Stelle stellte `README.100.txt` in jeder alphabetischen Liste vor
`README.11.txt`. Die Protokolldatei trägt keinen Index; je Lauf gibt es nur
eine.

## Filterung

Der Gmail-Suchfilter ist rein positiv:

    from:me to:simple-fax.de after:<FROM_DATE> before:<morgen>

Sämtliche Ausnahmen liegen im Code (`ermittleAusschlussgrund_`) und prüfen den
Empfängerheader Adresse für Adresse. Grund: Gmails Suche arbeitet tokenisiert;
ein negativer Suchoperator könnte mehr ausschließen als gemeint und Dokumente
lautlos verlieren. Ein zu weiter positiver Filter kostet dagegen nur Laufzeit.

Ausgeschlossen werden Entwürfe, Nachrichten ohne auswertbaren Empfänger,
Nachrichten mit einem Empfänger außerhalb der Fax-Domäne und Nachrichten an
eine der ausgenommenen Zielnummern.

## Erprobung

Ein vollständiger Lauf ist am 3. Oktober 2026 durchgelaufen. Die Trefferzahl
des Skripts stimmte mit derselben Suche in der Gmail-Oberfläche überein
(867 Treffer).

### Prüfstand

    node test/pruefstand.js

Rücksprung 0 ohne Beanstandung, sonst 1. Geprüft werden vollständige Läufe in
beiden Verfahren, das fehlende Label, ein Zwischenstand aus dem anderen
Verfahren, die Indexgrenze und die Empfängerzerlegung.

Zwei Einschränkungen gehören dazu. Gmail, Drive, Utilities und Session sind
nachgebaut; die Attrappen bilden ab, was das Skript erwartet, und sagen nichts
darüber, wie die echten Dienste sich verhalten. Und der Prüfstand erweitert
den Rückgabewert des Namensraums im geladenen Quelltext, um an die gekapselten
Funktionen zu kommen — in der Kopie, nie in der Datei; findet er seinen
Ankerpunkt nicht, bricht er ab.

Gegen das echte Postfach ist der Quellfilter noch nicht gelaufen.

## Offene Punkte

- Keine Spezifikation. Die Anforderungen stehen nur im Gesprächsverlauf;
  damit ist der Reviewprozess nach DEV-05 nicht vollständig ausführbar.
- Alle Nummern der Ausschlussliste teilen `FAX_CC`. Eine ausländische
  Zielnummer trüge die vorhandene Struktur nicht.
- `7112063142540` und `7112063148109` tragen 13 Stellen, alle übrigen 9 bis 11.
  Ungeprüft, ob dort eine Durchwahl oder eine Verkehrsausscheidungsziffer
  hineingeraten ist.
- Scheitert der Upload eines Teils, bleibt die Protokolldatei unverändert.
  Das verhindert Datenverlust, lässt den Lauf aber nicht weiterlaufen — die
  Ursache muss beseitigt werden, Wiederholen allein heilt nichts.
- Ein Teil ohne extrahiertes Dokument meldet keine Zusammenfassung; eine
  Gesamtbilanz über alle Teile gibt es nicht.
- Die Zeile „N von M" zählt geprüfte Nachrichten, nicht extrahierte Dokumente.
- Die Obergrenze von 50 MB für Uploads aus Apps Script stützt sich auf
  übereinstimmende Berichte Dritter, nicht auf Google-Dokumentation.
