/**
 * Fax-PDF-Extraktor – Versandrichtung (ausgehende Faxe).
 *
 * Stand: 2026-09-03 04:19:33 UTC (06:19:33 MESZ)
 *
 * NAMENSRAUM – bitte vor dem Bearbeiten lesen:
 *   Apps Script legt alle .gs-Dateien eines Projekts in EINEN globalen
 *   Geltungsbereich. Eine doppelte const-Deklaration bricht das Projekt
 *   mit SyntaxError ab; eine doppelte Funktionsdeklaration bricht nicht
 *   ab, sondern überschreibt still. Der stille Fall ist der gefährliche.
 *   Deshalb liegt hier alles in FaxVersandExtraktor. Global sind nur:
 *     - const FaxVersandExtraktor  (der Namensraum)
 *     - function extrahiereFaxVersandPdfs()  (Einstiegspunkt für den Editor)
 *   Beide sind bewusst als const bzw. eindeutig benannt gewählt: Träte
 *   der Name ein zweites Mal auf, bricht das Projekt laut ab statt still
 *   falsch zu laufen.
 *
 * TRENNUNG VON DER GESCHWISTERFASSUNG:
 *   Im Code getrennt:
 *     - Geltungsbereich: alles im Namensraum (siehe oben)
 *     - Einstiegspunkt: eigener Name
 *     - Exportkennung EXPORT_NAME: trägt Ordner-, Archiv- und
 *       Protokolldateinamen. Sie ist der einzige Ort, an dem die
 *       Unterscheidung festgelegt wird; kein Namensbestandteil ist
 *       noch fest verdrahtet.
 *     - Protokollsuche: greift über die Exportkennung und kann den
 *       Zwischenstand der Geschwisterfassung nicht mehr aufnehmen.
 *   NICHT trennbar, solange beide Fassungen im selben Apps-Script-
 *   Projekt liegen:
 *     - appsscript.json, OAuth-Bereiche, erweiterte Dienste
 *     - Laufzeitversion, Ausführungsprotokoll, Trigger, Kontingente
 *     - Skripteigenschaften
 *   Wer vollständige Trennung will, legt ein eigenes Apps-Script-
 *   Projekt an. Gemeinsam bleibt dann nur noch das Google-Konto
 *   mit seinem Gmail- und Drive-Bestand.
 *
 * Basis: bewährte EML-Export-Vorlage. Übernommen unverändert:
 *   - Protokolldatei-Mechanik (Wiederanlauf nach Zeitlimit, positionsgenau)
 *   - Teile-Logik (ZIP-Teile bei Zeit-/Größenlimit, fortlaufender Zähler)
 *   - Zeit- und Größenbudget, Fortschrittsanzeige, Konsolenausgaben
 *   - Ordner- und Namensschema, README je Teil
 *   - Payload: PDF-Anhang statt ganzer Nachricht als .eml
 *   - Konto-Zusicherung: Lauf bricht ab, wenn er nicht unter MAILBOX läuft
 *
 * Geändert gegenüber der Empfangsfassung (und nur das):
 *   - Richtung: nicht mehr Sendeberichte VON noanswer@simple-fax.de AN das
 *     Postfach, sondern die ausgehenden Faxe VOM Postfachinhaber AN
 *     <Nummer>@simple-fax.de. Der Anhang ist damit das gefaxte Dokument
 *     selbst, nicht mehr der Sendebericht.
 *   - Ausschluss: nicht mehr über den Betreff (Statusquittungen), sondern
 *     über den Empfänger. Die gesamte Betreffslogik entfällt.
 *   - Suchfilter: rein positiv (from:me to:<Domäne>). Sämtliche Ausnahmen
 *     stehen ausschließlich im Code – siehe ermittleAusschlussgrund_.
 *     Grund: Gmails Suche ist tokenisiert; ein negativer Suchoperator
 *     könnte mehr ausschließen als gemeint und Dokumente still verlieren.
 *     Ein zu weiter positiver Filter kostet dagegen nur Laufzeit.
 *   - Kapselung im Namensraum (siehe oben).
 *
 * Aufgabe:
 *   Den jeweils einen PDF-Anhang der Mails des Postfachinhabers an
 *   *@simple-fax.de extrahieren. Welche Mails das sind, bestimmt die
 *   Konstante SOURCE_FILTERED_BY:
 *
 *     'email-label'   Einschluss: nur Mails, die das E-Mail-Label
 *                     INCLUDED_EMAIL_LABEL tragen. EXCLUDED_FAX_NSN
 *                     bleibt dabei außer Betracht. Eingestellt.
 *     'fax-numbers'   Ausschluss: alle Mails an die Fax-Domäne AUSSER an
 *                     die in EXCLUDED_FAX_NSN geführten Nummern, jede in
 *                     ihren drei Kodierungen. EXCLUDED_FAX_NSN ist eine
 *                     Blacklist.
 *
 *   Das Label greift nicht über den Suchtext, sondern über den Parameter
 *   labelIds der Gmail-API („Only return messages with labels that match
 *   all of the specified label IDs"). Das ist exakt, wirkt je Nachricht
 *   statt je Konversation und umgeht die Tokenisierung der Suche. Fehlt
 *   das Label im Postfach, bricht der Lauf ab, statt lautlos null Treffer
 *   zu melden. Genau ein Label, nicht mehrere.
 *
 *   Der Domänenfilter to:<FAX_DOMAIN> gilt in beiden Verfahren. Ohne ihn
 *   träfe das Label auch Nicht-Fax-Mails, die die Ausschlussregel unten
 *   ohnehin wieder aussortiert.
 *
 *   Die Exportkennung trägt den Quellfilter NICHT; Ordner- und
 *   Archivnamen sind in beiden Verfahren dieselben. Gegen einen Wechsel
 *   bei laufendem Zwischenstand schützt stattdessen das Feld
 *   sourceFilteredBy der Protokolldatei: Weicht es ab, bricht der Lauf
 *   ab (assertQuellfilterUnveraendert_).
 *
 *   Bericht und README weisen stets BEIDE Einstellungen aus, die
 *   wirksame gekennzeichnet – aus dem Ergebnis allein wäre sonst nicht
 *   ablesbar, welches Verfahren es erzeugt hat.
 *
 * Ausschlussregeln (exaktes Sicherheitsnetz im Code):
 *   - Entwurf (nie versandt)
 *   - kein auswertbarer Empfänger
 *   - mindestens ein Empfänger außerhalb der Fax-Domäne
 *     (fängt zugleich die testhalber an das eigene Postfach
 *     gerichteten Nachrichten ab)
 *   - mindestens ein Empfänger ist eine ausgeschlossene Fax-Nummer
 *     (nur bei SOURCE_FILTERED_BY = 'fax-numbers')
 *
 * Archive:
 *   Die ZIP-Dateien tragen den zweistelligen Index ihres Teils:
 *     2026-06-12_export_09-15-30_faxversand.01.zip
 *   und führen das README desselben Index:
 *     README.01.txt
 *   Ab Teil 100 bricht der Lauf ab, statt den Index wachsen zu lassen.
 *   Alle Dateien landen in einem automatisch erzeugten Ordner:
 *     faxversand-extractor-dump_2026-06-12_09-15-30
 *   Die Protokolldatei trägt keinen Index – je Lauf gibt es nur eine:
 *     2026-06-12_export_09-15-30_faxversand_protokoll.json
 *   Bei Laufzeiten über 5 Minuten oder ZIP-Größen über dem Budget wird das
 *   Skript automatisch angehalten. Einfach erneut „Ausführen" klicken –
 *   das Skript setzt dort fort, wo es aufgehört hat, und erzeugt den
 *   nächsten Teil.
 *
 * Fortschrittsanzeige:
 *   Der Zähler (z. B. „85 von 847") läuft über alle Teile durch –
 *   Teil 2 beginnt dort, wo Teil 1 aufgehört hat.
 *   Der Durchschnitt (ø s/Nachricht) bezieht sich jeweils nur auf den
 *   aktuellen Teil.
 *
 * Protokolldatei:
 *   Trägt den Archivstamm mit der Endung _protokoll.json.
 *   Liegt im selben Ordner wie die Archive.
 *   Solange diese Datei in Google Drive existiert, setzt das Skript fort.
 *   Protokolldatei löschen = Neustart beim nächsten Ausführen.
 *   Nach vollständigem Export wird sie automatisch gelöscht.
 *
 * Nutzung:
 * 1. In https://script.google.com einfügen
 * 2. Projekteinstellungen → „appsscript.json im Editor anzeigen" aktivieren
 * 3. appsscript.json konfigurieren
 * 4. Gmail API und Drive API unter „Dienste" hinzufügen
 *    Hinweis: Diese Fassung nutzt zusätzlich GmailApp. Sind in der
 *    appsscript.json oauthScopes festgeschrieben, muss dort
 *    https://mail.google.com/ enthalten sein.
 * 5. extrahiereFaxVersandPdfs() ausführen
 * 6. Log enthält den Download-Link zur ZIP-Datei
 * 7. Bei Meldung „Bitte erneut Ausführen klicken": Schritt 5 wiederholen
 * 8. Zum Zurücksetzen: Protokolldatei (*_protokoll.json) in Google Drive löschen
 */

