'use strict';
/**
 * Prüfstand für Fax-Versand-Extractor.gs
 *
 * Aufruf:  node test/pruefstand.js
 * Rücksprung: 0 ohne Beanstandung, 1 sonst.
 *
 * WAS DIESER PRÜFSTAND NICHT LEISTET:
 *   Gmail, Drive, Utilities und Session sind hier NACHGEBAUT. Die
 *   Attrappen bilden ab, was das Skript von ihnen erwartet – sie sind
 *   keine Zusicherung darüber, wie die echten Dienste sich verhalten.
 *   Ein bestandener Lauf belegt die Logik des Skripts, nicht sein
 *   Zusammenspiel mit Google. Dafür bleibt der Lauf gegen das echte
 *   Postfach unverzichtbar.
 *
 * ZUGRIFF AUF GEKAPSELTE FUNKTIONEN:
 *   Das Skript gibt nach außen nur `ausfuehren` frei. Für die Prüfung
 *   wird der Rückgabewert des Namensraums im geladenen Quelltext um
 *   `_test` erweitert – in der Kopie, nie in der Datei. Findet sich der
 *   Ankerpunkt nicht mehr, bricht der Prüfstand ab, statt stillschweigend
 *   weniger zu prüfen.
 */

const fs = require('fs');
const path = require('path');

const QUELLE = path.resolve(__dirname, '..', 'src', 'Fax-Versand-Extractor.gs');
const ANKER = 'ausfuehren: ausfuehren';
const JETZT = new Date('2026-06-12T09:15:30');

// ──── Attrappen ────

function formatDate(date, tz, muster) {
  const p = (n) => String(n).padStart(2, '0');
  return muster
    .replace(/yyyy/g, date.getFullYear())
    .replace(/MM/g, p(date.getMonth() + 1))
    .replace(/dd/g, p(date.getDate()))
    .replace(/HH/g, p(date.getHours()))
    .replace(/mm/g, p(date.getMinutes()))
    .replace(/ss/g, p(date.getSeconds()));
}

function nachricht(o) {
  return {
    getId: () => o.id,
    getSubject: () => o.betreff || 'Fax',
    getTo: () => o.to,
    getDate: () => o.datum || JETZT,
    isDraft: () => !!o.entwurf,
    getAttachments: () => (o.anhaenge || []).map((a) => ({
      getName: () => a.name,
      getContentType: () => a.typ || 'application/pdf',
      getSize: () => a.groesse || 1024,
      copyBlob: () => ({
        _name: a.name,
        setName(n) { this._name = n; return this; },
        getName() { return this._name; }
      })
    }))
  };
}

function lade(opt) {
  const roh = fs.readFileSync(QUELLE, 'utf8');
  if (roh.indexOf(ANKER) === -1) {
    throw new Error('Ankerpunkt "' + ANKER + '" nicht gefunden – der Prüfstand ' +
      'kommt an die gekapselten Funktionen nicht heran und prüft sonst zu wenig.');
  }

  let src = roh.replace(ANKER, ANKER +
    ', _test: { teilIndex_, teilArchivName_, buildReadmeName_, ' +
    'parseEmpfaenger_, ermittleAusschlussgrund_, beschreibeEinstellungen_ }');
  if (opt.quellfilter) {
    const vorher = src;
    src = src.replace(/const SOURCE_FILTERED_BY = .*;/, 'const SOURCE_FILTERED_BY = ' + opt.quellfilter + ';');
    if (src === vorher) {
      throw new Error('Zeile SOURCE_FILTERED_BY nicht gefunden – Umschalten nicht möglich.');
    }
  }

  const log = [];
  const driveCreate = [];
  const konsole = { log: (...a) => log.push(a.join(' ')) };

  const Gmail = {
    Users: {
      getProfile: () => ({ emailAddress: opt.konto || 'fax.per.epost@gmail.com' }),
      Labels: {
        list: () => ({
          labels: opt.labels !== undefined ? opt.labels
            : [{ id: 'Label_7', name: 'channels/to-be-exported' }]
        })
      },
      Messages: {
        list: (uid, p) => {
          (opt.listAufrufe || []).push(JSON.parse(JSON.stringify(p)));
          return { messages: (opt.ids || []).map((id) => ({ id })) };
        }
      }
    }
  };
  const GmailApp = { getMessageById: (id) => nachricht(opt.nachrichten[id]) };
  const Drive = {
    Files: {
      create: (meta) => { driveCreate.push(meta.name); return { id: 'id_' + driveCreate.length, webContentLink: 'http://beispiel' }; },
      list: () => ({ files: opt.protokollDatei ? [{ id: 'p1', name: opt.protokollDatei.name }] : [] }),
      get: () => JSON.stringify(opt.protokollDatei.inhalt),
      update: () => ({}),
      remove: () => ({})
    }
  };
  const Utilities = {
    formatDate,
    newBlob: (inhalt, typ, name) => ({ _name: name, getName() { return this._name; }, inhalt }),
    zip: (blobs, name) => ({ getName: () => name, blobs })
  };
  const Session = { getScriptTimeZone: () => 'Europe/Berlin' };

  const FixDate = class extends Date {
    constructor(...a) { return a.length ? new Date(...a) : new Date(JETZT); }
  };
  FixDate.now = () => JETZT.getTime();

  const fabrik = new Function('Gmail', 'GmailApp', 'Drive', 'Utilities', 'Session', 'console', 'Date',
    src + '\n;return { run: extrahiereFaxVersandPdfs, ns: FaxVersandExtraktor };');

  return { modul: fabrik(Gmail, GmailApp, Drive, Utilities, Session, konsole, FixDate), log, driveCreate };
}