// ════ Einstiegspunkt (einzige globale Funktion) ════

/**
 * Der Zugriff auf den Namensraum erfolgt zur Aufrufzeit, nicht zur
 * Ladezeit – die Reihenfolge, in der Apps Script die Dateien lädt,
 * spielt daher keine Rolle.
 */
function extrahiereFaxVersandPdfs() {
  FaxVersandExtraktor.ausfuehren();
}

// ════ Namensraum (einziger globaler Bezeichner neben dem Einstiegspunkt) ════

const FaxVersandExtraktor = (function () {
  'use strict';

  // ──── Konfiguration: Anwendungsfall Fax ────

  // Quellfilter: wonach der Eingang ausgewählt wird. Beide Namen tragen
  // Gegenstand und Richtung, weil der Name sonst den Irrtum zulässt, die
  // Fax-Nummern seien eine Einschlussliste.
  const SOURCE_FILTER_INCLUDING_EMAIL_LABEL = 'email-label';
  const SOURCE_FILTER_EXCLUDING_FAX_NUMBERS = 'fax-numbers';

  const SOURCE_FILTERED_BY = SOURCE_FILTER_INCLUDING_EMAIL_LABEL;

  // Nur beim Einschluss wirksam: genau ein Label, nicht mehrere.
  const INCLUDED_EMAIL_LABEL = 'channels-to-be-exported';

  // Exportkennung: unterscheidet Ordner, Archive und Protokolldatei von der
  // Geschwisterfassung. Sie trägt den Quellfilter NICHT – dagegen schützt
  // der Eintrag sourceFilteredBy in der Protokolldatei.
  const EXPORT_NAME = 'faxversand';

  const MAILBOX = 'fax.per.epost@gmail.com';      // Zusicherung: Lauf nur unter diesem Konto
  const FAX_DOMAIN = 'simple-fax.de';             // Empfängerdomäne des Fax-Gateways
  const FROM_DATE = '2004-01-01';                 // vor Gmail-Start = gesamter Bestand

  // AUSGESCHLOSSENE Zielnummern – eine Blacklist. Wer hier einträgt,
  // nimmt den Kanal vom Export aus. Je Nummer ein Kern, drei Kodierungen
  // (DRY); alle Nummern teilen FAX_CC. Nur beim Ausschluss wirksam.
  const FAX_CC = '49';                 // Länderkennzahl
  const EXCLUDED_FAX_NSN = [           // nationale Nummern ohne Verkehrsausscheidungsziffer
    '23021844955',
    '70717573190',
    '75412048809',
    '71126331177',
    '7472169561',
    '7612188505',
    '761200572',
    '7541300050',
    '7112153340',
    '74721692309',
    '7112063142540',
    '7112063148109',
    '35131563109',
    '7541374810',
    '75413019680',
    '75412045364',
    '754122113',
    '75313618988',
    '7513524020'
  ];

  /** Die drei Kodierungen einer nationalen Nummer. */
  function kodierungen_(nsn) {
    return [
      '0'  + nsn,            // 023021844955
      '00' + FAX_CC + nsn,   // 004923021844955
      '+'  + FAX_CC + nsn    // +4923021844955
    ];
  }

  // Die ausgeschlossenen Empfängeradressen – einzige Quelle für die Ausschlussprüfung.
  const EXCLUDED_RECIPIENTS = EXCLUDED_FAX_NSN.reduce(function (adressen, nsn) {
    return adressen.concat(kodierungen_(nsn).map(function (kodierung) {
      return (kodierung + '@' + FAX_DOMAIN).toLowerCase();
    }));
  }, []);

  // ──── Systemgrenzen (aus der Vorlage) ────

  const MAX_RESULTS = 0;                       // 0 = alle; für Tests z. B. 5
  const TIME_BUDGET_MS = 5 * 60 * 1000;        // 5 Minuten (Free-Account-Limit: 6 Min.)
  // Uploads aus Apps Script scheitern nach übereinstimmenden Berichten
  // Dritter oberhalb von 50 MB (52.428.800 Bytes); Googles Kontingentseite
  // führt dazu nichts. Das Budget hält Abstand: Der ZIP-Umschlag komprimiert
  // PDF-Inhalte kaum, und Blobs und ZIP liegen gleichzeitig im Speicher.
  const SIZE_BUDGET_BYTES = 35 * 1024 * 1024;  // 35 MB pro Teil-ZIP

  // ──── Ablaufsteuerung ────

  function ausfuehren() {
    assertQuellfilterZulaessig_(SOURCE_FILTERED_BY);

    exportFaxPdfs_({
      exportName: EXPORT_NAME,
      searchQuery: 'from:me to:' + FAX_DOMAIN,
      fromDate: FROM_DATE,
      labelIds: schliesstUeberLabelEin_() ? [ermittleLabelId_(INCLUDED_EMAIL_LABEL)] : []
    });
  }

  /** Einschluss über das Label oder Ausschluss über die Nummern? */
  function schliesstUeberLabelEin_() {
    return SOURCE_FILTERED_BY === SOURCE_FILTER_INCLUDING_EMAIL_LABEL;
  }

  /** Ein unbekannter Quellfilter bricht den Lauf ab, statt still zu wirken. */
  function assertQuellfilterZulaessig_(quellfilter) {
    const zulaessig = [SOURCE_FILTER_INCLUDING_EMAIL_LABEL, SOURCE_FILTER_EXCLUDING_FAX_NUMBERS];
    if (zulaessig.indexOf(quellfilter) === -1) {
      throw new Error('Unbekannter Quellfilter "' + quellfilter + '" – zulässig: ' + zulaessig.join(', ') + '.');
    }
  }

  /**
   * Die Protokolldatei führt den Quellfilter mit. Findet ein fortgesetzter
   * Lauf dort einen anderen, bricht er ab: Die hinterlegte ID-Liste stammt
   * dann vom anderen Verfahren und hätte den falschen Bestand abgearbeitet.
   */
  function assertQuellfilterUnveraendert_(protokoll) {
    if (protokoll.sourceFilteredBy !== SOURCE_FILTERED_BY) {
      throw new Error('Zwischenstand stammt vom Quellfilter "' + protokoll.sourceFilteredBy +
        '", eingestellt ist "' + SOURCE_FILTERED_BY + '" – Abbruch.');
    }
  }

  /**
   * Übersetzt den Labelnamen in seine Kennung. Der Suchtext bliebe
   * tokenisiert; der Parameter labelIds der Gmail-API trifft exakt.
   * Fehlt das Label, bricht der Lauf ab – ein nicht gefundenes Label
   * lieferte sonst lautlos null Treffer.
   */
  function ermittleLabelId_(name) {
    const antwort = Gmail.Users.Labels.list('me');
    const treffer = ((antwort && antwort.labels) || []).filter(function (label) {
      return label.name === name;
    });

    if (treffer.length === 0) {
      throw new Error('Label "' + name + '" existiert im Postfach nicht – Abbruch.');
    }
    if (treffer.length > 1) {
      throw new Error('Label "' + name + '" ist mehrdeutig (' + treffer.length + ' Treffer) – Abbruch.');
    }

    return treffer[0].id;
  }

  // ──── Orchestrierung (Vorlage) ────

  function exportFaxPdfs_(params) {
    validateParams_(params);

    const config = resolveConfig_(params);
    const myEmail = Gmail.Users.getProfile('me').emailAddress.toLowerCase();
    assertKonto_(myEmail);

    const session = resumeOrStart_(config);

    if (!session) return;

    logSessionStart_(config, session);

    const result = processMessages_(session, config);

    if (result.blobs.length > 0) {
      createZipAndUpload_(result.blobs, session, config, result.skipped, result.totalBytes);
    }

    finalizeSession_(session, result);
  }

  // ──── Konto-Zusicherung (Ergänzung zur Vorlage) ────

  /**
   * Trägt die Last des Suchfilters mit: 'from:me' bezeichnet den Inhaber des
   * ausführenden Kontos. Läuft das Skript unter einem anderen Konto, wäre der
   * Filter still auf den falschen Absender gerichtet.
   */
  function assertKonto_(myEmail) {
    if (myEmail !== MAILBOX.toLowerCase()) {
      throw new Error('Falsches Konto: aktiv=' + myEmail + ', erwartet=' + MAILBOX + ' – Abbruch.');
    }
  }

  // ──── Eingabevalidierung (Vorlage) ────

  function validateParams_(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('params muss ein Objekt mit exportName, searchQuery und fromDate sein.');
    }

    const required = ['exportName', 'searchQuery', 'fromDate'];
    const missing = required.filter(function (key) { return !params[key]; });

    if (missing.length > 0) {
      throw new Error('Pflichtparameter fehlen: ' + missing.join(', '));
    }
  }

  // ──── Konfiguration auflösen (Vorlage) ────

  function resolveConfig_(params) {
    const effectiveToDate = params.toDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const effectiveLimit = MAX_RESULTS;
    const toDatePlusOne = addDays_(effectiveToDate, 1);
    const fullQuery = params.searchQuery + ' after:' + params.fromDate + ' before:' + toDatePlusOne;
    const bisDisplay = params.toDate ? effectiveToDate : 'heute (' + effectiveToDate + ', auto defaulted)';

    return {
      exportName: params.exportName,
      searchQuery: params.searchQuery,
      fromDate: params.fromDate,
      labelIds: params.labelIds || [],
      effectiveToDate: effectiveToDate,
      effectiveLimit: effectiveLimit,
      fullQuery: fullQuery,
      bisDisplay: bisDisplay
    };
  }

  function buildAnzahlDisplay_(effectiveLimit, totalFound) {
    if (effectiveLimit) {
      return effectiveLimit + ' von ' + totalFound;
    }
    return 'alle (' + totalFound + ', auto defaulted)';
  }

  // ──── Session: Fortsetzen oder Neu starten (Vorlage) ────

  function resumeOrStart_(config) {
    const protokoll = loadProtokoll_(config.exportName);

    if (protokoll) {
      assertQuellfilterUnveraendert_(protokoll);
      return resumeSession_(protokoll);
    }

    return startNewSession_(config);
  }

  function resumeSession_(protokoll) {
    console.log('Protokolldatei gefunden: ' + protokoll.archiveName + '_protokoll.json');
    console.log('Fortgesetzter Lauf – ' + protokoll.ids.length + ' IDs, weiter bei Nachricht ' + (protokoll.nextIndex + 1) + ' (Teil ' + protokoll.nextPart + ')');

    return {
      protokoll: protokoll,
      archiveName: protokoll.archiveName,
      allIds: protokoll.ids,
      startIndex: protokoll.nextIndex,
      partNumber: protokoll.nextPart,
      folderId: protokoll.folderId
    };
  }

  function startNewSession_(config) {
    const allIds = searchAllMessageIds_(config.fullQuery, config.labelIds);

    if (allIds.length === 0) {
      console.log('Zeitraum: ' + config.fromDate + ' bis ' + config.bisDisplay + ', jeweils inklusive');
      console.log('Keine Treffer.');
      return null;
    }

    const now = new Date();
    const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
    const archiveName = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd') +
      '_export_' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH-mm-ss') +
      '_' + config.exportName;
    assertArchiveName_(archiveName, config.exportName);

    // Ordner in Meine Ablage erstellen
    const folderName = config.exportName + '-extractor-dump_' + timestamp;
    const folderMeta = { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: ['root'] };
    const folder = Drive.Files.create(folderMeta, null, { fields: 'id' });
    const folderId = folder.id;

    console.log('Ordner erstellt: ' + folderName);

    const protokoll = {
      archiveName: archiveName,
      exportName: config.exportName,
      sourceFilteredBy: SOURCE_FILTERED_BY,
      ids: allIds,
      nextIndex: 0,
      nextPart: 1,
      folderId: folderId,
      teile: []
    };
    saveProtokoll_(protokoll, folderId);

    console.log('Neuer Export gestartet: ' + archiveName);

    return {
      protokoll: protokoll,
      archiveName: archiveName,
      allIds: allIds,
      startIndex: 0,
      partNumber: 1,
      folderId: folderId
    };
  }

  /**
   * findProtokollFile_ erkennt die eigene Protokolldatei am Suffix
   * '_' + exportName + '_protokoll.json'. Die Datei heißt archiveName +
   * '_protokoll.json'. Endet der Archivname nicht auf die Exportkennung,
   * findet der Wiederanlauf seinen Zwischenstand nicht mehr – und im
   * ungünstigen Fall den einer anderen Fassung. Die Kopplung ist damit
   * hier festgeschrieben statt bloß kommentiert.
   */
  function assertArchiveName_(archiveName, exportName) {
    if (!archiveName.endsWith('_' + exportName)) {
      throw new Error('Archivname "' + archiveName + '" endet nicht auf "_' + exportName + '" – Wiederanlauf wäre gebrochen.');
    }
  }

  // ──── Log: Session-Start (Vorlage) ────

  /**
   * Beide Einstellungen, gleich welche gerade wirkt, mit Kennzeichnung der
   * wirksamen. Bericht und README zeigen damit stets auch, wonach NICHT
   * ausgewählt wurde – sonst bliebe aus dem Ergebnis allein nicht ablesbar,
   * welches Verfahren es erzeugt hat. Eine Quelle für beide Ausgaben.
   */
  function beschreibeEinstellungen_() {
    const kennzeichen = function (quellfilter) {
      return SOURCE_FILTERED_BY === quellfilter ? ' [WIRKSAM]' : ' [ruht]';
    };

    return [
      'Quellfilter: ' + SOURCE_FILTERED_BY,
      'Einschluss über E-Mail-Label (' + SOURCE_FILTER_INCLUDING_EMAIL_LABEL + ')' +
        kennzeichen(SOURCE_FILTER_INCLUDING_EMAIL_LABEL) + ': ' + INCLUDED_EMAIL_LABEL,
      'Ausschluss über Fax-Nummern (' + SOURCE_FILTER_EXCLUDING_FAX_NUMBERS + ')' +
        kennzeichen(SOURCE_FILTER_EXCLUDING_FAX_NUMBERS) + ': ' +
        EXCLUDED_FAX_NSN.length + ' Nummern, ' + EXCLUDED_RECIPIENTS.length + ' Adressen',
      '  ' + EXCLUDED_RECIPIENTS.join(', ')
    ];
  }

  function logSessionStart_(config, session) {
    const totalFound = session.allIds.length;
    const anzahlDisplay = buildAnzahlDisplay_(config.effectiveLimit, totalFound);

    console.log('Export:     ' + config.exportName);
    console.log('Suchfilter: ' + config.searchQuery);
    beschreibeEinstellungen_().forEach(function (zeile) { console.log(zeile); });
    console.log('Zeitraum: ' + config.fromDate + ' bis ' + config.bisDisplay + ', jeweils inklusive');
    console.log('Anzahl:   ' + anzahlDisplay);
    console.log('Limits:   ' + (TIME_BUDGET_MS / 60000) + ' Min. Laufzeit, ' + formatSize_(SIZE_BUDGET_BYTES) + ' ZIP-Größe');
  }

  // ──── Nachrichten verarbeiten (Vorlage) ────

  function processMessages_(session, config) {
    const toProcess = config.effectiveLimit ? session.allIds.slice(0, config.effectiveLimit) : session.allIds;
    const totalToProcess = toProcess.length;
    const startIndex = session.startIndex;

    const blobs = [];
    let step = startIndex;
    let skipped = 0;
    let totalBytes = 0;
    const startTime = new Date().getTime();
    let timeOut = false;

    for (let i = startIndex; i < totalToProcess; i++) {
      if (new Date().getTime() - startTime > TIME_BUDGET_MS) {
        timeOut = true;
        console.log('Zeitlimit erreicht – Zwischenstand wird gespeichert.');
        break;
      }

      const stepStart = new Date().getTime();
      let pdfResult;

      try {
        pdfResult = holePdf_(toProcess[i]);
      } catch (e) {
        step++;
        skipped++;
        console.log('Fehler bei Nachricht ' + toProcess[i] + ': ' + e.message + ' – übersprungen.');
        continue;
      }

      if (!pdfResult) {
        step++;
        skipped++;
        continue;
      }

      // Vorausschauend prüfen: Passt das Dokument nicht mehr in dieses Teil,
      // bleibt es unverarbeitet und beginnt das nächste. step wird deshalb
      // NICHT erhöht – nextIndex zeigt danach genau auf diese Nachricht.
      if (blobs.length > 0 && totalBytes + pdfResult.size > SIZE_BUDGET_BYTES) {
        timeOut = true;
        console.log('Größenlimit erreicht (' + formatSize_(totalBytes) + ' + ' + formatSize_(pdfResult.size) +
          ') – Nachricht wandert in den nächsten Teil, Zwischenstand wird gespeichert.');
        break;
      }

      // Einzeldokument über Budget: Es allein bildet das Teil. Andernfalls
      // käme der Lauf nie an ihm vorbei.
      if (blobs.length === 0 && pdfResult.size > SIZE_BUDGET_BYTES) {
        console.log('Warnung – Einzeldokument über Budget (' + formatSize_(pdfResult.size) +
          '), bildet ein eigenes Teil. Der Upload kann daran scheitern.');
      }

      step++;
      totalBytes += pdfResult.size;
      blobs.push(pdfResult.blob);

      logProgress_(step, totalToProcess, startIndex, startTime, stepStart, pdfResult.size);
    }

    return {
      blobs: blobs,
      step: step,
      skipped: skipped,
      totalBytes: totalBytes,
      timeOut: timeOut,
      totalToProcess: totalToProcess,
      startTime: startTime
    };
  }

  // ──── Einzelne Nachricht: PDF-Anhang holen ────

  /**
   * Liefert den PDF-Anhang einer Nachricht als benannten Blob oder null
   * (ausgeschlossen / kein Anhang / kein PDF – Grund wird geloggt).
   * Zusicherung des Anwenders: genau ein Anhang, immer PDF, nie mehrere
   * Empfänger. Defensiv bleibt: Abweichungen werden geloggt.
   */
  function holePdf_(msgId) {
    const msg = GmailApp.getMessageById(msgId);
    const kennung = beschreibeNachricht_(msg);

    const ausschlussgrund = ermittleAusschlussgrund_(msg);
    if (ausschlussgrund) {
      console.log('Ausgeschlossen (' + ausschlussgrund + '): ' + kennung);
      return null;
    }

    const atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
    if (atts.length === 0) {
      console.log('Kein Anhang: ' + kennung);
      return null;
    }
    if (atts.length > 1) {
      console.log('Warnung – ' + atts.length + ' Anhänge, erster wird genommen: ' + kennung);
    }

    const pdf = atts[0];
    if (!istPdf_(pdf)) {
      console.log('Anhang ist kein PDF (' + pdf.getContentType() + '): ' + kennung);
      return null;
    }

    return {
      blob: pdf.copyBlob().setName(buildFileName_(msg, pdf)),
      size: pdf.getSize()
    };
  }

  function istPdf_(attachment) {
    return attachment.getContentType() === 'application/pdf' || /\.pdf$/i.test(attachment.getName());
  }

  function beschreibeNachricht_(msg) {
    return msg.getSubject().trim() + ' → ' + msg.getTo().trim() + ' [' + msg.getId() + ']';
  }

  function buildFileName_(msg, pdf) {
    const dateStr = Utilities.formatDate(msg.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH.mm.ss');
    return dateStr + ' [' + msg.getId() + '] ' + pdf.getName();
  }

  // ──── Filterlogik: Empfänger-Ausschlüsse (Sicherheitsnetz) ────

  /**
   * Liefert den Ausschlussgrund als Klartext oder null, wenn die Nachricht
   * zu extrahieren ist. Der Gmail-Suchfilter ist tokenisiert und damit nicht
   * exakt; hier wird der Empfängerheader Adresse für Adresse geprüft.
   */
  function ermittleAusschlussgrund_(msg) {
    if (msg.isDraft()) {
      return 'Entwurf, nie versandt';
    }

    const empfaenger = parseEmpfaenger_(msg.getTo());
    if (empfaenger.length === 0) {
      return 'kein auswertbarer Empfänger';
    }

    const fremde = empfaenger.filter(function (adresse) { return !istFaxAdresse_(adresse); });
    if (fremde.length > 0) {
      return 'Empfänger außerhalb ' + FAX_DOMAIN + ': ' + fremde.join(', ');
    }

    // Nur das Ausschlussverfahren wertet die Fax-Nummern aus. Beim
    // Einschluss entscheidet allein das Label, das die Gmail-API bereits
    // exakt gefiltert hat.
    if (!schliesstUeberLabelEin_()) {
      const gesperrte = empfaenger.filter(function (adresse) { return istAusgeschlosseneFaxNummer_(adresse); });
      if (gesperrte.length > 0) {
        return 'ausgeschlossene Fax-Nummer: ' + gesperrte.join(', ');
      }
    }

    return null;
  }

  /**
   * Zerlegt einen Empfängerheader in normalisierte Adressen. Trägt sowohl
   * die Form 'Anzeigename <adresse>' als auch die nackte Adresse; die
   * Zerlegung greift die Adressen selbst, nicht die Kommata – ein
   * Anzeigename darf damit Kommata enthalten.
   */
  function parseEmpfaenger_(header) {
    const muster = /<([^<>]+)>|([^\s,<>]+@[^\s,<>]+)/g;
    const adressen = [];
    let treffer;

    while ((treffer = muster.exec(header || '')) !== null) {
      const adresse = (treffer[1] || treffer[2] || '').trim().toLowerCase();
      if (adresse.indexOf('@') !== -1) {
        adressen.push(adresse);
      }
    }

    return adressen;
  }

  function istFaxAdresse_(adresse) {
    return adresse.endsWith('@' + FAX_DOMAIN.toLowerCase());
  }

  function istAusgeschlosseneFaxNummer_(adresse) {
    return EXCLUDED_RECIPIENTS.indexOf(adresse) !== -1;
  }

  // ──── Fortschrittsanzeige (Vorlage) ────

  function logProgress_(step, totalToProcess, startIndex, startTime, stepStart, pdfSize) {
    const stepDuration = ((new Date().getTime() - stepStart) / 1000).toFixed(1);
    const percent = Math.round(step / totalToProcess * 100);
    const elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(1);
    const secPerMsg = (elapsed / (step - startIndex)).toFixed(1);

    console.log(step + ' von ' + totalToProcess + ' (' + percent + '%) – ' + stepDuration + 's, ø ' + secPerMsg + 's/Nachricht (' + formatSize_(pdfSize) + ')');
  }

  // ──── ZIP erstellen und hochladen (Vorlage) ────

  function createZipAndUpload_(blobs, session, config, skipped, totalBytes) {
    const pdfCount = blobs.length;
    const totalFound = session.allIds.length;
    const anzahlDisplay = buildAnzahlDisplay_(config.effectiveLimit, totalFound);

    const readme = buildReadme_(config, anzahlDisplay, session.partNumber, pdfCount, skipped);
    blobs.push(Utilities.newBlob(readme, 'text/plain', buildReadmeName_(session.partNumber)));

    const zip = Utilities.zip(blobs, teilArchivName_(session.archiveName, session.partNumber));

    const fileMetadata = {
      name: zip.getName(),
      mimeType: 'application/zip',
      parents: [session.folderId]
    };
    const file = Drive.Files.create(fileMetadata, zip, { fields: 'id,webContentLink' });

    console.log('Teil ' + session.partNumber + ' fertig – ' + pdfCount + ' PDF-Dateien (' + formatSize_(totalBytes) + '), ' + skipped + ' übersprungen.');
    console.log('Download: ' + file.webContentLink);
  }

  /**
   * Der Index des Teils gehört in die Dateierweiterung, damit die READMEs
   * mehrerer Teile nebeneinander liegen können, ohne einander zu verdrängen.
   */
  function buildReadmeName_(partNumber) {
    return 'README.' + teilIndex_(partNumber) + '.txt';
  }

  /**
   * Zweistellig mit Vornull. Ab Teil 100 bricht der Lauf ab, statt den
   * Index wachsen zu lassen: Eine dritte Stelle stellte README.100.txt in
   * jeder alphabetischen Liste vor README.11.txt.
   */
  function teilIndex_(partNumber) {
    if (partNumber > 99) {
      throw new Error('Teil ' + partNumber + ' überschreitet den zweistelligen Index – Abbruch.');
    }
    return partNumber < 10 ? '0' + partNumber : String(partNumber);
  }

  /** Eine Quelle für den ZIP-Namen; Protokolleintrag und Ablage dürfen nicht auseinanderlaufen. */
  function teilArchivName_(archiveName, partNumber) {
    return archiveName + '.' + teilIndex_(partNumber) + '.zip';
  }

  function buildReadme_(config, anzahlDisplay, partNumber, pdfCount, skipped) {
    return [
      'Verwendeter Gmail-Suchfilter:',
      '',
      config.searchQuery,
      '',
      'Einstellungen:',
      '',
      beschreibeEinstellungen_().join('\n'),
      '',
      'Zeitraum: ' + config.fromDate + ' bis ' + config.bisDisplay + ', jeweils inklusive',
      'Anzahl:   ' + anzahlDisplay,
      'Limits:   ' + (TIME_BUDGET_MS / 60000) + ' Min. Laufzeit, ' + formatSize_(SIZE_BUDGET_BYTES) + ' ZIP-Größe',
      '',
      'Teil:         ' + partNumber,
      'In diesem Teil extrahiert: ' + pdfCount,
      'Übersprungen: ' + skipped,
      ''
    ].join('\n');
  }

  // ──── Session abschließen (Vorlage) ────

  function finalizeSession_(session, result) {
    if (result.blobs.length > 0) {
      session.protokoll.teile.push({
        teil: session.partNumber,
        exportiert: result.blobs.length,
        uebersprungen: result.skipped,
        bytes: result.totalBytes,
        zipName: teilArchivName_(session.archiveName, session.partNumber)
      });
    }

    if (result.timeOut) {
      session.protokoll.nextIndex = result.step;
      session.protokoll.nextPart = session.partNumber + 1;
      saveProtokoll_(session.protokoll, session.folderId);
      console.log('═══ Bitte erneut „Ausführen" klicken, um fortzufahren. ═══');
    } else {
      deleteProtokoll_(session.protokoll);
      console.log('═══ Export vollständig abgeschlossen. Protokolldatei gelöscht. ═══');
    }
  }

  // ──── Protokolldatei-Verwaltung (Vorlage) ────

  function findProtokollFile_(exportName) {
    const expectedSuffix = '_' + exportName + '_protokoll.json';
    const candidates = searchDriveByNameFragment_(exportName + '_protokoll.json');
    return findExactMatch_(candidates, expectedSuffix);
  }

  function searchDriveByNameFragment_(fragment) {
    // Drive API 'contains' ist tokenbasiert, kein exakter Substring-Match –
    // kann mehr als den gesuchten Treffer liefern. Ergebnis daher stets exakt nachprüfen.
    const result = Drive.Files.list({
      q: "name contains '" + fragment + "' and mimeType = 'application/json' and trashed = false",
      fields: 'files(id,name)',
      pageSize: 10
    });
    return (result.files || []);
  }

  function findExactMatch_(candidates, expectedSuffix) {
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].name.endsWith(expectedSuffix)) {
        return candidates[i];
      }
    }
    return null;
  }

  function loadProtokoll_(exportName) {
    const file = findProtokollFile_(exportName);
    if (!file) return null;
    const content = Drive.Files.get(file.id, { alt: 'media' });
    const data = (typeof content === 'string') ? JSON.parse(content) : content;
    data._fileId = file.id;
    return data;
  }

  function saveProtokoll_(protokoll, folderId) {
    const fileId = protokoll._fileId;
    const data = Object.assign({}, protokoll);
    delete data._fileId;
    const blob = Utilities.newBlob(JSON.stringify(data, null, 2), 'application/json', data.archiveName + '_protokoll.json');

    if (fileId) {
      Drive.Files.update({ name: blob.getName() }, fileId, blob);
    } else {
      const meta = {
        name: blob.getName(),
        mimeType: 'application/json',
        parents: [folderId]
      };
      const created = Drive.Files.create(meta, blob, { fields: 'id' });
      protokoll._fileId = created.id;
    }
  }

  function deleteProtokoll_(protokoll) {
    if (protokoll && protokoll._fileId) {
      Drive.Files.remove(protokoll._fileId);
    }
  }

  // ──── Basisfunktionen (Vorlage) ────

  function formatSize_(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function addDays_(dateStr, days) {
    const date = new Date(dateStr + 'T00:00:00');
    date.setDate(date.getDate() + days);
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  }

  function searchAllMessageIds_(query, labelIds) {
    const ids = [];
    let pageToken = null;
    do {
      // labelIds wird nur gesetzt, wenn es Kennungen gibt. Ob die Gmail-API
      // einen undefined-Wert wie ein fehlendes Feld behandelt, ist unbelegt.
      const optionen = { q: query, maxResults: 100, pageToken: pageToken };
      if (labelIds && labelIds.length > 0) {
        optionen.labelIds = labelIds;
      }

      const response = Gmail.Users.Messages.list('me', optionen);
      if (!response.messages) break;
      for (const m of response.messages) {
        ids.push(m.id);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
    return ids;
  }

  // ──── Nach außen sichtbar: nur der Ablauf ────

  return {
    ausfuehren: ausfuehren
  };
})();