// ──── Befundführung ────

let fehler = 0;
function pruefe(name, bedingung, ist) {
  if (bedingung) {
    console.log('  ✓ ' + name);
  } else {
    console.log('  ✗ ' + name + (ist !== undefined ? '  ist: ' + JSON.stringify(ist) : ''));
    fehler++;
  }
}

// ──── Testbestand ────

const NACHRICHTEN = {
  m1: { id: 'm1', to: '0711999999@simple-fax.de', anhaenge: [{ name: 'bericht.pdf', groesse: 2048 }] },
  m2: { id: 'm2', to: '023021844955@simple-fax.de', anhaenge: [{ name: 'gesperrt.pdf' }] },
  m3: { id: 'm3', to: 'jemand@example.com', anhaenge: [{ name: 'fremd.pdf' }] },
  m4: { id: 'm4', to: '0711999999@simple-fax.de', entwurf: true, anhaenge: [{ name: 'entwurf.pdf' }] },
  m5: { id: 'm5', to: '"Kanzlei, Dr. A" <07612188505@simple-fax.de>', anhaenge: [{ name: 'zwei.pdf' }, { name: 'drei.pdf' }] }
};

console.log('\n1 · Einschluss über E-Mail-Label, vollständiger Lauf');
{
  const listAufrufe = [];
  const g = lade({ ids: ['m1', 'm2', 'm3', 'm4', 'm5'], nachrichten: NACHRICHTEN, listAufrufe });
  g.modul.run();
  const zeilen = g.log.join('\n');
  pruefe('labelIds gesetzt', JSON.stringify(listAufrufe[0].labelIds) === '["Label_7"]', listAufrufe[0].labelIds);
  pruefe('Domänenfilter im Suchtext', listAufrufe[0].q.indexOf('to:simple-fax.de') !== -1, listAufrufe[0].q);
  pruefe('ZIP trägt .01.', g.driveCreate.some((n) => /_faxversand\.01\.zip$/.test(n)), g.driveCreate);
  pruefe('Ordnername unverändert', g.driveCreate.some((n) => /^faxversand-extractor-dump_/.test(n)), g.driveCreate);
  pruefe('beide Einstellungen ausgewiesen',
    /Einschluss über E-Mail-Label.*\[WIRKSAM\]/.test(zeilen) && /Ausschluss über Fax-Nummern.*\[ruht\]/.test(zeilen));
  pruefe('Blacklist ruht – gesperrte Nummer wird nicht ausgeschlossen',
    zeilen.indexOf('ausgeschlossene Fax-Nummer') === -1);
  pruefe('Entwurf übersprungen', /Entwurf, nie versandt/.test(zeilen));
  pruefe('fremde Domäne übersprungen', /Empfänger außerhalb simple-fax\.de/.test(zeilen));
  pruefe('Mehrfachanhang gemeldet', /2 Anhänge, erster wird genommen/.test(zeilen));
}

console.log('\n2 · Label fehlt im Postfach');
{
  let meldung = '';
  try { lade({ labels: [], ids: ['m1'], nachrichten: NACHRICHTEN }).modul.run(); } catch (e) { meldung = e.message; }
  pruefe('Abbruch im Klartext', /existiert im Postfach nicht/.test(meldung), meldung);
}

console.log('\n3 · Ausschluss über Fax-Nummern');
{
  const listAufrufe = [];
  const g = lade({ quellfilter: 'SOURCE_FILTER_EXCLUDING_FAX_NUMBERS', ids: ['m1', 'm2'], nachrichten: NACHRICHTEN, listAufrufe });
  g.modul.run();
  const zeilen = g.log.join('\n');
  pruefe('kein labelIds gesetzt', listAufrufe[0].labelIds === undefined, listAufrufe[0].labelIds);
  pruefe('gesperrte Nummer ausgeschlossen', /ausgeschlossene Fax-Nummer/.test(zeilen), zeilen);
  pruefe('freie Nummer extrahiert', g.driveCreate.some((n) => /\.01\.zip$/.test(n)), g.driveCreate);
  pruefe('Kennzeichnung gedreht',
    /Ausschluss über Fax-Nummern.*\[WIRKSAM\]/.test(zeilen) && /Einschluss über E-Mail-Label.*\[ruht\]/.test(zeilen));
}

console.log('\n4 · Zwischenstand stammt vom anderen Quellfilter');
{
  let meldung = '';
  try {
    lade({
      ids: ['m1'], nachrichten: NACHRICHTEN,
      protokollDatei: {
        name: '2026-06-12_export_09-15-30_faxversand_protokoll.json',
        inhalt: {
          archiveName: 'a_faxversand', exportName: 'faxversand', sourceFilteredBy: 'fax-numbers',
          ids: ['m1'], nextIndex: 0, nextPart: 1, folderId: 'f', teile: []
        }
      }
    }).modul.run();
  } catch (e) { meldung = e.message; }
  pruefe('Abbruch nennt beide Quellfilter', /fax-numbers/.test(meldung) && /email-label/.test(meldung), meldung);
}

console.log('\n5 · Index und Namen');
{
  const t = lade({ ids: [], nachrichten: {} }).modul.ns._test;
  pruefe('Teil 1 → 01', t.teilIndex_(1) === '01', t.teilIndex_(1));
  pruefe('Teil 9 → 09', t.teilIndex_(9) === '09');
  pruefe('Teil 10 → 10', t.teilIndex_(10) === '10');
  pruefe('Teil 99 → 99', t.teilIndex_(99) === '99');
  let meldung = '';
  try { t.teilIndex_(100); } catch (e) { meldung = e.message; }
  pruefe('Teil 100 bricht ab', /überschreitet den zweistelligen Index/.test(meldung), meldung);
  pruefe('README.01.txt', t.buildReadmeName_(1) === 'README.01.txt', t.buildReadmeName_(1));
  pruefe('ZIP-Name', t.teilArchivName_('2026-06-12_export_09-15-30_faxversand', 1)
    === '2026-06-12_export_09-15-30_faxversand.01.zip');
}

console.log('\n6 · Empfängerzerlegung');
{
  const t = lade({ ids: [], nachrichten: {} }).modul.ns._test;
  pruefe('Anzeigename mit Komma',
    JSON.stringify(t.parseEmpfaenger_('"Kanzlei, Dr. A" <a@simple-fax.de>')) === '["a@simple-fax.de"]');
  pruefe('Groß- und Kleinschreibung vereinheitlicht',
    JSON.stringify(t.parseEmpfaenger_('A@Simple-Fax.DE')) === '["a@simple-fax.de"]');
  pruefe('zwei Empfänger', t.parseEmpfaenger_('a@x.de, b@y.de').length === 2);
  pruefe('leerer Header', t.parseEmpfaenger_('').length === 0);
}

console.log('\n' + (fehler === 0 ? '✓ Alle Prüfungen bestanden.' : '✗ ' + fehler + ' Beanstandung(en).'));
process.exit(fehler === 0 ? 0 : 1);
