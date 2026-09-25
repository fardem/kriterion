#!/usr/bin/env node
/* Der Gegenprobentreiber. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

/* ================= Die Rueckbauten ================= */
const REGRESSIONS = [
  /* ---- Der Versand: das Offline-Prinzip ---- */
  {
    nr: '01', name: 'Der Token entsteht erst NACH dem Versand',
    file: 'server.js',
    search: "    const v = await sendTokenLink(target, token, localeOf(req));",
    replacement: "    const v = await sendTokenLink(target, token, localeOf(req)); if (v.delivery !== 'ok') throw new Error('Versand fehlgeschlagen');",
    expected: 'Der Mailversand: das Offline-Prinzip in beide Richtungen'
  },
  {
    nr: '02', name: 'Der Link faellt aus der Antwort, wenn der Versand traegt',
    file: 'server.js',
    search: "               withoutPassword: token.withoutPassword,\n               ...linkInfo(token.plain), ...v });",
    replacement: "               ohnePasswort: token.ohnePasswort,\n               ...(v.versand === 'ok' ? { link: null, linkQuelle: 'browser' } : linkInfo(token.plain)), ...v });",
    expected: 'Der Mailversand: das echte SMTP-Gespraech'
  },
  {
    nr: '03', name: 'Das Feld versand faellt ganz weg',
    file: 'server.js',
    search: "  return e.ok ? { delivery: 'ok', deliveryReason: '' }",
    replacement: "  return e.ok ? {}",
    expected: 'Der Mailversand: das echte SMTP-Gespraech'
  },
  {
    nr: '04', name: 'Der Grund faellt weg -- "aus" steht ohne Auskunft da',
    file: 'server.js',
    search: "    return { delivery: 'aus', deliveryReason: t(readerLocale, 'mail.noAccount') };",
    replacement: "    return { versand: 'aus' };",
    expected: 'Der Mailversand: das Offline-Prinzip in beide Richtungen'
  },
  /* ---- Der Versand: die Frist ---- */
  {
    nr: '05', name: 'Die aeussere Schranke ueber dem Versand faellt weg',
    file: 'mail.js',
    /* Macht die Frist wirkungslos; der Promise.race bleibt stehen. */
    search: "      clock = setTimeout(() => error(late), SEND_MS);",
    replacement: "      uhr = setTimeout(() => {}, SEND_MS);",
    expected: 'Der Mailversand: die Frist wird gemessen, nicht behauptet'
  },
  {
    nr: '06', name: 'Die Fristen von nodemailer stehen wieder auf ihren Vorgaben',
    file: 'mail.js',
    search: "    connectionTimeout: CONNECT_MS, greetingTimeout: GREETING_MS, socketTimeout: SEND_MS,",
    replacement: "",
    expected: '(erwartet STUMM — die aeussere Schranke traegt die Zusage allein; nodemailers Fristen sind der schnellere, nicht der tragende Weg)'
  },
  /* ---- Der Versand: die oeffentliche Adresse ---- */
  {
    nr: '07', name: 'Ohne oeffentliche Adresse wird trotzdem verschickt',
    file: 'server.js',
    search: "  if (!PUBLIC.address)\n    return { delivery: 'aus', deliveryReason:",
    replacement: "  if (false)\n    return { versand: 'aus', versandGrund:",
    expected: 'Der Mailversand: die oeffentliche Adresse ist Pflicht'
  },
  {
    nr: '08', name: 'Die Adresse wird aus dem Host-Kopf abgeleitet',
    file: 'server.js',
    search: "    username: target.username, link: `${PUBLIC.address}/#/invite/${token.plain}`,",
    replacement: "    username: ziel.username, link: `https://${'HOSTKOPF'}/#/invite/${token.plain}`,",
    expected: 'Der Mailversand: die oeffentliche Adresse ist Pflicht'
  },
  /* ---- Der Versand: der Empfaenger am Zugang ---- */
  {
    nr: '09', name: 'Ein Zugang ohne Adresse wird trotzdem beschickt',
    file: 'server.js',
    search: "  if (!target.email)",
    replacement: "  if (false)",
    expected: 'Der Versandzustand neben dem Link'
  },
  {
    nr: '10', name: 'Die Adresse laesst sich beim Anlegen nicht mehr mitgeben',
    file: 'auth.js',
    search: "    .run(clean, hash, role, mailAddress || null);",
    replacement: "    .run(sauber, hash, rolle, null);",
    expected: 'Der Mailversand: das echte SMTP-Gespraech'
  },
  {
    nr: '11', name: 'Die eigene Adresse laesst sich nicht mehr setzen',
    file: 'auth.js',
    search: "    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(address || null, u.id);",
    replacement: "    db.prepare('UPDATE users SET email = email WHERE id = ?').run(u.id);",
    expected: 'Der Mailversand: die Testmail geht an die eigene Adresse'
  },
  /* ---- Die Testmail ---- */
  {
    nr: '12', name: 'Die Testmail nimmt die Adresse aus dem Rumpf',
    file: 'server.js',
    search: "  const ownOne = auth.getUser2(req.user.id);",
    replacement: "  const eigener = { ...auth.getUser2(req.user.id), email: (req.body || {}).an || auth.getUser2(req.user.id)?.email };",
    expected: 'Der Mailversand: die Testmail geht an die eigene Adresse'
  },
  {
    nr: '13', name: 'Die Absage ohne eigene Adresse nennt den Weg dorthin nicht',
    file: 'public/languages/de.json',
    search: "\"server.ownEmailMissing\": \"Für deinen Account ist keine E-Mail-Adresse hinterlegt. Bitte unter Einstellungen › Mein Account eintragen — die Testmail geht ausschließlich an die eigene Adresse.\",",
    replacement: "\"server.ownEmailMissing\": \"Für deinen Account ist keine E-Mail-Adresse hinterlegt.\",",
    expected: 'Der Mailversand: die Testmail geht an die eigene Adresse'
  },
  {
    nr: '14', name: 'Die Marke gilt auch nach einer Aenderung am Zugang weiter',
    file: 'server.js',
    /* mailTestState() rechnet fuer die Karte und fuer den Schalter der
       Selbstanmeldung. */
    search: "  return test && test.mark && test.mark === mail.mark(raw) ? test : null;",
    replacement: "  return test || null;",
    expected: 'Der Mailversand: die Testmail geht an die eigene Adresse'
  },
  /* ---- Die Rollenleiter am Mailzugang ---- */
  {
    nr: '15', name: 'Der Mailzugang steht auch dem Admin offen',
    file: 'server.js',
    search: "app.put('/api/mail', ownerOnly, secondConfirmNeeded('mail'), (req, res) => {",
    replacement: "app.put('/api/mail', adminOnly, secondConfirmNeeded('mail'), (req, res) => {",
    expected: 'Der Mailzugang: wer ihn setzen darf'
  },
  {
    nr: '16', name: 'Die Testmail steht auch dem Admin offen',
    file: 'server.js',
    search: "app.post('/api/mail/test', ownerOnly, async (req, res) => {",
    replacement: "app.post('/api/mail/test', adminOnly, async (req, res) => {",
    expected: 'Der Mailzugang: wer ihn setzen darf'
  },
  {
    nr: '17', name: 'Die zweite Bestaetigung faellt am Mailzugang weg',
    file: 'server.js',
    search: "app.put('/api/mail', ownerOnly, secondConfirmNeeded('mail'), (req, res) => {",
    replacement: "app.put('/api/mail', ownerOnly, (req, res) => {",
    expected: 'Der Mailzugang: wer ihn setzen darf'
  },
  /* ---- Das Passwort ---- */
  {
    nr: '18', name: 'Das Mailpasswort steht in der Antwort',
    file: 'server.js',
    search: "app.get('/api/mail', ownerOnly, (req, res) => res.json(mailCard(req)));",
    replacement: "app.get('/api/mail', ownerOnly, (req, res) => res.json({ ...mailCard(req), passwort: mail.resolve(getSetting(mail.SETTING_KEY, null)).passwort }));",
    expected: 'Der Mailversand: das echte SMTP-Gespraech'
  },
  {
    nr: '19', name: 'Das Mailpasswort geht in die Kontrollausgabe',
    file: 'server.js',
    search: "        `(${z.secure ? 'TLS' : 'STARTTLS'}), sender ${z.sender}.` +",
    replacement: "        `(${z.secure ? 'TLS' : 'STARTTLS'}), sender ${z.sender}, password ${mail.resolve(roh).passwort}.` +",
    expected: 'Der Mailversand: das Passwort steht nirgends'
  },
  /* ---- Die Anbietervorlagen ---- */
  {
    nr: '20', name: 'Ein mitgeschickter Server ueberschreibt die Vorlage',
    file: 'mail.js',
    search: "  return { ...z, server: v.server, port: v.port, secure: v.secure };",
    replacement: "  return { ...z, server: z.server || v.server, port: z.port || v.port, secure: z.secure === true };",
    expected: 'Der Mailzugang: wer ihn setzen darf'
  },
  {
    nr: '21', name: 'Ein unbekannter Anbieter wird durchgelassen',
    file: 'mail.js',
    search: "  if (!v) throw message('mail.providerUnknown');",
    replacement: "  const vv = v;",
    expected: 'Der Mailzugang: wer ihn setzen darf'
  },
  /* ---- Die Frist ab dem ersten Oeffnen ---- */
  {
    nr: '22', name: 'Das erste Oeffnen startet die Frist nicht',
    file: 'server.js',
    search: "  const minutes = auth.startTokenDeadline(token.hash);",
    replacement: "  const minuten = auth.TOKEN_DEADLINE_MINUTES;",
    expected: 'Der Token: die Frist ab dem ersten Oeffnen'
  },
  {
    nr: '23', name: 'Jedes Oeffnen schiebt die Frist weiter',
    file: 'auth.js',
    search: "    WHERE hash = ? AND used_at IS NULL AND expires_at > datetime('now', ?)`);",
    replacement: "    WHERE hash = ? AND used_at IS NULL AND ? IS NOT NULL`);",
    expected: 'Der Token: die Frist ab dem ersten Oeffnen'
  },
  {
    nr: '24', name: 'Die Absage nach der Frist bekommt einen eigenen Wortlaut',
    file: 'public/languages/de.json',
    search: "\"server.linkExpired\": \"Dieser Link gilt nicht mehr. Bitte beim Admin einen neuen anfordern.\",",
    replacement: "\"server.linkExpired\": \"Die Frist von 15 Minuten ist abgelaufen.\",",
    expected: 'Der Token: die Absage sieht immer gleich aus'
  },
  /* ---- Die voruebergehende Absage ---- */
  {
    nr: '25', name: 'Jede Absage wirft den Schluessel wieder aus der Adresse',
    file: 'public/app.js',
    search: "    if (res.status === 400) {",
    replacement: "    if (!res.ok) {",
    expected: 'Die Einladungsseite in der Oberflaeche'
  },
  {
    nr: '26', name: 'Der zweite Anlauf nach der Bremse faellt weg',
    file: 'public/app.js',
    search: "    document.getElementById('eb-again').onclick = () => showInvite(key);",
    replacement: "    document.getElementById('eb-again').onclick = () => {};",
    expected: 'Die Einladungsseite in der Oberflaeche'
  },
  /* ---- Die Oberflaeche ---- */
  {
    /* Zielt auf den Abruf, nicht auf die Bedingung der Karte. */
    nr: '27', name: 'Der Mailzugang wird auch fuer den Admin geholt',
    file: 'public/app.js',
    search: "      ADMIN ? api('GET', '/api/requests') : null",
    replacement: "      ADMIN ? api('GET', '/api/mail') : null",
    expected: 'Die Karten des Systembereichs nach Rolle (viele rot — der Abruf reisst den ganzen Bereich mit)'
  },
  {
    nr: '28', name: 'Der Versandzustand verschwindet aus dem Linkkasten',
    file: 'public/app.js',
    search: "      ${deliveryRow(d)}",
    replacement: "      ",
    expected: 'Der Versandzustand neben dem Link'
  },
  {
    nr: '29', name: 'Das Adressfeld am eigenen Zugang schickt nichts mehr mit',
    file: 'public/app.js',
    search: "        oldPassword: old, username: name, newPassword: new1, email: address",
    replacement: "        oldPassword: alt, username: name, newPassword: neu1",
    expected: 'Die eigene Adresse in der Karte „Zugang“'
  },
  {
    nr: '30', name: 'Die Frist steht nicht mehr auf der Einladungsseite',
    file: 'public/app.js',
    search: "        ${status.minutes ? `${tH('login.linkValidHint', { n: status.minutes })}` : ''}",
    replacement: "        ${false ? `${tH('login.linkValidHint', { n: status.minutes })}` : ''}",
    expected: 'Die Einladungsseite in der Oberflaeche'
  },
  /* ---- Die Selbstanmeldung: die immer gleiche Antwort ---- */
  {
    nr: '31', name: 'Die Antwort verraet, dass still verworfen wurde',
    file: 'server.js',
    search: "  res.json(requestAnswer(localeOf(req)));",
    replacement: "  res.json(plain ? requestAnswer(localeOf(req)) : { ok: false, error: 'Name oder Adresse ist schon vergeben.' });",
    expected: 'Die Selbstanmeldung: die immer gleiche Antwort'
  },
  {
    nr: '32', name: 'Die Antwort wartet wieder auf den Mailserver',
    file: 'server.js',
    search: "  const plain = an ? auth.createRequest(name, address) : null;",
    replacement: "  const plain = an ? auth.createRequest(name, adresse) : null;\n" +
            "  if (klartext) await sendConfirm(String(name).trim(), String(adresse).trim(), klartext).catch(() => {});",
    expected: 'Die Selbstanmeldung: die immer gleiche Antwort'
  },
  {
    nr: '33', name: 'Der Schalter aus fuehrt zu einer eigenen Absage',
    file: 'server.js',
    search: "  const an = getSetting('signup', false) === true;",
    replacement: "  const an = getSetting('signup', false) === true;\n" +
            "  if (!an) return res.status(403).json({ error: 'Die Selbstanmeldung ist ausgeschaltet.' });",
    expected: 'Die Selbstanmeldung: der Schalter aus'
  },
  /* ---- Die Selbstanmeldung: der Deckel und die stille Verwerfung ---- */
  {
    nr: '34', name: 'Der Deckel faellt ganz weg',
    file: 'auth.js',
    search: "  if (countRequests() >= REQUEST_CAP) return null;",
    replacement: "  if (false) return null;",
    expected: 'Die Selbstanmeldung: der Deckel'
  },
  {
    nr: '35', name: 'Der Deckel zaehlt nur die BESTAETIGTEN',
    file: 'auth.js',
    search: "  if (countRequests() >= REQUEST_CAP) return null;",
    replacement: "  if (db.prepare('SELECT COUNT(*) n FROM requests WHERE confirmed_at IS NOT NULL').get().n >= REQUEST_CAP) return null;",
    expected: 'Die Selbstanmeldung: der Deckel'
  },
  {
    nr: '36', name: 'Eine zweite Anfrage je Adresse geht durch',
    file: 'auth.js',
    search: "  if (qRequestMail.get(post)) return null;",
    replacement: "  if (false) return null;",
    expected: 'Die Selbstanmeldung: die immer gleiche Antwort'
  },
  {
    nr: '37', name: 'Ein vergebener Benutzername kommt in die Warteschlange',
    file: 'auth.js',
    search: "  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(clean)) return null;",
    replacement: "  if (false) return null;",
    expected: 'Die Selbstanmeldung: die immer gleiche Antwort'
  },
  {
    nr: '38', name: 'Eine vergebene Adresse ebenso',
    file: 'auth.js',
    search: "  if (qUserMail.get(post)) return null;",
    replacement: "  if (false) return null;",
    expected: 'Die Selbstanmeldung: die immer gleiche Antwort'
  },
  {
    nr: '67', name: 'Derselbe Wunschname darf zweimal in der Warteschlange stehen',
    file: 'auth.js',
    search: "  if (qRequestName.get(clean)) return null;",
    replacement: "  if (false) return null;",
    expected: 'Die Selbstanmeldung: die immer gleiche Antwort'
  },
  {
    nr: '39', name: 'Name und Adresse von aussen sind wieder unbegrenzt lang',
    file: 'auth.js',
    search: "  if (clean.length > REQUEST_NAME_MAX || post.length > REQUEST_MAIL_MAX) return null;",
    replacement: "  if (false) return null;",
    expected: 'Die Selbstanmeldung: die immer gleiche Antwort'
  },
  /* ---- Die Selbstanmeldung: das Verfallen ---- */
  {
    nr: '40', name: 'Unbestaetigte Anfragen verfallen nicht mehr',
    file: 'auth.js',
    search: "  const n = delRequestsOld.run(`-${REQUEST_HOURS} hours`).changes;",
    replacement: "  const n = 0;",
    expected: 'Die Selbstanmeldung: das Verfallen und das Aufraeumen'
  },
  {
    nr: '41', name: 'Auch die BESTAETIGTEN verfallen',
    file: 'auth.js',
    search: "  \"DELETE FROM requests WHERE confirmed_at IS NULL AND created_at < datetime('now', ?)\");",
    replacement: "  \"DELETE FROM requests WHERE created_at < datetime('now', ?)\");",
    expected: 'Die Selbstanmeldung: das Verfallen und das Aufraeumen'
  },
  {
    nr: '42', name: 'Die Anfrageroute raeumt nicht mehr vor der Deckelpruefung auf',
    file: 'auth.js',
    search: "  cleanupRequests();\n  if (countRequests() >= REQUEST_CAP) return null;",
    replacement: "  if (countRequests() >= REQUEST_CAP) return null;",
    expected: 'Die Selbstanmeldung: das Verfallen und das Aufraeumen'
  },
  /* ---- Die Selbstanmeldung: der Schalter und seine Kopplung ---- */
  {
    nr: '43', name: 'Der Schalter laesst sich ohne durchgekommene Testmail einschalten',
    file: 'server.js',
    search: "  if (!mailTestState(raw))",
    replacement: "  if (false)",
    expected: 'Die Selbstanmeldung: der Schalter braucht drei Dinge'
  },
  {
    nr: '44', name: 'Der Schalter laesst sich ohne oeffentliche Adresse einschalten',
    file: 'server.js',
    search: "  if (!mailTestState(raw)) return { ok: false, key: 'server.noTestMail' };\n  if (!PUBLIC.address)",
    replacement: "  if (!mailTestState(raw)) return { ok: false, key: 'server.noTestMail' };\n  if (false)",
    expected: 'Die Selbstanmeldung: der Schalter braucht drei Dinge'
  },
  {
    nr: '46', name: 'Ausschalten wird an dieselbe Bedingung gehaengt wie Einschalten',
    file: 'server.js',
    search: "  if (an) {\n    const b = deliveryReady();",
    replacement: "  if (true) {\n    const b = versandBereit();",
    expected: 'Die Selbstanmeldung: der Schalter aus'
  },
  {
    nr: '47', name: 'Der Schalter legt sich bei kaputtem Versand selbst um',
    file: 'server.js',
    search: "    an: getSetting('signup', false) === true,\n    deliveryReady: b.ok,",
    replacement: "    an: getSetting('signup', false) === true && b.ok,\n    versandBereit: b.ok,",
    expected: 'Die Selbstanmeldung: die immer gleiche Antwort'
  },
  /* ---- Die Selbstanmeldung: der Bestaetigungslink ---- */
  {
    nr: '48', name: 'Der Bestaetigungsschluessel steht im Klartext in der Tabelle',
    file: 'auth.js',
    search: "    .run(tokenHash(plain), clean, post);",
    replacement: "    .run(klartext, sauber, post);",
    expected: 'Die Selbstanmeldung: die Bestaetigungsmail'
  },
  {
    nr: '49', name: 'Die Bestaetigung nimmt jeden Schluessel an',
    file: 'auth.js',
    search: "  return setConfirmed.run(tokenHash(raw), `-${REQUEST_HOURS} hours`).changes > 0;",
    replacement: "  setConfirmed.run(tokenHash(roh), `-${REQUEST_HOURS} hours`); return true;",
    expected: 'Die Selbstanmeldung: der Bestaetigungslink hat keine Passwortkraft'
  },
  {
    nr: '50', name: 'Die Karte gibt den Hash der Anfrage mit heraus',
    file: 'auth.js',
    search: "  `SELECT id, username, email, created_at, confirmed_at\n     FROM requests WHERE confirmed_at IS NOT NULL",
    replacement: "  `SELECT id, username, email, created_at, confirmed_at, hash\n     FROM requests WHERE confirmed_at IS NOT NULL",
    expected: 'Die Selbstanmeldung: die Freischaltung'
  },
  {
    nr: '51', name: 'Die unbestaetigte Anfrage erscheint beim Admin',
    file: 'auth.js',
    search: "     FROM requests WHERE confirmed_at IS NOT NULL ORDER BY confirmed_at ASC, id ASC`);",
    replacement: "     FROM requests ORDER BY created_at ASC, id ASC`);",
    expected: 'Die Selbstanmeldung: die unbestaetigte Anfrage'
  },
  {
    nr: '52', name: 'Die unbestaetigte Anfrage laesst sich freischalten',
    file: 'server.js',
    search: "  const a = auth.getRequest(req.params.id);\n  if (!a || !a.confirmed_at)\n    return res.status(404).json({ error: t(localeOf(req), 'server.requestUnknown')});\n  let created, token;",
    replacement: "  const a = auth.getRequest(req.params.id);\n  if (!a)\n    return res.status(404).json({ error: t(localeOf(req), 'server.requestUnknown')});\n  let angelegt, token;",
    expected: 'Die Selbstanmeldung: die unbestaetigte Anfrage'
  },
  /* ---- Die Selbstanmeldung: Freischaltung, Ablehnung, Rolle ---- */
  {
    nr: '53', name: 'Die Rolle kommt aus dem Rumpf der Anfrage',
    file: 'server.js',
    search: "    created = await auth.createUser(a.username, null, 'user', true, req.user.id, a.email);",
    replacement: "    angelegt = await auth.createUser(a.username, null, (req.body || {}).rolle || 'user', true, req.user.id, a.email);",
    expected: 'Die Selbstanmeldung: die Rolle ist immer user'
  },
  {
    nr: '54', name: 'Die Zeile bleibt nach der Freischaltung stehen',
    file: 'server.js',
    search: "  auth.removeRequest(a.id);\n  /* Der Protokolleintrag nennt den neuen Zugang",
    replacement: "  /* Der Protokolleintrag nennt den neuen Zugang",
    expected: 'Die Selbstanmeldung: die Freischaltung'
  },
  {
    nr: '55', name: 'Die Freischaltung erzeugt keinen Token',
    file: 'server.js',
    search: "    token = auth.createToken(created.id, 'invite', req.user.id);",
    replacement: "    token = { klartext: 'x'.repeat(64), zweck: 'invite', tage: 7, id: angelegt.id, username: angelegt.username };",
    expected: 'Die Selbstanmeldung: die Freischaltung'
  },
  {
    nr: '56', name: 'Die Protokollzeile der Freischaltung faellt weg',
    file: 'server.js',
    search: "  auth.log('request.approve', { actor: req.user.id, target: created.id });",
    replacement: "  // auth.log('request.approve', { wer: req.user.id, ziel: angelegt.id });",
    expected: 'Die Selbstanmeldung: die Freischaltung'
  },
  {
    nr: '57', name: 'Die Ablehnung entfernt die Zeile nicht',
    file: 'server.js',
    search: "  auth.removeRequest(a.id);\n  auth.log('request.reject', { actor: req.user.id });",
    replacement: "  auth.log('request.reject', { wer: req.user.id });",
    expected: 'Die Selbstanmeldung: die Ablehnung'
  },
  {
    nr: '58', name: 'Der Name des Abgewiesenen soll ins Protokoll',
    file: 'server.js',
    search: "  auth.log('request.reject', { actor: req.user.id });",
    replacement: "  auth.log('request.reject', { wer: req.user.id, merkmal: a.username });",
    expected: 'Die Selbstanmeldung: die Ablehnung'
  },
  {
    nr: '59', name: 'Die Anfrage selbst schreibt eine Protokollzeile',
    file: 'server.js',
    search: "  const plain = an ? auth.createRequest(name, address) : null;",
    replacement: "  const plain = an ? auth.createRequest(name, adresse) : null;\n" +
            "  if (klartext) auth.log('request.approve', { wer: 1 });",
    expected: 'Die Selbstanmeldung: keine Zeile, die ein Fremder ausloesen kann'
  },
  /* ---- Die Selbstanmeldung: die Bremse ---- */
  {
    nr: '60', name: 'Die Bremse fehlt an der Anfrageroute',
    file: 'server.js',
    search: "app.post('/api/signup', async (req, res) => {\n  if (!await tokenThrottleFree(req, res)) return;",
    replacement: "app.post('/api/signup', async (req, res) => {",
    expected: 'Die Selbstanmeldung: die Bremse greift an beiden Routen'
  },
  {
    nr: '61', name: 'Die Bremse fehlt an der Bestaetigungsroute',
    file: 'server.js',
    search: "  const ip = auth.clientIp(req);\n  if (!await tokenThrottleFree(req, res)) return;\n  if (!auth.confirmRequest((req.body || {}).key)) {",
    replacement: "  const ip = auth.clientIp(req);\n  if (!auth.confirmRequest((req.body || {}).schluessel)) {",
    expected: 'Die Selbstanmeldung: die Bremse greift an beiden Routen'
  },
  /* ---- Die Selbstanmeldung in der Oberflaeche ---- */
  {
    nr: '62', name: 'Das Anfrageformular steht auch bei ausgeschaltetem Schalter da',
    file: 'public/app.js',
    search: "    ${SIGNUP ? `<p class=\"sub login-divider\">${tH('login.noAccountYet')}</p>",
    replacement: "    ${true ? `<p class=\"sub login-divider\">${tH('login.noAccountYet')}</p>",
    expected: 'Die Anmeldeseite: das Anfrageformular'
  },
  {
    /* Die Bedingung steht als Feld `visible` in SYS_CARDS, nicht im Markup. */
    nr: '63', name: 'Die Karte „Anfragen“ verschwindet, solange der Schalter aus ist',
    file: 'public/app.js',
    search: "visible: (g) => ADMIN && !!g.requests,",
    replacement: "sichtbar: (g) => ADMIN && !!g.anfragen && (g.anfragen.an || g.anfragen.anfragen.length),",
    expected: 'Die Karten im Systembereich'
  },
  {
    nr: '68', name: 'Der Weg zur Anfrage wird wieder ein Verweis statt eines Knopfes',
    file: 'public/app.js',
    search: "      <button class=\"btn login-alt\" id=\"l-request\">${tH('login.requestAccess')}</button>",
    replacement: "      <a href=\"#\" id=\"l-request\">${tH('login.requestAccess')}</a>",
    expected: 'Die Anmeldeseite: das Anfrageformular'
  },
  {
    nr: '69', name: 'Der gedaempfte Knopf verliert auch seine Umrandung',
    file: 'public/style.css',
    search: "  background: var(--accent-dim); border-color: var(--accent-line);",
    replacement: "  background: var(--accent-dim); border-color: transparent;",
    expected: 'Die Anmeldeseite: das Anfrageformular'
  },
  {
    nr: '73', name: 'Der Strich ueber dem Anfrageknopf kommt zurueck',
    file: 'public/style.css',
    search: "  margin: 28px 0 0; font-size: .87rem;",
    replacement: "  margin: 22px 0 0; padding-top: 18px; border-top: 1px solid var(--line); font-size: .87rem;",
    expected: 'Die Anmeldeseite: das Anfrageformular'
  },
  {
    /* Ohne Strich und ohne Abstand stoesst der Knopf an den Anmeldeknopf. */
    nr: '74', name: 'Und der Abstand, der ihn ersetzt, schrumpft auf nichts',
    file: 'public/style.css',
    search: "  margin: 28px 0 0; font-size: .87rem;",
    replacement: "  margin: 10px 0 0; font-size: .87rem;",
    expected: 'Die Anmeldeseite: das Anfrageformular'
  },
  {
    nr: '75', name: 'Der Anfrageknopf verliert seine leichte Faerbung',
    file: 'public/style.css',
    search: "  background: var(--accent-dim); border-color: var(--accent-line);",
    replacement: "  background: transparent; border-color: var(--line);",
    expected: 'Die Anmeldeseite: das Anfrageformular'
  },
  {
    nr: '76', name: 'Der Anfrageknopf wird so laut wie "Anmelden"',
    file: 'public/style.css',
    search: "  background: var(--accent-dim); border-color: var(--accent-line);",
    replacement: "  background: var(--accent); border-color: var(--accent);",
    expected: 'Die Anmeldeseite: das Anfrageformular'
  },
  {
    nr: '64', name: 'Die rote Zeile bei kaputtem Versand faellt weg',
    file: 'public/app.js',
    search: "        ${requests.an && !requests.deliveryReady ? `<p class=\"warn-box\" id=\"signup-broken\"",
    replacement: "        ${false ? `<p class=\"warn-box\" id=\"signup-broken\"",
    expected: 'Die Karte „Anfragen“'
  },
  {
    nr: '65', name: 'Die Bestaetigungsseite meldet gleich an',
    file: 'public/app.js',
    search: "  const best = (location.hash || '').match(/^#\\/confirm\\/([0-9a-f]{16,128})$/);\n  if (best) return showConfirm(best[1]);",
    replacement: "  const best = (location.hash || '').match(/^#\\/confirm\\/([0-9a-f]{16,128})$/);\n  if (best) return showInvite(best[1]);",
    expected: 'Die Bestaetigungsseite in der Oberflaeche'
  },
  /* ---- Die Marke der Instanz ---- */
  {
    nr: '70', name: 'Die Marke folgt dem Schema nicht mehr',
    file: 'public/app.js',
    search: '<path d="M8 6 V26" stroke="var(--brand-grey)"/>',
    replacement: '<path d="M8 6 V26" stroke="#838c95"/>',
    expected: 'Die Marke der Instanz'
  },
  {
    /* Mit dieser Klasse saesse die Marke in einem Kaestchen mit Rahmen und
       Fuellgrund. */
    nr: '71', name: 'Die Marke heisst wieder wie die Kommentarknoepfe',
    file: 'public/app.js',
    search: '<svg class="logo" viewBox=',
    replacement: '<svg class="mark" viewBox=',
    expected: 'Die Marke der Instanz'
  },
  {
    nr: '72', name: 'Der Tab bekommt kein Favicon mehr',
    file: 'public/index.html',
    search: '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
    replacement: '',
    expected: 'Die Marke der Instanz'
  },
  /* ---- Die Markenzeile der Anmeldeseiten ---- */
  {
    nr: '77', name: 'Marke und Name stapeln sich wieder uebereinander',
    file: 'public/app.js',
    search: '  `<div class="login-brand">${MARK(36)}<h1>${esc(TITLE_PUBLIC)}</h1></div>`;',
    replacement: '  `${MARK(40)}<h1>${esc(TITLE_PUBLIC)}</h1>`;',
    expected: 'Die Markenzeile der Anmeldeseiten'
  },
  {
    nr: '78', name: 'Erst das Wort, dann das Zeichen',
    file: 'public/app.js',
    search: '  `<div class="login-brand">${MARK(36)}<h1>${esc(TITLE_PUBLIC)}</h1></div>`;',
    replacement: '  `<div class="login-brand"><h1>${esc(TITLE_PUBLIC)}</h1>${MARK(36)}</div>`;',
    expected: 'Die Markenzeile der Anmeldeseiten'
  },
  {
    nr: '79', name: 'Die Markenzeile ist keine Zeile mehr',
    file: 'public/style.css',
    search: '  display: flex; align-items: center; gap: 11px; margin: 0 0 5px;',
    replacement: '  display: block; margin: 0 0 5px;',
    expected: 'Die Marke der Instanz'
  },
  {
    /* Mit Unterrand sitzt die Ueberschrift bei align-items: center um die
       halbe Hoehe zu hoch. */
    nr: '80', name: 'Die Ueberschrift in der Zeile traegt wieder einen Unterrand',
    file: 'public/style.css',
    search: '.login-card .login-brand h1 { margin: 0; }',
    replacement: '.login-card .login-brand h1 { margin: 0 0 5px; }',
    expected: 'Die Marke der Instanz'
  },
  {
    nr: '81', name: 'Dieselbe Datei liegt wieder unter zwei Namen in public/',
    file: 'public/favicon.svg',
    copy: 'public/marke-hell.svg',
    expected: 'Die Marke der Instanz'
  },
  /* ---- Der zweite Faktor: die Rechnung ---- */
  {
    nr: '82', name: 'Acht Ziffern statt sechs',
    file: 'twofactor.js',
    search: 'const DIGITS = 6;',
    replacement: 'const DIGITS = 8;',
    expected: 'Der zweite Faktor: die Rechnung gegen den Standard'
  },
  {
    nr: '83', name: 'SHA-256 statt SHA-1',
    file: 'twofactor.js',
    search: "const ALGORITHM = 'sha1';",
    replacement: "const ALGORITHM = 'sha256';",
    expected: 'Der zweite Faktor: die Rechnung gegen den Standard'
  },
  {
    nr: '84', name: 'Sechzig Sekunden statt dreissig',
    file: 'twofactor.js',
    search: 'const STEP_SECONDS = 30;',
    replacement: 'const STEP_SECONDS = 60;',
    expected: 'Der zweite Faktor: die Rechnung gegen den Standard'
  },
  {
    /* Dynamisches Abgreifen nach RFC 4226, Abschnitt 5.3. */
    nr: '85', name: 'Der Anfang des Abgreifens steht fest statt aus dem Hash zu kommen',
    file: 'twofactor.js',
    search: '  const o = h[h.length - 1] & 0x0f;',
    replacement: '  const o = 0;',
    expected: 'Der zweite Faktor: die Rechnung gegen den Standard'
  },
  {
    /* Der Zaehler ist acht Bytes gross. */
    nr: '86', name: 'Der Zaehler wird nur in seiner unteren Haelfte geschrieben',
    file: 'twofactor.js',
    search: "  z.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);",
    replacement: "  z.writeUInt32BE(0, 0);",
    expected: 'Der zweite Faktor: die Rechnung gegen den Standard'
  },
  /* ---- Der zweite Faktor: das Fenster und die Wiederverwendung ---- */
  {
    nr: '87', name: 'Das Fenster wird auf zwei Schritte geweitet',
    file: 'twofactor.js',
    search: 'const WINDOW = 1;',
    replacement: 'const WINDOW = 2;',
    expected: 'Der zweite Faktor: das Zeitfenster'
  },
  {
    nr: '88', name: 'Es gibt gar kein Nachbarfenster mehr',
    file: 'twofactor.js',
    search: 'const WINDOW = 1;',
    replacement: 'const WINDOW = 0;',
    expected: 'Der zweite Faktor: das Zeitfenster'
  },
  {
    /* Die Bedingung steht im UPDATE; der Rueckbau macht sie wirkungslos, statt
       sie zu entfernen. */
    nr: '89', name: 'Der verbrauchte Zaehler wird nicht mehr geprueft',
    file: 'auth.js',
    search: "    WHERE user_id = ? AND (last_counter IS NULL OR last_counter < ?)`);",
    replacement: "    WHERE user_id = ? AND (last_counter IS NULL OR ? IS NOT NULL)`);",
    expected: 'Der zweite Faktor: ein Code gilt genau einmal'
  },
  {
    nr: '90', name: 'Der verbrauchte Zaehler wird gar nicht erst geschrieben',
    file: 'auth.js',
    search: "    if (!useCounter.run(counter, id, counter).changes) return null;\n    return 'app';",
    replacement: "    return 'app';",
    expected: 'Der zweite Faktor: ein Code gilt genau einmal'
  },
  {
    nr: '91', name: 'Der bestaetigende Code beim Einschalten zaehlt nicht als verbraucht',
    file: 'auth.js',
    search: "    `UPDATE two_factor SET confirmed_at = datetime('now'), last_counter = ?\n      WHERE user_id = ?`).run(counter, id);",
    replacement: "    `UPDATE two_factor SET confirmed_at = datetime('now'), last_counter = NULL\n      WHERE user_id = ?`).run(id);",
    expected: 'Der zweite Faktor: ein Code gilt genau einmal'
  },
  /* ---- Der zweite Faktor: die Anmeldung ---- */
  {
    nr: '92', name: 'Die Anmeldung meldet auch mit zweitem Faktor gleich an',
    file: 'server.js',
    search: "  if (auth.twoFactorOn(user.id)) {\n    return res.json({ twoFactor: true, ...auth.createLoginTicket(user.id) });\n  }",
    replacement: "",
    expected: 'Der zweite Faktor: ohne Code kommt niemand herein'
  },
  {
    nr: '93', name: 'Die Absage verraet, ob der Zugang einen zweiten Faktor hat',
    file: 'server.js',
    search: "    return res.status(401).json({ error: t(localeOf(req), 'server.loginWrong')});",
    replacement: "    return res.status(401).json({ error: t(localeOf(req), 'server.loginWrong'),\n      zweifaktor: auth.twoFactorOn((auth.getUserByName(user) || {}).id) });",
    expected: 'Der zweite Faktor: die Auskunft kommt erst nach richtigem Passwort'
  },
  {
    nr: '94', name: 'Der Ausweis wird nicht verbraucht',
    file: 'auth.js',
    search: "  tickets.delete(k);\n  return Date.now() <= a.until ? a.id : null;",
    replacement: "  return Date.now() <= a.until ? a.id : null;",
    expected: 'Der zweite Faktor: ohne Code kommt niemand herein'
  },
  {
    /* Die Frist selbst ist im Prueflauf nicht messbar: jeder Lauf wartete zwei
       Minuten. */
    nr: '95', name: 'Der Ausweis bekommt eine eigene, laengere Frist',
    file: 'auth.js',
    search: 'const LOGIN_TICKET_MS = RELEASE_MS;',
    replacement: 'const LOGIN_TICKET_MS = 3600 * 1000;',
    expected: 'Der zweite Faktor: der Rundlauf'
  },
  {
    nr: '96', name: 'Die Benutzernummer im zweiten Schritt kommt aus dem Rumpf',
    file: 'server.js',
    search: "  const id = auth.useLoginTicket(ticket);",
    replacement: "  const id = Number((req.body || {}).id) || auth.useLoginTicket(ausweis);",
    expected: 'Der zweite Faktor: ohne Code kommt niemand herein'
  },
  /* ---- Der zweite Faktor: die Bremse ---- */
  {
    nr: '97', name: 'Die Bremse fehlt am zweiten Schritt',
    file: 'server.js',
    search: "  const throttle = auth.checkThrottle(ip, null);\n  if (throttle.blocked) {\n    return res.status(429).json({\n      error: t(localeOf(req), 'server.throttled', { seconds: throttle.retryInSec })});\n  }\n  if (throttle.delayMs) await new Promise(r => setTimeout(r, throttle.delayMs));\n  const id = auth.useLoginTicket(ticket);",
    replacement: "  const id = auth.useLoginTicket(ausweis);",
    expected: 'Der zweite Faktor: die Anmeldebremse greift am zweiten Schritt'
  },
  {
    nr: '123', name: 'Die Bremse steht wieder HINTER dem Ausweis',
    file: 'server.js',
    search: "  const throttle = auth.checkThrottle(ip, null);\n  if (throttle.blocked) {\n    return res.status(429).json({\n      error: t(localeOf(req), 'server.throttled', { seconds: throttle.retryInSec })});\n  }\n  if (throttle.delayMs) await new Promise(r => setTimeout(r, throttle.delayMs));\n  const id = auth.useLoginTicket(ticket);\n  if (!id) {\n    auth.noteFailure(ip, null);\n    return res.status(401).json({ error: t(localeOf(req), 'server.sessionExpired')});\n  }",
    replacement: "  const id = auth.useLoginTicket(ausweis);\n  if (!id) {\n    auth.noteFailure(ip, null);\n    return res.status(401).json({ error: t(localeOf(req), 'server.sessionExpired')});\n  }\n  const bremse = auth.checkThrottle(ip, null);\n  if (bremse.blocked) {\n    return res.status(429).json({\n      error: t(localeOf(req), 'server.throttled', { seconds: bremse.retryInSec })});\n  }\n  if (bremse.delayMs) await new Promise(r => setTimeout(r, bremse.delayMs));",
    expected: 'Der zweite Faktor: die Anmeldebremse greift am zweiten Schritt'
  },
  {
    nr: '98', name: 'Der Fehlversuch am zweiten Schritt wird nicht gezaehlt',
    file: 'server.js',
    search: "  if (!auth.checkTwoFactor(id, code)) {\n    auth.noteFailure(ip, name);",
    replacement: "  if (!auth.checkTwoFactor(id, code)) {",
    expected: 'Der zweite Faktor: die Anmeldebremse greift am zweiten Schritt'
  },
  {
    /* Steht noteSuccess direkt hinter der Passwortpruefung, loescht der erste
       Schritt den Zaehler, den der zweite aufbaut. */
    nr: '99', name: 'Der erste Schritt setzt den Zaehler der Bremse wieder zurueck',
    file: 'server.js',
    search: "  if (auth.twoFactorOn(user.id)) {\n    return res.json({ twoFactor: true, ...auth.createLoginTicket(user.id) });\n  }\n  auth.noteSuccess(ip, username);",
    replacement: "  auth.noteSuccess(ip, username);\n  if (auth.twoFactorOn(user.id)) {\n    return res.json({ zweifaktor: true, ...auth.createLoginTicket(user.id) });\n  }",
    expected: 'Der zweite Faktor: die Anmeldebremse greift am zweiten Schritt'
  },
  /* ---- Der zweite Faktor: die Wiederherstellungscodes ---- */
  {
    nr: '100', name: 'Die Wiederherstellungscodes liegen im Klartext in der Tabelle',
    file: 'auth.js',
    search: "    for (const k of plains) insertCode.run(tokenHash(k), id);",
    replacement: "    for (const k of klartexte) insCode.run(k, id);",
    expected: 'Der zweite Faktor: die Wiederherstellungscodes'
  },
  {
    nr: '101', name: 'Ein Wiederherstellungscode wird nicht verbraucht',
    file: 'auth.js',
    search: "    WHERE hash = ? AND user_id = ? AND used_at IS NULL`);",
    replacement: "    WHERE hash = ? AND user_id = ?`);",
    expected: 'Der zweite Faktor: die Wiederherstellungscodes'
  },
  {
    nr: '102', name: 'Es entstehen sieben Codes statt acht',
    file: 'twofactor.js',
    search: 'const RECOVERY_COUNT = 8;',
    replacement: 'const RECOVERY_COUNT = 7;',
    expected: 'Der zweite Faktor: die Rechnung gegen den Standard'
  },
  {
    nr: '103', name: 'Die alten Codes bleiben beim Erneuern stehen',
    file: 'auth.js',
    search: "    db.prepare('DELETE FROM two_factor_codes WHERE user_id = ?').run(id);\n    // tokenHash() wie in checkTwoFactor()",
    replacement: "    // tokenHash() wie in checkTwoFactor()",
    expected: 'Der zweite Faktor: die Wiederherstellungscodes'
  },
  /* ---- Der zweite Faktor: das Geheimnis ---- */
  {
    nr: '104', name: 'Das Geheimnis steht auch nach dem Bestaetigen in der Antwort',
    file: 'server.js',
    search: "    res.json(auth.turnTwoFactorOn(req.user.id, code, req.user.id));",
    replacement: "    res.json({ ...auth.turnTwoFactorOn(req.user.id, code, req.user.id),\n" +
            "      secret: db.prepare('SELECT secret g FROM two_factor WHERE user_id = ?').get(req.user.id).g });",
    expected: 'Der zweite Faktor: das Geheimnis kommt aus keiner Antwort'
  },
  {
    nr: '105', name: 'Die Karte "Zugang" gibt das Geheimnis mit heraus',
    file: 'server.js',
    search: "             twoFactor: auth.twoFactorState(req.user.id) });",
    replacement: "             zweifaktor: { ...auth.twoFactorState(req.user.id),\n" +
            "               secret: (db.prepare('SELECT secret g FROM two_factor WHERE user_id = ?').get(req.user.id) || {}).g } });",
    expected: 'Der zweite Faktor: das Geheimnis kommt aus keiner Antwort'
  },
  {
    nr: '106', name: 'Ein zweiter Start ueberschreibt einen laufenden zweiten Faktor',
    file: 'auth.js',
    search: "  if (twoFactorOn(id)) throw new Message('login.twoFactorAlreadyOn');",
    replacement: "",
    expected: 'Der zweite Faktor: das Geheimnis kommt aus keiner Antwort'
  },
  /* ---- Der zweite Faktor: der Tokenweg und der Admin ---- */
  {
    /* Sonst oeffnet ein Admin einen Ruecksetzlink fuer einen fremden Zugang
       selbst und ist ohne zweiten Faktor angemeldet. */
    nr: '107', name: 'Der Tokenweg meldet wieder gleich an',
    file: 'server.js',
    search: "  if (auth.twoFactorOn(result.id)) {\n    return res.json({\n      ok: true, username: result.username, twoFactor: true,\n      ...auth.createLoginTicket(result.id)\n    });\n  }",
    replacement: "",
    expected: 'Der zweite Faktor: der Tokenweg aus 0.8.80 fragt ebenfalls'
  },
  {
    nr: '108', name: 'Ein fremdes Passwort zu setzen raeumt den zweiten Faktor mit weg',
    file: 'auth.js',
    search: "async function setNewPassword(userId, newPassword, actor) {",
    replacement: "async function setNewPassword(userId, newPassword, wer) {\n" +
            "  db.prepare('DELETE FROM two_factor WHERE user_id = ?').run(Number(userId) || 0);",
    expected: 'Der zweite Faktor: ein Admin kommt an einen fremden nicht heran'
  },
  {
    /* Sonst streift ein Admin mit Sperren und Freigeben einen fremden zweiten
       Faktor ab. */
    nr: '109', name: 'Sperren raeumt den zweiten Faktor mit weg',
    file: 'auth.js',
    search: "    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);\n    db.prepare('DELETE FROM tokens WHERE user_id = ?').run(u.id);\n  }\n  log('user.status'",
    replacement: "    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);\n    db.prepare('DELETE FROM tokens WHERE user_id = ?').run(u.id);\n    db.prepare('DELETE FROM two_factor WHERE user_id = ?').run(u.id);\n  }\n  protokolliere('user.status'",
    expected: 'Der zweite Faktor: ein Admin kommt an einen fremden nicht heran'
  },
  {
    nr: '110', name: 'Ausschalten geht ohne Code',
    file: 'server.js',
    search: "  if (!await ownPasswordMatches(req, res, password)) return;\n  if (!auth.checkTwoFactor(req.user.id, code))\n    return res.status(403).json({ error: t(localeOf(req), auth.TWO_FACTOR_DENIAL)});\n  auth.turnTwoFactorOff(req.user.id, req.user.id);",
    replacement: "  if (!await ownPasswordMatches(req, res, passwort)) return;\n  auth.turnTwoFactorOff(req.user.id, req.user.id);",
    expected: 'Der zweite Faktor: der Rundlauf'
  },
  {
    nr: '111', name: 'usertool.js schaltet den zweiten Faktor nicht mehr ab',
    file: 'usertool.js',
    search: "  auth.turnTwoFactorOff(u.id, auth.FROM_HOST);",
    replacement: "  // auth.turnTwoFactorOff(u.id, auth.FROM_HOST);",
    expected: 'Der zweite Faktor: usertool.js auf dem Wirt'
  },
  /* ---- Der zweite Faktor: die zweite Bestaetigung ---- */
  {
    nr: '112', name: 'Die zweite Bestaetigung fragt den Code nicht mehr',
    file: 'server.js',
    search: "  if (auth.twoFactorOn(req.user.id) && !auth.checkTwoFactor(req.user.id, code)) {",
    replacement: "  if (false) {",
    expected: 'Der zweite Faktor: die zweite Bestaetigung fragt zusaetzlich'
  },
  {
    nr: '113', name: 'Das Bestaetigungsfenster zeigt sein Codefeld immer',
    file: 'public/app.js',
    search: "  confirmReason() + (TWO_FACTOR ? ' ' + t('dialog.twoFactorOn') : ''), TWO_FACTOR);",
    replacement: "  confirmReason() + (TWO_FACTOR ? ' ' + t('dialog.twoFactorOn') : ''), true);",
    expected: 'Die Karte „Zugang“: der zweite Faktor'
  },
  {
    nr: '114', name: 'Der Code wird VOR dem Passwort geprueft',
    file: 'server.js',
    search: "  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);\n  if (!row || !await auth.checkPassword(String(password || ''), row.password_hash)) {",
    replacement: "  if (auth.twoFactorOn(req.user.id) && !auth.checkTwoFactor(req.user.id, code))\n" +
            "    return res.status(403).json({ error: auth.TWO_FACTOR_DENIAL, zweifaktor: true });\n" +
            "  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);\n  if (!row || !await auth.checkPassword(String(password || ''), row.password_hash)) {",
    expected: 'Der zweite Faktor: die zweite Bestaetigung fragt zusaetzlich'
  },
  /* ---- Der zweite Faktor: die Tabellen und die Oberflaeche ---- */
  {
    nr: '115', name: 'Der Index auf zweifaktor_codes wird nicht mehr angelegt',
    file: 'db.js',
    search: 'CREATE INDEX IF NOT EXISTS idx_two_factor_codes_user ON two_factor_codes(user_id);',
    replacement: '',
    expected: 'Der zweite Faktor: die Tabellen legen sich selbst an'
  },
  {
    nr: '116', name: 'Der Zustand faellt aus der Antwort der Karte "Zugang"',
    file: 'server.js',
    search: "             twoFactor: auth.twoFactorState(req.user.id) });",
    replacement: "             });",
    expected: 'Die Karte „Zugang“: der zweite Faktor'
  },
  {
    nr: '117', name: 'Die Zahl der uebrigen Wiederherstellungscodes faellt weg',
    file: 'public/app.js',
    search: "          <strong>${tH('card.codesLeft', { codesLeft: status.codesOpen, codesTotal: status.codesTotal })}</strong>",
    replacement: "          <strong>vorhanden</strong>",
    expected: 'Die Karte „Zugang“: der zweite Faktor'
  },
  {
    nr: '118', name: 'Der Kasten sagt nicht mehr, dass die Codes nicht wiederkommen',
    file: 'public/app.js',
    search: "    boxId.innerHTML = `<strong>${tH('card.yourRecoveryCodes', { length: codes.length })}</strong>",
    replacement: "    kasten.innerHTML = `<strong>Deine ${codes.length} Wiederherstellungscodes.</strong>",
    expected: 'Die Karte „Zugang“: der zweite Faktor'
  },
  {
    nr: '122', name: 'Die Liste der Wiederherstellungscodes wird um einen gekuerzt',
    file: 'public/app.js',
    search: "      <div class=\"two-factor-codes\">${codes.map(c => `<span>${esc(c)}</span>`).join('')}</div>",
    replacement: "      <div class=\"two-factor-codes\">${codes.slice(1).map(c => `<span>${esc(c)}</span>`).join('')}</div>",
    expected: 'Die Karte „Zugang“: der zweite Faktor'
  },
  {
    nr: '119', name: 'Das Bestaetigungsfenster zeigt das Codefeld nie',
    file: 'public/app.js',
    search: "  confirmReason() + (TWO_FACTOR ? ' ' + t('dialog.twoFactorOn') : ''), TWO_FACTOR);",
    replacement: "  confirmReason() + (TWO_FACTOR ? ' ' + t('dialog.twoFactorOn') : ''), false);",
    expected: 'Die Karte „Zugang“: der zweite Faktor'
  },
  {
    nr: '120', name: 'Die Anmeldeseite geht ueber den zweiten Schritt hinweg',
    file: 'public/app.js',
    search: "      if (j.twoFactor) return showSecondFactor(j.ticket);",
    replacement: "",
    expected: 'Die Anmeldeseite: der zweite Schritt'
  },
  {
    nr: '121', name: 'F_ROUTEN kennt den zweiten Schritt der Anmeldung nicht',
    file: 'test/frame.js',
    search: "  ['POST',   '/api/login/second',                'offen'],",
    replacement: "",
    expected: 'Der Waechter ueber den Quelltext'
  },
  /* ---- Die Volltextsuche: der Weg ueberhaupt ---- */
  {
    nr: '124', name: 'Der Parameter q wird nicht mehr gelesen',
    file: 'server.js',
    search: "  const term = fulltextTerm(req.query.q);",
    replacement: "  const term = '';",
    expected: 'Die Volltextsuche'
  },
  {
    nr: '125', name: 'searchText steht wieder in der Antwort',
    file: 'server.js',
    search: "    delete it.description;",
    replacement: "    it.searchText = (it.title || '').toLowerCase();\n    delete it.description;",
    expected: 'searchText ist fort, und sonst nichts'
  },
  /* ---- Die sieben Quellen, einzeln ---- */
  /* `0 > 1` statt eines Glieds laesst die Oder-Kette stehen und nimmt genau
     eine Quelle heraus. */
  {
    nr: '126', name: 'Die Suche sieht den Titel nicht mehr an',
    file: 'server.js',
    search: "instr(kkl(i.title), :q) > 0",
    replacement: "0 > 1",
    expected: 'Die Volltextsuche'
  },
  {
    nr: '127', name: 'Und die Beschreibung nicht',
    file: 'server.js',
    search: "instr(kkl(i.description), :q) > 0",
    replacement: "0 > 1",
    expected: 'Die Volltextsuche'
  },
  {
    nr: '128', name: 'Und den Namen der Kategorie nicht',
    file: 'server.js',
    search: "instr(kkl(c.name), :q) > 0",
    replacement: "0 > 1",
    expected: 'Die Volltextsuche'
  },
  {
    nr: '129', name: 'Und die Tags am Eintrag nicht',
    file: 'server.js',
    search: "instr(kkl(t.name), :q) > 0",
    replacement: "0 > 1",
    expected: 'Die Volltextsuche'
  },
  {
    nr: '130', name: 'Und die Tags an den Testtagen nicht',
    file: 'server.js',
    search: "instr(kkl(tt.name), :q) > 0",
    replacement: "0 > 1",
    expected: 'Die Volltextsuche'
  },
  {
    nr: '131', name: 'Und die Adressen der Links nicht',
    file: 'server.js',
    search: "instr(kkl(l.url), :q) > 0",
    replacement: "0 > 1",
    expected: 'Die Volltextsuche'
  },
  {
    nr: '132', name: 'Und die Kommentartexte nicht',
    file: 'server.js',
    search: "instr(kkl(k.text), :q) > 0",
    replacement: "0 > 1",
    expected: 'Die Volltextsuche'
  },
  /* ---- Die Schreibung und die Wildcards ---- */
  {
    /* Nur die Unicode-Faltung faellt weg; ASCII wird weiter gefaltet, wie bei
       lower() und LIKE in SQLite. */
    nr: '133', name: 'Die Kleinschreibung faltet nur noch ASCII',
    file: 'db.js',
    search: "db.function('kkl', { deterministic: true }, searchFold);",
    replacement: "db.function('kkl', { deterministic: true }, (s) => (s === null ? '' : String(s).replace(/[A-Z]/g, (c) => c.toLowerCase())));",
    expected: 'Die Volltextsuche'
  },
  /* ---- Die eine Faltung der Suche ---- */
  {
    nr: '734', name: 'Die Nadel faltet wieder mit der Sprache des Lesers',
    file: 'server.js',
    search: "const fulltextTerm = (raw) => (typeof raw === 'string' ? searchFold(raw.trim()) : '');",
    replacement: "const fulltextTerm = (raw, locale = languageDefault()) => (typeof raw === 'string' ? raw.trim().toLocaleLowerCase(localeTag(locale)) : '');",
    expected: 'Die Befunde der Runde 0.24.4'
  },
  {
    nr: '736', name: 'Der Sprachwechsel nimmt das Vokabular nicht mit',
    file: 'public/app.js',
    search: "          takeVocabulary((await api('PUT', '/api/settings', { language: a.code })));",
    replacement: "          await api('PUT', '/api/settings', { language: a.code });",
    expected: 'Die Kacheln und der Leser — 0.24.4'
  },
  {
    /* Die Faltung von `ß` bleibt, nur der Schritt fuer `İ` und `ı` faellt
       weg. */
    nr: '735', name: 'Die vier i fallen nicht mehr auf eines',
    file: 'db.js',
    search: "  : String(s).toLowerCase().replace(/\\u0307/g, '').replace(/\\u0131/g, 'i')\n      .replace(/\\u00df/g, 'ss'));",
    replacement: "  : String(s).toLowerCase().replace(/\\u00df/g, 'ss'));",
    expected: 'Die Befunde der Runde 0.24.4'
  },
  {
    nr: '134', name: 'Der Titel wird wieder ueber LIKE gesucht -- Wildcards wirken',
    file: 'server.js',
    search: "instr(kkl(i.title), :q) > 0",
    replacement: "kkl(i.title) LIKE '%' || :q || '%'",
    expected: 'Die Volltextsuche'
  },
  {
    nr: '135', name: 'Die Liste ohne Begriff verschweigt die abgelehnten Eintraege',
    file: 'server.js',
    search: "  let rows = qAllItems.all();",
    replacement: "  let rows = qAllItems.all();\n  if (!fulltextTerm(req.query.q)) rows = rows.filter(r => !r.rejected);",
    expected: 'Die Volltextsuche'
  },
  /* ---- testDays und die Zeitleiste ---- */
  {
    nr: '136', name: 'testDays kommt wieder immer mit',
    file: 'server.js',
    search: "    if (timeline) it.testDays = testDaysPer.get(it.id) || [];",
    replacement: "    it.testDays = testDaysPerEntry(req.user.id).get(it.id) || [];",
    expected: 'testDays haengt an der Zeitleiste'
  },
  {
    nr: '137', name: 'testDays fehlt immer, auch mit eingeschalteter Zeitleiste',
    file: 'server.js',
    search: "    if (timeline) it.testDays = testDaysPer.get(it.id) || [];",
    replacement: "    if (false) it.testDays = testDaysPer.get(it.id) || [];",
    expected: 'testDays haengt an der Zeitleiste'
  },
  /* ---- Die Suche am Bildschirm ---- */
  {
    nr: '138', name: 'Der Debounce faellt weg -- jeder Anschlag fragt',
    file: 'public/app.js',
    search: "  searchClock = setTimeout(() => { searchClock = null; runSearch(); }, SEARCH_DELAY_MS);",
    replacement: "  sucheAusfuehren();",
    expected: 'Die Suche fragt den Server'
  },
  {
    nr: '139', name: 'Die Reihenfolge der Antworten wird nicht mehr geachtet',
    file: 'public/app.js',
    search: "    if (run !== searchRun) return;          // eine neuere Anfrage ist unterwegs",
    replacement: "",
    expected: 'Die Suche fragt den Server'
  },
  {
    nr: '140', name: 'Bei gescheiterter Suche wird die Liste leer',
    file: 'public/app.js',
    search: "    state.searchRunning = false; state.searchError = true;",
    replacement: "    state.suchLaeuft = false; state.suchFehler = true; state.items = [];",
    expected: 'Die Suche fragt den Server'
  },
  {
    nr: '141', name: 'Die Zaehlzeile nennt die Trefferzahl als Bestand',
    file: 'public/app.js',
    search: "    let z = `${state.inventory} ${vThing(state.inventory)}`",
    replacement: "    let z = `${state.items.length} ${vSache(state.items.length)}`",
    expected: 'Die Suche fragt den Server'
  },
  {
    nr: '142', name: 'Das Leeren holt den Bestand neu vom Server',
    file: 'public/app.js',
    search: "    state.items = state.all;\n    state.searchRunning = false; state.searchError = false;",
    replacement: "    state.items = await api('GET', '/api/items');\n    state.suchLaeuft = false; state.suchFehler = false;",
    expected: 'Die Suche fragt den Server'
  },
  /* ---- Die gespeicherten Ansichten ---- */
  {
    nr: '143', name: 'Die Ansichten sind kein persoenlicher Schluessel mehr',
    file: 'server.js',
    search: "                                'bellSeen', 'views', 'strip', 'theme', 'language'];",
    replacement: "                                'bellSeen', 'strip', 'theme', 'language'];",
    expected: 'Gespeicherte Ansichten'
  },
  {
    nr: '144', name: 'Der Deckel fuer Ansichten faellt weg',
    file: 'server.js',
    search: "    if (input.length > VIEWS_CAP)",
    replacement: "    if (false)",
    expected: 'Gespeicherte Ansichten'
  },
  {
    nr: '145', name: 'Zwei Ansichten duerfen wieder denselben Namen tragen',
    file: 'server.js',
    search: "      if (names.has(key))",
    replacement: "      if (false)",
    expected: 'Gespeicherte Ansichten'
  },
  {
    nr: '146', name: 'Die Ansichten werden geprueft, NACHDEM filters geschrieben ist',
    file: 'server.js',
    search: "  let viewsText = null;",
    replacement: "  let viewsText = null;\n  if (req.body.filters !== undefined)\n    putUserSetting(req.user.id, 'filters', JSON.stringify(req.body.filters));",
    expected: 'Gespeicherte Ansichten'
  },
  {
    nr: '147', name: 'Das Speichern einer Ansicht raeumt die gemerkte Stellung weg',
    file: 'server.js',
    search: "      if (viewsText !== null)\n        putUserSetting(req.user.id, 'views', viewsText);",
    replacement: "      if (viewsText !== null) {\n        putUserSetting(req.user.id, 'views', viewsText);\n        putUserSetting(req.user.id, 'filters', 'null');\n      }",
    expected: 'Gespeicherte Ansichten'
  },
  {
    nr: '148', name: 'Der Suchbegriff faellt aus der gespeicherten Ansicht',
    file: 'public/app.js',
    search: "const viewOutState = () => ({ filters: { ...state.filters }, q: state.search.trim() });",
    replacement: "const viewOutState = () => ({ filters: { ...state.filters }, q: '' });",
    expected: 'Gespeicherte Ansichten in der Oberflaeche'
  },
  {
    nr: '149', name: 'Eine geloeschte Kategorie bleibt in der angewandten Ansicht stehen',
    file: 'public/app.js',
    search: "  f.categoryIds = [...new Set(f.categoryIds)].filter(v =>\n    v === CATEGORY_NONE || state.categories.some(c => c.id === v));",
    replacement: "  f.categoryIds = [...new Set(f.categoryIds)];",
    expected: 'Gespeicherte Ansichten in der Oberflaeche'
  },
  /* ---- Die Doppelerkennung ---- */
  {
    nr: '150', name: 'Der Titelvergleich achtet wieder auf Gross- und Kleinschreibung',
    file: 'public/app.js',
    search: "const titleCore = (raw) => String(raw || '').toLocaleLowerCase(LOCALE).replace(",
    replacement: "const titleCore = (roh) => String(roh || '').replace(",
    expected: 'Doppelte Eintraege beim Anlegen'
  },
  {
    nr: '151', name: 'Der Hinweis greift erst ab acht Zeichen',
    file: 'public/app.js',
    search: "const SIMILAR_DIALOG = 4;",
    replacement: "const SIMILAR_DIALOG = 8;",
    expected: 'Doppelte Eintraege beim Anlegen'
  },
  {
    nr: '152', name: 'Der Hinweis vergleicht nur die Trefferliste statt des Bestands',
    file: 'public/app.js',
    search: "  for (const it of state.all) {",
    replacement: "  for (const it of state.items) {",
    expected: 'Doppelte Eintraege beim Anlegen'
  },
  /* ---- Die Marke ---- */
  {
    nr: '153', name: 'Der Markenstrich traegt wieder Gold',
    file: 'public/style.css',
    search: '--brand-line: var(--accent-text);',
    replacement: '--brand-line: var(--gold);',
    expected: 'Die Marke der Instanz'
  },
  {
    /* Die Farbe steht auch in favicon.svg; eine Aenderung in style.css
       erreicht sie dort nicht. */
    nr: '154', name: 'Die Fassung mit Kachel traegt wieder Gold',
    file: 'public/favicon.svg',
    search: '<path d="M8 16 H24" stroke="#ff7a1a"/>',
    replacement: '<path d="M8 16 H24" stroke="#ffc531"/>',
    expected: 'Die Marke der Instanz'
  },
  {
    nr: '155', name: 'Das viewBox umschliesst wieder die Kachel statt der Farbe',
    file: 'public/app.js',
    search: 'viewBox="6.5 4.5 19 23" width=',
    replacement: 'viewBox="0 0 32 32" width=',
    expected: 'Die Marke der Instanz'
  },
  {
    nr: '156', name: 'Die Hoehe der Marke steht wieder in Pixel',
    file: 'public/style.css',
    search: '.brand .logo { height: 3.1rem; }',
    replacement: '.brand .marke { height: 46px; }',
    expected: 'Die Marke der Instanz'
  },
  {
    nr: '157', name: 'Das Markup gibt die Marke wieder quadratisch an',
    file: 'public/app.js',
    search: 'width="${Math.round(s * 19 / 23)}" height="${s}"',
    replacement: 'width="${s}" height="${s}"',
    expected: 'Die Marke der Instanz'
  },
  /* ---- Telefon und Tablett ---- */
  {
    nr: '158', name: 'Die Spalte des Systembereichs darf sich wieder aufblaehen',
    file: 'public/style.css',
    search: '.sys-grid { grid-template-columns: minmax(0, 1fr); gap: 0; }',
    replacement: '.sys-grid { grid-template-columns: 1fr; gap: 0; }',
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '159', name: 'Die Bedingung in app.js laeuft von der im Stylesheet weg',
    file: 'public/app.js',
    search: "const NARROW = '(max-width: 700px), (max-height: 500px) and (max-width: 960px)';",
    replacement: "const SCHMAL = '(max-width: 640px)';",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '160', name: 'Der Behaelter des Menues steht auch am breiten Schirm im Weg',
    file: 'public/style.css',
    search: '.mast-rest { display: contents; }',
    replacement: '.mast-rest { display: flex; }',
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '161', name: 'Die Seite bekommt die Aussparung nicht mehr',
    file: 'public/index.html',
    search: '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
    replacement: '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '162', name: 'Der Blaetterpfeil verschwindet auf dem Finger wieder',
    file: 'public/style.css',
    search: '@media (hover: none) { .vnav { opacity: 1; } }',
    replacement: '',
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '163', name: 'Der Name des Angemeldeten rutscht hinter das Abmelden',
    file: 'public/app.js',
    search: "        <span class=\"hint who\" id=\"who\">${tH('list.signedInAs', { name: NAME })}</span>\n        <button class=\"btn btn-ghost btn-sm\" id=\"out\">${tH('list.signOut')}</button>",
    replacement: "        <button class=\"btn btn-ghost btn-sm\" id=\"out\">${tH('list.signOut')}</button>\n        <span class=\"hint who\" id=\"who\">${tH('list.signedInAs', { name: NAME })}</span>",
    expected: 'Mehrbenutzer-Anzeigen in der Oberflaeche'
  },
  {
    nr: '164', name: 'Das Kreuz kehrt auf die Vorschaukachel zurueck',
    file: 'public/style.css',
    search: '@media (hover: none) { .thumb .del { display: none; } }',
    replacement: '',
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '165', name: 'Der Papierkorb rueckt an die Einstellknoepfe heran',
    file: 'public/style.css',
    search: '.vremove { margin-left: 14px; }',
    replacement: '.vweg { margin-left: 0; }',
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '166', name: 'Das Kreuz an der Kachel wird nur durchsichtig, nicht herausgenommen',
    file: 'public/style.css',
    search: '@media (hover: none) { .thumb .del { display: none; } }',
    replacement: '@media (hover: none) { .thumb .del { opacity: 0; } }',
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '167', name: 'Die Vorschaureihe faellt auf den umbrechenden Kasten zurueck',
    file: 'public/style.css',
    search: ".thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--tile-min), 1fr)); gap: 7px; margin: 10px 0; }",
    replacement: ".thumbs { display: flex; flex-wrap: wrap; gap: 7px; margin: 10px 0; }",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  /* Mit zwoelf Fotos aendert auto-fit nichts, mit zwei werden die Kacheln
     breit. */
  {
    nr: '168', name: 'Die leeren Spalten klappen zusammen (auto-fit)',
    file: 'public/style.css',
    search: "grid-template-columns: repeat(auto-fill, minmax(var(--tile-min), 1fr));",
    replacement: "grid-template-columns: repeat(auto-fit, minmax(var(--tile-min), 1fr));",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '169', name: 'Die Kachel behaelt ihre feste Hoehe und wird zum Rechteck',
    file: 'public/style.css',
    search: "  width: auto; height: auto; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden;",
    replacement: "  width: auto; height: 62px; border-radius: 8px; overflow: hidden;",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '170', name: 'Die Grundgroesse der Kachel verrutscht',
    file: 'public/style.css',
    search: "  --tile-min: 80px;",
    replacement: "  --tile-min: 86px;",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  /* ---- Der Export sagt seine Groesse an ---- */
  /* Die Rueckbauten zielen auf Rechnung und Klemme, nicht auf die Anzeige:
     eine falsch gerechnete Zahl sieht aus wie eine richtige. */
  {
    nr: '172', name: 'Die Vorschaubilder werden mitgezaehlt, obwohl sie nie mitgehen',
    file: 'server.js',
    search: "      `SELECT COALESCE(SUM(length(data)),0) n FROM photos WHERE kind != 'video'`));",
    replacement: "      `SELECT COALESCE(SUM(length(data) + COALESCE(length(thumb),0)),0) n FROM photos WHERE art != 'video'`));",
    expected: 'Videos: Kennzahlen und Austausch'
  },
  {
    nr: '174', name: 'Der Warnwert liegt auf der Grenze statt darunter',
    file: 'server.js',
    search: 'const EXCHANGE_WARN = 300 * 1024 * 1024;',
    replacement: 'const EXCHANGE_WARN = EXCHANGE_MAX;',
    expected: 'Die Exportgroesse sagt sich an'
  },
  {
    nr: '175', name: 'Die Videos zaehlen auch ohne Fotos mit',
    file: 'public/app.js',
    search: '    + (s.withPhotos && s.withVideos ? (ex.videos || 0) : 0)',
    replacement: '    + (s.mitVideos ? (ex.videos || 0) : 0)',
    expected: 'Die Exportgroesse sagt sich an'
  },
  /* ---- Die Anzeige zieht nach ---- */
  {
    nr: '176', name: 'Die Kachel zeichnet wieder alles, auch was niemand sieht',
    file: 'public/style.css',
    search: '  content-visibility: auto;\n  contain-intrinsic-size: auto 400px;',
    replacement: '  contain-intrinsic-size: auto 400px;',
    expected: 'Die Anzeige zieht nach — 0.12.3'
  },
  {
    /* Ohne `auto` springt der Rollbalken bei jeder Kachel, die anders hoch ist
       als geschaetzt. */
    nr: '177', name: 'Die geschaetzte Kachelhoehe gilt fuer immer statt nur bis zum ersten Zeichnen',
    file: 'public/style.css',
    search: '  contain-intrinsic-size: auto 400px;',
    replacement: '  contain-intrinsic-size: 400px;',
    expected: 'Die Anzeige zieht nach — 0.12.3'
  },
  {
    nr: '178', name: 'Der angepinnte Bericht traegt wieder zwei Farben',
    file: 'public/style.css',
    search: '.cmt.pinned.report {\n  border-top-color: var(--accent);',
    replacement: '.cmt.pinned.bericht {\n  border-top-color: var(--gold-line);',
    expected: 'Die Anzeige zieht nach — 0.12.3'
  },
  {
    nr: '179', name: 'Der Verweis rutscht wieder VOR die Wolke',
    file: 'public/app.js',
    search: '  if (right.childElementCount) r3.appendChild(right);',
    replacement: '  if (rechts.childElementCount) r3.insertBefore(rechts, g3);',
    expected: 'Die Anzeige zieht nach — 0.12.3'
  },
  {
    nr: '180', name: 'Die Klammer nennt die Gesamtzahl statt der offenen',
    file: 'public/app.js',
    search: "    + (finished ? t('list.openCount', { n: open }) : ''));",
    replacement: "    + (finished ? t('list.openCount', { n: tasks }) : ''));",
    expected: 'Kommentare in der Oberflaeche'
  },
  {
    nr: '181', name: 'Das Codefeld fragt wieder nach der App statt nach dem Verfahren',
    file: 'public/app.js',
    search: "<label>${tH('dialog.twoFactorCode')}</label>\n        <input class=\"input\" id=\"confirm-code\"",
    replacement: "<label>Code aus deiner App</label>\n        <input class=\"input\" id=\"confirm-code\"",
    expected: 'Die Karte „Zugang“: der zweite Faktor'
  },
  {
    nr: '182', name: 'Der Sprungknopf springt, klappt den Block aber nicht auf',
    file: 'public/app.js',
    search: "    if (BLOCKS.closed.includes('kommentare')) {",
    replacement: '    if (false) {',
    expected: 'Kommentare in der Oberflaeche'
  },
  /* ---- Der Export in Teilen ---- */
  {
    nr: '183', name: 'Der Schnitt laesst die Fenster ueberlappen',
    file: 'server.js',
    search: "    open.to = z.id;\n    open.count++;",
    replacement: '    open.to = z.id + 1;\n    open.count++;',
    expected: 'Der Export in Teilen'
  },
  {
    /* Jeder Teil traegt Titel, Zeitstempel und die ganze Kriterienliste noch
       einmal. */
    nr: '184', name: 'Der Umschlag je Teil faellt aus der Rechnung',
    file: 'server.js',
    search: "      open = { nr: parts.length + 1, from: z.id, to: z.id, count: 0, bytes: reason };",
    replacement: '      open = { nr: parts.length + 1, from: z.id, to: z.id, count: 0, bytes: 0 };',
    expected: 'Der Export in Teilen'
  },
  {
    nr: '185', name: 'Ein zu grosser Eintrag wird still uebergangen',
    file: 'server.js',
    search: "    if (reason + b > EXCHANGE_MAX) { tooBig.push({ id: z.id, title: z.title, bytes: reason + b }); continue; }",
    replacement: '    if (grund + b > EXCHANGE_MAX) { continue; }',
    expected: 'Der Export in Teilen'
  },
  {
    nr: '186', name: 'Eine halbe Fensterangabe geht als Vollexport durch',
    file: 'server.js',
    search: '  if (asPart && (from === null || to === null || part === null || parts === null))',
    replacement: '  if (false)',
    expected: 'Der Export in Teilen'
  },
  {
    nr: '187', name: 'Eine Freigabe gilt wieder fuer alle Teile',
    file: 'server.js',
    search: "             : (req.query && req.query.part !== undefined ? req.query.part : null);",
    replacement: '             : null;',
    expected: 'Der Export in Teilen'
  },
  {
    nr: '188', name: 'Jeder Teil traegt den ganzen Bestand',
    file: 'server.js',
    search: "    ? db.prepare('SELECT * FROM items WHERE id BETWEEN ? AND ? ORDER BY id').all(from, to)",
    replacement: "    ? db.prepare('SELECT * FROM items ORDER BY id').all()",
    expected: 'Der Export in Teilen'
  },
  {
    nr: '189', name: 'Die Teilgroesse laesst sich ueber den Warnwert stellen',
    file: 'server.js',
    search: "  const targetSize = Math.min(EXCHANGE_WARN,",
    replacement: '  const targetSize = Math.min(Number.MAX_SAFE_INTEGER,',
    expected: 'Der Export in Teilen'
  },
  {
    /* Nur am Dateinamen ist die Reihenfolge der Teile abzulesen. */
    nr: '190', name: 'Alle Teile heissen gleich',
    file: 'server.js',
    search: "    `attachment; filename=\"${exportName(asPart ? `-part-${part}-of-${parts}` : '')}\"`);",
    replacement: "    `attachment; filename=\"${exportName('')}\"`);",
    expected: 'Der Export in Teilen'
  },
  {
    nr: '191', name: 'Die Oberflaeche fragt wieder je Teil statt einmal fuer alle',
    file: 'public/app.js',
    search: "  try { await api('POST', '/api/confirm', { ...input, purpose, targets }); }\n  catch (e) { toast(e.message, true); return false; }\n  return true;",
    replacement: "  for (const ziel of ziele) {\n    try { await api('POST', '/api/confirm', { ...eingabe, zweck, ziel }); }\n    catch (e) { toast(e.message, true); return false; }\n  }\n  return true;",
    expected: 'Der Teilexport mit zweitem Faktor'
  },
  {
    nr: '192', name: 'Die Route nimmt wieder nur ein einzelnes Ziel',
    file: 'server.js',
    search: '  } else targetList = [target ?? null];',
    replacement: '  }\n  targetList = [ziel ?? null];',
    expected: 'Der Teilexport mit zweitem Faktor'
  },
  {
    nr: '193', name: 'Doppelte Zielnummern gehen als halbierte Bestellung durch',
    file: 'server.js',
    search: '    if (new Set(targetList).size !== targetList.length)',
    replacement: '    if (false)',
    expected: 'Der Teilexport mit zweitem Faktor'
  },
  {
    nr: '194', name: 'Eine Anfrage darf beliebig viele Freigaben bestellen',
    file: 'server.js',
    search: '    if (targets.length > EXCHANGE_PART_MAX)',
    replacement: '    if (false)',
    expected: 'Der Teilexport mit zweitem Faktor'
  },
  {
    nr: '195', name: 'Der Teilexport schreibt wieder "teil 1/5" und faellt damit aus dem Protokoll',
    file: 'server.js',
    search: "detail: asPart ? 'part' : null });",
    replacement: 'merkmal: asPart ? `teil ${teil}/${teile}` : null });',
    expected: 'Der Teilexport mit zweitem Faktor'
  },
  /* ---- Zwei Netze, ein Zugang ---- */
  {
    nr: '196', name: 'X-Forwarded-Proto wird auch ohne BEHIND_PROXY geglaubt',
    file: 'auth.js',
    search: '  if (!BEHIND_PROXY) return false;',
    replacement: '  if (false) return false;',
    expected: 'Ohne Proxy ist der Kopf nur eine Behauptung'
  },
  {
    nr: '197', name: 'Beide Wege bekommen denselben Cookienamen',
    file: 'auth.js',
    search: "const cookieName = (req) => viaProxy(req) ? COOKIE_SECURE : COOKIE_NAME;",
    replacement: "const cookieName = (req) => COOKIE_NAME;",
    expected: 'Zwei Netze, ein Zugang — 0.13.0'
  },
  {
    nr: '198', name: 'Auch der Heimnetzcookie traegt Secure',
    file: 'auth.js',
    search: "  `${viaProxy(req) ? '; Secure' : ''}; Max-Age=${SESSION_DAYS * 86400}`;",
    replacement: "  `; Secure; Max-Age=${SESSION_DAYS * 86400}`;",
    expected: 'Zwei Netze, ein Zugang — 0.13.0'
  },
  {
    nr: '199', name: 'HSTS geht wieder auf jedem Weg mit',
    file: 'server.js',
    search: "  if (auth.viaProxy(req)) res.set('Strict-Transport-Security', 'max-age=31536000');",
    replacement: "  if (auth.BEHIND_PROXY) res.set('Strict-Transport-Security', 'max-age=31536000');",
    expected: 'Zwei Netze, ein Zugang — 0.13.0'
  },
  /* ---- Der Filter am Sicherheitsprotokoll ---- */
  {
    nr: '200', name: 'Die Leseroute uebergeht die gewaehlte Ansicht',
    file: 'server.js',
    search: '  res.json(auth.readLog(auth.LOG_LIMIT, group));',
    replacement: '  res.json(auth.readLog(auth.LOG_LIMIT));',
    expected: 'Das Sicherheitsprotokoll in der Oberflaeche'
  },
  {
    nr: '201', name: 'Die Namen im Protokoll sind wieder nur Text',
    file: 'public/app.js',
    search: "    if (id == null) { field.appendChild(doc.createTextNode(text)); return field; }",
    replacement: "    feld.appendChild(dok.createTextNode(text)); return feld;",
    expected: 'Das Sicherheitsprotokoll in der Oberflaeche'
  },
  {
    nr: '202', name: 'Auch "unbekannter Name" wird ein Knopf',
    file: 'public/app.js',
    search: "      row.appendChild(logNameField(doc, 'log-actor', logActor(z),\n        z.actor != null ? z.actor : null));",
    replacement: "      zeile.appendChild(protNamensFeld(dok, 'log-actor', protHandelnder(z), z.wer ?? 0));",
    expected: 'Das Sicherheitsprotokoll in der Oberflaeche'
  },
  {
    nr: '203', name: 'Fuenf Vorgaenge stehen wieder als roher Schluessel da',
    file: 'public/app.js',
    search: "    'request.approve': 'card.requestApproved',",
    replacement: "",
    expected: 'Das Sicherheitsprotokoll in der Oberflaeche'
  },
  /* ---- Der Loeschdialog und die Grabsteine ---- */
  {
    nr: '204', name: 'Der Loeschdialog verschweigt den umkehrbaren Weg wieder',
    file: 'public/app.js',
    search: "      <p>${tH('dialog.lockInsteadHint')}</p>",
    replacement: "",
    expected: 'Die zweite Bestaetigung in der Oberflaeche'
  },
  {
    nr: '205', name: 'Grabsteine stehen wieder in der Zugangsliste',
    file: 'public/app.js',
    search: "    for (const z of data.users.filter(z => z.status !== 'deleted')) {",
    replacement: "    for (const z of daten.zugaenge) {",
    expected: 'Der Einladungslink in der Karte Zugaenge'
  },
  /* ---- Die Filterleiste ---- */
  {
    nr: '206', name: 'Die selbsttaetige Aussenkante frisst die Zeile wieder',
    file: 'public/style.css',
    search: '.frow-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }',
    replacement: '.frow-right { display: flex; align-items: center; gap: 10px; margin-left: auto; }',
    expected: 'Die Anzeige zieht nach — 0.12.3'
  },
  {
    nr: '207', name: 'Sortieren und Ansichten bekommen wieder je eine Zeile',
    file: 'public/app.js',
    search: "  const r5 = r4;\n  secondLabel(r5, t('list.views'));",
    replacement: "  const r5 = row(t('list.views'));",
    expected: 'Die Filterleiste wird kuerzer — 0.13.0'
  },
  {
    nr: '208', name: 'Eine Pille mit null Treffern wird nicht mehr gedaempft',
    file: 'public/app.js',
    search: "    b.className = 'pill pill-tag' + (chosen ? ' on' : '') + (idle.has(tag.id) ? ' blank' : '');",
    replacement: "    b.className = 'pill pill-tag' + (gewaehlt ? ' on' : '');",
    expected: 'Die Filterleiste wird kuerzer — 0.13.0'
  },
  /* ---- Die Kategoriezeile ---- */
  {
    nr: '209', name: 'Eine gespeicherte Ansicht in der alten Form verliert ihre Kategorie',
    file: 'public/app.js',
    search: "  if (!Array.isArray(f.categoryIds))\n    f.categoryIds = f.categoryId != null ? [f.categoryId] : [];",
    replacement: "  if (!Array.isArray(f.categoryIds))\n    f.categoryIds = [];",
    expected: 'Die Kategoriezeile lernt die Mehrzahl — 0.13.0'
  },
  {
    nr: '210', name: 'Aus der Vereinigung wird ein Schnitt',
    file: 'public/app.js',
    search: "  if (f.categoryIds.length) out = out.filter(i =>\n    f.categoryIds.includes(i.category ? i.category.id : CATEGORY_NONE));",
    replacement: "  if (f.categoryIds.length) out = out.filter(i =>\n    f.categoryIds.every(v => v === (i.category ? i.category.id : CATEGORY_NONE)));",
    expected: 'Die Kategoriezeile lernt die Mehrzahl — 0.13.0'
  },
  {
    /* "Ohne" ist kein Kategoriewert; eine Klemme, die nur Nummern durchlaesst,
       wirft es weg. */
    nr: '211', name: '"Ohne" ueberlebt das Zurechtruecken nicht',
    file: 'public/app.js',
    search: "    v === CATEGORY_NONE || state.categories.some(c => c.id === v));",
    replacement: "    state.categories.some(c => c.id === v));",
    expected: 'Die Kategoriezeile lernt die Mehrzahl — 0.13.0'
  },
  {
    nr: '212', name: 'Die Pille "Ohne" wird gar nicht erst gezeichnet',
    file: 'public/app.js',
    search: "  if (withoutNumber || f.categoryIds.includes(CATEGORY_NONE)) {",
    replacement: "  if (false) {",
    expected: 'Die Kategoriezeile lernt die Mehrzahl — 0.13.0'
  },
  /* ---- Die Beschriftungen stehen oben ---- */
  {
    nr: '213', name: 'Die Filterzeile mittelt wieder ueber die ganze Hoehe',
    file: 'public/style.css',
    search: '.frow { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }',
    replacement: '.frow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }',
    expected: 'Die Beschriftungen stehen oben — 0.13.1'
  },
  {
    nr: '214', name: 'Die Beschriftung schert aus der Grundlinie aus',
    file: 'public/style.css',
    search: '.frow > .eyebrow { min-width: 7.25em; flex-shrink: 0; }',
    replacement: '.frow > .eyebrow { min-width: 7.25em; flex-shrink: 0; align-self: center; }',
    expected: 'Die Beschriftungen stehen oben — 0.13.1'
  },
  /* ---- Der angepinnte Rahmen schliesst ---- */
  {
    nr: '215', name: 'Die angepinnte Notiz bekommt ihre linke Kante nicht',
    file: 'public/style.css',
    search: '.cmt.pinned { border-color: var(--gold-line); }',
    replacement: '.cmt.pinned {\n  border-top-color: var(--gold-line);\n' +
      '  border-right-color: var(--gold-line);\n  border-bottom-color: var(--gold-line);\n}',
    expected: 'Der angepinnte Rahmen schliesst — 0.13.2'
  },
  {
    /* Ohne die Wiederholung gilt die spaetere Regel der Anpinnung: eine
       goldene linke Kante neben drei orangen. */
    nr: '216', name: 'Der angepinnte Bericht verliert seine orange Kante an das Gold',
    file: 'public/style.css',
    search: '  border-bottom-color: var(--accent);\n  border-left-color: var(--accent);\n}',
    replacement: '  border-bottom-color: var(--accent);\n}',
    expected: 'Der angepinnte Rahmen schliesst — 0.13.2'
  },
  /* ---- Der kaputte Cookiewert ---- */
  {
    nr: '217', name: 'Ein kaputter Cookiewert bricht wieder den ganzen Kopf ab',
    file: 'auth.js',
    search: "    let value;\n    try { value = decodeURIComponent(part.slice(i + 1).trim()); }\n" +
      "    catch { continue; }\n    out[part.slice(0, i).trim()] = value;",
    replacement: "    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());",
    expected: 'Der kaputte Cookiewert — 0.14.0'
  },
  {
    nr: '218', name: 'Ein kaputter Wert nimmt den ganzen Cookiekopf mit',
    file: 'auth.js',
    search: "    catch { continue; }",
    replacement: "    catch { return {}; }",
    expected: 'Der kaputte Cookiewert — 0.14.0'
  },
  /* ---- Die drei Spalten und der Migrationsblock ---- */
  {
    nr: '224', name: 'Die drei Spalten stehen nicht mehr in der DDL',
    file: 'db.js',
    search: "  rejected_at TEXT,\n  rejected_reason TEXT,",
    replacement: "",
    expected: 'Der Hinweis auf einen unvollstaendigen Bestand — 0.33.0'
  },
  /* ---- Die Klemme an der Begruendung ---- */
  {
    nr: '225', name: 'An der Begruendung gilt wieder mayChange statt selfOnly',
    file: 'server.js',
    search: "      it.rejected_by != null && !selfOnly(req, it.rejected_by))",
    replacement: "      it.rejected_von != null && !mayChange(req, it.rejected_von))",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  {
    nr: '226', name: 'Die Begruendung faellt aus den Verfasserfeldern heraus',
    file: 'server.js',
    search: "const AUTHOR_ONLY_FIELDS = ['title', 'description', 'rejected', 'rejectedReason',\n                              'tested', 'productCategoryId'];",
    replacement: "const AUTHOR_ONLY_FIELDS = ['title', 'description', 'rejected',\n                              'tested', 'productCategoryId'];",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  {
    nr: '227', name: 'Eine Ablehnung ohne Verfasser laesst sich nicht mehr begruenden',
    file: 'server.js',
    search: "  if (b.rejectedReason !== undefined && !turnsOn && !removedReason &&\n      it.rejected_by != null && !selfOnly(req, it.rejected_by))",
    replacement: "  if (b.rejectedGrund !== undefined && !turnsOn && !removedReason &&\n      !selfOnly(req, it.rejected_von))",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  {
    nr: '228', name: 'Ein neues Ablehnen uebernimmt den fremden Satz',
    file: 'server.js',
    search: "    put('rejected_by', req.user.id);\n    put('rejected_reason', reasonText(b.rejectedReason));",
    replacement: "    put('rejected_von', req.user.id);",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  {
    nr: '229', name: 'Das Ablehnungsdatum kommt aus dem Rumpf statt vom Server',
    file: 'server.js',
    search: "    sets.push(`rejected_at = datetime('now')`);",
    replacement: "    put('rejected_at', b.rejectedAt || new Date().toISOString().slice(0, 19).replace('T', ' '));",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  {
    nr: '230', name: 'Der Ablehnende geht als nackte Nummer hinaus',
    file: 'server.js',
    search: "  it.rejectedAuthor = authorFrom(card, it.rejected_by);\n  delete it.rejected_by;",
    replacement: "",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  {
    nr: '231', name: 'Die Uebersicht schickt Grund und Nummer mit hinaus',
    file: 'server.js',
    search: "    delete it.rejected_at; delete it.rejected_reason; delete it.rejected_by;",
    replacement: "",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  {
    nr: '232', name: 'Die Begruendung wird weder eingeebnet noch gekappt',
    file: 'server.js',
    search: "const reasonText = (v) =>\n  typeof v === 'string' ? v.replace(/\\s+/g, ' ').trim().slice(0, REASON_LENGTH) : '';",
    replacement: "const reasonText = (v) => (typeof v === 'string' ? v : '');",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  /* ---- Das Austauschformat ---- */
  {
    nr: '233', name: 'Die Formatnummer bleibt auf 15',
    file: 'server.js',
    search: "const EXCHANGE_FORMAT = 19;",
    replacement: "const EXCHANGE_FORMAT = 15;",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  {
    nr: '234', name: 'Der Ablehnende wandert als Nummer statt als Name hinaus',
    file: 'server.js',
    search: "    rejected_author: authorName(it.rejected_by),",
    replacement: "    rejected_author: it.rejected_von,",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  {
    nr: '235', name: 'Die drei Angaben gehen gar nicht erst in die Datei',
    file: 'server.js',
    search: "    rejected_at: it.rejected_at, rejected_reason: it.rejected_reason,\n    rejected_author: authorName(it.rejected_by),",
    replacement: "",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  {
    nr: '236', name: 'Ein fehlender Ablehnender faellt an den Einspielenden',
    file: 'server.js',
    search: "      const rejectedBy = String(it.rejected_author == null ? '' : it.rejected_author).trim()\n        ? authorId(it.rejected_author) : null;",
    replacement: "      const rejectedBy = verfasser(it.rejected_author);",
    expected: 'Die Entscheidung wird mitgeschrieben — 0.14.0'
  },
  /* ---- Die Sternreihe der Kriterienliste ---- */
  {
    /* Eine feste Pixelzahl passt bei 80 Prozent Schriftgroesse, bei 120
       Prozent klaffen 26 px. */
    nr: '237', name: 'Die Zahlenspalte bekommt ihre feste Mindestbreite zurueck',
    file: 'public/style.css',
    search: "  white-space: nowrap; padding-left: 9px;\n  min-width: calc(4.34rem + 9px);\n  display: flex; align-items: center; justify-content: flex-end;",
    replacement: "  white-space: nowrap; padding-left: 9px;\n  min-width: 52px; text-align: right;",
    expected: 'Die Sternreihe steht auf einer Linie — 0.14.0'
  },
  {
    nr: '238', name: 'Aus dem Raster wird wieder ein gewoehnlicher Kasten',
    file: 'public/style.css',
    search: ".rlist { display: grid; grid-template-columns: 1fr auto auto auto; }",
    replacement: ".rlist { display: block; }",
    expected: 'Die Sternreihe steht auf einer Linie — 0.14.0'
  },
  {
    nr: '239', name: 'Die Kriterienliste bekommt ihre Rasterklasse nicht',
    file: 'public/app.js',
    search: "    box.className = 'rlist' + (withAverage ? '' : ' no-average');",
    replacement: "",
    expected: 'Die Sternreihe steht auf einer Linie — 0.14.0'
  },
  {
    nr: '240', name: 'Die Zahl steckt wieder in den Sternen statt im Raster',
    file: 'public/app.js',
    search: "        row.append(a);",
    replacement: "        acts.append(a);",
    expected: 'Die Sternreihe steht auf einer Linie — 0.14.0'
  },
  {
    nr: '241', name: 'Die Trennlinie wird wieder an der Zeile gezogen',
    file: 'public/style.css',
    search: ".rrow > * { padding: 9px 0; border-bottom: 1px solid var(--line-2); }\n.rrow:last-of-type > * { border-bottom: none; }",
    replacement: ".rrow { padding: 9px 0; border-bottom: 1px solid var(--line-2); }\n.rrow:last-of-type { border-bottom: none; }",
    expected: 'Die Sternreihe steht auf einer Linie — 0.14.0'
  },
  /* ---- Die Oberflaeche an der Marke ---- */
  {
    nr: '242', name: 'Die Marke sagt wieder nur "Abgelehnt"',
    file: 'public/app.js',
    search: "    drawRejection();\n  }",
    replacement: "  }",
    expected: 'Die Aussage an der Marke — 0.14.0'
  },
  {
    nr: '243', name: 'Die Aussage verliert ihren Verfasser',
    file: 'public/app.js',
    search: "    if (item.rejectedAuthor && multipleUsers())\n" +
      "      parts.push(`von ${authorName(item.rejectedAuthor)}`);",
    replacement: "",
    expected: 'Die Aussage an der Marke — 0.14.0'
  },
  {
    nr: '247', name: 'Der Name steht auch bei einem einzigen Zugang da',
    file: 'public/app.js',
    search: "    if (item.rejectedAuthor && multipleUsers())",
    replacement: "    if (item.rejectedAuthor)",
    expected: 'Die Aussage an der Marke — 0.14.0'
  },
  {
    nr: '244', name: 'Der Vorschlag zum Ueberschreiben geht verloren',
    file: 'public/app.js',
    search: "      : { rejected: true, rejectedReason: item.rejected_reason || '' };",
    replacement: "      : { rejected: true };",
    expected: 'Die Aussage an der Marke — 0.14.0'
  },
  {
    nr: '245', name: 'Das Feld fuer den Grund erscheint nicht',
    file: 'public/app.js',
    search: "    row.hidden = !open;",
    replacement: "    zeile.hidden = true;",
    expected: 'Das Feld steht nur, wo etwas fehlt — 0.15.1'
  },
  {
    /* Ohne Angaben sagt die Zeile nur "Abgelehnt", wie der Schalter
       darueber. */
    nr: '246', name: 'Die Aussage steht auch da, wenn sie nichts sagt',
    file: 'public/app.js',
    search: "    mark.hidden = !item.rejected || open || (!head && !reason && !showPen);",
    replacement: "    marke.hidden = !item.rejected;",
    expected: 'Die Aussage an der Marke — 0.14.0'
  },

  /* ---- Der Filter und der Stift ---- */
  {
    nr: '250', name: 'Der Filter „abgelehnt" nimmt nichts weg',
    file: 'public/app.js',
    search: "  if (f.rejected === 'ja') out = out.filter(i => i.rejected);",
    replacement: "  if (false) out = out.filter(i => i.rejected);",
    expected: 'Der Filter „abgelehnt" — 0.15.0'
  },
  {
    nr: '251', name: 'Die Gegenrichtung des Filters faellt weg',
    file: 'public/app.js',
    search: "  else if (f.rejected === 'nein') out = out.filter(i => !i.rejected);",
    replacement: "  else if (false) out = out.filter(i => !i.rejected);",
    expected: 'Der Filter „abgelehnt" — 0.15.0'
  },
  {
    nr: '252', name: 'Der neue Filter fehlt in der Vorgabe',
    file: 'public/app.js',
    search: "                         rejected: 'all', favorite: false,",
    replacement: "                         favorite: false,",
    expected: 'Der Filter „abgelehnt" — 0.15.0'
  },
  {
    nr: '253', name: 'Der Ablehnungsfilter zaehlt nicht mit',
    file: 'public/app.js',
    search: "  if (f.rejected !== v.rejected) n++;",
    replacement: "  if (false) n++;",
    expected: 'Der Filter „abgelehnt" — 0.15.0'
  },
  {
    /* Ohne eigene Beschriftung liest sich die Gruppe als Fortsetzung der Reihe
       davor. */
    nr: '254', name: 'Die zweite Gruppe ist nicht abgesetzt',
    file: 'public/app.js',
    search: "  secondLabel(r1, t('list.rejection'));",
    replacement: "  // zweiteBeschriftung(r1, t('list.rejection'));",
    expected: 'Der Filter „abgelehnt" — 0.15.0'
  },
  {
    nr: '255', name: 'rejectedMine geht nicht mehr hinaus',
    file: 'server.js',
    search: "  it.rejectedMine = it.rejected_by != null && it.rejected_by === userId;",
    replacement: "  it.rejectedMine = false;",
    expected: 'Entfernen darf auch der Admin — 0.15.0'
  },
  {
    /* Ohne `mine` fehlt der Papierkorb auch beim Eigentuemer des Eintrags. */
    nr: '256', name: 'mine geht am Eintrag nicht mehr hinaus',
    file: 'server.js',
    search: "  it.mine = it.user_id === userId;",
    replacement: "  it.mine = false;",
    expected: 'Entfernen darf auch der Admin — 0.15.0'
  },
  {
    /* Dann kann ein Admin eine fremde Begruendung weder umschreiben noch
       entfernen. */
    nr: '257', name: 'Entfernen laeuft wieder ueber selfOnly',
    file: 'server.js',
    search: "  const removedReason = b.rejectedReason !== undefined && !reasonText(b.rejectedReason);",
    replacement: "  const removedReason = false;",
    expected: 'Entfernen darf auch der Admin — 0.15.0'
  },
  {
    nr: '258', name: 'Auch das Umschreiben kommt durch',
    file: 'server.js',
    search: "  if (b.rejectedReason !== undefined && !turnsOn && !removedReason &&",
    replacement: "  if (false &&",
    expected: 'Entfernen darf auch der Admin — 0.15.0'
  },
  {
    nr: '259', name: 'Wer entfernt, wird Verfasser',
    file: 'server.js',
    search: "    if (it.rejected_by == null && !removedReason) put('rejected_by', req.user.id);",
    replacement: "    if (it.rejected_von == null) put('rejected_von', req.user.id);",
    expected: 'Entfernen darf auch der Admin — 0.15.0'
  },
  {
    nr: '260', name: 'Das Feld bleibt nach dem Speichern offen',
    file: 'public/app.js',
    search: "      reasonOpen = false;\n      drawSwitches();\n    };\n    field.onblur = save;",
    replacement: "      drawSwitches();\n    };\n    feld.onblur = speichere;",
    expected: 'Die Begruendung kommt zur Ruhe — 0.15.0'
  },
  {
    nr: '261', name: 'Beim Einschalten bleibt das Feld zu',
    file: 'public/app.js',
    search: "    const open = item.rejected && mine && (!reason || reasonOpen);",
    replacement: "    const open = item.rejected && mine && reasonOpen;",
    expected: 'Das Feld steht nur, wo etwas fehlt — 0.15.1'
  },
  {
    /* Das Feld oeffnet sich, und der Server weist den Inhalt mit 403 ab. */
    nr: '262', name: 'Der Stift steht jedem da',
    file: 'public/app.js',
    search: "    const showPen = item.rejected && mine;",
    replacement: "    const showPen = item.rejected;",
    expected: 'Die Begruendung kommt zur Ruhe — 0.15.0'
  },
  {
    nr: '263', name: 'Der Papierkorb steht jedem da',
    file: 'public/app.js',
    search: "    const showPath = item.rejected && manage && !!reason;",
    replacement: "    const showPath = item.rejected && !!grund;",
    expected: 'Die Begruendung kommt zur Ruhe — 0.15.0'
  },
  {
    nr: '264', name: 'Der Papierkorb fragt nicht mehr nach',
    file: 'public/app.js',
    search: "    if (!await confirmBox(t('entry.reasonDeleteAsk'),",
    replacement: "    if (false && !await confirmBox(t('entry.reasonDeleteAsk'),",
    expected: 'Die Begruendung kommt zur Ruhe — 0.15.0'
  },
  {
    nr: '265', name: 'Escape verwirft nicht mehr, sondern speichert',
    file: 'public/app.js',
    search: "        field.value = item.rejected_reason || '';\n        reasonOpen = false;\n        drawRejection();",
    replacement: "        reasonOpen = false;\n        drawAblehnung();",
    expected: 'Die Begruendung kommt zur Ruhe — 0.15.0'
  },
  {
    nr: '266', name: 'An der herrenlosen Ablehnung fehlt der Weg hinein',
    file: 'public/app.js',
    search: "    const mine = may && (item.rejectedMine === true || !item.rejectedAuthor);",
    replacement: "    const meins = darf && item.rejectedMine === true;",
    expected: 'Die Begruendung kommt zur Ruhe — 0.15.0'
  },
  {
    nr: '267', name: 'Die Hervorhebung des Grundes faellt weg',
    file: 'public/style.css',
    search: ".rej-note .rej-why { color: var(--red); font-weight: 500; }",
    replacement: ".rej-note .rej-why { font-weight: 500; }",
    expected: 'Die Begruendung kommt zur Ruhe — 0.15.0'
  },
  /* ---- Das Attribut hidden ---- */
  {
    /* Ohne diese Regel ist `hidden` wirkungslos, sobald eine display-Regel
       danebensteht. */
    nr: '268', name: 'Die Regel fuer hidden verliert ihre Kraft',
    file: 'public/style.css',
    search: "[hidden] { display: none !important; }",
    replacement: "[hidden] { display: none; }",
    expected: 'Die Begruendung kommt zur Ruhe — 0.15.0'
  },
  {
    nr: '269', name: 'Die Regel fuer hidden fehlt ganz',
    file: 'public/style.css',
    search: "[hidden] { display: none !important; }\n",
    replacement: "",
    expected: 'Die Begruendung kommt zur Ruhe — 0.15.0'
  },
  {
    nr: '270', name: 'Aussage und Feld stehen wieder zugleich da',
    file: 'public/app.js',
    search: "    mark.hidden = !item.rejected || open || (!head && !reason && !showPen);",
    replacement: "    marke.hidden = !item.rejected || (!kopf && !grund && !showPen);",
    expected: 'Das Feld steht nur, wo etwas fehlt — 0.15.1'
  },
  {
    nr: '271', name: 'Das Feld steht auch dem offen, der nicht schreiben darf',
    file: 'public/app.js',
    search: "    const open = item.rejected && mine && (!reason || reasonOpen);",
    replacement: "    const open = item.rejected && (!reason || reasonOpen);",
    expected: 'Das Feld steht nur, wo etwas fehlt — 0.15.1'
  },

  /* ---- Abschnitte, Glocke und Auskunft ---- */
  {
    nr: '272', name: 'Der Systembereich zeigt wieder alle Karten auf einmal',
    file: 'public/app.js',
    search: "  const cards = SYS_CARDS.filter(k => k.section === open.key && k.visible(fetched));",
    replacement: "  const karten = SYS_KARTEN.filter(k => k.sichtbar(geholt));",
    expected: 'Der Systembereich nach Rolle'
  },
  {
    nr: '273', name: 'Ein Abschnitt ohne sichtbare Karte erscheint trotzdem',
    file: 'public/app.js',
    search: "  return SYS_SECTIONS.filter(a =>\n    SYS_CARDS.some(k => k.section === a.key && k.visible(fetched)));",
    replacement: "  return SYS_ABSCHNITTE;",
    expected: 'Der Systembereich nach Rolle'
  },
  {
    nr: '274', name: 'Die Adresse wird nicht mehr nachgezogen',
    file: 'public/app.js',
    search: "    history.replaceState(null, '', sysUrl(open.key));",
    replacement: "    void 0;",
    expected: 'Der Systembereich nach Rolle'
  },
  {
    nr: '275', name: 'Eine Adresse auf einen unsichtbaren Abschnitt zeigt ins Leere',
    file: 'public/app.js',
    search: "  const open = visibleOnes.find(a => a.key === desired) || visibleOnes[0];",
    replacement: "  const open = SYS_ABSCHNITTE.find(a => a.schluessel === gewuenscht) || sichtbare[0];",
    expected: 'Der Systembereich nach Rolle'
  },
  {
    nr: '276', name: 'Die Reiter tragen keine eigene Adresse mehr',
    file: 'public/app.js',
    search: "      ${visibleOnes.map(a => `<a class=\"sys-tab${a === open ? ' on' : ''}\"",
    replacement: "      ${sichtbare.map(a => `<button class=\"sys-tab${a === open ? ' on' : ''}\"",
    expected: 'Der Systembereich nach Rolle'
  },
  {
    nr: '277', name: 'Der Import steht wieder gleichrangig neben dem Export',
    file: 'public/app.js',
    search: "        <h4 class=\"sys-sub\">${tH('card.import')}</h4>",
    replacement: "        <h3>${tH('card.import')}</h3>",
    expected: 'Export und Import stehen in einer Karte'
  },
  {
    nr: '278', name: 'Das Ablagefeld des Imports wird wieder gleich laut gezeichnet',
    file: 'public/app.js',
    search: '        <label class="drop drop-quiet" id="imp-drop">',
    replacement: '        <label class="drop" id="imp-drop">',
    expected: 'Export und Import stehen in einer Karte'
  },
  {
    nr: '279', name: 'Die Kopfzahl ist wieder blosser Text',
    file: 'public/app.js',
    search: "        b.onclick = () => showCalc(boxId);",
    replacement: "        b.onclick = null;",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },
  {
    nr: '280', name: 'Der Erklaerkasten rechnet wieder selbst nach',
    file: 'public/app.js',
    search: "          <span id=\"calc-result\">⌀ ${esc(weightNumber(removed.result))}</span></div>",
    replacement: "          <span id=\"calc-result\">⌀ ${esc(gewZahl(Math.round((weg.summe / weg.teiler) * 10) / 10))}</span></div>",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },
  {
    nr: '281', name: 'Der Rechenweg faellt aus der Antwort',
    file: 'server.js',
    search: "  it.calc = { ...calc, result: it.avgRating };",
    replacement: "  void rechenweg;",
    expected: 'Der Rechenweg reist mit'
  },
  {
    nr: '282', name: 'Der Rechenweg wird auf zwei Stellen gerundet ausgeliefert',
    file: 'server.js',
    search: "    { rows, sum: counter, divisor: denominator, raw: denominator ? counter / denominator : null,",
    replacement: "    { zeilen, summe: Math.round(zaehler * 100) / 100, teiler: nenner,\n      roh: nenner ? Math.round((zaehler / nenner) * 100) / 100 : null,",
    expected: 'Der Rechenweg reist mit'
  },
  {
    nr: '283', name: 'Der Bezugspunkt der Glocke ist kein persoenlicher Schluessel mehr',
    file: 'server.js',
    search: "'searchNames',\n                                'bellSeen', 'views', 'strip', 'theme', 'language'];",
    replacement: "'searchNames',\n                                'views', 'strip', 'theme', 'language'];",
    expected: 'Persoenliche Einstellungen'
  },
  {
    nr: '284', name: 'Die Glocke steht auch ohne gespeicherten Bezugspunkt',
    file: 'public/app.js',
    search: "        ${BELL_SEEN ? `<button class=\"icon-btn bell\" id=\"bell\" title=\"${esc(t('list.news'))}\"",
    replacement: "        ${true ? `<button class=\"icon-btn bell\" id=\"bell\" title=\"${esc(t('list.news'))}\"",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '285', name: 'Die Zahl der Kommentare steht auch ohne Bezugspunkt da',
    file: 'server.js',
    search: "    if (reference) it.newComments = newCommentsPer.get(it.id) || 0;",
    replacement: "    it.neuKommentare = newCommentsPer.get(it.id) || 0;",
    expected: 'Die Glocke: was mit der Liste mitreist'
  },
  {
    /* Die drei Angaben stehen oder fehlen gemeinsam. */
    nr: '314', name: 'Die Verfasser stehen auch ohne Bezugspunkt an jedem Eintrag',
    file: 'server.js',
    search: "    if (reference) it.newFrom = [...(newFromPer.get(it.id) || [])].map(uid => authorFrom(card, uid));",
    replacement: "    it.neuVon = [...(neuVonJe.get(it.id) || [])].map(uid => authorFrom(karte, uid));",
    expected: 'Die Glocke: was mit der Liste mitreist'
  },
  {
    nr: '286', name: 'Die Glocke zaehlt die eigenen Kommentare wieder mit',
    file: 'server.js',
    search: "    WHERE c.created_at > ? AND c.user_id IS NOT ?\n    GROUP BY c.item_id, c.user_id`);",
    replacement: "    WHERE c.created_at > ? AND c.user_id IS NOT NULL\n    GROUP BY c.item_id, c.user_id`);",
    expected: 'Die Glocke: was mit der Liste mitreist'
  },
  {
    nr: '287', name: 'Bewertungen ohne Zeitpunkt gelten wieder als neu',
    file: 'server.js',
    search: "    WHERE set_at IS NOT NULL AND set_at > ? AND value > 0",
    replacement: "    WHERE IFNULL(set_at, '9999-12-31') > ? AND value > 0",
    expected: 'Die Glocke: was mit der Liste mitreist'
  },
  {
    nr: '288', name: 'Der Zeitpunkt zieht beim Ueberschreiben nicht mehr mit',
    file: 'server.js',
    search: "              DO UPDATE SET value = excluded.value, set_at = excluded.set_at`)",
    replacement: "              DO UPDATE SET value = excluded.value`)",
    expected: 'Die Bewertung traegt ihren Zeitpunkt'
  },
  {
    nr: '289', name: 'Der Punkt an der Glocke wird wieder eine Zahl',
    file: 'public/app.js',
    search: "  atElement('bell-dot', el => { el.hidden = !fresh; });",
    replacement: "  amElement('bell-dot', el => { el.textContent = String(neu); el.hidden = !neu; });",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '290', name: 'Der Zaehler „Offen" zeigt auch die Null',
    file: 'public/app.js',
    search: "    el.textContent = open ? String(open) : '';\n    el.hidden = !open;",
    replacement: "    el.textContent = String(open);\n    el.hidden = false;",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    /* Der Aufruf steht zweimal in public/app.js; die Kommentarzeile macht den
       Suchtext eindeutig. */
    nr: '291', name: 'Das Oeffnen der Tafel zieht den Bezugspunkt nicht nach',
    file: 'public/app.js',
    search: "  /* bellSeen beim Oeffnen setzen, nicht beim Schliessen. */\n  api('PUT', '/api/settings', { bellSeen: 1 }).catch(() => {});",
    replacement: "  /* bellSeen beim Oeffnen setzen, nicht beim Schliessen. */\n  void 0;",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '292', name: 'Die Zeilen der Tafel fuehren nicht mehr zum Eintrag',
    file: 'public/app.js',
    search: "      a.href = `#/item/${it.id}`;\n      a.dataset.mid = String(it.id);",
    replacement: "      a.href = '#/';\n      a.dataset.mid = String(it.id);",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '293', name: 'Die Kennzahlen nennen die Verfahren nicht mehr',
    file: 'server.js',
    search: "    method: { ...method(), passwords: 'scrypt' },",
    replacement: "",
    expected: 'Der Versions-Fingerprint'
  },
  {
    nr: '294', name: 'Die Kennzahlen nennen zusaetzlich die Paketversion',
    file: 'server.js',
    search: "    method: { ...method(), passwords: 'scrypt' },",
    replacement: "    verfahren: { ...verfahren(), passwoerter: 'scrypt',\n      paket: require('./package.json').dependencies['better-sqlite3-multiple-ciphers'] },",
    expected: 'Der Versions-Fingerprint'
  },
  {
    nr: '295', name: 'Das Journal wird behauptet statt abgelesen',
    file: 'db.js',
    search: "    journal: String(db.pragma('journal_mode', { simple: true }) || '').toUpperCase()",
    replacement: "    journal: 'DELETE'",
    expected: 'Der Versions-Fingerprint'
  },
  {
    nr: '296', name: 'Der Papierkorb loescht wieder ohne Rueckfrage',
    file: 'public/app.js',
    search: "    if (!await confirmBox(t('entry.deleteWordAsk', { word: word }), t('entry.deleteHint', { word: word }))) return false;",
    replacement: "    if (false) return false;",
    expected: 'Der Papierkorb im Vollbild'
  },
  {
    nr: '297', name: 'Das Vollbild bekommt seinen Papierkorb nicht',
    file: 'public/app.js',
    search: "        ${remove ? `<button class=\"lb-btn remove\" title=\"${esc(t('dialog.delete'))}\">${ICON_TRASH}</button>` : ''}",
    replacement: "    ${false ? `<button class=\"lb-btn weg\" title=\"${esc(t('dialog.delete'))}\">${ICON_TRASH}</button>` : ''}",
    expected: 'Der Papierkorb im Vollbild'
  },
  {
    nr: '298', name: 'Der Vorschaustreifen im Vollbild zieht nach dem Loeschen nicht nach',
    file: 'public/app.js',
    search: "    buildStrip();\n    show();",
    replacement: "    show();",
    expected: 'Der Papierkorb im Vollbild'
  },
  {
    nr: '299', name: 'Die Groessenmessung findet gar nichts mehr',
    file: 'test/selfcheck.js',
    search: "    return found.sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));",
    replacement: "    return [];",
    expected: 'Die Groesse der Funktionen wird gemessen'
  },
  {
    nr: '300', name: 'Der Nummernfilter der Gegenprobe greift wieder in die Namen',
    file: 'counterproof.js',
    search: "  if (/^\\d+$/.test(a)) return r.nr.toLowerCase() === a;",
    replacement: "  if (false) return r.nr.toLowerCase() === a;",
    expected: 'Die Gegenproben greifen'
  },

  /* ---- Das Raster der Kriterienliste ---- */
  {
    /* Mit fester Spaltenzahl stehen zwei Zellen in drei Spalten, und die Liste
       zerfaellt. */
    nr: '301', name: 'Die Spaltenzahl folgt dem Zustand nicht mehr',
    file: 'public/app.js',
    search: "    box.className = 'rlist' + (withAverage ? '' : ' no-average');",
    replacement: "    box.className = 'rlist';",
    expected: 'Das Raster der Kriterienliste zaehlt seine Zellen — 0.17.0'
  },
  {
    nr: '302', name: 'Die Regel fuer den einen Zugang faellt aus dem Stilblatt',
    file: 'public/style.css',
    search: ".rlist.no-average { grid-template-columns: 1fr auto auto; }",
    replacement: "",
    expected: 'Das Raster der Kriterienliste zaehlt seine Zellen — 0.17.0'
  },

  /* ---- Zwei Masse vom echten Geraet ---- */
  {
    /* vh misst die grosse Anzeigeflaeche, die auf dem Telefon nicht sichtbar
       ist. */
    nr: '303', name: 'Die Anmeldeseite misst die Hoehe wieder in vh',
    file: 'public/style.css',
    search: "body.login { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; }",
    replacement: "body.login { display: flex; flex-direction: column; min-height: 100vh; }",
    expected: 'Zwei Masse vom echten Geraet — 0.17.0'
  },
  {
    /* Steht 100vh hinten, gilt es auch in Browsern, die dvh kennen. */
    nr: '304', name: 'Der Rueckfall 100vh steht hinter dem dvh statt davor',
    file: 'public/style.css',
    search: "  min-height: 100vh; min-height: 100dvh;",
    replacement: "  min-height: 100dvh; min-height: 100vh;",
    expected: 'Zwei Masse vom echten Geraet — 0.17.0'
  },
  {
    nr: '305', name: 'Die Anmeldezeile darf wieder breiter werden als ihr Kasten',
    file: 'public/style.css',
    /* Sucht die Regel selbst, nicht einen Kommentar daneben; ausserhalb der
       Medienabfrage steht sie genau einmal. */
    search: `.mrow.session { display: grid; grid-template-columns: minmax(0, 1fr) auto;
  align-items: center; column-gap: 9px; row-gap: 2px; }`,
    replacement: ".mrow.sitz { display: grid; grid-template-columns: max-content auto; }",
    expected: 'Zwei Masse vom echten Geraet — 0.17.0'
  },
  {
    nr: '306', name: 'Die Karte „Mailversand" verliert ihre Breite wieder',
    file: 'public/app.js',
    search: "  return `<div class=\"sys-card wide\">\n        <h3>${tH('card.mailDelivery')}</h3>",
    replacement: "  return `<div class=\"sys-card\">\n        <h3>${tH('card.mailDelivery')}</h3>",
    expected: 'Der Systembereich nach Rolle'
  },
  {
    /* Als eigener Kasten richtet die Zeile ihre Spalten nicht mehr an der
       breitesten Zelle der Liste aus. */
    nr: '307', name: 'Aus den Rasterzellen wird wieder eine eigene Zeile',
    file: 'public/style.css',
    search: ".rrow { display: contents; }",
    replacement: ".rrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; }",
    expected: 'Die Sternreihe steht auf einer Linie — 0.14.0'
  },

  /* ---- Die Vergleichszahl ohne Gewichte ---- */
  {
    nr: '308', name: 'Die Vergleichszahl faellt aus dem Rechenweg',
    file: 'server.js',
    search: "      equalSum: sameCounter, equalDivisor: rows.length,",
    replacement: "      gleichSumme: 0, gleichTeiler: 0,",
    expected: 'Der Rechenweg reist mit'
  },
  {
    nr: '309', name: 'Die Vergleichszahl rechnet die Gewichte doch wieder ein',
    file: 'server.js',
    search: "    sameCounter += z.average;",
    replacement: "    sameCounter += produkt;",
    expected: 'Der Rechenweg reist mit'
  },
  {
    /* Gerundet wird zweimal: je Kriterium und am Ende. */
    nr: '310', name: 'Die Vergleichszahl wird ungerundet ausgeliefert',
    file: 'server.js',
    search: "      equalResult: rows.length\n        ? Math.round((sameCounter / rows.length) * 10) / 10 : null });",
    replacement: "      gleichErgebnis: zeilen.length ? sameCounter / zeilen.length : null });",
    expected: 'Der Rechenweg reist mit'
  },
  {
    nr: '311', name: 'Der Erklaerkasten laesst die Vergleichszahl weg',
    file: 'public/app.js',
    search: "        ${withWeight ? `<div class=\"calc-row calc-same\"><span>${tH('entry.calcNoWeights')}</span>",
    replacement: "        ${false ? `<div class=\"rz calc-same\"><span>${tH('entry.calcNoWeights')}</span>",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },
  {
    /* Sind alle Gewichte 1, stuende zweimal dieselbe Zahl im Kasten. */
    nr: '312', name: 'Die Vergleichszahl steht auch ohne jede Gewichtung da',
    file: 'public/app.js',
    search: "    const sameNumber = Number(removed.equalResult) === Number(removed.result);",
    replacement: "    const gleicheZahl = false;",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },
  {
    nr: '313', name: 'Der Kasten rechnet die Vergleichszahl selbst nach',
    file: 'public/app.js',
    search: "          <span id=\"calc-same\">⌀ ${esc(weightNumber(removed.equalResult))}</span></div>` : ''}",
    replacement: "          <span id=\"calc-same\">⌀ ${esc(gewZahl(Math.round((weg.zeilen.reduce((n, z) => n + z.schnitt, 0) / weg.zeilen.length) * 10) / 10))}</span></div>` : ''}",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },

  /* ---- Die Glockentafel sagt, was neu ist ---- */
  {
    nr: '315', name: 'Die Tafel zaehlt Kommentare und Bewertungen wieder zusammen',
    file: 'public/app.js',
    search: "  const marked = markedCount(i);",
    replacement: "  const marked = markedCount(i);\n  { const n = k + b; return `${n} ${n === 1 ? 'neuer Beitrag' : 'neue Beiträge'}`; }",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '316', name: 'Die Tafel schreibt auch die Null hin',
    file: 'public/app.js',
    search: "           b ? countMark('rating', '★', b) : ''].filter(Boolean).join(' · '),",
    replacement: "           countMark('rating', '★', b)].join(' · '),",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '317', name: 'Die Tafel schreibt die Mehrzahl auch bei einem Kommentar',
    file: 'public/languages/de.json',
    search: "\"list.commentCount\": {\n    \"one\": \"{n} Kommentar\",",
    replacement: "\"list.commentCount\": {\n    \"one\": \"{n} Kommentare\",",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '318', name: 'Der Server legt beide Zahlen wieder in eine Kiste',
    file: 'server.js',
    search: "      newRatingsPer.set(z.item_id, (newRatingsPer.get(z.item_id) || 0) + z.n);",
    replacement: "      newCommentsPer.set(z.item_id, (newCommentsPer.get(z.item_id) || 0) + z.n);",
    expected: 'Die Glocke: was mit der Liste mitreist'
  },
  {
    nr: '319', name: 'Die Tafel ordnet nach den Kommentaren statt nach der Summe',
    file: 'public/app.js',
    search: "    .slice().sort((a, b) => (freshCount(b) - freshCount(a)) || String(a.title).localeCompare(String(b.title), LOCALE));",
    replacement: "    .slice().sort((a, b) => ((b.neuKommentare || 0) - (a.neuKommentare || 0)) || String(a.title).localeCompare(String(b.title), LOCALE));",
    expected: 'Die Glocke in der Kopfzeile'
  },

  /* ---- Die Glocke ersetzt die Pille ---- */
  {
    nr: '320', name: 'Die Tafel sagt nicht mehr, von wem etwas kommt',
    file: 'public/app.js',
    search: "    a.querySelector('.bell-from').textContent = newFromWords(it);",
    replacement: "    a.querySelector('.bell-from').textContent = '';",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '321', name: 'Die Abfrage gruppiert nicht mehr nach Verfasser',
    file: 'server.js',
    search: "    GROUP BY c.item_id, c.user_id`);",
    replacement: "    GROUP BY c.item_id`);",
    expected: 'Die Glocke: was mit der Liste mitreist'
  },
  {
    nr: '322', name: 'Die Namen werden mit Kommas bis zum Schluss aufgezaehlt',
    file: 'public/app.js',
    search: "  const last = names[names.length - 1], first = names.slice(0, -1).join(', ');\n  return t('list.byNames',\n    { names: first ? t('list.namesAndLast', { first: first, last: last }) : last });",
    replacement: "  return t('list.byNames', { names: names.join(', ') });",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '323', name: 'Der Schluessel der gestrichenen Pille bleibt in der Stellung stehen',
    file: 'public/app.js',
    search: "  delete f.fresh;\n  return f;",
    replacement: "  return f;",
    expected: 'Die gestrichene Pille „Neu seit …" — 0.17.0'
  },
  {
    /* Dann setzt schon ein Blick in einen Eintrag die Tafel zurueck. */
    nr: '324', name: 'Der Bezugspunkt faellt bei jedem Verlassen der Uebersicht',
    file: 'public/app.js',
    search: "  if (BELL_SEEN) return;\n  BELL_SEEN = true;",
    replacement: "  BELL_SEEN = true;",
    expected: 'Der Bezugspunkt der Glocke in der Oberflaeche'
  },
  {
    /* Ohne Umbruch schrumpft der Titel zu Punkten. */
    nr: '325', name: 'Die Zeile der Glockentafel bricht nicht mehr um',
    file: 'public/style.css',
    search: ".mrow.bell-row { flex-wrap: wrap; row-gap: 2px; }",
    replacement: "",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '326', name: 'Die Angabe „von wem" bekommt keine eigene Zeile',
    file: 'public/style.css',
    search: ".bell-row .bell-from { flex-basis: 100%; font-size: .76rem; color: var(--faint); }",
    replacement: ".bell-row .bell-from { font-size: .76rem; color: var(--faint); }",
    expected: 'Die Glocke in der Kopfzeile'
  },

  /* ---- Die beiden gestrichenen Erklaertexte ---- */
  {
    nr: '327', name: 'Die Kennzahlen begruenden den Vorbehalt wieder an der Oberflaeche',
    file: 'public/app.js',
    search: "        <div class=\"kv\"><span class=\"k\">${tH('card.passwords')}</span><span class=\"v\">${esc(stats.method.passwords || '—')}</span></div>` : ''}",
    replacement: "        <div class=\"kv\"><span class=\"k\">${tH('card.passwords')}</span><span class=\"v\">${esc(stats.verfahren.passwoerter || '—')}</span></div>\n        <p class=\"desc\" style=\"margin:10px 0 0\"><strong>Welche Fassung welcher Bibliothek</strong>\n          das rechnet, steht hier <strong>nicht</strong>: das wäre die Angabe, nach der jemand\n          sucht, der eine Lücke ausnutzen will.</p>` : ''}",
    expected: 'Der Papierkorb in der Oberflaeche'
  },
  {
    nr: '328', name: 'Die Glockentafel begruendet sich wieder selbst',
    file: 'public/app.js',
    search: "    <div class=\"manage-list\" id=\"bell-list\"></div>\n    <div class=\"modal-acts\">",
    replacement: "    <div class=\"manage-list\" id=\"bell-list\"></div>\n    <p class=\"hint hint-sm\" style=\"margin:2px 0 0\"><strong>Was die Glocke nicht verspricht:</strong>\n      Sie rechnet beim Aufbau der Übersicht nach, nicht laufend.</p>\n    <div class=\"modal-acts\">",
    expected: 'Die Glocke in der Kopfzeile'
  },
  /* Gegenrichtung zu 301: die Klasse bleibt, die Zelle loest sich von der
     Bedingung, drei Zellen stehen in zwei Spalten. */
  {
    nr: '329', name: 'Die Durchschnittszelle haengt nicht mehr an derselben Bedingung',
    file: 'public/app.js',
    search: "      if (withAverage) {",
    replacement: "      if (true) {",
    expected: 'Das Raster der Kriterienliste zaehlt seine Zellen — 0.17.0'
  },
  {
    /* Der Suchtext nimmt den ganzen Ruf mit, damit die Datei ladbar bleibt;
       ein Rueckbau, der sie zerbricht, bricht ab, statt rot zu werden. */
    nr: '330', name: 'Der Erklaerkasten verweist wieder auf die Spalte dahinter',
    file: 'public/languages/de.json',
    search: "(Spalte **{grade}**)",
    replacement: "(Spalte dahinter)",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },
  {
    nr: '331', name: 'Das Raster des Erklaerkastens verliert eine Spalte',
    file: 'public/style.css',
    search: ".calc { display: grid; grid-template-columns: 1fr auto auto auto; gap: 0 14px; }",
    replacement: ".rechnung { display: grid; grid-template-columns: 1fr auto auto; gap: 0 14px; }",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },
  {
    nr: '332', name: 'Die Vergleichszeile wird dem Ergebnis gleichgestellt',
    file: 'public/style.css',
    search: ".calc-same > span { color: var(--muted); border-bottom: 0; border-top: 1px solid var(--line-2); }",
    replacement: ".calc-same > span { font-weight: 640; color: #8a8a8a; border-bottom: 0; }",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },
  {
    nr: '333', name: 'Die Vergleichszeile bekommt eine Zelle zu wenig',
    file: 'public/app.js',
    search: "          <span></span><span></span>\n          <span id=\"calc-same\">",
    replacement: "          <span></span>\n          <span id=\"calc-same\">",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },

  /* ---- Was der Benutzer sieht ---- */
  {
    nr: '334', name: 'Die Marke am Adressfeld behauptet wieder immer „freiwillig"',
    file: 'public/app.js',
    search: "        <div class=\"field\"><label>${tH('login.email')} <span class=\"hint\">${\n          SIGNUP ? t('card.required') : t('card.optional')}</span></label>",
    replacement: "        <div class=\"field\"><label>${tH('login.email')} <span class=\"hint\">${t('card.optional')}</span></label>",
    expected: 'Der Zugangstext sagt, was gilt — 0.17.1'
  },
  {
    nr: '335', name: 'Der Absatz richtet sich nicht mehr nach der Selbstanmeldung',
    file: 'public/app.js',
    search: "        <p class=\"desc\" style=\"margin:0 0 10px\">${SIGNUP",
    replacement: "        <p class=\"desc\" style=\"margin:0 0 10px\">${false",
    expected: 'Der Zugangstext sagt, was gilt — 0.17.1'
  },
  {
    nr: '336', name: 'Der Merker der Selbstanmeldung bleibt beim Umlegen stehen',
    file: 'public/app.js',
    search: "      SIGNUP = !!d.an;\n",
    replacement: "",
    expected: 'Der Zugangstext sagt, was gilt — 0.17.1'
  },
  {
    nr: '337', name: 'Der Wirtsbefehl steht wieder bei jedem',
    file: 'public/app.js',
    search: "function serverBox(sentence, command) {\n  if (!OWNER) return '';",
    replacement: "function serverKasten(satz, befehl) {\n  if (false) return '';",
    expected: 'Der Systembereich nach Rolle'
  },
  {
    nr: '338', name: 'Die Laengenvorgabe faellt vom Passwortfeld weg',
    file: 'public/app.js',
    search: "        <div class=\"field\"><label>${tH('dialog.newPassword')}\n          <span class=\"hint\">${tH('card.minCharsHint', { minPassword: MIN_PASSWORD })}</span></label>",
    replacement: "        <div class=\"field\"><label>${tH('dialog.newPassword')}</label>",
    expected: 'Der Zugangstext sagt, was gilt — 0.17.1'
  },
  {
    nr: '339', name: 'Die Liste bekommt ihre feste Hoehe zurueck',
    file: 'public/style.css',
    search: `.manage-list { flex: 0 1 auto; min-height: 0; max-height: 27.95rem;
  overflow-y: auto; margin: 0 -4px; padding: 0 4px; }`,
    replacement: ".manage-list { max-height: 280px; overflow-y: auto; margin: 0 -4px; padding: 0 4px; }",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '340', name: 'Die Liste verliert die Zeile, an der es sonst scheitert',
    file: 'public/style.css',
    search: ".log-list { flex: 0 1 auto; min-height: 0; max-height: 35rem;",
    replacement: ".log-list { flex: 0 1 auto; max-height: 35rem;",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '341', name: 'Die Kachel ist wieder keine Spalte',
    file: 'public/style.css',
    search: "padding: 18px 20px 20px;\n  display: flex; flex-direction: column; }",
    replacement: "padding: 18px 20px 20px; }",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '342', name: 'Der Knopf in der Kachel wird wieder ueber die volle Breite gezogen',
    file: 'public/style.css',
    search: ".sys-card > .btn { align-self: flex-start; }",
    replacement: "",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '347', name: 'Der fuenfte Abschnitt heisst wieder „Anlage"',
    file: 'public/app.js',
    search: "  { key: 'installation', name: () => t('card.installation') }",
    replacement: "  { schluessel: 'installation', name: () => 'Anlage' }",
    expected: 'Der fuenfte Abschnitt heisst „Installation" — 0.17.1, 0.19.1 und 0.19.2'
  },
  {
    nr: '348', name: 'Die Zeitangaben stehen wieder linksbuendig',
    file: 'public/style.css',
    search: ".mrow.session .session-time { grid-column: 1 / -1; justify-self: end; text-align: right; }",
    replacement: ".mrow.sitz .session-time { grid-column: 1 / -1; }",
    expected: 'Die Zeitangaben stehen untereinander — 0.17.1'
  },
  {
    nr: '349', name: 'Der Name teilt seine Reihe wieder mit den Zeiten',
    file: 'public/style.css',
    search: ".mrow.session .mname { grid-column: 1; grid-row: 1; }",
    replacement: ".mrow.sitz .mname { grid-column: 1; grid-row: 1 / span 3; }",
    expected: 'Die Zeitangaben stehen untereinander — 0.17.1'
  },
  {
    nr: '350', name: 'Das Vollbild uebernimmt den inneren Abspieler nicht mehr',
    file: 'public/app.js',
    search: "      handover = { source, position: el.currentTime || 0, wasPlaying: !el.paused, open: true };\n" +
           "      el.pause();\n      el.removeAttribute('src');\n      el.load();",
    replacement: "      el.pause();",
    expected: 'Genau ein Abspieler laeuft — 0.17.1'
  },
  {
    nr: '351', name: 'Die uebernommene Stelle wird nicht gesetzt',
    file: 'public/app.js',
    search: "        player.currentTime = handover.position;\n",
    replacement: "",
    expected: 'Genau ein Abspieler laeuft — 0.17.1'
  },
  {
    nr: '352', name: 'Der Rueckweg beim Schliessen faellt weg',
    file: 'public/app.js',
    search: "    hold();\n    restore();\n    lightboxOpen = false;",
    replacement: "    halteAn();\n    lightboxOpen = false;",
    expected: 'Genau ein Abspieler laeuft — 0.17.1'
  },
  {
    nr: '353', name: 'Die geloeschte Quelle wandert wieder zurueck',
    file: 'public/app.js',
    search: "    if (handover && imageSource(removed, '') === handover.source) handover = null;\n",
    replacement: "",
    expected: 'Genau ein Abspieler laeuft — 0.17.1'
  },

  /* ---- Der Deckel, die Reihen, die Klammer und die Glocke ---- */
  {
    nr: '354', name: 'Das Raster der Sitzungszeile bekommt seine dritte Spalte zurueck',
    file: 'public/style.css',
    search: ".mrow.session { display: grid; grid-template-columns: minmax(0, 1fr) auto;",
    replacement: ".mrow.sitz { display: grid; grid-template-columns: minmax(0, 1fr) auto auto;",
    expected: 'Die Zeitangaben stehen untereinander — 0.17.1'
  },
  {
    nr: '355', name: 'Die Liste fordert wieder so viele Zeilen, wie sie hat',
    file: 'public/style.css',
    search: ".manage-list { flex: 0 1 auto; min-height: 0; max-height: 27.95rem;",
    replacement: ".manage-list { flex: 0 1 auto; min-height: 0; max-height: none;",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '356', name: 'Das Sicherheitsprotokoll fordert wieder alle seine Zeilen',
    file: 'public/style.css',
    search: ".log-list { flex: 0 1 auto; min-height: 0; max-height: 35rem;\n",
    replacement: ".log-list { flex: 0 1 auto; min-height: 0; max-height: none;\n",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '357', name: 'Auf dem Telefon deckelt nichts mehr am Fenster',
    file: 'public/style.css',
    search: "  .manage-list, .log-list, .test-scroll, .atext, #ex-part-list {\n" +
           "    flex: 0 1 auto; max-height: 62vh; max-height: 62dvh; }",
    replacement: "",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '363', name: 'Die Begruendung zum fehlenden Adressfeld steht wieder in der Karte',
    file: 'public/languages/de.json',
    search: "\"card.testMailGoesHint\": \"Die Testmail geht **ausschließlich an die Adresse deines eigenen Accounts**. Antwortet der Mailserver nicht, bricht der",
    replacement: "\"card.testMailGoesHint\": \"Die Testmail geht an deinen Account — es gibt kein Adressfeld daneben, und zwar mit Absicht: ein Knopf, der an eine beliebige Adresse schickt, wäre ein offener Mailverteiler hinter einer Anmeldung. Antwortet der Mailserver nicht, bricht der",
    expected: 'Die Karte „Mailversand“'
  },
  {
    nr: '364', name: 'Die Klammer steht wieder auch bei einer einzigen Stimme',
    file: 'public/app.js',
    search: "          a.textContent = r.count > 1 ? `⌀ ${average} (${r.count})` : `⌀ ${average}`;",
    replacement: "          a.textContent = `⌀ ${schnitt} (${r.count})`;",
    expected: 'Die Klammer steht erst ab zwei Stimmen — 0.17.2'
  },
  {
    nr: '365', name: 'Die Glocke meldet wieder die eigenen Kommentare',
    file: 'server.js',
    search: "    WHERE c.created_at > ? AND c.user_id IS NOT ?",
    replacement: "    WHERE c.created_at > ? AND (c.user_id IS NOT ? OR 1)",
    expected: 'Die Glocke: was mit der Liste mitreist'
  },
  {
    nr: '366', name: 'Die Glocke meldet wieder die eigenen Bewertungen',
    file: 'server.js',
    search: "    WHERE set_at IS NOT NULL AND set_at > ? AND value > 0 AND user_id IS NOT ?",
    replacement: "    WHERE set_at IS NOT NULL AND set_at > ? AND value > 0 AND (user_id IS NOT ? OR 1)",
    expected: 'Die Glocke: was mit der Liste mitreist'
  },
  {
    nr: '367', name: 'Die Tafel verspricht wieder die eigenen Beitraege',
    file: 'public/app.js',
    search: "    <p>${tH('list.newCommentsHint')}</p>",
    replacement: "    <p>${tH('list.newCommentsHint')} Die eigenen stehen mit da.</p>",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '368', name: 'Die Anleitung erzaehlt wieder, seit wann etwas gilt',
    file: 'manual-de.md',
    search: "Die Ansichten „Alle · Gescheitert · Anmeldungen · Benutzer · Zweiter Faktor ·",
    replacement: "Seit 0.13.0 zeigen die Ansichten „Alle · Gescheitert · Anmeldungen · Benutzer · Zweiter Faktor ·",
    expected: 'Der Sprachwaechter'
  },

  /* ---- Die Kachel, der Mailversand, der Erklaerkasten, der Filter ---- */
  {
    nr: '369', name: 'Das Kachelraster streckt seine Kinder wieder nicht',
    file: 'public/style.css',
    search: "grid-auto-flow: dense; gap: 18px; margin-top: 6px; }",
    replacement: "grid-auto-flow: dense; gap: 18px; margin-top: 6px; align-items: start; }",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '370', name: 'Die Liste fordert wieder zwoelf Zeilen',
    file: 'public/style.css',
    search: ".manage-list { flex: 0 1 auto; min-height: 0; max-height: 27.95rem;\n",
    replacement: ".manage-list { flex: 0 1 auto; min-height: 0; max-height: 33.5rem;\n",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '371', name: 'Das Sicherheitsprotokoll deckelt wieder bei zehn Zeilen',
    file: 'public/style.css',
    search: ".log-list { flex: 0 1 auto; min-height: 0; max-height: 35rem;",
    replacement: ".log-list { flex: 0 1 auto; min-height: 0; max-height: 23.3rem;",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '372', name: 'Die Karte bekommt ihre Passwortzeile zurueck',
    file: 'public/app.js',
    search: "        <div class=\"kv\"><span class=\"k\">${tH('card.provider')}</span>",
    replacement: "        <div class=\"kv\"><span class=\"k\">Passwort</span><span class=\"v\">${mailstand.passwortGesetzt\n          ? 'gesetzt' : 'nicht gesetzt'}</span></div>\n        <div class=\"kv\"><span class=\"k\">${tH('card.provider')}</span>",
    expected: 'Die Karte „Mailversand“'
  },
  {
    nr: '373', name: 'Die Anbieterzeile nennt wieder nur den Namen',
    file: 'public/app.js',
    search: "  const parts = [esc(m.providerName || m.provider)];\n  if (m.server && m.port) {",
    replacement: "  const teile = [esc(m.anbieterName || m.anbieter)];\n  if (false) {",
    expected: 'Die Karte „Mailversand“'
  },
  {
    nr: '374', name: 'Der Knopf heisst wieder „Mailzugang speichern"',
    file: 'public/app.js',
    search: "id=\"mail-setup\">${tH('card.mailAccount')} ${\n            mailStatus.configured ? tH('card.change') : tH('card.setUp')}</button>",
    replacement: "id=\"mail-setup\">${tH('card.mailAccount')} speichern</button>",
    expected: 'Die Karte „Mailversand“'
  },
  {
    nr: '375', name: 'Der Anbieterhinweis wechselt nicht mehr mit der Auswahl',
    file: 'public/app.js',
    search: "      hint.textContent = v && v.hint ? v.hint : '';",
    replacement: "      hinweis.textContent = mailstand.hinweis || '';",
    expected: 'Der Dialog „Mailzugang einrichten“ — 0.17.3'
  },
  {
    nr: '376', name: 'Die gelesene Zeile steht auch bei „Eigener Server"',
    file: 'public/app.js',
    search: "      fixedField.hidden = !v || own;",
    replacement: "      fixedField.hidden = !v;",
    expected: 'Der Dialog „Mailzugang einrichten“ — 0.17.3'
  },
  {
    nr: '377', name: 'Der Dialog kuerzt die zweite Bestaetigung ab',
    file: 'public/app.js',
    search: "      if (!await secondConfirm('mail', null, t('card.saveMailAccount'),\n        t('card.mailServerHint'))) return;\n",
    replacement: "",
    expected: 'Der Dialog „Mailzugang einrichten“ — 0.17.3'
  },
  {
    nr: '378', name: 'Die Anbieterliste kommt wieder ohne Hinweise und feste Werte',
    file: 'server.js',
    search: "    providerList: mail.forChoice().map(a =>\n      ({ ...a, name: a.nameKey ? t(localeOf(req), a.nameKey) : a.name,\n         hint: a.hint ? t(localeOf(req), a.hint) : '' })),",
    replacement: "    anbieterListe: mail.PROVIDERS.map(a => ({ schluessel: a.schluessel, name: a.name })),",
    expected: 'Der Mailversand: das echte SMTP-Gespraech'
  },
  {
    nr: '379', name: 'Der Hinweis rueckt nicht mehr an seine Sache heran',
    file: 'public/style.css',
    search: ".mail-hint { margin: -7px 0 0; }",
    replacement: ".mail-hint { margin: 0; }",
    expected: 'Der Dialog „Mailzugang einrichten“ — 0.17.3'
  },
  {
    nr: '380', name: 'Die Felder im Dialog tragen wieder ihren zweiten Abstand',
    file: 'public/style.css',
    search: ".mail-dialog .field { margin-bottom: 0; }",
    replacement: ".mail-dialog .field { margin-bottom: 14px; }",
    expected: 'Der Dialog „Mailzugang einrichten“ — 0.17.3'
  },
  {
    nr: '381', name: 'Die Zeilen der Rechnung ruecken wieder auseinander',
    file: 'public/style.css',
    search: ".calc-row > span { padding: 3px 0;",
    replacement: ".rz > span { padding: 6px 0;",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },
  {
    nr: '382', name: 'Der Erklaerkasten wird wieder schmal',
    file: 'public/style.css',
    search: ".calc-modal { max-width: 620px; }",
    replacement: ".calc-modal { max-width: 540px; }",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },
  {
    nr: '383', name: 'Die ausgeschriebene Rechnung steht wieder unter der Tabelle',
    file: 'public/app.js',
    search: "      <p>${tH('entry.calcRoundingHint')}",
    replacement: "      <p><strong>${tH('entry.criteriaNoStars')}</strong> ${tH('entry.calcRounding')} ${esc(gewZahl(weg.summe))} ÷ ${esc(gewZahl(weg.teiler))}",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },
  {
    nr: '384', name: 'Der Filterruecksetzer steht immer da',
    file: 'public/app.js',
    search: "  const filtersSet = filterNumber();\n  if (filtersSet) {",
    replacement: "  const filtersSet = filterNumber();\n  if (true) {",
    expected: 'Der Ruecksetzer fuer die Filterleiste — 0.17.3'
  },
  {
    nr: '385', name: 'Der Filterruecksetzer nennt seine Zahl nicht mehr',
    file: 'public/app.js',
    search: "    bBack.textContent = t('list.resetFilters', { filtersSet: filtersSet });",
    replacement: "    bZurueck.textContent = 'Filter zurücksetzen';",
    expected: 'Der Ruecksetzer fuer die Filterleiste — 0.17.3'
  },
  {
    nr: '386', name: 'Der Filterruecksetzer raeumt die Sortierung mit',
    file: 'public/app.js',
    search: "      state.filters = filterNormal({ sort: state.filters.sort });",
    replacement: "      state.filters = filterNormal({});",
    expected: 'Der Ruecksetzer fuer die Filterleiste — 0.17.3'
  },
  {
    nr: '387', name: 'Der Filterruecksetzer raeumt die Suche mit',
    file: 'public/app.js',
    search: "      redraw();\n    };\n    right5.appendChild(bBack);",
    replacement: "      const qf = document.getElementById('q'); if (qf) qf.value = '';\n" +
            "      redraw();\n    };\n    rechts5.appendChild(bZurueck);",
    expected: 'Der Ruecksetzer fuer die Filterleiste — 0.17.3'
  },
  {
    nr: '388', name: 'Der Filterruecksetzer steht nicht mehr am rechten Rand',
    file: 'public/style.css',
    search: ".frow-right-wide { margin-left: auto; }",
    replacement: ".frow-right-wide { margin-right: 0; }",
    expected: 'Der Ruecksetzer fuer die Filterleiste — 0.17.3'
  },

  /* ---- Fordern und nutzen ---- */
  {
    nr: '389', name: 'Die leere Bedienliste wird wieder eine Zeile hoch',
    file: 'public/style.css',
    search: ".manage-list > .hint { min-height: 5.59rem; padding: 0 9px; }",
    replacement: ".manage-list > .hint { min-height: 2.795rem; padding: 0 9px; }",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '392', name: 'Das leere Protokoll wird wieder eine Zeile hoch',
    file: 'public/style.css',
    search: ".log-list > .hint { min-height: 4.666rem; padding: 0 2px; grid-column: 1 / -1; }",
    replacement: ".log-list > .hint { min-height: 2.333rem; padding: 0 2px; grid-column: 1 / -1; }",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '393', name: 'Die leere Meldung traegt die Vorgabemarge wieder mit',
    file: 'public/style.css',
    search: "  display: flex; align-items: center; margin: 0; }\n.manage-list > .hint {",
    replacement: "  display: flex; align-items: center; }\n.manage-list > .hint {",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '390', name: 'Die Liste im Fenster bekommt den Deckel wieder',
    file: 'public/style.css',
    search: ".modal .manage-list { max-height: none; }",
    replacement: ".modal .manage-list { max-height: 27.95rem; }",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '391', name: 'Die Liste haengt wieder am Schluesselwort',
    file: 'public/style.css',
    search: ".manage-list { flex: 0 1 auto; min-height: 0; max-height: 27.95rem;",
    replacement: ".manage-list { flex: 1 1 27.95rem; min-height: 0; max-height: max-content;",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },

  /* ---- Die Hoehe ohne Schluesselwort, das Raster der Liste ---- */
  {
    nr: '394', name: 'Die Spalten gehoeren wieder der Zeile',
    file: 'public/style.css',
    search: "  display: grid; grid-template-columns: 128px 1fr 1fr auto auto; align-content: start; }",
    replacement: "  grid-template-columns: 128px 1fr 1fr auto auto; align-content: start; }",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '395', name: 'Die Zeile wird wieder ein eigener Kasten',
    file: 'public/style.css',
    search: ".log-row { display: contents; }",
    replacement: ".log-row { display: block; }",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '396', name: 'Die Felder richten sich wieder an der Schriftlinie aus',
    file: 'public/style.css',
    search: "  font-size: .86rem; align-self: end; }",
    replacement: "  font-size: .86rem; align-self: baseline; }",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },
  {
    nr: '397', name: 'Auf dem Telefon bleibt die Liste ein Raster',
    file: 'public/style.css',
    search: "  .log-list { display: block; }\n  .log-row { display: grid;",
    replacement: "  .log-row { display: grid;",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },

  /* ---- Die Suche wird nachvollziehbar ---- */
  {
    nr: '398', name: 'Der Trefferkontext faellt ganz aus der Antwort',
    file: 'server.js',
    search: "    if (term) it.foundAt = hits.get(it.id);",
    replacement: "    if (false) it.fundstelle = fundstellen.get(it.id);",
    expected: 'Der Trefferkontext an der Antwort'
  },
  {
    nr: '399', name: 'Der Trefferkontext steht auch ohne Suche in der Antwort',
    file: 'server.js',
    search: "    if (term) it.foundAt = hits.get(it.id);",
    replacement: "    it.fundstelle = fundstellen.get(it.id) || null;",
    expected: 'Der Trefferkontext an der Antwort'
  },
  {
    nr: '400', name: 'Der Ausschnitt wird vorn geschnitten statt an der Fundstelle',
    file: 'server.js',
    search: "const SNIPPET_LEAD = 4;",
    replacement: "const SNIPPET_LEAD = 1000;",
    expected: 'Der Trefferkontext an der Antwort'
  },
  {
    /* Dann fehlt der Hinweis, dass die Fundstelle mitten in einem Wort
       steht. */
    nr: '401', name: 'Der Ausschnitt beginnt genau bei der Fundstelle',
    file: 'server.js',
    search: "const SNIPPET_LEAD = 4;",
    replacement: "const SNIPPET_LEAD = 0;",
    expected: 'Der Trefferkontext an der Antwort'
  },
  {
    nr: '402', name: 'Der Ausschnitt wird nicht mehr eingeebnet',
    file: 'server.js',
    search: "const oneLine = (s) => String(s ?? '').replace(/\\s+/g, ' ').trim();",
    replacement: "const oneLine = (s) => String(s ?? '');",
    expected: 'Der Trefferkontext an der Antwort'
  },
  {
    nr: '403', name: 'Der Ausschnitt wird gar nicht mehr gekuerzt',
    file: 'server.js',
    search: "const SNIPPET_LENGTH = 56;",
    replacement: "const SNIPPET_LENGTH = 100000;",
    expected: 'Der Trefferkontext an der Antwort'
  },
  {
    nr: '404', name: 'Die Zahl der weiteren Stellen ist immer null',
    file: 'server.js',
    search: "    others: hit.length - 1",
    replacement: "    weitere: 0",
    expected: 'Der Trefferkontext an der Antwort'
  },
  {
    /* Dann steht der Titel zuerst, den die Kachel ohnehin zeigt. */
    nr: '405', name: 'Die Folge der Quellen kehrt sich um',
    file: 'server.js',
    search: "  const hit = FULLTEXT_SOURCES.filter(q => r['f_' + q.key] != null);",
    replacement: "  const getroffen = [...FULLTEXT_SOURCES].reverse().filter(q => r['f_' + q.schluessel] != null);",
    expected: 'Der Trefferkontext an der Antwort'
  },
  {
    nr: '406', name: 'Der genannte Kommentar ist der juengste statt der aeltesten',
    file: 'server.js',
    search: "             ORDER BY k.id LIMIT 1)",
    replacement: "             ORDER BY k.id DESC LIMIT 1)",
    expected: 'Der Trefferkontext an der Antwort'
  },
  {
    /* Nimmt das Feld weg, nicht nur die Vorlage. */
    nr: '407', name: 'Die Kachel baut keine Trefferzeile mehr',
    file: 'public/app.js',
    search: "  const f = it.foundAt;",
    replacement: "  const f = null;",
    expected: 'Die Trefferzeile an der Kachel'
  },
  {
    nr: '408', name: 'Die Trefferzeile rutscht ueber den Titel',
    file: 'public/app.js',
    search: "      <h3 class=\"card-title\">${esc(it.title)}</h3>\n      ${findingRow}",
    replacement: "      ${findingRow}\n      <h3 class=\"card-title\">${esc(it.title)}</h3>",
    expected: 'Die Trefferzeile an der Kachel'
  },
  {
    nr: '409', name: 'Die Zahl der weiteren Stellen faellt aus der Zeile',
    file: 'public/app.js',
    search: "class=\"find-text\"></span>${f.others ? `<span class=\"find-more\">+${f.others}</span>` : ''}",
    replacement: "class=\"find-text\"></span>${''}",
    expected: 'Die Trefferzeile an der Kachel'
  },
  {
    nr: '410', name: 'Der Ueberfahrtext nennt die weiteren Stellen nicht mehr',
    file: 'public/app.js',
    search: "  f.others > 0 ? t('list.moreHits', { n: f.others }) : '');",
    replacement: "  '');",
    expected: 'Die Trefferzeile an der Kachel'
  },
  {
    nr: '411', name: 'Eine unbekannte Quelle faellt aus der Zeile',
    file: 'public/app.js',
    search: "const findingWord = (source) => (FINDING_WORDS[source] || (() => t('list.hitPlace')))();",
    replacement: "const findingWord = (quelle) => (FINDING_WORDS[quelle] || (() => ''))();",
    expected: 'Die Trefferzeile an der Kachel'
  },
  {
    nr: '412', name: 'Der Ausschnitt kommt ueber innerHTML in die Kachel',
    file: 'public/app.js',
    search: "  if (f) a.querySelector('.find-text').replaceChildren(raiseHighlight(f.text, term));",
    replacement: "  if (f) a.querySelector('.find-text').innerHTML = f.text;",
    expected: 'Die Trefferzeile an der Kachel'
  },
  {
    nr: '413', name: 'Die Marke wird ueber innerHTML gefuellt',
    file: 'public/app.js',
    search: "  const m = document.createElement('mark');\n  m.textContent = text;",
    replacement: "  const m = document.createElement('mark');\n  m.innerHTML = text;",
    expected: 'Links im Kommentartext'
  },
  {
    nr: '414', name: 'Der Titel der Kachel wird nicht mehr hervorgehoben',
    file: 'public/app.js',
    search: "  highlightInNode(a.querySelector('.card-title'), it.title, term);",
    replacement: "  hebeImKnoten(a.querySelector('.card-title'), it.title, '');",
    expected: 'Die Hervorhebung in der Uebersicht'
  },
  {
    nr: '415', name: 'Nur die erste Fundstelle wird hervorgehoben',
    file: 'public/app.js',
    search: "    from = i + b.length;\n  }",
    replacement: "    von = i + b.length;\n    break;\n  }",
    expected: 'Die Hervorhebung in der Uebersicht'
  },
  {
    /* Als Muster gelesen findet ein eingegebener Punkt jedes Zeichen. */
    nr: '416', name: 'Der Begriff wird als Muster gelesen',
    file: 'public/app.js',
    search: "    const i = lower.indexOf(lowerB, from);",
    replacement: "    const i = klein.slice(von).search(new RegExp(kleinB, 'i')) < 0 ? -1 : von + klein.slice(von).search(new RegExp(kleinB, 'i'));",
    expected: 'Die Hervorhebung in der Uebersicht'
  },
  {
    nr: '417', name: 'Die Hervorhebung erreicht den Kommentartext nicht mehr',
    file: 'public/app.js',
    search: "        .appendChild(markupNodes(c.text, term, c.mentions));",
    replacement: "        .appendChild(markupNodes(c.text, '', c.mentions));",
    expected: 'Der Suchbegriff in der Adresse'
  },
  {
    nr: '418', name: 'Eine Adresse mit Begriff zerfaellt in mehrere Anker',
    file: 'public/app.js',
    search: "      let j = i;\n      while (j < list.length && String(list[j].target ?? '') === String(s.target))\n        a.appendChild(pieceNode(list[j++]));\n      i = j - 1;",
    replacement: "      a.appendChild(stueckKnoten(s));",
    expected: 'Links im Kommentartext'
  },
  {
    nr: '419', name: 'In der Linkliste wird der Anzeigename hervorgehoben',
    file: 'public/app.js',
    search: "          nameBox.appendChild(s);",
    replacement: "          hebeImKnoten(s, a.name, begriff);\n          nameBox.appendChild(s);",
    expected: 'Der Suchbegriff in der Adresse'
  },
  {
    nr: '420', name: 'Die Adresse in der Linkliste wird nicht mehr hervorgehoben',
    file: 'public/app.js',
    search: "      highlightInNode(row.querySelector('.dom'), top, term);",
    replacement: "      hebeImKnoten(row.querySelector('.dom'), top, '');",
    expected: 'Der Suchbegriff in der Adresse'
  },
  {
    nr: '421', name: 'Das Adressmuster nimmt keinen Begriff mehr an',
    file: 'public/app.js',
    search: "const ENTRY_PATTERN = /^#\\/item\\/(\\d+)(?:\\?(.*))?$/;",
    replacement: "const ENTRY_PATTERN = /^#\\/item\\/(\\d+)$/;",
    expected: 'Der Suchbegriff in der Adresse'
  },
  {
    nr: '422', name: 'Das Adressmuster ist hinten nicht mehr verankert',
    file: 'public/app.js',
    search: "const ENTRY_PATTERN = /^#\\/item\\/(\\d+)(?:\\?(.*))?$/;",
    replacement: "const ENTRY_PATTERN = /^#\\/item\\/(\\d+)/;",
    expected: 'Der Suchbegriff in der Adresse'
  },
  {
    nr: '423', name: 'Die Detailansicht zieht die Adresse nicht mehr nach',
    file: 'public/app.js',
    search: "  if (location.hash !== wanted &&\n      typeof history !== 'undefined' && typeof history.replaceState === 'function')\n    history.replaceState(null, '', wanted);",
    replacement: "  void gewollt;",
    expected: 'Der Suchbegriff in der Adresse'
  },
  {
    nr: '424', name: 'Die Adresse wird ueber location.hash gesetzt',
    file: 'public/app.js',
    search: "    history.replaceState(null, '', wanted);",
    replacement: "    location.hash = gewollt;",
    expected: 'Der Suchbegriff in der Adresse'
  },
  {
    nr: '425', name: 'Die Kachel haengt den Begriff nicht an ihre Adresse',
    file: 'public/app.js',
    search: "  a.href = entryAddress(it.id, term);",
    replacement: "  a.href = entryAddress(it.id, '');",
    expected: 'Die Trefferzeile an der Kachel'
  },
  {
    nr: '426', name: 'Der Begriff aus der Adresse wird nicht entschluesselt',
    file: 'public/app.js',
    search: "  try { return new URLSearchParams(askKey || '').get('q') || ''; }",
    replacement: "  try { return (String(frage || '').match(/(?:^|&)q=([^&]*)/) || [])[1] || ''; }",
    expected: 'Der Suchbegriff in der Adresse'
  },
  {
    nr: '427', name: 'Die Marke bringt wieder Schwarz auf Gelb mit',
    file: 'public/style.css',
    search: "mark {\n  background: var(--accent-dim); color: var(--accent-text-hi);",
    replacement: "mark {\n  border-radius: 3px;",
    expected: 'Die Trefferzeile im Stylesheet'
  },
  {
    nr: '428', name: 'Die Trefferzeile darf wieder umbrechen',
    file: 'public/style.css',
    search: "  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n}\n/* Die Zahl in der Schreibmaschinenschrift",
    replacement: "}\n/* Die Zahl in der Schreibmaschinenschrift",
    expected: 'Die Trefferzeile im Stylesheet'
  },
  {
    nr: '429', name: 'Die Quelle gibt in der Trefferzeile nach statt der Ausschnitt',
    file: 'public/style.css',
    search: ".card-find .find-source { flex-shrink: 0; color: var(--faint); font-weight: 600; }",
    replacement: ".card-find .find-source { color: var(--faint); font-weight: 600; }",
    expected: 'Die Trefferzeile im Stylesheet'
  },

  /* ---- Der Deckel der Sitzungsliste, die leere Message ---- */
  {
    /* 48.37rem ohne die Fusszeile; sie steht ausserhalb der rollenden
       Liste. */
    nr: '430', name: 'Die Sitzungsliste deckelt wieder nach der fremden Zeile',
    file: 'public/style.css',
    search: "#msessions { max-height: 48.37rem; }",
    replacement: "#msessions-ohne-deckel { max-height: 27.95rem; }",
    expected: 'So hoch wie der Inhalt — 0.17.5'
  },

  /* ---- Die Bildablage ---- */
  {
    nr: '431', name: 'Ein ankommendes PNG wird gar nicht mehr umgewandelt',
    file: 'images.js',
    search: "  if (!recipe || !isPng(buf)) return { data: buf, mime: reportedType, converted: false };",
    replacement: "  if (true) return { data: buf, mime: reportedType, umgewandelt: false };",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '432', name: 'Der mime_type wird nicht mitgezogen',
    file: 'images.js',
    search: "      return { data: webp, mime: 'image/webp', converted: true };",
    replacement: "      return { data: webp, mime: reportedType, umgewandelt: true };",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '433', name: 'Auch ein groesseres Ergebnis wird genommen',
    file: 'images.js',
    search: "    if (webp.length < buf.length)",
    replacement: "    if (true)",
    expected: '(erwartet STUMM — achtzehn Laborversuche ohne Gegenbeispiel, und am echten Bestand 679 von 679 umgestellt; nur die Kantengrenze laesst PNG liegen, und die ist Rueckbau 458)'
  },
  {
    /* WebP fasst hoechstens 16383 px je Kante. */
    nr: '458', name: 'Ein Bild, das WebP nicht fassen kann, reisst den Upload ab',
    file: 'images.js',
    search: "    logFail('PNG blieb PNG:', e.message);",
    replacement: "    throw e;",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '434', name: 'Die Erkennung glaubt dem gemeldeten Typ',
    file: 'images.js',
    search: "  Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC);",
    replacement: "  Buffer.isBuffer(buf) && buf.length >= 8;",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '435', name: 'Der verlustbehaftete Kodierer statt nearLossless',
    file: 'images.js',
    search: "  'webp-lossless': { nearLossless: true, quality: 60, effort: 4 },",
    replacement: "  'webp-lossless': { quality: 60, effort: 4 },",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '436', name: 'Der Schalter wirkt nicht mehr -- es wird immer umgewandelt',
    file: 'server.js',
    search: "  const v = getSetting('imageStore', IMAGE_STORE_DEFAULT);",
    replacement: "  const v = IMAGE_STORE_DEFAULT;",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '437', name: 'Der Schalter der Bildablage ist nur noch Adminsache',
    file: 'server.js',
    search: "const OWNER_KEYS = ['imageStore',\n" +
           "                                'backupCleanup', 'backupKeep', 'backupDays',\n",
    replacement: "const OWNER_KEYS = ['backupCleanup', 'backupKeep', 'backupDays',\n",
    expected: 'Die Bildablage: die Rechte'
  },
  {
    nr: '438', name: 'Die Umstellung laeuft ohne zweite Bestaetigung',
    file: 'server.js',
    search: "app.post('/api/images/convert', ownerOnly, secondConfirmNeeded('images'), (req, res) => {",
    replacement: "app.post('/api/images/convert', ownerOnly, (req, res) => {",
    expected: 'Die Bildablage: die Rechte'
  },
  {
    nr: '439', name: 'Zweimal druecken startet zwei Laeufe',
    file: 'server.js',
    search: "  if (batchStates.conversion && batchStates.conversion.running)\n    return res.status(409).json({ error: t(localeOf(req), 'server.convertRunning')});",
    replacement: "  if (false)\n    return res.status(409).json({ error: t(localeOf(req), 'server.convertRunning')});",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '440', name: 'Der Fortschritt steht nicht mehr in den Kennzahlen',
    file: 'server.js',
    search: "const batchState = (task) =>\n  batchStates[task] && { ...batchStates[task] };",
    replacement: "const batchState = () => null;",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '441', name: 'Die Aufstellung nach Format faellt aus den Kennzahlen',
    file: 'server.js',
    search: "    imageFormats,\n",
    replacement: "",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },

  /* ---- Der engere Ausschnitt ---- */
  {
    nr: '442', name: 'Der Zoomwert wird gar nicht erst gespeichert',
    file: 'server.js',
    search: "  db.prepare('UPDATE photos SET focus_x = ?, focus_y = ?, zoom = ? WHERE id = ?')\n    .run(x, y, z, req.params.id);",
    replacement: "  db.prepare('UPDATE photos SET focus_x = ?, focus_y = ? WHERE id = ?')\n    .run(x, y, req.params.id);",
    expected: 'Fokuspunkt der Vorschau'
  },
  {
    nr: '443', name: 'Der Zoomwert wird nicht mehr beschnitten',
    file: 'server.js',
    search: "  zoom:    { min: ZOOM_MIN, max: ZOOM_MAX, fallback: ZOOM_MIN, digits: 0 }",
    replacement: "  zoom:    { min: 0, max: 100000, vorgabe: ZOOM_MIN, stellen: 0 }",
    expected: 'Fokuspunkt der Vorschau'
  },
  {
    nr: '444', name: 'Ein Ruf ohne Zoomwert setzt ihn auf die Vorgabe zurueck',
    file: 'server.js',
    search: "  let z = p.zoom;\n  if (req.body.zoom !== undefined) {",
    replacement: "  let z = ANZEIGEWERTE.zoom.vorgabe;\n  if (req.body.zoom !== undefined) {",
    expected: 'Fokuspunkt der Vorschau'
  },
  {
    nr: '445', name: 'Der Ausschnitt geht nicht in die Exportdatei',
    file: 'server.js',
    search: "        const z = { mime_type: p.mime_type, focus_x: p.focus_x, focus_y: p.focus_y,\n                    zoom: p.zoom, kind: p.kind };",
    replacement: "        const z = { mime_type: p.mime_type, focus_x: p.focus_x, focus_y: p.focus_y,\n                    art: p.art };",
    expected: 'Fokuspunkt der Vorschau'
  },
  {
    nr: '446', name: 'Der eingespielte Ausschnitt wird verworfen',
    file: 'server.js',
    search: "                    fx: crop.fx, fy: crop.fy, zoom: crop.zoom,",
    replacement: "                    fx: 50, fy: 50, zoom: ANZEIGEWERTE.zoom.vorgabe,",
    expected: 'Fokuspunkt der Vorschau'
  },
  {
    /* Derselbe Suchtext wie 233; geprueft wird hier die Exportdatei. */
    nr: '448', name: 'Die Formatnummer bleibt bei 15, obwohl das Faelligkeitsdatum mitgeht',
    file: 'server.js',
    search: "const EXCHANGE_FORMAT = 19;",
    replacement: "const EXCHANGE_FORMAT = 15;",
    expected: 'Die Exportdatei'
  },

  /* ---- Die Bildablage in der Oberflaeche ---- */
  {
    nr: '449', name: 'Der Zoom kommt nicht in den Zuschnitt (bis 0.19.4: nicht an die Kachel)',
    file: 'batchrun.js',
    search: "                               zoom: Number(z.zoom) });",
    replacement: "                               zoom: 100 });",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '450', name: 'Der Schieber fuer die Weite steht nicht mehr im Betrachter',
    file: 'public/app.js',
    search: "      ${cropMode && !showsVideo ? `<div class=\"vzoom\">",
    replacement: "      ${false ? `<div class=\"vzoom\">",
    expected: 'Fokuspunkt in der Oberflaeche'
  },
  {
    nr: '451', name: 'Der Schieber schickt bei jedem Zwischenschritt',
    file: 'public/app.js',
    search: "        draw();\n      };\n      slider.onchange = save;",
    replacement: "        zeichne();\n        speichere();\n      };\n      schieber.onchange = speichere;",
    expected: 'Fokuspunkt in der Oberflaeche'
  },
  {
    nr: '452', name: 'Der Griff an den Schieber setzt den Fokuspunkt mit',
    file: 'public/app.js',
    search: "      if (e.target.closest('.vfocus, .vnav, .vzoom')) return;",
    replacement: "      if (e.target.closest('.vfocus, .vnav')) return;",
    expected: 'Fokuspunkt in der Oberflaeche'
  },
  {
    nr: '453', name: 'Die Ueberfahrregel haengt wieder am Ausschnitt',
    file: 'public/style.css',
    search: ".card:hover .card-img img { transform: scale(1.02); }",
    replacement: ".card:hover .card-img img { transform: scale(calc(var(--zoom, 1) * 1.02)); }",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '454', name: 'Der Knopf der Umstellung fragt kein Passwort',
    file: 'public/app.js',
    search: "      const ok = await secondConfirm('images', null, t('card.catchUpStore'),",
    replacement: "      const ok = true || await secondConfirm('images', null, t('card.catchUpStore'),",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '455', name: 'Der Dialog sagt nicht mehr, was verloren geht',
    file: 'public/app.js',
    search: "        t('card.catchUpAsk', { n: png.count, bytes: fmtBytes(png.bytes),",
    replacement: "        `${png.count} PNG-Fotos werden umgestellt.` || t('card.catchUpAsk', { n: png.count, bytes: fmtBytes(png.bytes),",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '456', name: 'Der Knopf bleibt bedienbar, obwohl kein PNG mehr dasteht',
    file: 'public/app.js',
    search: "id=\"convert-run\"${running || !(png && IMAGE_STORE !== 'png') ? ' disabled' : ''}",
    replacement: "id=\"convert-run\"${''}",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '457', name: 'Schalter und Knopf stehen jedem Admin',
    file: 'public/app.js',
    search: "        ${OWNER ? `\n        ${/* Knopf „Standard\" je Zeile",
    replacement: "        ${true ? `\n        ${/* Knopf „Standard\" je Zeile",
    expected: 'Die Bildablage in der Oberflaeche'
  },

  /* ---- Bildablage und Betrieb ---- */
  {
    nr: '460', name: 'Die Aufteilung nach Format liest wieder den Inhalt',
    file: 'server.js',
    search: "    SELECT mime_type AS m, length(data) AS o FROM photos WHERE kind IS ?)",
    replacement: "    SELECT CASE\n" +
            "             WHEN hex(substr(data,1,8)) = '89504E470D0A1A0A' THEN 'image/png'\n" +
            "             WHEN hex(substr(data,1,3)) = 'FFD8FF'           THEN 'image/jpeg'\n" +
            "             WHEN hex(substr(data,1,4)) = '52494646'\n" +
            "              AND hex(substr(data,9,4)) = '57454250'         THEN 'image/webp'\n" +
            "             WHEN hex(substr(data,1,3)) = '474946'           THEN 'image/gif'\n" +
            "             ELSE 'other'\n" +
            "           END AS m, length(data) AS o FROM photos WHERE kind IS ?)",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '461', name: 'Die Arten kommen wieder aus dem Satz statt aus dem Index',
    file: 'server.js',
    search: "const qImageKinds = lateStatement('SELECT kind AS a FROM photos GROUP BY 1');",
    replacement: "const qImageKinds = lateStatement('SELECT DISTINCT kind || \\'\\' AS a FROM photos');",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '462', name: 'Der Knopf sucht am gemeldeten Typ statt am Inhalt',
    file: 'server.js',
    search: "  \"SELECT id FROM photos WHERE kind != 'video'\");",
    replacement: "  \"SELECT id FROM photos WHERE kind != 'video' AND mime_type = 'image/png'\");",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    /* Ohne Zuordnung faellt jede Zeile in 'other'. */
    nr: '463', name: 'Die Zuordnung von mime_type auf den Schluessel ist leer',
    file: 'server.js',
    search: "const IMAGE_MIME_FORMAT = {\n  'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif'\n};",
    replacement: "const IMAGE_MIME_FORMAT = {};",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '464', name: 'Der Zuschnitt verliert eine seiner beiden Achsen (bis 0.19.4: transform-origin)',
    file: 'images.js',
    search: "  return { links: fx / 100 * (width - tight), top: fy / 100 * (height - tight), edge: tight };",
    replacement: "  return { links: fx / 100 * (breite - eng), top: 0, kante: eng };",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '465', name: 'Der Zuschnitt sitzt in der Mitte statt auf dem Fokuspunkt',
    file: 'images.js',
    search: "  const k = cropSpecBox(width, height, cropSpec.fx, cropSpec.fy, cropSpec.zoom);",
    replacement: "  const k = cropSpecBox(breite, hoehe, 50, 50, zuschnitt.zoom);",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '466', name: 'Der Dialog liegt wieder unter dem Vollbild',
    file: 'public/style.css',
    search: "  --z-dialog: 100;",
    replacement: "  --z-dialog: 60;",
    expected: 'Die Stapelordnung — 0.19.1'
  },
  {
    nr: '467', name: 'Der Dialog traegt seine Stufe wieder als Zahl in der Regel',
    file: 'public/style.css',
    search: "padding: 22px; z-index: var(--z-dialog);",
    replacement: "padding: 22px; z-index: 60;",
    expected: 'Die Stapelordnung — 0.19.1'
  },
  {
    nr: '468', name: 'Die Meldung liegt unter dem Dialog',
    file: 'public/style.css',
    search: "  --z-toast: 120;",
    replacement: "  --z-toast: 95;",
    expected: 'Die Stapelordnung — 0.19.1'
  },
  {
    nr: '469', name: 'Die Bildablage faellt aus der Kartentabelle',
    file: 'public/app.js',
    search: "  { key: 'imagestore',   section: 'database', visible: () => ADMIN,\n" +
           "    markup: cardImageStore,   wireUp: setUpImageStoreOut },\n",
    replacement: "",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '470', name: 'Die Karte „Bildablage" steht im Abschnitt „Bestand"',
    file: 'public/app.js',
    search: "  { key: 'imagestore',   section: 'database',",
    replacement: "  { schluessel: 'imagestore',   abschnitt: 'inventory',",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '471', name: 'Die Karte „Bildablage" verschwindet ohne Bilder',
    file: 'public/app.js',
    search: "  { key: 'imagestore',   section: 'database', visible: () => ADMIN,",
    replacement: "  { key: 'imagestore',   section: 'database',\n" +
            "    sichtbar: (g) => ADMIN && !!Object.keys((g.stats && g.stats.bildFormate) || {}).length,",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '472', name: 'Der Dialog sagt nicht mehr, dass es dauern kann',
    file: 'public/languages/de.json',
    search: "werden konvertiert, die Originale ersetzt (danach etwa {after}). Rückgängig nur mit einem vorher angelegten Backup. Dauer: Minuten bis Stunden.\"",
    replacement: "werden konvertiert, die Originale ersetzt (danach etwa {after}). Rückgängig nur mit einem vorher angelegten Backup.\"",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '473', name: 'Der Dialog erfindet doch eine Minutenangabe',
    file: 'public/languages/de.json',
    search: "Rückgängig nur mit einem vorher angelegten Backup. Dauer: Minuten bis Stunden.\"\n  },",
    replacement: "Rückgängig nur mit einem vorher angelegten Backup. Dauer: etwa 20 Minuten.\"\n  },",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '474', name: 'Die Threadzahl von sharp wird nicht mehr gesetzt',
    file: 'server.js',
    search: "sharp.concurrency(Math.max(1, Math.floor(os.cpus().length / 2)));",
    replacement: "",
    expected: 'Die Threadzahl von sharp — 0.19.1'
  },
  {
    nr: '475', name: 'Die Threadzahl von sharp ist die volle Kernzahl',
    file: 'server.js',
    search: "Math.max(1, Math.floor(os.cpus().length / 2))",
    replacement: "os.cpus().length",
    expected: 'Die Threadzahl von sharp — 0.19.1'
  },
  {
    nr: '477', name: 'Die docker-compose.yml steht nicht mehr in der .gitignore',
    file: '.gitignore',
    search: "\ndocker-compose.yml",
    replacement: "",
    expected: 'Die Compose-Datei wird nicht ueberschrieben'
  },
  {
    nr: '478', name: 'Die README nennt den Pflichtschritt zur Compose-Datei nicht mehr',
    file: 'README.md',
    search: "**Der Schritt `cp docker-compose.example.yml docker-compose.yml` ist Pflicht.**",
    replacement: "",
    expected: 'Die Compose-Datei wird nicht ueberschrieben'
  },
  {
    nr: '479', name: 'Die Berichtigung zu substr() faellt aus dem Quelltext',
    file: 'server.js',
    search: "     substr() auf einem Blob, 205 MB               657 ms */",
    replacement: "     substr() liest wenig, 205 MB                  657 ms */",
    expected: 'Die berichtigten Behauptungen stehen nirgends mehr'
  },

  /* ---- Indizes, Rahmen und alte Adressen ---- */
  {
    nr: '480', name: 'Der Index auf photos(art) faellt weg',
    file: 'db.js',
    search: "tryIndex('idx_photos_kind',\n  'CREATE INDEX IF NOT EXISTS idx_photos_kind ON photos(kind)');",
    replacement: "",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '486', name: 'Der Index steht wieder vor seiner Migration',
    file: 'db.js',
    search: "CREATE INDEX IF NOT EXISTS idx_photos_item ON photos(item_id, sort_order);",
    replacement: "CREATE INDEX IF NOT EXISTS idx_photos_item ON photos(item_id, sort_order);\n" +
            "CREATE INDEX IF NOT EXISTS idx_photos_kind ON photos(kind);",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '481', name: 'Die Aufteilung fragt wieder mit einer Ungleichheit',
    file: 'server.js',
    search: "  'SELECT COUNT(*) AS n, COALESCE(SUM(length(data)),0) AS o FROM photos WHERE kind IS ?');",
    replacement: "  \"SELECT COUNT(*) AS n, COALESCE(SUM(length(data)),0) AS o FROM photos WHERE kind != 'video' AND ? IS NOT NULL\");",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    /* Die Frage nach `art != 'video'` kostet gemessen 1363 und 1310 ms
       zusaetzlich. */
    nr: '482', name: 'Die Exportgroesse der Bilder wird ein zweites Mal gefragt',
    file: 'server.js',
    search: "      ...exchangeParts({ withFiles: true }),",
    replacement: "      ...exchangeParts({ mitFotos: true, mitDateien: true, mitVideos: true }),",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '483', name: 'Der Spielraum des Ausschnitts rechnet den Zoom nicht ein',
    file: 'public/app.js',
    search: "               playX: f.width - k.edge, playY: f.height - k.edge };",
    replacement: "               playX: f.breite - Math.min(f.breite, f.hoehe), playY: f.hoehe - Math.min(f.breite, f.hoehe) };",
    expected: 'Fokuspunkt in der Oberflaeche'
  },
  {
    /* Gerechnet wird mit der vollen Seite statt mit dem engeren Ausschnitt. */
    nr: '484', name: 'Der Griff setzt den Punkt neben die Mitte des Rahmens',
    file: 'public/app.js',
    search: "      fx = playX > 0 ? Math.min(100, Math.max(0, (px - eng / 2) / playX * 100)) : 50;",
    replacement: "      fx = playX > 0 ? Math.min(100, Math.max(0, (px - seite / 2) / playX * 100)) : 50;",
    expected: 'Fokuspunkt in der Oberflaeche'
  },
  {
    nr: '485', name: 'Der Dialog sagt nicht mehr, dass es verlustfrei ist',
    file: 'public/languages/de.json',
    search: "\"card.storeLosslessHint\": \"Vorgabe — verlustfrei, gemessen rund zwei Drittel kleiner\",",
    replacement: "\"card.storeLosslessHint\": \"Vorgabe — gemessen rund zwei Drittel kleiner\",",
    expected: 'Die Bildablage in der Oberflaeche'
  },

  {
    nr: '487', name: 'Die Uebersetzung der alten Abschnittsadressen kommt zurueck',
    file: 'public/app.js',
    search: "  const desired = fromAddress;",
    replacement: "  const gewuenscht = { anlage: 'installation', instanz: 'installation' }[ausDerAdresse] || ausDerAdresse;",
    expected: 'Der fuenfte Abschnitt heisst „Installation" — 0.17.1, 0.19.1 und 0.19.2'
  },

  {
    nr: '488', name: 'Der deckende Index fuer die Uebersicht faellt weg',
    file: 'db.js',
    search: "tryIndex('idx_photos_tile', `CREATE INDEX IF NOT EXISTS idx_photos_tile",
    replacement: "tryIndex('idx_photos_tile', `SELECT 1 -- (",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    /* Fehlt eine Spalte, nimmt SQLite idx_photos_item und liest wieder die
       ganze Zeile. */
    nr: '489', name: 'Dem deckenden Index fehlt eine Spalte',
    file: 'db.js',
    search: "zoom, created_at, kind, duration, length(thumb))`);",
    replacement: "zoom, art, dauer)`);",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '490', name: 'Die Uebersicht fragt die Fotos wieder je Eintrag',
    file: 'server.js',
    search: "    const ph = photosPer.get(it.id) || [];",
    replacement: "    const ph = qPhotos.all(it.id);",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },

  /* ---- Der Bestandslauf im eigenen Thread ---- */
  {
    nr: '491', name: 'Der Thread meldet seinen Stand erst am Ende',
    file: 'batchrun.js',
    /* Die dritte Zeile macht den Suchtext eindeutig; die ersten zwei stehen
       auch in der dritten Schleife. */
    search: "    status.done++;\n    report(status);\n    await new Promise(r => setTimeout(r, 30));",
    replacement: "    stand.done++;\n    await new Promise(r => setTimeout(r, 30));",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },
  {
    nr: '492', name: 'Der Haupt-Thread hoert die Meldungen des Threads nicht mehr',
    file: 'server.js',
    search: "  w.on('message', (m) => { if (m && m.kind === 'status') batchStates[task] = m.status; });",
    replacement: "  w.on('message', () => {});",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '493', name: 'Der Schluessel reist ueber workerData in den Thread',
    file: 'server.js',
    search: "  const w = new Worker(BATCHRUN, { workerData: { task, rows, store } });",
    replacement: "  const w = new Worker(BESTANDSLAUF, { workerData: { aufgabe, zeilen, schluessel: keyHex } });",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },
  {
    nr: '494', name: 'SIGTERM kuerzt die WAL, waehrend der Thread noch schreibt',
    file: 'server.js',
    search: "    for (const w of batchThreads) { try { w.terminate(); } catch {} }",
    replacement: "    // die Threads laufen weiter",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },
  {
    nr: '495', name: 'Ein Fehler im Thread laesst den Lauf auf „laeuft" stehen',
    file: 'server.js',
    search: "    if (batchStates[task]) batchStates[task].running = false;",
    replacement: "    if (false) batchStates[aufgabe].laeuft = false;",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },
  {
    nr: '496', name: 'Der Fingerprint kennt die Datei des Threads nicht',
    file: 'server.js',
    search: "  const list = [...new Set([...ran, BATCHRUN,",
    replacement: "  const liste = [...new Set([...ausgefuehrt,",
    expected: 'Der Versions-Fingerprint'
  },
  {
    nr: '497', name: 'Der Thread ueberlaesst sharp seine Vorgabe',
    file: 'batchrun.js',
    search: "sharp.concurrency(Math.max(1, Math.floor(os.cpus().length / 2)));",
    replacement: "// sharp nimmt sich, was es will",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },
  {
    nr: '498', name: 'Der Schluesselhinweis wiederholt sich in jedem Thread',
    file: 'keys.js',
    search: "function warnKeyBesideData() {\n  if (!isMainThread) return;",
    replacement: "function warnKeyBesideData() {",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },

  /* ---- Die Uebersicht fragt einmal und holt nur, was sie zeigt ---- */
  {
    nr: '499', name: 'Die gebuendelten Schlagworte verlieren ihre zweite Ordnung',
    file: 'server.js',
    search: "  JOIN item_tags it ON it.tag_id = t.id ORDER BY it.item_id, t.name COLLATE NOCASE`);",
    replacement: "  JOIN item_tags it ON it.tag_id = t.id ORDER BY it.item_id`);",
    expected: 'Die Uebersicht fragt einmal — und Kachel und Eintrag sagen dasselbe — 0.19.3'
  },
  {
    nr: '500', name: 'Die gebuendelten Testtage verlieren ihre zweite Ordnung',
    file: 'server.js',
    search: "  'SELECT item_id, id, day, rating, user_id FROM test_days ORDER BY item_id, day DESC, id DESC');",
    replacement: "  'SELECT item_id, id, day, rating, user_id FROM test_days ORDER BY item_id');",
    expected: 'Die Uebersicht fragt einmal — und Kachel und Eintrag sagen dasselbe — 0.19.3'
  },
  {
    nr: '501', name: 'Die Linkzahl fehlt ganz, wo kein Link ist',
    file: 'server.js',
    search: "    it.linkCount = linkCountPer.get(it.id) || 0;",
    replacement: "    it.linkCount = linkCountPer.get(it.id);",
    expected: 'Die Uebersicht fragt einmal — und Kachel und Eintrag sagen dasselbe — 0.19.3'
  },
  {
    nr: '502', name: 'Die gebuendelte Schlagwortabfrage liest eine Spalte mehr',
    file: 'server.js',
    search: "const qAllTags = db.prepare(`SELECT it.item_id, ${TAG_COLUMNS} FROM tags t",
    replacement: "const qAllTags = db.prepare(`SELECT it.item_id, t.id, t.name, t.created_at FROM tags t",
    expected: 'Die Uebersicht fragt einmal — und Kachel und Eintrag sagen dasselbe — 0.19.3'
  },
  {
    /* Bei 400 Eintraegen sind das 1200 Einzelabfragen. */
    nr: '503', name: 'Die Testtage der Liste tragen wieder Schlagworte und Verfasser',
    file: 'server.js',
    search: "    if (timeline) it.testDays = testDaysPer.get(it.id) || [];",
    replacement: "    if (timeline) it.testDays = qTestDays(it.id, req.user.id, karte);",
    expected: 'Die Uebersicht fragt einmal — und Kachel und Eintrag sagen dasselbe — 0.19.3'
  },
  {
    nr: '504', name: 'Die Schlagwortabfrage liest wieder alle Spalten',
    file: 'server.js',
    search: "const TAG_COLUMNS = 't.id, t.name';",
    replacement: "const TAG_COLUMNS = 't.*';",
    expected: 'Die Uebersicht fragt einmal — und Kachel und Eintrag sagen dasselbe — 0.19.3'
  },

  /* ---- Das Wort „Instanz" im Bildschirmtext ---- */
  {
    nr: '505', name: 'Eine Stelle im Bildschirmtext sagt wieder „Instanz"',
    file: 'public/languages/de.json',
    search: "\"card.emailOptionalHint\": \"**E-Mail ist optional.** Ohne Mailzugang zeigt Kriterion",
    replacement: "\"card.emailOptionalHint\": \"**E-Mail ist optional.** Ohne Mailzugang zeigt die Instanz",
    expected: '„Instanz" steht in keinem Bildschirmtext mehr — 0.19.1 und 0.19.3'
  },

  /* ---- Die Ableitung folgt der Anzeige ---- */
  /* Jeder Rueckbau aendert eine Zahl; einer, der die ganze Tafel umwirft,
     zeigte nur, dass irgendetwas an den Ableitungen haengt. */
  {
    /* Der Deckel bleibt, damit nur diese eine Zahl gemessen wird. */
    nr: '506', name: 'Die kurze Kante des thumb steht wieder auf 400',
    file: 'images.js',
    search: "  thumb:  { short: 512,  long: 1280, q: 82, crops: true  },",
    replacement: "  thumb:  { kurz: 400,  lang: 1280, q: 82, schneidet: true  },",
    expected: 'Die Ableitung folgt der Anzeige — 0.19.4'
  },
  {
    nr: '507', name: 'Der Deckel auf der langen Kante faellt weg',
    file: 'images.js',
    search: "long: 1280, q: 82, crops: true  }",
    replacement: "lang: 99999, q: 82, schneidet: true  }",
    expected: 'Die Ableitung folgt der Anzeige — 0.19.4'
  },
  {
    nr: '508', name: 'medium bekommt dieselbe Kiste wie thumb',
    file: 'images.js',
    search: "  medium: { short: 1600, long: 1600, q: 78, crops: false }",
    replacement: "  medium: { kurz: 512, lang: 1280, q: 78, schneidet: false }",
    expected: 'Die Ableitung folgt der Anzeige — 0.19.4'
  },
  {
    nr: '509', name: 'Der EXIF-Vermerk zaehlt bei der Kante nicht mehr mit',
    file: 'images.js',
    search: "  const rotated = m && m.orientation >= 5;",
    replacement: "  const gedreht = false;",
    expected: 'Die Ableitung folgt der Anzeige — 0.19.4'
  },
  {
    nr: '510', name: 'Der Kopf wird nicht gelesen -- die Kiste liegt immer quer',
    file: 'images.js',
    search: "  const landscape = size ? isLandscape(size) : true;",
    replacement: "  const quer = true;",
    expected: 'Die Ableitung folgt der Anzeige — 0.19.4'
  },
  {
    nr: '511', name: 'Die Faelligkeit wird wieder an der Zielkante erkannt',
    file: 'images.js',
    search: "  return size.width !== size.height;",
    replacement: "  return masse.width !== masse.height || masse.width !== VARIANTS.thumb.kurz;",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '512', name: 'Ein unlesbarer thumb bleibt liegen',
    file: 'images.js',
    search: "  catch { return true; }",
    replacement: "  catch { return false; }",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },
  {
    nr: '513', name: 'Der Lauf erneuert jede Zeile, nicht nur die faelligen',
    file: 'batchrun.js',
    search: "        if (await isUncropped(z.thumb)) {",
    replacement: "        if (true) {",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },
  {
    nr: '514', name: 'Der Lauf schreibt auch, wenn die Ableitung leer zurueckkommt',
    file: 'batchrun.js',
    search: "  if (!v.thumb) return null;",
    replacement: "  if (!v.thumb) v.thumb = null;",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },
  {
    /* Wie 491, eine Schleife weiter. */
    nr: '515', name: 'Das Nachziehen meldet seinen Stand erst am Ende',
    file: 'batchrun.js',
    search: "    status.done++;\n    report(status);\n    // 30 ms Pause je Zeile",
    replacement: "    status.done++;\n    // 30 ms Pause je Zeile",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },
  {
    nr: '516', name: 'Das Nachziehen gibt seine Seiten nicht frei',
    file: 'batchrun.js',
    search: "  reclaim();\n  report(status);\n  logLine(`Tiles renewed:",
    replacement: "  melde(stand);\n  logLine(`Tiles renewed:",
    expected: '(erwartet STUMM — die Wirkung ist eine Dateigroesse, und die waechst in dieser Runde ohnehin)'
  },
  {
    nr: '517', name: 'Das Nachziehen wird beim Start nicht mehr gerufen',
    file: 'server.js',
    search: "  if (!open.length) return refreshTiles();",
    replacement: "  if (!open.length) return maintainStorage();",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },
  {
    nr: '518', name: 'Die Auswahl der faelligen Zeilen verengt sich auf ein Wort',
    file: 'server.js',
    search: "const qTileRows = db.prepare('SELECT id FROM photos');",
    replacement: "const qTileRows = db.prepare(\"SELECT id FROM photos WHERE kind IS 'image'\");",
    expected: 'Der Bestandslauf faehrt in einem eigenen Thread — 0.19.3'
  },
  {
    nr: '519', name: 'Die Fortschrittszeile des Nachziehens faellt aus der Karte',
    file: 'public/app.js',
    search: "        ${geometryRow(stats.geometry)}",
    replacement: "",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '520', name: 'Die Zeile des Nachziehens steht auch ohne Fund da',
    file: 'public/app.js',
    search: "  if (!g.renewed && !g.skipped) return '';",
    replacement: "  if (false) return '';",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '521', name: 'Die Uhr verfolgt nur noch die Umstellung',
    file: 'public/app.js',
    search: "  { field: 'geometry', id: 'thumbs-running',",
    replacement: "  { feld: 'gibtsnicht', id: 'gibtsnicht',",
    expected: 'Die Ableitung folgt der Anzeige — 0.19.4'
  },
  {
    nr: '522', name: 'Die Karte nennt wieder 400 px, ohne die Kante zu sagen',
    file: 'public/languages/de.json',
    search: "(WebP) sind nicht mitgezählt.\"",
    replacement: "(WebP, 400 px) sind nicht mitgezählt.\"",
    expected: 'Die Bildablage in der Oberflaeche'
  },

  /* ---- Der Ausschnitt steckt in der Kachel ---- */
  {
    nr: '523', name: 'Die Kachel wird wieder ungeschnitten abgeleitet',
    file: 'images.js',
    search: "  thumb:  { short: 512,  long: 1280, q: 82, crops: true  },",
    replacement: "  thumb:  { kurz: 512,  lang: 1280, q: 82, schneidet: false },",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '524', name: 'medium wird mitgeschnitten',
    file: 'images.js',
    search: "  medium: { short: 1600, long: 1600, q: 78, crops: false }",
    replacement: "  medium: { kurz: 1600, lang: 1600, q: 78, schneidet: true }",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '525', name: 'Der Zuschnitt rechnet in den gespeicherten statt in den gedrehten Massen',
    file: 'images.js',
    search: "  const { width, height } = rotatedSize(size);",
    replacement: "  const breite = masse.width, hoehe = masse.height;",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '526', name: 'Die Zuschnittkiste wird nicht gegen den Rand geklammert',
    file: 'images.js',
    search: "  return { left:  Math.max(0, Math.min(width - edge, Math.round(k.links))),\n           top:   Math.max(0, Math.min(height  - edge, Math.round(k.top))),",
    replacement: "  return { left:  Math.round(k.links) + 1,\n           top:   Math.round(k.top) + 1,",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    /* Ohne `withoutEnlargement` wird ein Ausschnitt unter der Zielkante auf
       512 px vergroessert. */
    nr: '527', name: 'Ein zu kleiner Ausschnitt wird auf die Zielkante hochgerechnet',
    file: 'images.js',
    search: "withoutEnlargement: true })",
    replacement: "withoutEnlargement: false })",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '528', name: 'Beim Hochladen wird die Kachel nicht zugeschnitten',
    file: 'server.js',
    search: "      const v = await makeVariants(f.buffer, DEFAULT_CROP);",
    replacement: "      const v = await makeVariants(f.buffer);",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '529', name: 'Beim Einspielen wird die Kachel nicht zugeschnitten',
    file: 'server.js',
    search: "      const v = template ? await makeVariants(template, crop) : { thumb: null, medium: null };",
    replacement: "      const v = vorlage ? await makeVariants(vorlage) : { thumb: null, medium: null };",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '530', name: 'Der Bestandslauf erneuert ohne Zuschnitt',
    file: 'batchrun.js',
    search: "  const v = await makeVariants(source, cropFrom(z));",
    replacement: "  const v = await makeVariants(vorlage);",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '531', name: 'Die Videozeile erzeugt aus der Videodatei statt aus ihrem Standbild',
    file: 'batchrun.js',
    search: "const sourceFrom = (z) => (isVideoRow(z) ? z.medium : z.data);",
    replacement: "const sourceFrom = (z) => z.data;",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '532', name: 'Der Thread kennt die Aufgabe zuschnitt nicht',
    file: 'batchrun.js',
    search: "  else if (workerData.task === 'crop') await refreshOneTile(workerData.rows);\n",
    replacement: "",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '533', name: 'Das Ergebnis der einzelnen Zeile wird nicht gemeldet',
    file: 'batchrun.js',
    search: "  parentPort.postMessage({ kind: 'refreshed', id, ok });",
    replacement: "",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '534', name: 'Das Speichern des Ausschnitts erzeugt die Kachel nicht neu',
    file: 'server.js',
    search: "  refreshTile(req.params.id, () => res.json(detail(p.item_id, req.user.id, localeOf(req))));",
    replacement: "  res.json(detail(p.item_id, req.user.id, localeOf(req)));",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '535', name: 'Die Antwort kommt, bevor die Kachel steht',
    file: 'server.js',
    search: "  const clock = setTimeout(once, REFRESH_MS);",
    replacement: "  const uhr = setTimeout(einmal, 0);",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '536', name: 'Die Fassung faellt aus der Fotoabfrage',
    file: 'server.js',
    search: "const PHOTO_VERSION = 'length(thumb) AS thumbLength';",
    replacement: "const PHOTO_VERSION = 'NULL AS thumbLength';",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '537', name: 'Die Bildadresse traegt die Fassung nicht mehr',
    file: 'public/app.js',
    search: "  const version = filesize === 'thumb' && Number.isFinite(f) ? `&v=${f}` : '';",
    replacement: "  const fassung = '';",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '538', name: 'Der Zuschnitt im Browser kommt zurueck -- es wird zweimal geschnitten',
    file: 'public/style.css',
    search: ".thumb img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }",
    replacement: ".thumb img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; transform: scale(var(--zoom, 1)); }",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '539', name: 'Die Rechnung im Browser laeuft der im Server davon',
    file: 'public/app.js',
    search: "  const eng = side * 100 / zoom;          // was sie beim eingestellten Zoom zeigt",
    replacement: "  const eng = side;                       // was sie beim eingestellten Zoom zeigt",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '540', name: 'Die Fortschrittszeile kennt nur eine Richtung',
    file: 'public/app.js',
    search: "(d > 0 ? t('card.moreBytes', { bytes: fmtBytes(Math.abs(d)) })\n                                : t('card.lessBytes', { bytes: fmtBytes(Math.abs(d)) }))",
    replacement: "t('card.moreBytes', { bytes: fmtBytes(Math.abs(d)) })",
    expected: 'Die Bildablage in der Oberflaeche'
  },

  /* ---- Die Ansicht kann fort sein ---- */
  {
    nr: '541', name: 'Der Bilderstreifen fragt nicht, ob seine Ansicht noch steht',
    file: 'public/app.js',
    search: "    // Nach einem await kann die Ansicht schon gewechselt haben.\n    if (!box) return;\n",
    replacement: "    // Nach einem await kann die Ansicht schon gewechselt haben.\n",
    expected: 'Die Ansicht kann fort sein — 0.19.6'
  },
  {
    nr: '542', name: 'Der Betrachter fragt nicht, ob seine Ansicht noch steht',
    file: 'public/app.js',
    search: "    if (!v) return;\n    // #viewer bleibt dasselbe Element; die Handler des Ausschnittmodus loeschen.",
    replacement: "    // #viewer bleibt dasselbe Element; die Handler des Ausschnittmodus loeschen.",
    expected: 'Die Ansicht kann fort sein — 0.19.6'
  },
  {
    nr: '543', name: 'Der Bilderstreifen zeichnet ueberhaupt keine Kacheln mehr',
    file: 'public/app.js',
    search: "    box.innerHTML = '';\n    item.photos.forEach((p, i) => {",
    replacement: "    box.innerHTML = '';\n    [].forEach((p, i) => {",
    expected: 'Die Ansicht kann fort sein — 0.19.6'
  },

  /* ---- Alte Sicherungen aufraeumen ---- */
  {
    nr: '544', name: 'Die Regel kennt nur das Alter -- der Boden faellt weg',
    file: 'server.js',
    search: "  return usable.slice(keep).filter(d => d.time < limit);",
    replacement: "  return brauchbar.filter(d => d.zeit < grenze);",
    expected: 'Die Aufraeumregel an der Tafel'
  },
  {
    nr: '545', name: 'Die Regel kennt nur die Zahl -- die Schere faellt weg',
    file: 'server.js',
    search: "  return usable.slice(keep).filter(d => d.time < limit);",
    replacement: "  return brauchbar.slice(behalten);",
    expected: 'Die Aufraeumregel an der Tafel'
  },
  {
    nr: '546', name: 'Die Musterpruefung faellt weg -- die fremde Datei faellt mit',
    file: 'server.js',
    search: "const BACKUP_PATTERN = /^kriterion-.+\\.sqlite$/;",
    replacement: "const BACKUP_PATTERN = /./;",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '547', name: 'Die zweite Musterpruefung vor dem unlink faellt weg',
    file: 'server.js',
    search: "    if (short !== String(n) || !BACKUP_PATTERN.test(short)) { stayed.push(short); continue; }",
    replacement: "    if (false) { stayed.push(kurz); continue; }",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '548', name: 'Die Liste folgt dem Symlink statt ihn zu sehen',
    file: 'server.js',
    search: "      const st = fs.lstatSync(path.join(filePath, n));",
    replacement: "      const st = fs.statSync(path.join(pfad, n));",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '549', name: 'Das Entfernen folgt dem Symlink',
    file: 'server.js',
    search: "      const st = fs.lstatSync(full);",
    replacement: "      const st = fs.statSync(voll);",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '550', name: 'Der Boden zaehlt auch die veralteten Kopien mit',
    file: 'server.js',
    search: "    .filter(d => changeMs == null || d.time >= changeMs)",
    replacement: "    .filter(() => true)",
    expected: 'Die Aufraeumregel an der Tafel'
  },
  {
    nr: '551', name: 'Nach der gescheiterten Sicherung wird doch aufgeraeumt',
    file: 'server.js',
    search: "  if (fs.existsSync(file))\n    return res.status(409).json({ error: t(localeOf(req), 'server.backupConcurrent')});",
    replacement: "  if (fs.existsSync(datei)) {\n    const r = cleanupStatus();\n    if (r.an) removeBackups(ziel.pfad, ruleHit(backupList(ziel.pfad) || [],\n      r.behalten, r.tage, Date.now(), (changeMark() || {}).ms ?? null).map(d => d.name));\n    return res.status(409).json({ error: t(localeOf(req), 'server.backupConcurrent')});\n  }",
    expected: 'Alte Sicherungen aufraeumen: der Anschluss an die Sicherung'
  },
  {
    nr: '552', name: 'Das Aufraeumen reisst die gelungene Sicherung mit',
    file: 'server.js',
    search: "    logFail('Clearing up after the backup failed:', e.message);\n" +
           "    cleaned = { removed: 0, notDeleted: 0, bytes: 0, failed: true };\n" +
           "  }",
    replacement: "    throw e;\n" +
            "  }\n" +
            "  if (cleaned && cleaned.removed)\n" +
            "    return res.status(500).json({ error: 'Die Sicherung ist gescheitert.' });",
    expected: 'Alte Sicherungen aufraeumen: der Anschluss an die Sicherung'
  },
  {
    nr: '553', name: 'Der Schalter steht bei einer frischen Installation auf AN',
    file: 'server.js',
    search: "    an: getSetting('backupCleanup', false) === true,",
    replacement: "    an: getSetting('backupCleanup', true) !== false,",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '554', name: 'Die Grenzen der beiden Werte halten nicht mehr am Server',
    file: 'server.js',
    search: "  if (!Number.isInteger(n) || n < range.min || n > range.max)",
    replacement: "  if (false)",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '555', name: 'Die Vorschau rechnet mit einem anderen Boden als das Loeschen',
    file: 'server.js',
    search: "  const matched = ruleHit(files, keep, days, now, mark ? mark.ms : null);",
    replacement: "  const treffer = ruleHit(dateien, Math.max(1, behalten - 1), tage, jetzt,\n" +
            "                               marke ? marke.ms : null);",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    /* Die Route nimmt keinen Dateinamen an; eine Pruefung des Namens liesse
       sich vergessen. */
    nr: '556', name: 'Die Loeschroute nimmt einen Dateinamen aus dem Rumpf',
    file: 'server.js',
    search: "  const kind = String(req.body?.kind || '');",
    replacement: "  const art = String(req.body?.art || '');\n" +
            "  if (req.body?.datei) {\n" +
            "    const einzeln = removeBackups(ziel.pfad, [req.body.datei]);\n" +
            "    return res.json({ ok: true, art, weg: einzeln.weg, nicht: einzeln.geblieben.length,\n" +
            "                      bytes: einzeln.bytes, ...lastBackup(ziel.pfad) });\n" +
            "  }",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '557', name: 'Das Aufraeumen laeuft ohne zweite Bestaetigung',
    file: 'server.js',
    search: "app.post('/api/backup/cleanup', ownerOnly,\n" +
           "         secondConfirmNeeded('backup'), (req, res) => {",
    replacement: "app.post('/api/backup/cleanup', ownerOnly, (req, res) => {",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '558', name: 'Ein gewoehnlicher Admin darf alte Sicherungen entfernen',
    file: 'server.js',
    search: "app.post('/api/backup/cleanup', ownerOnly,\n" +
           "         secondConfirmNeeded('backup'), (req, res) => {",
    replacement: "app.post('/api/backup/cleanup', adminOnly,\n" +
            "         secondConfirmNeeded('backup'), (req, res) => {",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '559', name: 'Die entfernten Kopien stehen in keinem Protokoll mehr',
    file: 'server.js',
    search: "  for (let i = 0; i < number; i++) auth.log('backup.delete', { actor });",
    replacement: "  for (let i = 0; i < 0; i++) auth.log('backup.delete', { wer });",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '560', name: 'Der Vorgang sicherung.weg steht in keiner Gruppe',
    file: 'auth.js',
    search: "  inventory: ['export', 'import', 'backup', 'backup.delete', 'key']",
    replacement: "  bestand: ['export', 'import', 'backup', 'key']",
    expected: 'Das Sicherheitsprotokoll: die Gruppen des Filters'
  },
  {
    nr: '561', name: 'Die Karte „Alte Sicherungen" faellt aus dem Systembereich',
    file: 'public/app.js',
    search: "  { key: 'cleanup',      section: 'database', visible: () => OWNER,\n" +
           "    markup: cardCleanup,   wireUp: setUpCleanupOut },",
    replacement: "",
    expected: 'Der Systembereich nach Rolle'
  },
  {
    nr: '562', name: 'Die Karte „Alte Sicherungen" steht schon beim Admin',
    file: 'public/app.js',
    search: "  { key: 'cleanup',      section: 'database', visible: () => OWNER,",
    replacement: "  { key: 'cleanup',      section: 'database', sichtbar: () => ADMIN,",
    expected: 'Der Systembereich nach Rolle'
  },
  {
    nr: '563', name: 'Eine Aenderung am Feld rechnet die Vorschau nicht neu',
    file: 'public/app.js',
    search: "        el.oninput = previewNew;",
    replacement: "        el.oninput = null;",
    expected: 'Die Karte „Alte Sicherungen" in der Oberflaeche'
  },
  {
    nr: '564', name: 'Die Karte schickt die Dateinamen an die Loeschroute mit',
    file: 'public/app.js',
    search: "      try { r = await api('POST', '/api/backup/cleanup', { kind }); }",
    replacement: "      try { r = await api('POST', '/api/backup/cleanup',\n" +
            "        { art, dateien: (a.treffer || []).map(t => t.datei) }); }",
    expected: 'Die Karte „Alte Sicherungen" in der Oberflaeche'
  },
  {
    nr: '565', name: 'Der Knopf ist auch ohne Treffer bedienbar',
    file: 'public/app.js',
    search: "id=\"cleanup-run\"${matched.length ? '' : ' disabled'}>${tH('card.deleteNow')}",
    replacement: "id=\"cleanup-run\">${tH('card.deleteNow')}",
    expected: 'Die Karte „Alte Sicherungen" in der Oberflaeche'
  },
  {
    nr: '566', name: 'Die Sicherungsliste bekommt keinen Deckel',
    file: 'public/style.css',
    search: '#cleanup-list { flex: none; max-height: 13.98rem; }',
    replacement: '#cleanup-list { flex: none; }',
    expected: 'Die Karte „Alte Sicherungen" in der Oberflaeche'
  },
  {
    nr: '567', name: 'Die Karte listet die Sicherungen nicht mehr',
    file: 'public/app.js',
    search: '           <div class="manage-list" id="cleanup-list">${all.map(row).join(\'\')}</div>`',
    replacement: '           <div class="manage-list" id="cleanup-list"></div>`',
    expected: 'Die Karte „Alte Sicherungen" in der Oberflaeche'
  },
  {
    nr: '568', name: 'Die Nummern laufen von der aeltesten zur juengsten',
    file: 'server.js',
    search: '      ...cleanupRow(d, now), nr: i + 1,',
    replacement: '      ...cleanupRow(d, jetzt), nr: dateien.length - i,',
    expected: 'Die Karte „Alte Sicherungen" in der Oberflaeche'
  },
  {
    nr: '569', name: 'Die Zeilen sagen nicht mehr, welche geloescht wird',
    file: 'public/app.js',
    search: "      const mark = z.affected ? `<span class=\"cleanup-badge remove\">${tH('card.deleteLower')}</span>`",
    replacement: "      const marke = z.faellt ? ''",
    expected: 'Die Karte „Alte Sicherungen" in der Oberflaeche'
  },

  /* ---- Zwei Kaesten, zwei Durchschnitte ---- */
  {
    nr: '570', name: 'Der Gesamtschnitt der Uebersicht kennt die Phase nicht mehr',
    file: 'server.js',
    search: '   GROUP BY r.item_id, r.criterion_id, c.weight, c.phase`);',
    replacement: '   GROUP BY r.item_id, r.criterion_id, c.weight`);',
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    nr: '571', name: 'Der Gesamtschnitt des Eintrags kennt die Phase nicht mehr',
    file: 'server.js',
    search: '   GROUP BY r.criterion_id, c.weight, c.phase`);',
    replacement: '   GROUP BY r.criterion_id, c.weight`);',
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    nr: '572', name: 'potenzialRating faellt aus der Uebersicht',
    file: 'server.js',
    search: '    it.potentialRating = totalAverage(boxes.before);',
    replacement: '    it.potenzialRating = null;',
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    nr: '573', name: 'Der Rechenweg des Potenzials faellt aus der Antwort',
    file: 'server.js',
    search: '  it.potentialCalc = { ...potentialCalc, result: it.potentialRating };',
    replacement: '  void potenzialRechenweg;',
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    nr: '574', name: 'Die Sternzeilen des Details tragen ihre Phase nicht mehr',
    file: 'server.js',
    search: '    SELECT c.id AS criterion_id, c.name, c.weight, c.phase, COALESCE(r.value, 0) AS value',
    replacement: '    SELECT c.id AS criterion_id, c.name, c.weight, COALESCE(r.value, 0) AS value',
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    /* Ein Kriterium mit ungueltiger Phase steht in keinem Kasten, und seine
       Sterne zaehlen nirgends. */
    nr: '575', name: 'POST /api/criteria nimmt jede Phase an',
    file: 'server.js',
    search: "  if (!PHASES.includes(phase))",
    replacement: "  if (false)",
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    nr: '576', name: 'PUT /api/criteria/:id uebergeht die Phase stillschweigend',
    file: 'server.js',
    search: "  if (req.body.phase !== undefined)",
    replacement: "  if (false)",
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    nr: '577', name: 'Der Export nennt die Kaesten nicht mehr',
    file: 'server.js',
    search: "  for (const c of critRows) if (c.phase !== 'after') criteriaPhase[c.name] = c.phase;",
    replacement: '  void criteriaPhase;',
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    nr: '578', name: 'Der Import spielt ueber die Kaesten hinweg ein',
    file: 'server.js',
    search: '  if (conflicts.length) {',
    replacement: '  if (false) {',
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    nr: '579', name: 'GET /api/criteria liefert die Phase nicht mehr',
    file: 'server.js',
    search: '  SELECT c.id, c.name, c.language, c.sort_order, c.weight, c.phase, c.created_at,',
    replacement: '  SELECT c.id, c.name, c.language, c.sort_order, c.weight, c.created_at,',
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    nr: '582', name: 'Die Sternkaesten speichern ihren Einklappzustand wieder',
    file: 'server.js',
    search: "const CLOSED_BLOCKS = ALL_BLOCKS.filter(k => !BLOCKS_ALWAYS_OPEN.includes(k));",
    replacement: "const CLOSED_BLOCKS = ALL_BLOCKS;",
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },

  /* ---- Die Sternzeile ---- */
  {
    nr: '583', name: 'Das × verschwindet mit seinem Platz statt nur mit seiner Farbe',
    file: 'public/app.js',
    search: "  z.className = 'rreset' + (value > 0 ? '' : ' blank');",
    replacement: "  z.className = 'rzurueck'; if (!(value > 0)) z.hidden = true;",
    expected: "Die Sternzeile — 0.22.0"
  },
  {
    /* Sternreihen ohne Ruecksetzer: die Testtage und jede Lesestelle. */
    nr: '584', name: 'Das × steht auch an einer Sternreihe ohne Ruecksetzer',
    file: 'public/app.js',
    search: "  w.addEventListener('click', e => { if (e.target.dataset.v) onPick(+e.target.dataset.v); });\n  return w;\n}",
    replacement: "  w.addEventListener('click', e => { if (e.target.dataset.v) onPick(+e.target.dataset.v); });\n  w.appendChild(zuruecksetzKnopf(value, () => onPick(0)));\n  return w;\n}",
    expected: "Die Sternzeile — 0.22.0"
  },
  {
    nr: '585', name: 'Die leere Durchschnittszelle zeigt wieder gar nichts',
    file: 'public/app.js',
    search: "          a.textContent = '–';\n          a.title = t('entry.notRatedYet');",
    replacement: "          a.textContent = '';",
    expected: 'Die Sternzeile — 0.21.0'
  },
  {
    nr: '586', name: 'Die Durchschnittsspalte verliert ihre Mindestbreite wieder',
    file: 'public/style.css',
    search: '  min-width: calc(4.34rem + 9px);\n  display: flex; align-items: center; justify-content: flex-end;',
    replacement: '  display: flex; align-items: center; justify-content: flex-end;',
    expected: 'Die Sternzeile — 0.21.0'
  },

  /* ---- Die Oberflaeche der beiden Kaesten ---- */
  {
    nr: '587', name: 'Der Potenzialblock steht hinter der Bewertung',
    file: 'public/app.js',
    search: "  side: ['kategorie', 'tags', 'potenzial', 'bewertung'],",
    replacement: "  side: ['kategorie', 'tags', 'bewertung', 'potenzial'],",
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '588', name: 'Der Zeichner zeigt in beiden Kaesten alle Zeilen',
    file: 'public/app.js',
    search: '    const rows = item.ratings.filter(r => r.phase === boxId.phase);',
    replacement: '    const zeilen = item.ratings;',
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '589', name: 'Die Sternkaesten folgen wieder der gespeicherten Einstellung',
    file: 'public/app.js',
    search: '    const afterState = BLOCKS_ALWAYS_OPEN.includes(name);',
    replacement: '    const afterState = false;',
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '590', name: 'Bewertungssterne an einem ungetesteten Eintrag bleiben zugeklappt',
    file: 'public/app.js',
    search: "  return !item.tested && !hasStars(item, 'after');",
    replacement: '  return !item.tested;',
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '591', name: 'Ein Klick auf den Kastenkopf speichert wieder',
    file: 'public/app.js',
    search: '        if (GLANCE.has(name)) GLANCE.delete(name); else GLANCE.add(name);',
    replacement: "        BLOECKE.zu = zu ? BLOECKE.zu.filter(k => k !== name) : [...BLOECKE.zu, name];\n        saveBlocks();",
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '592', name: 'Der Schalter „Getestet" leert den Blick nicht mehr',
    file: 'public/app.js',
    search: '      GLANCE.clear();\n      drawSwitches(); drawTestDays(); drawRatings();',
    replacement: '      drawSwitches(); drawTestDays(); drawRatings();',
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '593', name: 'Der Blick ueberlebt den Wechsel des Eintrags',
    file: 'public/app.js',
    search: "  GLANCE.clear();\n  /* Suchbegriff aus der Adresse oder aus state.search; danach sind beide gleich. */",
    replacement: "  /* Suchbegriff aus der Adresse oder aus state.search; danach sind beide gleich. */",
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '594', name: 'Die Kachel zeigt an einer Idee wieder die Bewertung',
    file: 'public/app.js',
    search: "  const value = potential ? it.potentialRating : it.avgRating;",
    replacement: '  const wert = it.avgRating;',
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '595', name: 'Das Potenzial traegt auf der Kachel wieder den Stern',
    file: 'public/app.js',
    search: "  const char = potential ? '◆' : '★';",
    replacement: "  const zeichen = '★';",
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '596', name: 'Eintraege ohne Potenzialzahl stehen in einer Richtung vorn',
    file: 'public/app.js',
    search: "      case 'potential_asc':  return (a.potentialRating ?? 99) - (b.potentialRating ?? 99);",
    replacement: "      case 'potential_asc':  return (a.potenzialRating ?? 0) - (b.potenzialRating ?? 0);",
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '597', name: 'Die zweite Kriterienkarte filtert nicht nach Phase',
    file: 'public/app.js',
    search: "function critRows(fetched, phase) {\n" +
      "  return namesFrom(fetched, 'crits').filter(c => c.phase === phase);\n}",
    replacement: "function critRows(fetched, phase) {\n" +
      "  return namesFrom(fetched, 'crits');\n}",
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '598', name: 'Die zweite Kriterienkarte legt im falschen Kasten an',
    file: 'public/app.js',
    search: "      try { await api('POST', '/api/criteria', { name, phase }); critField.value = '';",
    replacement: "      try { await api('POST', '/api/criteria', { name }); critField.value = '';",
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '599', name: 'Der eigene Schnitt im Vergleich mischt die Kaesten',
    file: 'public/app.js',
    search: "      if (r.phase !== phase) continue;",
    replacement: "      if (false) continue;",
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },
  {
    nr: '600', name: 'Der Blockkopf traegt das Wort aus dem Quelltext',
    file: 'public/app.js',
    search: "<div class=\"block-head\"><span class=\"label\">${esc(V.potential)}</span>",
    replacement: '<div class="block-head"><span class="label">Potenzial</span>',
    expected: 'Zwei Kaesten in der Oberflaeche — 0.21.0'
  },

  {
    nr: '601', name: 'Die Vorgabe der Oberflaeche kennt das neue Wort nicht',
    file: 'public/languages/de.json',
    search: "\"vocabulary.potential\":",
    replacement: "\"vocabulary.potenzialWeg\":",
    expected: 'Oberflaeche mit eigenem Vokabular'
  },
  {
    /* Zielt auf das SELECT, nicht auf das GROUP BY wie 570. */
    nr: '602', name: 'Die gebuendelte Abfrage waehlt die Phase nicht mehr aus',
    file: 'server.js',
    search: '  SELECT r.item_id, r.criterion_id, AVG(r.value * 1.0) AS average, COUNT(*) AS count,\n' +
           '         c.weight, c.phase\n',
    replacement: '  SELECT r.item_id, r.criterion_id, AVG(r.value * 1.0) AS average, COUNT(*) AS count,\n' +
            '         c.weight\n',
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    nr: '603', name: 'Die Abfrage des Eintrags waehlt die Phase nicht mehr aus',
    file: 'server.js',
    search: '  SELECT r.criterion_id, AVG(r.value * 1.0) AS average, COUNT(*) AS count,\n' +
           '         c.weight, c.phase\n',
    replacement: '  SELECT r.criterion_id, AVG(r.value * 1.0) AS average, COUNT(*) AS count,\n' +
            '         c.weight\n',
    expected: 'Zwei Kaesten, zwei Durchschnitte — 0.21.0'
  },
  {
    /* Beide Blicke fallen weg: ueber die Befehlszeile und ueber die Ports. */
    nr: '604', name: 'Der Treiber faehrt los, ohne nach fremden Servern zu sehen',
    file: 'counterproof.js',
    search: '  const foreign = foreignServer();\n  const busy = foreignPort(foreign.map(f => f.port));\n  if (foreign.length || busy.length) {',
    replacement: '  const foreign = [];\n  const busy = [];\n  if (false) {',
    expected: 'Die Gegenproben greifen'
  },
  {
    /* Setzt `pruefung.js` ein, eine Datei, die es im Repository nicht gibt. */
    nr: '605', name: 'Die Suche nach fremden Servern kennt den Prueflauf nicht mehr',
    file: 'counterproof.js',
    search: "    const script = parts.find(t => /(^|\\/)(server\\.js|testbench\\.js|test\\/[a-z0-9_]+\\.js)$/.test(t));",
    replacement: "    const script = parts.find(t => /(^|\\/)(server|pruefung)\\.js$/.test(t));",
    expected: 'Der Waechter erkennt den Prueflauf — 0.30.0'
  },

  /* ---- Die Sortierung gibt den Status vor ---- */
  {
    nr: '610', name: 'Die Liste liest die Ableitung nicht mehr',
    file: 'public/app.js',
    search: "  const status = statusEffective(f);",
    replacement: "  const status = f.tested;",
    expected: 'Die Sortierung gibt den Status vor — 0.21.1'
  },
  {
    nr: '613', name: 'Die Ableitung wird mitgespeichert',
    file: 'public/app.js',
    search: "  const applySort = () => { f.sort = picked.base.key + (picked.asc ? '_asc' : '_desc'); redraw(); };",
    replacement: "  const applySort = () => { f.sort = picked.base.key + (picked.asc ? '_asc' : '_desc');\n" +
            "    f.tested = statusOutSort(f.sort) || f.tested; redraw(); };",
    expected: 'Die Sortierung gibt den Status vor — 0.21.1'
  },
  {
    nr: '614', name: 'Der Wechsel der Sortierung zeichnet nur noch die Liste',
    file: 'public/app.js',
    search: "  const applySort = () => { f.sort = picked.base.key + (picked.asc ? '_asc' : '_desc'); redraw(); };",
    replacement: "  const applySort = () => { f.sort = picked.base.key + (picked.asc ? '_asc' : '_desc'); saveFilters(); drawBody(); };",
    expected: 'Die Sortierung gibt den Status vor — 0.21.1'
  },

  /* ---- Der Pruefstand ueber sich selbst ---- */
  {
    nr: 'W14', name: 'Die Dateiliste des Sprachwaechters verliert die neuen Dateien',
    file: 'test/source.js',
    search: "                          'images.js', 'batchrun.js', 'mail.js'];",
    replacement: "                          ];",
    expected: 'Der Sprachwaechter'
  },
  {
    nr: 'W13', name: 'Die Sprachliste verliert ihren juengsten Eintrag',
    file: 'test/source.js',
    search: "    ['Auffangnetz', 'Rueckfall'], ['Grundausstattung', 'Vorgabewerte']\n  ];",
    replacement: "  ];",
    expected: 'Der Sprachwaechter'
  },
  /* ---- Die Oberflaeche wird ruhiger ---- */
  {
    nr: '624', name: 'Das Milchglas kommt an die Kopfzeile zurueck',
    file: 'public/style.css',
    search: ".masthead.scrolled { box-shadow: var(--sh-sm); }",
    replacement: ".masthead.scrolled { box-shadow: var(--sh-sm); backdrop-filter: blur(10px); }",
    expected: 'Kein Milchglas im Stilblatt — 0.22.0'
  },
  {
    nr: '625', name: 'Die Glocke sagt wieder „Blick"',
    file: 'public/app.js',
    search: "    : t('list.noNews'));",
    replacement: "    : 'Nichts Neues seit deinem letzten Blick');",
    expected: 'Der Bildschirmtext-Waechter — 0.22.0'
  },
  {
    nr: '626', name: 'Die Servermeldung zur Phase eines Kriteriums sagt wieder „Kasten"',
    file: 'public/languages/de.json',
    search: "\"server.criterionEitherOr\": \"Ein Kriterium gehört entweder zu „{potential}“ oder zu „{ratingOne}“.\",",
    replacement: "\"server.criterionEitherOr\": \"Der Kasten muss „{potential}“ oder „{ratingOne}“ sein.\",",
    expected: 'Der Bildschirmtext-Waechter — 0.22.0'
  },
  {
    nr: '627', name: 'Das Beenden der anderen Sitzungen fragt wieder ueber confirm()',
    file: 'public/app.js',
    search: "      if (!await confirmBox(t('card.endSessionsAsk'), t('card.thisSessionStays'), t('card.end'))) return;",
    replacement: "      if (!confirm(t('card.endSessionsAsk'))) return;",
    expected: 'Keine Browserfenster mehr — 0.22.0'
  },
  {
    nr: '628', name: 'Ein Server-Befehl steht wieder im Fliesstext der Karte Mein Konto',
    file: 'public/languages/de.json',
    search: "\"card.forgotPasswordHint\": \"Das Passwort eines Benutzers auf dem Server zurücksetzen:\",",
    replacement: "\"card.forgotPasswordHint\": \"Das Passwort eines Benutzers mit docker compose exec kriterion node usertool.js password <name> zurücksetzen.\",",
    expected: 'Server-Befehle nur im Kasten — 0.22.0'
  },
  {
    nr: '629', name: 'Ein fuenfter Kasten „Auf dem Server" kommt an die Karte Sicherung',
    file: 'public/app.js',
    search: "        <div id=\"backup-box\"></div>\n      </div>`;",
    replacement: "        <div id=\"backup-box\"></div>\n        ${serverKasten('Die Sicherung von Hand:', 'docker compose exec kriterion node sicherung.js')}\n      </div>`;",
    expected: 'Server-Befehle nur im Kasten — 0.22.0'
  },
  {
    // Mit prompt() stuende das fremde Passwort im Klartext.
    nr: '630', name: 'Das fremde Passwort wird wieder ueber prompt() abgefragt',
    file: 'public/app.js',
    search: "          const fresh = await newPasswordDialog(t('card.setPasswordFor', { username: z.username }),",
    replacement: "          const neu = prompt(t('card.setPasswordFor', { username: z.username }),",
    expected: 'Keine Browserfenster mehr — 0.22.0'
  },
  {
    nr: '631', name: 'Der Bildstreifen laesst eine ungueltige Stufe durch',
    file: 'server.js',
    search: "  strip:       { list: STRIP_LEVELS,       cast: Number, fallback: 80,",
    replacement: "  strip:       { list: [...STRIP_LEVELS, 90], cast: Number, fallback: 80,",
    expected: 'Die Einstellung streifen — 0.22.0'
  },
  {
    // Dreizehn statt vierzehn Woerter in der Vorgabe.
    nr: '632', name: 'Die Vorgabe des Vokabulars vergisst die Mehrzahl der Bewertung',
    file: 'public/languages/de.json',
    search: "\"vocabulary.ratingMany\": \"Bewertungen\",",
    replacement: "\"vocabulary.ratingMany\": \"\",",
    expected: 'Einstellungen: Vokabular und Schriftgroesse'
  },
  {
    nr: '633', name: 'Der Ruecksetzknopf steht wieder in der Sternzelle statt in seiner eigenen Spalte',
    file: 'public/app.js',
    search: "      const zz = document.createElement('span');\n      zz.className = 'rreset-cell';\n      zz.appendChild(back);\n      row.append(zz);",
    replacement: "      acts.appendChild(zurueck);",
    expected: 'Die Sternzeile — 0.22.0'
  },
  {
    nr: '634', name: 'Rueckgaengig schreibt die Null statt des alten Werts',
    file: 'public/app.js',
    search: "        toast(t('entry.starsRemoved', { name: r.name }), false, { text: t('entry.undo'), tu: () => set(old) });",
    replacement: "        toast(t('entry.starsRemoved', { name: r.name }), false, { text: t('entry.undo'), tu: () => set(0) });",
    expected: 'Die Sternzeile — 0.22.0'
  },
  {
    nr: '635', name: 'Die Zelle des Ruecksetzknopfs verliert ihren Abstand',
    file: 'public/style.css',
    search: ".rrow .rreset-cell { display: flex; align-items: center; justify-content: flex-end; padding-left: 12px; }",
    replacement: ".rrow .rzz { display: flex; align-items: center; justify-content: flex-end; padding-left: 4px; }",
    expected: 'Die Sternzeile — 0.22.0'
  },
  {
    nr: '636', name: 'Die Tagzeile bleibt bei greifendem Tagfilter zugeklappt',
    file: 'public/app.js',
    search: "  const tagsOpen = tagsPossible;",
    replacement: "  const tagsOpen = tagsPossible && f.tagIds.length === 0;",
    expected: 'Die Tagzeile steht offen — 0.30.0'
  },
  {
    nr: '637', name: 'filterNumber() zaehlt die Tags hinter dem Umschalter nicht mehr',
    file: 'public/app.js',
    search: "  n += f.tagIds.length;",
    replacement: "  n += 0;",
    expected: 'Der Umschalter der Tagzeile — 0.24.0'
  },
  {
    nr: '658', name: 'Die Tagzeile sagt dem Raster nicht mehr, dass sie die Tagzeile ist',
    file: 'public/app.js',
    search: "    r3.classList.add('frow-tags');",
    replacement: "    r3.classList.add('frow-tagzeile');",
    expected: 'Die Tagzeile steht offen — 0.30.0'
  },
  {
    nr: '659', name: 'Die Tagzeile wird zugeklappt gebaut statt weggelassen',
    file: 'public/app.js',
    search: "  if (tagsOpen) {\n    const r3 = row(t('list.tags'));",
    replacement: "  if (true) {\n    const r3 = row(t('list.tags'));",
    expected: 'Der Umschalter der Tagzeile — 0.24.0'
  },
  {
    nr: '660', name: 'Der Umschalter steht auch da, wenn kein Tag dahinter ist',
    file: 'public/app.js',
    search: "  const tagsPossible = filterTags.length > 0 || f.tagIds.length > 0;",
    replacement: "  const tagsMoeglich = true;",
    expected: 'Der Umschalter der Tagzeile — 0.24.0'
  },
  {
    nr: '675', name: 'Eine Servermeldung steht wieder als Satz im Quelltext',
    file: 'server.js',
    search: "  if (!title) return res.status(400).json({ error: t(localeOf(req), 'server.titleMissing')});",
    replacement: "  if (!title) return res.status(400).json({ error: 'Bitte einen Titel eingeben.' });",
    expected: 'Der Bildschirmtext-Waechter'
  },
  {
    nr: '676', name: 'auth.js wirft wieder einen deutschen Satz',
    file: 'auth.js',
    search: "  if (!ROLES.includes(role)) throw new Message('login.roleUnknown');\n  const clean = String(name).trim();",
    replacement: "  if (!ROLLEN.includes(rolle)) throw new Error('Diese Rolle gibt es nicht.');\n  const sauber = String(name).trim();",
    expected: 'Der Bildschirmtext-Waechter'
  },
  {
    nr: '677', name: 'Ein Programmierfehler ohne Bildschirm faellt weg',
    file: 'auth.js',
    search: "    throw new Error('Eine Sitzung braucht einen Benutzer.');",
    replacement: "    return null;",
    expected: 'Der Bildschirmtext-Waechter'
  },
  {
    nr: '680', name: 'mail.js bekommt den Uebersetzer nicht mehr gereicht',
    file: 'server.js',
    search: "mail.setTranslator(t);",
    replacement: "void mail.setTranslator;",
    expected: 'Die Serverseite spricht aus der Datei — 0.24.0'
  },
  {
    nr: '681', name: 'auth.js bekommt den Uebersetzer nicht mehr gereicht',
    file: 'server.js',
    search: "auth.setTranslator((req, key, values) => t(localeOf(req), key, values));",
    replacement: "void auth.setTranslator;",
    expected: 'Die Serverseite spricht aus der Datei — 0.24.0'
  },
  {
    nr: '682', name: 'Die Vokabelvorgaben stehen wieder im Quelltext',
    file: 'server.js',
    search: "const vocabularyDefault = (locale) => Object.fromEntries(\n  Object.entries(textsOf(locale || languageDefault()))",
    replacement: "const VOKABULAR_VORGABE = { sacheEinzahl: 'Eintrag' };\nconst vocabularyDefault = (locale) => Object.fromEntries(\n  Object.entries(textsOf(locale || languageDefault()))",
    expected: 'Die Serverseite spricht aus der Datei — 0.24.0'
  },
  {
    nr: '683', name: 'Der Betreff eines Briefes verliert seinen Platzhalter',
    file: 'public/languages/de.json',
    search: "  \"mail.invite.subject\": \"Dein Account für „{instanceTitle}“\",",
    replacement: "  \"mail.invite.subject\": \"Dein Account\",",
    expected: 'Die Serverseite spricht aus der Datei — 0.24.0'
  },
  {
    nr: '684', name: 'Die Testmail traegt ploetzlich einen Link',
    file: 'public/languages/de.json',
    search: "das ist die Testmail aus „{instanceTitle}“.",
    replacement: 'das ist die Testmail aus „{instanceTitle}“: {link}',
    expected: 'Die Serverseite spricht aus der Datei — 0.24.0'
  },
  {
    nr: '665', name: 'Die Sprachdatei verliert ihren Kopf _locale',
    file: 'public/languages/de.json',
    search: '  "_locale": "de-DE",',
    replacement: '  "_hinweis": "de-DE",',
    expected: 'Der Sprachhelfer und die Ladung — 0.24.0'
  },
  {
    nr: '666', name: 'Ein Wert der Sprachdatei traegt eine spitze Klammer',
    file: 'public/languages/de.json',
    search: "\"server.errorUnknown\": \"Unbekannter Fehler.\"",
    replacement: "\"server.errorUnknown\": \"<b>Unbekannter Fehler.</b>\"",
    expected: 'Der Sprachhelfer und die Ladung — 0.24.0'
  },
  {
    nr: '667', name: 'tH() maskiert die eingesetzten Werte nicht mehr',
    file: 'public/app.js',
    search: "    return mask ? esc(String(value)) : String(value);",
    replacement: "    return String(wert);",
    expected: 'Der Sprachhelfer und die Ladung — 0.24.0'
  },
  {
    nr: '668', name: 'Ein unbekannter Platzhalter verschwindet still',
    file: 'public/app.js',
    search: "    if (value === undefined) return whole;",
    replacement: "    if (wert === undefined) return '';",
    expected: 'Der Sprachhelfer und die Ladung — 0.24.0'
  },
  {
    nr: '669', name: 'Die Mehrzahl waehlt wieder ueber n === 1',
    file: 'public/app.js',
    search: "  return PLURAL.select(values.n) === 'one' ? raw.one : raw.other;",
    replacement: "  return werte.n === 1 ? roh.one : roh.other;",
    expected: 'Der Sprachhelfer und die Ladung — 0.24.0'
  },
  {
    nr: '670', name: 'Der Rueckfall auf Deutsch faellt weg',
    file: 'public/app.js',
    search: "  const raw = TEXTS[key] !== undefined ? TEXTS[key] : TEXTS_FALLBACK[key];",
    replacement: "  const raw = TEXTS[key];",
    expected: 'Der Sprachhelfer und die Ladung — 0.24.0'
  },
  {
    nr: '671', name: 'boot() haelt bei fehlender Sprachdatei nicht an',
    file: 'public/app.js',
    search: "    app.textContent = 'Die Sprachdatei fehlt.';\n    return;",
    replacement: "    app.textContent = 'Die Sprachdatei fehlt.';",
    expected: 'Der Sprachhelfer und die Ladung — 0.24.0'
  },
  {
    nr: '672', name: 'Der Server stirbt wieder an einer fehlenden Pflichtdatei',
    file: 'server.js',
    search: "if (!LANGUAGES[LANGUAGE_FALLBACK]) console.error(",
    replacement: "if (!LANGUAGES[LANGUAGE_FALLBACK]) throw new Error('Pflichtdatei fehlt'); if (false) console.error(",
    expected: 'Der Sprachhelfer und die Ladung — 0.24.0'
  },
  {
    nr: '673', name: 'api() traegt seinen Rueckfallsatz wieder im Quelltext',
    file: 'public/app.js',
    search: "    let m = t('error.serverStatus', { status: res.status });",
    replacement: "    let m = `Der Server meldet einen Fehler (${res.status}).`;",
    expected: 'Der Sprachhelfer und die Ladung — 0.24.0'
  },
  {
    nr: '674', name: 'Der Fehler-Handler traegt seinen Satz wieder im Quelltext',
    file: 'server.js',
    search: "  if (rank >= 500) return res.status(500).json({ error: t(locale, 'server.error') });",
    replacement: "  if (rang >= 500) return res.status(500).json({ error: 'Auf dem Server ist ein Fehler aufgetreten.' });",
    expected: 'Der Sprachhelfer und die Ladung — 0.24.0'
  },
  {
    /* Allgemeine Randfarbe: 1,02 : 1 gegen den hellen Grund. */
    nr: '661', name: 'Die Hilfslinie der Zeitleiste ist im hellen Schema wieder unsichtbar',
    file: 'public/style.css',
    search: "  --timeline-line: var(--line-hover);",
    replacement: "  --timeline-line: var(--line-2);",
    expected: 'Die Zeitleiste im hellen Schema — 0.24.0'
  },
  {
    /* --faint: 3,46 : 1 bei 0,63 rem Festbreite; --faint ist nie tragender Text. */
    nr: '662', name: 'Die Jahreszahl der Zeitleiste faellt unter die Latte fuer Text',
    file: 'public/style.css',
    search: "  --timeline-year: var(--muted);",
    replacement: "  --timeline-year: var(--faint);",
    expected: 'Die Zeitleiste im hellen Schema — 0.24.0'
  },
  {
    nr: '663', name: 'Das dunkle Schema bekommt einen anderen Wert fuer die Zeitleiste',
    file: 'public/style.css',
    search: "  --timeline-mid: var(--line);\n  --timeline-year: var(--faint);",
    replacement: "  --timeline-mid: var(--line-hover);\n  --timeline-year: var(--faint);",
    expected: 'Die Zeitleiste im hellen Schema — 0.24.0'
  },
  {
    nr: '664', name: 'Die Hilfslinie liest die allgemeine Randfarbe statt ihrer eigenen',
    file: 'public/style.css',
    search: ".timeline-line { position: absolute; left: 0; right: 0; height: 1px; background: var(--timeline-line); }",
    replacement: ".timeline-line { position: absolute; left: 0; right: 0; height: 1px; background: var(--line-2); }",
    expected: 'Die Zeitleiste im hellen Schema — 0.24.0'
  },
  {
    nr: '638', name: 'Der Knopf „Eintrag löschen" steht wieder fuer jede Rolle',
    file: 'public/app.js',
    search: "    ${item.mine === true || ADMIN\n      ? `<div class=\"danger-row\">",
    replacement: "    ${true\n      ? `<div class=\"danger-row\">",
    expected: 'Die Rollenweichen — 0.22.0'
  },
  {
    nr: '639', name: 'Der Klartextschluessel steht wieder vor dem Admin',
    file: 'public/app.js',
    search: "          : (OWNER\n            ? `<div class=\"warn-box\">${tH('card.keyBesideHint')}",
    replacement: "          : (ADMIN\n            ? `<div class=\"warn-box\">${tH('card.keyBesideHint')}",
    expected: 'Die Rollenweichen — 0.22.0'
  },
  {
    nr: '640', name: 'Die Karte Kategorien erklaert dem Benutzer wieder die Werkzeuge des Admins',
    file: 'public/app.js',
    search: "        <p class=\"desc\">${ADMIN\n          ? tH('card.categoriesHint')",
    replacement: "        <p class=\"desc\">${true\n          ? tH('card.categoriesHint')",
    expected: 'Die Rollenweichen — 0.22.0'
  },
  {
    nr: '641', name: 'Abbrechen im Loeschfenster fuer einen Benutzer bricht nicht ab',
    file: 'public/app.js',
    search: "    bd.querySelector('[data-no]').onclick = () => done(null);\n    bd.querySelector('[data-yes]').onclick = take;\n    bd.onclick = e => { if (e.target === bd) done(null); };\n    const onKey = e => { if (e.key === 'Escape') done(null); };",
    replacement: "    bd.querySelector('[data-no]').onclick = nimm;\n    bd.querySelector('[data-yes]').onclick = nimm;\n    bd.onclick = e => { if (e.target === bd) done(null); };\n    const onKey = e => { if (e.key === 'Escape') done(null); };",
    expected: 'Keine Browserfenster mehr — 0.22.0'
  },
  /* ---- Gesten, Kopfzahl, Bewertungskasten ---- */
  {
    nr: '642', name: 'Der Rahmen verliert seine acht Griffe',
    file: 'public/app.js',
    search: "const HANDLE = 12;",
    replacement: "const GRIFF = 0;",
    expected: 'Die fuenf Gesten am Ausschnitt — 0.22.1'
  },
  {
    nr: '643', name: 'Die Kante gewinnt wieder gegen die Ecke',
    file: 'public/app.js',
    search: "  if (n && w) return 'links-oben';",
    replacement: "  if (n) return 'oben';\n  if (n && w) return 'links-oben';",
    expected: 'Die fuenf Gesten am Ausschnitt — 0.22.1'
  },
  {
    nr: '644', name: 'Die Greifzone wird am kleinen Rahmen nicht mehr gedeckelt',
    file: 'public/app.js',
    search: "  const g = Math.min(handle, edge / 4);",
    replacement: "  const g = griff;",
    expected: 'Die fuenf Gesten am Ausschnitt — 0.22.1'
  },
  {
    nr: '645', name: 'Das Schieben aendert die Weite wieder mit',
    file: 'public/app.js',
    search: "      setState(user.crate.links + (p.x - user.p0.x), user.crate.top + (p.y - user.p0.y));",
    replacement: "      setBox(zug.kiste.kante * 0.9,\n        () => ({ l: zug.kiste.links + (p.x - zug.p0.x), o: zug.kiste.top + (p.y - zug.p0.y) }));",
    expected: 'Die fuenf Gesten am Ausschnitt — 0.22.1'
  },
  {
    nr: '646', name: 'Die feste Ecke wandert wieder mit der Rastung',
    file: 'public/app.js',
    search: "      const { l, o } = situation(narrow);\n      setState(l, o);",
    replacement: "      const { l, o } = lage(k);\n      setState(l, o);",
    expected: 'Die fuenf Gesten am Ausschnitt — 0.22.1'
  },
  {
    nr: '647', name: 'Die Kante verschiebt den Mittelpunkt wieder',
    file: 'public/app.js',
    search: "          (e) => ({ l: right - e, o: centerY - e / 2 }), Math.min(right, aroundCenter(centerY, f.height)));",
    replacement: "          (e) => ({ l: rechts - e, o: k.oben }), Math.min(rechts, umMitte(mitteY, f.hoehe)));",
    expected: 'Die fuenf Gesten am Ausschnitt — 0.22.1'
  },
  {
    nr: '648', name: 'Ein Griff ohne Weg setzt wieder den Punkt',
    file: 'public/app.js',
    search: "      if (prev.gesture !== 'neu') return;\n      outPoint(e);",
    replacement: "      outPoint(e);",
    expected: 'Die fuenf Gesten am Ausschnitt — 0.22.1'
  },
  {
    nr: '649', name: 'Der Zeiger sagt wieder nicht, was geschehen wird',
    file: 'public/app.js',
    search: "      const kl = HANDLE_CURSORS[gesture];\n      if (kl) v.classList.add(kl);",
    replacement: "      const kl = null;\n      if (kl) v.classList.add(kl);",
    expected: 'Die fuenf Gesten am Ausschnitt — 0.22.1'
  },
  {
    nr: '650', name: 'Der Finger bekommt die acht Griffe doch',
    file: 'public/app.js',
    search: "      if (e.pointerType === 'touch' && gesture !== 'neu') gesture = 'schieben';",
    replacement: "      if (false && e.pointerType === 'touch' && geste !== 'neu') geste = 'schieben';",
    expected: 'Die fuenf Gesten am Ausschnitt — 0.22.1'
  },
  {
    nr: '651', name: 'Die Kopfzahl steht wieder zweimal da',
    file: 'public/app.js',
    search: "    case 'potenzial': return item.potentialRating ? '' : t('list.notEstimatedYet');",
    replacement: "    case 'potenzial': return item.potenzialRating\n      ? '⌀ ' + zahl(item.potenzialRating, 1) : t('list.notEstimatedYet');",
    expected: 'Die beiden Sternkaesten — 0.21.0'
  },
  {
    nr: '652', name: 'Der Bewertungskasten steht wieder an jeder Idee',
    file: 'public/app.js',
    search: "  return name === 'bewertung' && !item.tested && !hasStars(item, 'after');",
    replacement: "  return false && name === 'bewertung' && !item.tested && !hasStars(item, 'after');",
    expected: 'Die beiden Sternkaesten — 0.21.0'
  },
  {
    nr: '653', name: 'Der Server nimmt die Bewertung am ungetesteten Eintrag wieder an',
    file: 'server.js',
    search: "    if (crit && crit.phase === 'after' && entry && !entry.tested)",
    replacement: "    if (false && krit && krit.phase === 'after' && eintrag && !eintrag.tested)",
    expected: 'Rechte und Sichtbarkeit'
  },
  {
    nr: '654', name: 'Die Kopfzahl sagt nicht mehr, wessen Zahl sie ist',
    file: 'public/app.js',
    search: "        b.title = t('entry.avgAllHint');",
    replacement: "        b.title = 'Wie diese Zahl zustande kommt';",
    expected: 'Die beiden Sternkaesten — 0.21.0'
  },
  {
    nr: '655', name: 'Die Rastung springt wieder ueber den Deckel',
    file: 'public/app.js',
    search: "      if (narrow > up + 1e-9 && zoom < 400) {",
    replacement: "      if (false && eng > hoch + 1e-9 && zoom < 400) {",
    expected: 'Die fuenf Gesten am Ausschnitt — 0.22.1'
  },
  {
    nr: 'W2', name: 'Eine Portbasis liegt wieder auf der gesperrten 4045',
    file: 'test/firstlogin.js',
    search: '  const B = startFurtherServer(freshDir, {}, 5130);',
    replacement: '  const B = startFurtherServer(freshDir, {}, 4000);',
    expected: 'Die Portbasen und der Versatz'
  },
  {
    nr: 'W5', name: 'Der SMTP-Empfaenger wird nicht mehr vermerkt',
    file: 'test/frame.js',
    search: '  SMTP_CASES.push(state);',
    replacement: '  // SMTP_CASES.push(state);',
    expected: 'Die Portbasen und der Versatz'
  },
  {
    /* Zielt auf das Horchen, nicht auf das Abraeumen der Verbindungen. */
    nr: 'W6', name: 'Der SMTP-Empfaenger hoert nicht auf zu horchen',
    file: 'test/frame.js',
    search: '    server.close(() => r());',
    replacement: '    r();',
    expected: 'Keine Prueflage laesst ihren Server zurueck'
  },
  /* ---- Bericht ueber einen abgerissenen Lauf ---- */
  {
    /* Aufheben (W16) und Drucken stehen getrennt, daher zwei Rueckbauten. */
    nr: 'W15', name: 'Der Bericht druckt die letzten Zeilen eines Abrisses nicht mehr',
    file: 'counterproof.js',
    search: '      for (const z of e.tail || []) console.log(`     \u2502 ${z}`);',
    replacement: '      for (const z of []) console.log(`     \u2502 ${z}`);',
    expected: 'Die Gegenproben greifen'
  },
  {
    nr: 'W16', name: 'Der Leser hebt die letzten Zeilen gar nicht erst auf',
    file: 'counterproof.js',
    search: "    tail: output.split('\\n').map(z => z.trimEnd()).filter(z => z).slice(-20)",
    replacement: '    tail: []',
    expected: 'Die Gegenproben greifen'
  },
  /* ---- Waechter der Sprachdatei ---- */
  {
    nr: '685', name: 'Eine zweite Sprachdatei traegt andere Schluessel',
    file: 'package.json',
    copy: 'public/languages/en.json',
    expected: 'Die sieben Waechter der Sprachdatei — 0.24.0'
  },
  {
    nr: '686', name: 'Ein Schluessel der Sprachdatei heisst anders als im Code',
    file: 'public/languages/de.json',
    search: '"list.open": "\u00d6ffnen",',
    replacement: '"liste.oeffnen2": "\u00d6ffnen",',
    expected: 'Die sieben Waechter der Sprachdatei \u2014 0.24.0'
  },
  {
    nr: '687', name: 'Ein Platzhalter heisst beinahe wie ein Vokabelwort',
    file: 'public/languages/de.json',
    search: "\"list.foundIn\": \"Gefunden in: {source}\",",
    replacement: '"list.foundIn": "Gefunden in: {sache}",',
    expected: 'Die sieben Waechter der Sprachdatei \u2014 0.24.0'
  },
  {
    nr: '688', name: 'Einer Mehrzahlform fehlt die Einzahl',
    file: 'public/languages/de.json',
    search: "\"list.commentCount\": {\n    \"one\": \"{n} Kommentar\",\n    \"other\": \"{n} Kommentare\"\n  },",
    replacement: '"list.commentCount": {\n    "other": "{n} Kommentare"\n  },',
    expected: 'Die sieben Waechter der Sprachdatei \u2014 0.24.0'
  },
  {
    nr: '689', name: 'Eine Mehrzahl waehlt ihre Form wieder ueber `=== 1 ?`',
    file: 'public/app.js',
    search: "const vThing = (n) => counted(n, V.entryOne, V.entryMany);",
    replacement: 'const vThing = (n) => (n === 1 ? V.entryOne : V.entryMany);',
    expected: 'Die sieben Waechter der Sprachdatei \u2014 0.24.0'
  },
  {
    nr: '690', name: 'Ein deutscher Satz bleibt wieder in app.js stehen',
    file: 'public/app.js',
    search: "      button.textContent = t('entry.showLess');",
    replacement: "      knopf.textContent = 'Weniger anzeigen, bitte sehr';",
    expected: 'Die sieben Waechter der Sprachdatei \u2014 0.24.0'
  },
  {
    nr: '691', name: 'Die Sprachdatei nennt eine Locale, die Intl nicht kennt',
    file: 'public/languages/de.json',
    search: "\"_locale\": \"de-DE\",",
    replacement: "\"_locale\": \"xx-XX\",",
    expected: 'Die sieben Waechter der Sprachdatei \u2014 0.24.0'
  },
  {
    nr: '692', name: 'Ein Schluessel der Liste fehlt und steht als \u27e6\u2026\u27e7 am Bildschirm',
    file: 'public/languages/de.json',
    search: '"list.loading":',
    replacement: '"liste.laedtNicht":',
    expected: 'Oberflaeche'
  },
  {
    nr: '693', name: 'Ein Schluessel des Systembereichs fehlt und steht als \u27e6\u2026\u27e7 da',
    file: 'public/languages/de.json',
    search: '"card.personal":',
    replacement: '"karte.persoenlichNicht":',
    expected: 'Der Systembereich nach Rolle'
  },

  /* ---- Englischer Quelltext ---- */
  {
    nr: '694', name: 'Ein deutscher Bezeichner kehrt in den Server zurueck',
    file: 'server.js',
    search: 'const EXCHANGE_PART_MIN = 1024 * 1024;',
    replacement: 'const EXCHANGE_PART_MIN = 1024 * 1024;\nconst teilGroesseKlein = EXCHANGE_PART_MIN;',
    expected: 'Der Quelltext spricht Englisch — die sechs Waechter'
  },
  {
    nr: '695', name: 'Ein Schluessel der Sprachdatei heisst wieder deutsch',
    file: 'public/languages/de.json',
    search: '"list.description":',
    replacement: '"list.beschreibungLang":',
    expected: 'Der Quelltext spricht Englisch — die sechs Waechter'
  },
  {
    nr: '696', name: 'Eine deutsche Adresse kommt dazu',
    file: 'public/app.js',
    search: "const OLD_ADDRESSES = { '#/offen': '#/open' };",
    replacement: "const OLD_ADDRESSES = { '#/offen': '#/open', '#/uebersicht': '#/list' };",
    expected: 'Der Quelltext spricht Englisch — die sechs Waechter'
  },
  {
    nr: '697', name: 'Eine deutsche Klasse kehrt ins Stilblatt zurueck',
    file: 'public/style.css',
    search: '.role-badge.owner {',
    replacement: '.role-badge.owner, .role-badge.eigentuemer {',
    expected: 'Der Quelltext spricht Englisch — die sechs Waechter'
  },
  {
    nr: '698', name: 'Ein Satz der Oberflaeche wird umformuliert',
    file: 'public/languages/de.json',
    search: '"card.never": "noch nie"',
    replacement: '"card.never": "bisher nie"',
    expected: 'Der Quelltext spricht Englisch — die sechs Waechter'
  },
  {
    nr: '699', name: 'Ein Schluessel bekommt eine angehaengte Ziffer',
    file: 'public/languages/de.json',
    search: '"card.mailAccount":',
    replacement: '"card.mailAccount2":',
    expected: 'Der Quelltext spricht Englisch — die sechs Waechter'
  },

  /* ---- Sprachhelfer ---- */
  {
    nr: '700', name: 'Die Vorschaukachel fragt wieder den Sprachhelfer nach ihrem Vater',
    file: 'public/app.js',
    search: 'idx = [...tile.parentElement.children].indexOf(tile);',
    replacement: 'idx = [...t.parentElement.children].indexOf(tile);',
    expected: 'Der Sprachhelfer und die Ladung — 0.24.0'
  },
  {
    nr: '701', name: 'Der zugeklappte Linkblock behaelt seine Stellung am Ende',
    file: 'public/app.js',
    search: '    box.scrollTop = 0;',
    replacement: '    box.scrollTop = 1;',
    expected: 'Zugeklappt heisst: die ersten Zeilen — 0.24.1'
  },

  /* ---- Gespeicherte Formen ---- */
  {
    nr: '710', name: 'Eine Datei mit kaputtem JSON nimmt den Server wieder mit',
    file: 'server.js',
    search: "    } catch (e) {\n      languageSkip(file, `it cannot be read (${e.message})`);\n      continue;\n    }",
    replacement: "    } catch (e) { throw e; }",
    expected: 'Die Fremddatei und der Dateiname — 0.24.3'
  },
  {
    nr: '711', name: 'Eine unbrauchbare _locale nimmt den Server wieder mit',
    file: 'server.js',
    search: "    try { new Intl.PluralRules(texts._locale); }\n    catch {\n      languageSkip(file, `Intl does not know the locale \"${texts._locale}\"`);\n      continue;\n    }",
    replacement: "    new Intl.PluralRules(texts._locale);",
    expected: 'Die Fremddatei und der Dateiname — 0.24.3'
  },
  {
    nr: '712', name: 'Der Dateiname wird nicht mehr geprueft',
    file: 'server.js',
    search: "    if (!LANGUAGE_NAME.test(code)) {",
    replacement: "    if (false) {",
    expected: 'Die Fremddatei und der Dateiname — 0.24.3'
  },
  {
    nr: '713', name: 'Die uebergangene Datei wird nicht mehr genannt',
    file: 'server.js',
    search: "const languageSkip = (file, why) => console.error(\n  `[languages] ${file} does not count as a language: ${why}`);",
    replacement: "const languageSkip = (file, why) => file && why;",
    expected: 'Die Fremddatei und der Dateiname — 0.24.3'
  },
  {
    nr: '714', name: 'Ein Benutzer darf wieder jede Sprache setzen, auch eine gesperrte',
    file: 'server.js',
    search: "    if (!languagePool().includes(wanted))",
    replacement: "    if (!LANGUAGES[wanted])",
    expected: 'Der Vorrat der Sprachen — 0.24.3'
  },
  {
    /* Die Klemme steht an zwei Stellen, daher zwei Rueckbauten. */
    nr: '715', name: 'Die Vorgabesprache faellt beim SCHREIBEN aus dem Vorrat',
    file: 'server.js',
    search: "  if (!set.includes(std)) set.push(std);",
    replacement: "  if (false) set.push(std);",
    expected: 'Der Vorrat der Sprachen — 0.24.3'
  },
  {
    nr: '733', name: 'Die Vorgabesprache faellt beim LESEN aus dem Vorrat',
    file: 'server.js',
    search: "  return pool.includes(std) ? pool : [std, ...pool];",
    replacement: "  return pool;",
    expected: 'Der Vorrat der Sprachen — 0.24.3'
  },
  {
    nr: '716', name: 'Ohne Sprachangabe meint der Schreibweg wieder die Sprache des Lesers',
    file: 'server.js',
    search: "  if (wanted === undefined) return rowLanguage;",
    replacement: "  if (wanted === undefined) return localeOf(req);",
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  {
    nr: '717', name: 'Die Grundzeile haengt wieder an der Vorgabesprache',
    file: 'server.js',
    search: "  if (language === rowLanguage) return true;",
    replacement: "  if (language === languageDefault()) return true;",
    expected: 'Die Kette am Server — 0.25.0'
  },
  {
    nr: '718', name: 'Die Namenstabelle haengt nicht mehr an ihrer Grundzeile',
    file: 'db.js',
    search: "CREATE TABLE IF NOT EXISTS criterion_names (\n  criterion_id INTEGER NOT NULL REFERENCES rating_criteria(id) ON DELETE CASCADE,",
    replacement: "CREATE TABLE IF NOT EXISTS criterion_names (\n  criterion_id INTEGER NOT NULL,",
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  {
    /* Nicht die Tabelle entfernen: die Abfrage scheitert dann beim Vorbereiten,
       und der Lauf bricht ab, statt namentlich rot zu werden. */
    nr: '719', name: 'Die Kategorienamen werden nicht mehr je Sprache gelesen',
    file: 'server.js',
    search: "const categoryNames = (locale) => nameTable(qCategoryBase().all(), qCategoryNamesAll.all(), locale);",
    replacement: "const categoryNames = () => new Map();",
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  {
    nr: '731', name: 'Der Export nimmt die Sprachfassungen der Namen nicht mit',
    file: 'server.js',
    search: "           criteriaNames: exchangeCriterionNames(),\n           criteriaLanguages: exchangeCriterionLanguages(),\n           categoryNames: exchangeCategoryNames(),\n           categoryLanguages: exchangeCategoryLanguages(), items };",
    replacement: "           items };",
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  {
    nr: '732', name: 'Der Import legt die Sprachfassungen nicht wieder hinein',
    file: 'server.js',
    search: "      [iCritNameAdd, critByName, payload.criteriaNames],",
    replacement: "      [iCritNameAdd, critByName, null],",
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  /* ---- Sprachpillen der Namenskarten ---- */
  {
    nr: '737', name: 'Die Namenstafeln fallen aus der Antwort',
    file: 'server.js',
    search: "  ...(isAdmin(req)\n    ? { categoryNames: categoryNamesAll(), criterionNames: criterionNamesAll() } : {}),\n",
    replacement: "",
    expected: 'Die Sprachpillen der Namenskarten — 0.24.5'
  },
  {
    nr: '738', name: 'Die Namenstafeln gehen an jeden -- auch an den, der nicht umschalten kann',
    file: 'server.js',
    search: "  ...(isAdmin(req)\n    ? { categoryNames: categoryNamesAll(), criterionNames: criterionNamesAll() } : {}),",
    replacement: "  categoryNames: categoryNamesAll(), criterionNames: criterionNamesAll(),",
    expected: 'Die Namenstafeln je Sprache — 0.24.5'
  },
  {
    nr: '739', name: 'Die Namenstafel behauptet, jede Zelle sei eingetragen',
    file: 'server.js',
    search: "      table[row.id] = { name: hit.name, from: hit.from };",
    replacement: "      table[row.id] = { name: hit.name, from: code };",
    expected: 'Die Sprachpillen der Namenskarten — 0.24.5'
  },
  {
    nr: '740', name: 'Der Bauer der Kriterientafel nimmt wieder eine Sprache an',
    file: 'server.js',
    search: "const criterionNamesAll = () => namesAll(qCriterionBase().all(), qCriterionNamesAll.all());",
    replacement: "const criterionNamesAll = () => {\n" +
      "  const all = namesAll(qCriterionBase.all(), qCriterionNamesAll.all());\n" +
      "  return { [languageDefault()]: all[languageDefault()] };\n};",
    expected: 'Die Sprachpillen der Namenskarten — 0.24.5'
  },
  {
    nr: '741', name: 'Der Listenweg folgt nicht mehr dem Leser',
    file: 'server.js',
    search: "app.get('/api/criteria', (req, res) => res.json(criteriaFor(localeOf(req))));",
    replacement: "app.get('/api/criteria', (req, res) => res.json(criteriaFor(languageDefault())));",
    expected: 'Die Namenstafeln je Sprache — 0.24.5'
  },
  {
    nr: '742', name: 'api() nimmt wieder eine fremde Sprache an',
    file: 'public/app.js',
    search: "async function api(method, url, body, isForm = false) {",
    replacement: "async function api(method, url, body, isForm = false, language = LANGUAGE) {",
    expected: 'Die Namenstafeln je Sprache — 0.24.5'
  },
  {
    nr: '743', name: 'Der Kopf traegt wieder, was der Rufer verlangt',
    file: 'public/app.js',
    search: "                 headers: { 'Accept-Language': LANGUAGE, ...csrfHeader() } };",
    replacement: "                 headers: { 'Accept-Language': arguments[4] || LANGUAGE, ...csrfHeader() } };",
    expected: 'Die Namenstafeln je Sprache — 0.24.5'
  },
  {
    nr: '744', name: 'Die Karte liest die Namenstafel nicht mehr',
    file: 'public/app.js',
    search: "  const shown = (NAMES_ALL[key] || {})[code];",
    replacement: "  const shown = null;",
    expected: 'Die Sprachpillen der Namenskarten — 0.24.5'
  },
  {
    nr: '745', name: 'Der Vermerk am Rueckfall faellt weg',
    file: 'public/app.js',
    search: "      const fallbackMark = entry.nameFallback === undefined ? ''\n" +
      "        : (entry.nameFallback === true",
    replacement: "      const fallbackMark = '' || (false",
    expected: 'Die Sprachpillen der Namenskarten — 0.24.5'
  },
  {
    nr: '746', name: 'Das Umbenennfeld traegt wieder den Rueckfall als Wert',
    file: 'public/app.js',
    search: "        inp.value = entry.nameFallback ? '' : entry.name;\n" +
      "        if (entry.nameFallback) inp.placeholder = entry.name;",
    replacement: "        inp.value = entry.name;",
    expected: 'Die Sprachpillen der Namenskarten — 0.24.5'
  },
  {
    nr: '747', name: 'drawAdmin liest wieder an namesFrom vorbei',
    file: 'public/app.js',
    search: "    manageList('mcats', namesFrom(fetched, 'cats'), 'cat', fetched);",
    replacement: "    manageList('mcats', fetched.cats, 'cat', fetched);",
    expected: 'Die Sprachpillen der Namenskarten — 0.24.5'
  },
  {
    nr: '748', name: 'adminNew zieht die Namenstafeln nicht nach',
    file: 'public/app.js',
    search: "    takeNames(settings);\n    drawAdmin(fetched);",
    replacement: "    drawAdmin(fetched);",
    expected: 'Die Sprachpillen der Namenskarten — 0.24.5'
  },
  /* ---- Rueckfall sagt, was er zeigt ---- */
  {
    nr: '749', name: 'Die Kette bricht nach der Vorgabesprache ab',
    file: 'server.js',
    search: "  for (const code of [std, row.language]) {",
    replacement: "  for (const code of [std]) {",
    expected: 'Die Kette am Server — 0.25.0'
  },
  {
    nr: '750', name: 'Der Vermerk nennt wieder die Vorgabesprache',
    file: 'public/app.js',
    search: "    return { ...z, name: hit.name, nameFallback: hit.from === null ? true : hit.from };",
    replacement: "    return { ...z, name: hit.name, nameFallback: baseNamesLanguage() };",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '751', name: 'Die Klammer behauptet wieder eine Sprache',
    file: 'server.js',
    search: "  return { name: row.name, from: null, fallback: true };",
    replacement: "  return { name: row.name, from: languageDefault(), fallback: true };",
    expected: 'Die Kette am Server — 0.25.0'
  },
  {
    nr: '752', name: 'Die Kette laeuft in der umgekehrten Reihenfolge',
    file: 'server.js',
    search: "  for (const code of [std, row.language]) {",
    replacement: "  for (const code of [row.language, std]) {",
    expected: 'Die Kette am Server — 0.25.0'
  },
  {
    nr: '754', name: 'Der rote Rahmen an der Kachel faellt weg',
    file: 'public/app.js',
    search: "  if (card) card.classList.toggle('gaps', namesMissing(key, shownCode, only) > 0);",
    replacement: "  if (card) card.classList.toggle('gaps', false);",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '755', name: 'Der rote Rahmen steht an jeder Kachel',
    file: 'public/app.js',
    search: "  if (card) card.classList.toggle('gaps', namesMissing(key, shownCode, only) > 0);",
    replacement: "  if (card) card.classList.toggle('gaps', true);",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '756', name: 'Der Wechsel der Vorgabesprache zieht die Tafeln nicht nach',
    file: 'public/app.js',
    search: "      takeNames(s);\n      drawLanguages();",
    replacement: "      drawLanguages();",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '757', name: 'Die Antwort des Wechsels traegt die Namenstafeln nicht',
    file: 'server.js',
    search: "                 ...(isAdmin(req) && languagesTouched\n" +
      "                   ? { categoryNames: categoryNamesAll(), criterionNames: criterionNamesAll() } : {}),",
    replacement: "",
    expected: 'Die Namenstafeln je Sprache — 0.24.5'
  },
  {
    nr: '758', name: 'Jede Antwort des Schreibwegs traegt die Namenstafeln',
    file: 'server.js',
    search: "                 ...(isAdmin(req) && languagesTouched",
    replacement: "                 ...(isAdmin(req)",
    expected: 'Die Namenstafeln je Sprache — 0.24.5'
  },
  {
    nr: '759', name: 'Der Gewichtswechsel schickt den Namen ohne Sprache',
    file: 'public/app.js',
    search: "          const now = await api('PUT', `${url}/${entry.id}`, spec.perLanguage\n" +
      "            ? { name: entry.name, weight: g,\n" +
      "                ...(nameLanguage === null ? {} : { language: nameLanguage }) }\n" +
      "            : { name: entry.name, weight: g });",
    replacement: "          const now = await api('PUT', `${url}/${entry.id}`, " +
      "{ name: entry.name, weight: g });",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  /* ---- Sprache der Namen ---- */
  {
    nr: '763', name: 'Eine neue Kategorie entsteht wieder ohne Sprachvermerk',
    file: 'server.js',
    search: "  const i = db.prepare('INSERT INTO product_categories (name, language) VALUES (?, ?)')\n" +
      "    .run(name, catNew);",
    replacement: "  const i = db.prepare('INSERT INTO product_categories (name) VALUES (?)').run(name);",
    expected: 'Die Kette am Server — 0.25.0'
  },
  {
    nr: '764', name: 'Eine neue Zeile bekommt die Vorgabe statt der Sprache des Rufers',
    file: 'server.js',
    search: "  if (wanted === undefined) return localeOf(req);\n" +
      "  return typeof wanted === 'string' && LANGUAGES[wanted] ? wanted : null;",
    replacement: "  if (wanted === undefined) return languageDefault();\n" +
      "  return typeof wanted === 'string' && LANGUAGES[wanted] ? wanted : null;",
    expected: 'Die Kette am Server — 0.25.0'
  },
  {
    nr: '765', name: 'Der eine Griff schreibt auch die Zeilen um, die ihre Sprache kennen',
    file: 'server.js',
    search: "  const categories = db.prepare('UPDATE product_categories SET language = ? WHERE language IS NULL')",
    replacement: "  const categories = db.prepare('UPDATE product_categories SET language = ?')",
    expected: 'Die Kette am Server — 0.25.0'
  },
  {
    nr: '766', name: 'Das ✕ raeumt auch den Originaltext',
    file: 'server.js',
    search: "  if (language === row.language)\n" +
      "    return res.status(400).json({ error: t(localeOf(req), 'server.nameOriginalStays')});",
    replacement: "  if (false)\n" +
      "    return res.status(400).json({ error: t(localeOf(req), 'server.nameOriginalStays')});",
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  {
    nr: '767', name: 'Der Export nimmt die Erstellungssprachen nicht mit',
    file: 'server.js',
    search: "           criteriaNames: exchangeCriterionNames(),\n" +
      "           criteriaLanguages: exchangeCriterionLanguages(),",
    replacement: "           criteriaNames: exchangeCriterionNames(),",
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  {
    nr: '768', name: 'Der Import uebergeht die Erstellungssprache der Kriterien',
    file: 'server.js',
    search: "    const critLanguages = fileLanguage(payload.criteriaLanguages);",
    replacement: "    const critLanguages = fileLanguage(null);",
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  {
    nr: '779', name: 'Der Import uebergeht die Erstellungssprache der Kategorien',
    file: 'server.js',
    search: "    const catLanguages = fileLanguage(payload.categoryLanguages);",
    replacement: "    const catLanguages = fileLanguage(null);",
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  {
    nr: '769', name: 'Die Pille traegt weder Punkt noch Zahl',
    file: 'public/app.js',
    search: "    b.innerHTML = esc(a.name) + (gaps\n" +
      "      ? `<span class=\"n\">${Number(gaps)}</span>`\n" +
      "      : '<span class=\"dot\" aria-hidden=\"true\">●</span>');\n" +
      "    b.title = gaps ? t('card.languageMissing', { n: gaps }) : t('card.languageComplete');",
    replacement: "    b.textContent = a.name;",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '770', name: 'Die Zahl an der Pille zaehlt alle Zellen statt der fehlenden',
    file: 'public/app.js',
    search: "  return Object.entries(table).filter(([id, z]) =>\n" +
      "    (!only || only.has(Number(id))) && (!z || z.from !== code)).length;",
    replacement: "  return Object.entries(table).filter(([id]) =>\n" +
      "    !only || only.has(Number(id))).length;",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '771', name: 'Der geliehene Name wird nicht mehr gedaempft',
    file: 'public/app.js',
    search: "        <span class=\"mname${\n" +
      "          entry.nameFallback === undefined ? '' : ' back'}\">${esc(entry.name)}</span>",
    replacement: "        <span class=\"mname\">${esc(entry.name)}</span>",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '772', name: 'Das ✕ steht an jeder Zeile',
    file: 'public/app.js',
    search: "      const mayClear = may && spec.perLanguage && entry.nameFallback === undefined &&\n" +
      "        entry.language !== namesLanguage();",
    replacement: "      const mayClear = may && spec.perLanguage;",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '773', name: 'Das ✕ schickt einen leeren Namen statt des Raeumzeichens',
    file: 'public/app.js',
    search: "          await api('PUT', `${url}/${entry.id}`,\n" +
      "            { clearName: true, language: namesLanguage() });",
    replacement: "          await api('PUT', `${url}/${entry.id}`,\n" +
      "            { name: '', language: namesLanguage() });",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '774', name: 'Der Kasten fuer die unbekannte Sprache steht immer',
    file: 'public/app.js',
    search: "  box.hidden = open === 0;",
    replacement: "  box.hidden = false;",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '775', name: 'Die Vokabelpille traegt weder Punkt noch Zahl',
    file: 'public/app.js',
    search: "      b.innerHTML = esc(a.name) + (gaps\n" +
      "        ? `<span class=\"n\">${Number(gaps)}</span>`\n" +
      "        : '<span class=\"dot\" aria-hidden=\"true\">●</span>');\n" +
      "      b.title = gaps ? t('card.wordsMissing', { n: gaps }) : t('card.languageComplete');",
    replacement: "      b.textContent = a.name;",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '776', name: 'Das leere Vokabelfeld wird nicht mehr markiert',
    file: 'public/app.js',
    search: "          ${VOCABULARY_FIELDS.map(([id, key, name]) => `<div class=\"field${\n" +
      "            vocabularyShown()[key] ? '' : ' gap'}\"><label for=\"${id}\">${esc(name())}",
    replacement: "          ${VOCABULARY_FIELDS.map(([id, key, name]) => `<div class=\"field\"><label for=\"${id}\">${esc(name())}",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '777', name: 'Die Ansage nach dem Umschalten faellt weg',
    file: 'public/app.js',
    search: "    if (gapCode && gaps.names + gaps.words > 0) {",
    replacement: "    if (false) {",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '778', name: 'Die Pillenreihen werden nach einem Umbenennen nicht nachgezogen',
    file: 'public/app.js',
    search: "    drawNameLanguages('ncatlang', 'cats');\n    drawNamesUnknown(fetched);",
    replacement: "    drawNamesUnknown(fetched);",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '780', name: 'Die Zahl an der Pille zaehlt wieder beide Kriterienkarten',
    file: 'public/app.js',
    search: "    const gaps = namesMissing(key, a.code, only);",
    replacement: "    const gaps = namesMissing(key, a.code);",
    expected: 'Jede Kachel zaehlt ihre eigene Arbeit — 0.25.1'
  },
  {
    nr: '781', name: 'Der rote Rahmen zaehlt wieder beide Kriterienkarten',
    file: 'public/app.js',
    search: "  if (card) card.classList.toggle('gaps', namesMissing(key, shownCode, only) > 0);",
    replacement: "  if (card) card.classList.toggle('gaps', namesMissing(key, shownCode) > 0);",
    expected: 'Jede Kachel zaehlt ihre eigene Arbeit — 0.25.1'
  },
  {
    nr: '782', name: 'Die erste Zeichnung reicht der Pillenreihe die Zeilen nicht',
    file: 'public/app.js',
    search: "  drawNameLanguages(`${k.list}-lang`, 'crits', rows);",
    replacement: "  drawNameLanguages(`${k.list}-lang`, 'crits');",
    expected: 'Jede Kachel zaehlt ihre eigene Arbeit — 0.25.1'
  },
  {
    nr: '783', name: 'Das Neuzeichnen reicht der Pillenreihe die Zeilen nicht',
    file: 'public/app.js',
    search: "      drawNameLanguages(`${CRIT_CARD[phase].list}-lang`, 'crits', rows);",
    replacement: "      drawNameLanguages(`${CRIT_CARD[phase].list}-lang`, 'crits');",
    expected: 'Jede Kachel zaehlt ihre eigene Arbeit — 0.25.1'
  },
  {
    nr: '784', name: 'Der Vermerk sitzt wieder im Namenskasten',
    file: 'public/app.js',
    search: "        <span class=\"mname${\n" +
      "          entry.nameFallback === undefined ? '' : ' back'}\">${esc(entry.name)}</span>",
    replacement: "        <span class=\"mnamebox\"><span class=\"mname${\n" +
      "          entry.nameFallback === undefined ? '' : ' back'}\">${esc(entry.name)}</span>${fallbackMark}</span>",
    expected: 'Jede Kachel zaehlt ihre eigene Arbeit — 0.25.1'
  },
  {
    nr: '785', name: 'Die Zeile mit Vermerk bekommt den Umbruch nicht',
    file: 'public/app.js',
    search: "      if (entry.nameFallback !== undefined) row.classList.add('withback');",
    replacement: "      if (false) row.classList.add('withback');",
    expected: 'Jede Kachel zaehlt ihre eigene Arbeit — 0.25.1'
  },
  {
    nr: '786', name: 'Der Vermerk nennt die fehlende Sprache nicht',
    file: 'public/languages/de.json',
    search: "\"card.nameFallback\": \"(kein Eintrag in {missing} — gezeigt wird {language})\"",
    replacement: "\"card.nameFallback\": \"(nicht eingetragen — es steht {language})\"",
    expected: 'Jede Kachel zaehlt ihre eigene Arbeit — 0.25.1'
  },
  {
    nr: '787', name: 'Ein alleinstehendes „yedek" bleibt im Tuerkischen stehen',
    file: 'public/languages/tr.json',
    search: "\"card.lastBackup\": \"Son yedekleme\"",
    replacement: "\"card.lastBackup\": \"Son yedek\"",
    expected: '„Backup" heisst auf Tuerkisch yedekleme — 0.25.1'
  },
  {
    nr: '788', name: 'Der Stempel des Servers reist wieder mit',
    file: 'public/app.js',
    search: "    if (hit.from === code) return { ...z, name: hit.name, nameFallback: undefined };",
    replacement: "    if (hit.from === code) return { ...z, name: hit.name };",
    expected: 'Ein Leser, der anders liest — 0.25.2'
  },
  {
    nr: '789', name: 'Die zweite Angabe steht wieder im Quelltext',
    file: 'public/app.js',
    search: "let NAMES_SHOWN = null;",
    replacement: "let NAMES_SHOWN = null;\nlet VOCABULARY_SHOWN = null;",
    expected: 'Ein Leser, der anders liest — 0.25.2'
  },
  {
    nr: '790', name: 'Der Vokabelumschalter liest wieder seine eigene Angabe',
    file: 'public/app.js',
    search: "      b.className = 'pill' + (namesLanguage() === a.code ? ' on' : '');",
    replacement: "      b.className = 'pill' + (LANGUAGE === a.code ? ' on' : '');",
    expected: 'Ein Leser, der anders liest — 0.25.2'
  },
  {
    nr: '791', name: 'Die Felder einer Vokabelzeile fliessen wieder von oben',
    file: 'public/style.css',
    search: ".vocabulary-grid .field { margin-bottom: 10px; display: flex; flex-direction: column; }\n" +
      ".vocabulary-grid .field .input { margin-top: auto; }",
    replacement: ".vocabulary-grid .field { margin-bottom: 10px; }",
    expected: 'Zwei Felder in einer Zeile stehen auf einer Linie — 0.25.3'
  },
  {
    nr: '793', name: 'Das Anfuehrungszeichen am Tagzeichen bleibt wieder offen',
    file: 'public/languages/tr.json',
    search: '"entry.tagQuote": "Etiket \u201c{name}\u201d",',
    replacement: '"entry.tagQuote": "Etiket \u201c{name}",',
    expected: 'Ein Satz, den jede Sprache selbst schneidet — 0.25.4'
  },
  {
    nr: '794', name: 'Der Zaehlwert reist wieder unter einem fremden Namen',
    file: 'public/app.js',
    search: "tH('card.logKeepsHint', { n: log.days })",
    replacement: "tH('card.logKeepsHint', { days: log.days })",
    expected: 'Ein Satz, den jede Sprache selbst schneidet — 0.25.4'
  },

  /* ---- Kleine Fehler ---- */
  {
    nr: '795', name: 'Der Hinweistext hat keinen eigenen Traeger mehr',
    file: 'public/app.js',
    search: '<input type="file" id="file" accept="image/*,video/*" multiple><span\n          id="drop-text">',
    replacement: '<input type="file" id="file" accept="image/*,video/*" multiple>\n          <span-ohne-kennung>',
    expected: 'Die kleinen Fehler fallen — 0.26.0'
  },
  {
    nr: '796', name: 'Der Fortschritt schreibt wieder ins Label statt in den Traeger',
    file: 'public/app.js',
    search: "    const dropText = document.getElementById('drop-text');",
    replacement: "    const dropText = document.getElementById('drop');",
    expected: 'Die kleinen Fehler fallen — 0.26.0'
  },
  {
    nr: '797', name: 'Die Fusszeile der Sitzungen haengt wieder in der Liste',
    file: 'public/app.js',
    search: "    if (!foot) return;\n    foot.innerHTML = other",
    replacement: "    if (!foot) return;\n    box.appendChild(foot);\n    foot.innerHTML = other",
    expected: 'Die kleinen Fehler fallen — 0.26.0'
  },
  {
    nr: '798', name: 'Der Eintragstitel ist wieder ein einzeiliges Feld',
    file: 'public/app.js',
    search: '<textarea class="title-in" id="title" rows="1">${esc(item.title)}</textarea>',
    replacement: '<input class="title-in" id="title" value="${esc(item.title)}">',
    expected: 'Die kleinen Fehler fallen — 0.26.0'
  },
  {
    nr: '799', name: 'Der Ausfuhrknopf traegt wieder drei Flexkinder',
    file: 'public/app.js',
    search: '<button class="btn btn-accent btn-sm" id="ex-yes"><span>${tMarks(\'card.withPhotos\',\n            { word: \'<span id="ex-gr-yes">…</span>\' })}</span></button>',
    replacement: '<button class="btn btn-accent btn-sm" id="ex-yes">${tMarks(\'card.withPhotos\',\n            { word: \'<span id="ex-gr-yes">…</span>\' })}</button>',
    expected: 'Die kleinen Fehler fallen — 0.26.0'
  },
  {
    nr: '800', name: 'Der Satz am Ausfuhrknopf macht seine Klammer nicht mehr auf',
    file: 'public/languages/de.json',
    search: "\"card.withPhotos\": \"Mit Fotos (~{word})\",",
    replacement: '"card.withPhotos": "mit Fotos",',
    expected: 'Die kleinen Fehler fallen — 0.26.0'
  },
  {
    nr: '801', name: 'Der Gewichtssatz erklaert dem Benutzer wieder den Knopf des Admins',
    file: 'public/app.js',
    search: "            : t('card.weightSystemDefault')}</p>",
    replacement: "            : t('card.weightRangeHint')}</p>",
    expected: 'Die kleinen Fehler fallen — 0.26.0'
  },
  {
    nr: '802', name: 'Der Strich vor den Summen kommt wieder aus einer toten Regel',
    file: 'public/style.css',
    search: '.calc-last > span { border-bottom-color: var(--line); }',
    replacement: '.calc-sum:first-of-type > span { border-top: 1px solid var(--line); }',
    expected: 'Die kleinen Fehler fallen — 0.26.0'
  },
  {
    nr: '803', name: 'Der Hinweis an der Zeitleiste laeuft wieder hinaus',
    file: 'public/style.css',
    search: '  width: max-content; max-width: min(14rem, 46%); overflow-wrap: anywhere;',
    replacement: '  white-space: nowrap;',
    expected: 'Die kleinen Fehler fallen — 0.26.0'
  },
  {
    nr: '804', name: 'ß und ss sind wieder zwei verschiedene Dinge',
    file: 'db.js',
    search: "      .replace(/\\u00df/g, 'ss'));",
    replacement: "      );",
    expected: 'Die kleinen Fehler fallen — 0.26.0'
  },

  /* ---- Potenzialmodus ---- */
  {
    nr: '805', name: 'Der Sternkasten steht wieder an jedem Eintrag',
    file: 'public/app.js',
    search: '        ${POTENTIAL_MODE ? `<div class="block" data-block="potenzial">',
    replacement: '        ${true ? `<div class="block" data-block="potenzial">',
    expected: 'Der Potenzialmodus — 0.26.0'
  },
  {
    nr: '806', name: 'Die Sortiergruppe des Potenzials steht wieder immer da',
    file: 'public/app.js',
    search: "      down: 'list.dirHighLow',  up: 'list.dirLowHigh', start: 'down',\n      only: () => POTENTIAL_MODE },",
    replacement: "      down: 'list.dirHighLow',  up: 'list.dirLowHigh', start: 'down',\n      only: () => true },",
    expected: 'Der Potenzialmodus — 0.26.0'
  },
  {
    nr: '808', name: 'Die Kopfzahl des Potenzials steht wieder in der Uebersicht',
    file: 'public/app.js',
    search: "  if (!POTENTIAL_MODE && potential) return '';",
    replacement: "  if (false && potential) return '';",
    expected: 'Der Potenzialmodus — 0.26.0'
  },
  {
    nr: '809', name: 'Der Potenzialmodus ist wieder gewoehnliche Adminsache',
    file: 'server.js',
    search: "                                'languageDefault', 'languageOn', 'potentialMode',\n",
    replacement: "                                'languageDefault', 'languageOn',\n",
    expected: 'Der Potenzialmodus — 0.26.0'
  },
  {
    nr: '810', name: 'Die Antwort verschweigt, wie der Schalter steht',
    file: 'server.js',
    search: "  potentialMode: potentialMode(),\n  imageStore: imageStore(),",
    replacement: "  imageStore: imageStore(),",
    expected: 'Der Potenzialmodus — 0.26.0'
  },
  {
    nr: '811', name: 'Der Bildschirm wird wieder geleert, bevor jemand gefragt hat',
    file: 'public/app.js',
    search: "  if (!app.firstElementChild)\n    app.innerHTML = `<div class=\"shell\"><p class=\"hint\" style=\"padding-top:44px\">${tH('list.loading')}</p></div>`;",
    replacement: "  app.innerHTML = `<div class=\"shell\"><p class=\"hint\" style=\"padding-top:44px\">${tH('list.loading')}</p></div>`;",
    expected: 'Die Hervorhebung in der Uebersicht'
  },
  {
    nr: '812', name: 'Der Lauf haengt wieder nur an main',
    file: '.github/workflows/pruefstand.yml',
    search: "on:\n  push:\n  workflow_dispatch:",
    replacement: "on:\n  push:\n    branches:\n      - main\n  workflow_dispatch:",
    expected: 'Der Beipack — 0.25.0'
  },

  /* ---- Waehlbare Bildablage ---- */
  {
    nr: '813', name: 'Ein vierter Wert kommt durch',
    file: 'server.js',
    search: "    if (!isImageStore(req.body.imageStore))",
    replacement: "    if (false)",
    expected: 'Die Bildablage: die Rechte'
  },
  {
    nr: '814', name: 'Die Wahl der Bildablage wird gewoehnliche Adminsache',
    file: 'server.js',
    search: "const OWNER_KEYS = ['imageStore',\n",
    replacement: "const OWNER_KEYS = [\n",
    expected: 'Die Bildablage: die Rechte'
  },
  {
    nr: '815', name: 'Die Vorgabe einer frischen Installation wird verstellt',
    file: 'images.js',
    search: "const IMAGE_STORE_DEFAULT = 'webp-lossless';",
    replacement: "const IMAGE_STORE_DEFAULT = 'png';",
    expected: 'Die Bildablage: die Rechte'
  },
  {
    nr: '816', name: 'Die Wahl wird wieder fest verdrahtet',
    file: 'images.js',
    search: "  const recipe = IMAGE_STORES[isImageStore(store) ? store : IMAGE_STORE_DEFAULT];",
    replacement: "  const recipe = IMAGE_STORES[IMAGE_STORE_DEFAULT];",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '817', name: 'Die Groessenpruefung gilt nicht mehr fuer jedes Verfahren',
    file: 'images.js',
    search: "    if (webp.length < buf.length)",
    replacement: "    if (webp.length < buf.length || store === 'webp-lossy')",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '818', name: 'Die Ableitungen werden wieder JPEG',
    file: 'images.js',
    search: "        .webp(variantWebp(v.q)).toBuffer();",
    replacement: "        .jpeg({ quality: v.q, mozjpeg: true }).toBuffer();",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '820', name: 'Der Lauf haengt am Umschalten',
    file: 'public/app.js',
    search: "      } catch (e) { IMAGE_STORE = before; toast(e.message, true); }",
    replacement: "      } catch (e) { IMAGE_STORE = before; toast(e.message, true); }\n      try { await api('POST', '/api/images/convert', {}); } catch {}",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '821', name: 'Die Karte nennt die Auflage nicht mehr',
    file: 'public/languages/de.json',
    search: "Verlustbehaftet: bei Fotos rund zwei Drittel kleiner",
    replacement: "Verlustbehaftet: überall rund zwei Drittel kleiner",
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '824', name: 'Der Satz an der Einfuegestelle wird nicht gezeichnet',
    file: 'public/app.js',
    search: "          ${tH('entry.photoOrderHint', { mb: UPLOAD_LIMITS.video })} ${tH('entry.clipboardLarger')}</p>",
    replacement: "          ${tH('entry.photoOrderHint', { mb: UPLOAD_LIMITS.video })}</p>",
    expected: 'Der Eintrag am Bildschirm'
  },
  {
    /* renderCompare() eigens: eine Pruefung nur an renderDetail() bliebe gruen,
       wenn renderCompare() seine alte Zeile behaelt. */
    /* Ersetzt auch wireSubhead(); ohne Kopfzeile bricht der Lauf sonst ab und belegt nichts. */
    nr: '825', name: 'Der Vergleich behaelt seine alte Rueckzeile',
    file: 'public/app.js',
    search: "    ${subhead()}\n    <h1 class=\"page-title\">${tH('list.compare')}</h1>\n    <p class=\"hint page-hint${multipleUsers() ? ' above-pills' : ''}\" id=\"cmp-hint\"></p>\n    ${multipleUsers() ? `<div class=\"pills\" id=\"cmp-view\" style=\"margin:0 0 20px\"></div>` : ''}\n    <div class=\"cmp-grid\" id=\"cg\" style=\"grid-template-columns:repeat(auto-fit,minmax(264px,1fr))\"></div>\n  </div>`;\n  wireSubhead();",
    replacement: "    <a href=\"#/\" class=\"back\">${tH('list.backToList')}</a>\n    <h1 class=\"page-title\">${tH('list.compare')}</h1>\n    <p class=\"hint page-hint${multipleUsers() ? ' above-pills' : ''}\" id=\"cmp-hint\"></p>\n    ${multipleUsers() ? `<div class=\"pills\" id=\"cmp-view\" style=\"margin:0 0 20px\"></div>` : ''}\n    <div class=\"cmp-grid\" id=\"cg\" style=\"grid-template-columns:repeat(auto-fit,minmax(264px,1fr))\"></div>\n  </div>`;",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '826', name: 'Der Fehlerweg des Eintrags bleibt ohne Kopfzeile',
    file: 'public/app.js',
    search: "      app.innerHTML = `<div class=\"shell\">${subhead()}<p class=\"hint\">${tH('server.entryUnknown')}</p></div>`;",
    replacement: "      app.innerHTML = `<div class=\"shell\"><a href=\"#/\" class=\"back\">${tH('list.backToList')}</a><p class=\"hint\">${tH('server.entryUnknown')}</p></div>`;",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '827', name: 'Die Glocke wandert in die Kopfzeile der Unteransicht',
    file: 'public/app.js',
    search: "    <div class=\"mast-rest\" id=\"mast-rest\">\n      <button class=\"icon-btn\" id=\"open\"",
    replacement: "    <div class=\"mast-rest\" id=\"mast-rest\">\n      <button class=\"icon-btn bell\" id=\"bell\">${ICON_BELL}</button>\n      <button class=\"icon-btn\" id=\"open\"",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '828', name: 'Die Kopfzeile der Unteransicht wird eine eigene',
    file: 'public/app.js',
    search: "  return `<div class=\"masthead subhead\">",
    replacement: "  return `<div class=\"subhead\">",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '829', name: 'Die Suche springt nicht mehr zur Uebersicht',
    file: 'public/app.js',
    search: "  const over = () => { SEARCH_HANDOFF = true; location.hash = '#/'; };",
    replacement: "  const over = () => { state.search = sq.value; };",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '830', name: 'Der Schreibstrich landet nach dem Sprung nirgends',
    file: 'public/app.js',
    search: "    atElement('q', el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });",
    replacement: "    void 0;",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },

  /* ---- Blaettern ---- */
  {
    nr: '831', name: 'Die Pfeile blaettern im ganzen Bestand statt in der Trefferliste',
    file: 'public/app.js',
    search: "  const list = state.items || [];",
    replacement: "  const list = state.all || [];",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '832', name: 'Ohne Reihenfolge wird eine erfunden',
    file: 'public/app.js',
    search: "  if (at < 0) return { prev: null, next: null };",
    replacement: "  if (at < 0) return { prev: (list[0] || {}).id || null, next: (list[1] || {}).id || null };",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '833', name: 'Der gedaempfte Blaetterknopf verschwindet statt dazubleiben',
    file: 'public/style.css',
    search: ".entry-nav .step:disabled { opacity: .38; cursor: default; }",
    replacement: ".entry-nav .step:disabled { display: none; }",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '834', name: 'Die Reihenfolge wird im Browser abgelegt',
    file: 'public/app.js',
    search: "  const list = state.items || [];",
    replacement: "  const list = state.items || []; try { sessionStorage.setItem('reihe', JSON.stringify(list.map(x => x.id))); } catch {}",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '835', name: 'Bild auf und Bild ab blaettern doch den Eintrag',
    file: 'public/app.js',
    search: "  document.querySelectorAll('.entry-nav .step').forEach(b => {",
    replacement: "  document.addEventListener('keydown', e => { if (e.key === 'PageDown' || e.key === 'PageUp') e.preventDefault(); });\n  document.querySelectorAll('.entry-nav .step').forEach(b => {",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '836', name: 'Der Begriff faellt beim Blaettern aus der Adresse',
    file: 'public/app.js',
    search: "      if (to) location.hash = entryAddress(+to, term);",
    replacement: "      if (to) location.hash = entryAddress(+to, '');",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },

  /* ---- Behaelterabfragen ---- */
  {
    nr: '837', name: 'Die Protokollzeile fragt wieder das Fenster',
    file: 'public/style.css',
    search: "@container (max-width: 420px) {",
    replacement: "@media (max-width: 420px) {",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '838', name: 'Die Karte des Systembereichs ist kein Behaelter mehr',
    file: 'public/style.css',
    search: ".sys-card { container-type: inline-size; }",
    replacement: ".sys-card { }",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '839', name: 'Der Befehl rollt wieder seitlich statt umzubrechen',
    file: 'public/style.css',
    search: "  .server-row code { flex: 1 1 100%; overflow-x: visible;\n    white-space: pre-wrap; overflow-wrap: anywhere; }",
    replacement: "  .server-row code { flex: 1 1 auto; }",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },

  /* ---- Halbsatz am Ablegefeld ---- */
  {
    /* Nur englisch: eine Pruefung, die nur Deutsch ansieht, bliebe gruen. */
    nr: '840', name: 'Strg+V steht wieder am Ablegefeld (englisch)',
    file: 'public/languages/en.json',
    search: '"entry.addMediaHint": "Add photos and videos — several at a time",',
    replacement: '"entry.addMediaHint": "Add photos and videos — several at a time, or paste with Ctrl+V",',
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },

  /* ---- Meldung ---- */
  {
    nr: '841', name: 'Die Meldung deckt die Vergleichsleiste wieder zu',
    file: 'public/style.css',
    search: "body:has(.cmp-bar) .toast { bottom: calc(90px + env(safe-area-inset-bottom)); }",
    replacement: "",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '842', name: 'Der Hub der Meldung ist kleiner als die Leiste',
    file: 'public/style.css',
    search: "body:has(.cmp-bar) .toast { bottom: calc(90px + env(safe-area-inset-bottom)); }",
    replacement: "body:has(.cmp-bar) .toast { bottom: calc(40px + env(safe-area-inset-bottom)); }",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },

  /* ---- Startbildzeichen ---- */
  {
    nr: '843', name: 'Das Manifest traegt einen festen Namen',
    file: 'server.js',
    search: "  const name = getSetting('title_public', 'Bewertungskatalog');",
    replacement: "  const name = 'Kriterion';",
    expected: 'Das Startbildzeichen — 0.28.0'
  },
  {
    nr: '844', name: 'Das Manifest haengt hinter der Anmeldung',
    file: 'server.js',
    search: "app.get('/api/manifest.json', (req, res) => {",
    replacement: "app.get('/api/manifest.json', adminOnly, (req, res) => {",
    expected: 'Das Startbildzeichen — 0.28.0'
  },
  {
    /* Ein blosser Aufruf genuegt; ein laufender Zwischenspeicher ist nicht noetig. */
    nr: '845', name: 'Ein Arbeiter im Hintergrund wird registriert',
    file: 'public/theme.js',
    search: "  } catch (e) {\n    document.documentElement.dataset.theme = 'dark';\n  }",
    replacement: "  } catch (e) {\n    document.documentElement.dataset.theme = 'dark';\n  }\n  try { navigator.serviceWorker.register('/sw.js'); } catch (e) {}",
    expected: 'Das Startbildzeichen — 0.28.0'
  },
  {
    nr: '846', name: 'Die Seite verweist nicht mehr auf das Manifest',
    file: 'public/index.html',
    search: '<link rel="manifest" href="/api/manifest.json">',
    replacement: "",
    expected: 'Das Startbildzeichen — 0.28.0'
  },

  /* ---- Dichte am Finger ---- */
  {
    /* Das Zeigermass erfuellt „kleiner als vorher", aber nicht „groesser als am Zeiger". */
    nr: '847', name: 'Die Pille faellt am Finger auf das Zeigermass zurueck',
    file: 'public/style.css',
    search: "  .pill { padding: 7px 13px; }",
    replacement: "  .pill { padding: 5px 12px; }",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '848', name: 'Der Und/Oder-Umschalter wird so hoch wie die Pille',
    file: 'public/style.css',
    search: "  .pill-mode { padding: 5px 11px; }",
    replacement: "  .pill-mode { padding: 7px 12px; }",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '849', name: 'Der Symbolknopf schrumpft mit',
    file: 'public/style.css',
    search: "  .icon-btn { width: 44px; height: 44px; }",
    replacement: "  .icon-btn { width: 36px; height: 36px; }",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '850', name: 'Die Auswahlfelder stehen wieder in der Zoomregel',
    file: 'public/style.css',
    search: "  .input, .input-sm, .ta, .title-in,",
    replacement: "  .input, .input-sm, .ta, .select, .select-sm, .title-in,",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '851', name: 'Ein Eingabefeld faellt aus der Zoomregel',
    file: 'public/style.css',
    search: "  .mrow input.medit, .mrow .mweight-field,",
    replacement: "  .mrow .mweight-field,",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '852', name: 'Das Datumsfeld faellt mit aus der Zoomregel',
    file: 'public/style.css',
    search: "  .test-add input[type=date] { font-size: max(16px, 1rem); }",
    replacement: "  .title-in { font-size: max(16px, 1rem); }",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  {
    nr: '853', name: 'Die Untergrenze steht als blanke Zahl',
    file: 'public/style.css',
    search: "  .test-add input[type=date] { font-size: max(16px, 1rem); }",
    replacement: "  .test-add input[type=date] { font-size: 16px; }",
    expected: 'Handy und Tablett: die Staffel der Umbruchpunkte'
  },
  /* ---- Sortierung, Stern, Abschnittsliste, Telefon ---- */
  {
    nr: '854', name: 'Ein achter Eintrag steht in der Sortierliste',
    file: 'public/app.js',
    search: "  ].filter(b => !b.only || b.only());",
    replacement: "    ,{ key: 'favorite', group: GENERAL, word: () => t('list.sortTitle'),\n" +
            "      down: 'list.dirHighLow', up: 'list.dirLowHigh' }\n" +
            "  ].filter(b => !b.only || b.only());",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '855', name: 'Die Richtung steht wieder im Wort der Option',
    file: 'public/app.js',
    search: "word: () => t('list.sortChanged'),",
    replacement: "word: () => t('list.sortChanged') + ' (neu → alt)',",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '856', name: 'Der Richtungsumschalter haengt nicht in der Zeile',
    file: 'public/app.js',
    search: "  sortPair.appendChild(dirBtn);",
    replacement: "",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    /* Umschalter und Wort bleiben; nur die gefahrene Liste zeigt, dass sie sich nicht dreht. */
    nr: '857', name: 'Die Richtung kommt in der Sortierung nicht an',
    file: 'public/app.js',
    search: "  const applySort = () => { f.sort = picked.base.key + (picked.asc ? '_asc' : '_desc'); redraw(); };",
    replacement: "  const applySort = () => { f.sort = picked.base.key + '_desc'; redraw(); };",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '858', name: 'Der Wechsel der Grundlage nimmt die alte Richtung mit',
    file: 'public/app.js',
    search: "    picked = { base: b, asc: b.start === 'up' };",
    replacement: "    picked = { base: b, asc: picked.asc };",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '859', name: 'Der Stern faellt am Finger auf das Zeigermass',
    file: 'public/style.css',
    search: "  .star { font-size: 1.25rem; }",
    replacement: "  .star { font-size: 1.2rem; }",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '860', name: 'Der Stern behaelt sein altes Mass',
    file: 'public/style.css',
    search: "  .star { font-size: 1.25rem; }",
    replacement: "  .star { font-size: 1.45rem; }",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '861', name: 'Der Abschnittsschalter sagt nicht, welcher Abschnitt offen ist',
    file: 'public/app.js',
    search: "aria-controls=\"sys-tabs\">${tH('card.sections')}<span class=\"fcount\">${esc(open.name())}</span></button>",
    replacement: "aria-controls=\"sys-tabs\">${tH('card.sections')}</button>",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '862', name: 'Die Abschnittsliste klappt auf jedem Schirm ein',
    file: 'public/app.js',
    search: "    if (isNarrow()) tabs.classList.add('closed');",
    replacement: "    tabs.classList.add('closed');",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '863', name: 'Die Titelzeile dehnt sich am Telefon wieder nicht',
    file: 'public/style.css',
    search: "  .detail { display: flex; flex-direction: column; gap: 16px; align-items: stretch; }",
    replacement: "  .detail { display: flex; flex-direction: column; gap: 16px; align-items: start; }",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '864', name: 'Die Dehnung wird global statt am Telefon gesetzt',
    file: 'public/style.css',
    search: ".detail { display: grid; grid-template-columns: minmax(300px, 46%) 1fr; gap: 28px; align-items: start; }",
    replacement: ".detail { display: grid; grid-template-columns: minmax(300px, 46%) 1fr; gap: 28px; align-items: stretch; }",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '865', name: 'Die tote Regel `.back` steht wieder im Telefonblock',
    file: 'public/style.css',
    search: "  .detail { display: flex; flex-direction: column; gap: 16px; align-items: stretch; }",
    replacement: "  .back { margin-bottom: 14px; }\n" +
            "  .detail { display: flex; flex-direction: column; gap: 16px; align-items: stretch; }",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '866', name: 'Die Filterzeile wird am Telefon wieder eine Spalte',
    file: 'public/style.css',
    search: "  .frow { display: grid; grid-template-columns: auto minmax(0, 1fr) auto;",
    replacement: "  .frow { display: flex; flex-direction: column;",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '867', name: 'Die Filterreihen brechen wieder um, statt quer zu rollen',
    file: 'public/style.css',
    search: "  .frow > .pills:not(.cloud) { flex-wrap: nowrap; overflow-x: auto;",
    replacement: "  .frow > .pills:not(.cloud) { flex-wrap: wrap;",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },
  {
    nr: '868', name: 'Die Pillen schrumpfen mit',
    file: 'public/style.css',
    search: "  .pill { padding: 7px 13px; }",
    replacement: "  .pill { padding: 5px 11px; }",
    expected: 'Die Sortierung trennt Grundlage und Richtung — 0.28.1'
  },

  /* ---- Sicherungsprobe ---- */
  {
    nr: '869', name: 'Die Probe oeffnet die laufende Datenbank statt der Kopie',
    file: 'server.js',
    search: "  const full = path.join(target.filePath, file.name);",
    replacement: "  const full = DB_FILE;",
    expected: 'Die Sicherungsprobe — 0.29.0'
  },
  {
    nr: '870', name: 'Die Probe oeffnet die Sicherung schreibend',
    file: 'server.js',
    search: "    probe = new Database(full, { readonly: true });",
    replacement: "    probe = new Database(full);",
    expected: 'Die Sicherungsprobe — 0.29.0'
  },
  {
    nr: '871', name: 'Der fremde Schluessel wird fuer lesbar erklaert',
    file: 'server.js',
    search: "    return res.json({ ok: false, reason: 'key', at: file.time, bytes: file.bytes, nr });",
    replacement: "    return res.json({ ok: true, nr, at: file.time, bytes: file.bytes, itemCount: 0, photoCount: 0, userCount: 0, contentUntil: null });",
    expected: 'Die Sicherungsprobe — 0.29.0'
  },
  {
    nr: '872', name: 'Eine Nummer, die es nicht gibt, wird zur leeren Sicherung',
    file: 'server.js',
    search: "  if (!file) return res.status(404).json({ error: t(localeOf(req), 'server.backupGone') });",
    replacement: "  if (!file) return res.json({ ok: true, nr, at: 0, bytes: 0, itemCount: 0, photoCount: 0, userCount: 0, contentUntil: null });",
    expected: 'Die Sicherungsprobe — 0.29.0'
  },
  {
    nr: '873', name: 'Die Probe zaehlt in der laufenden Datenbank',
    file: 'server.js',
    search: "      itemCount: one('SELECT COUNT(*) AS n FROM items').n,",
    replacement: "      itemCount: db.prepare('SELECT COUNT(*) AS n FROM items').get().n,",
    expected: 'Die Sicherungsprobe — 0.29.0'
  },
  {
    nr: '874', name: 'Die Probe steht schon dem Admin offen',
    file: 'server.js',
    search: "app.post('/api/backup/check', ownerOnly, (req, res) => {",
    replacement: "app.post('/api/backup/check', adminOnly, (req, res) => {",
    expected: 'Die Sicherungsprobe — 0.29.0'
  },

  /* ---- Fingerprint nennt die Datei ---- */
  {
    nr: '875', name: 'Die Einzelwerte kommen aus einem zweiten Lesevorgang',
    file: 'server.js',
    search: "    files.push({ name: rel,\n      hash: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8) });",
    replacement: "    files.push({ name: rel, hash: crypto.createHash('sha256')\n      .update(fs.readFileSync(path.join(__dirname, rel))).digest('hex').slice(0, 8) });",
    expected: 'Der Fingerprint nennt die Datei — 0.29.0'
  },
  {
    nr: '876', name: 'Die Dateiliste steht dauerhaft aufgeklappt da',
    file: 'public/app.js',
    search: '        <div class="fp-list" id="fp-list" hidden>',
    replacement: '        <div class="fp-list" id="fp-list">',
    expected: 'Der Fingerprint nennt die Datei — 0.29.0'
  },

  /* ---- Faelligkeitsdatum ---- */
  {
    nr: '877', name: 'Ein Tag, den es nicht gibt, wird gespeichert',
    file: 'server.js',
    search: "  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)\n    return { error: 'server.dueInvalid' };",
    replacement: "  if (false) return { error: 'server.dueInvalid' };",
    expected: 'Das Faelligkeitsdatum — 0.29.0'
  },
  {
    nr: '878', name: 'Die Aufgaben ohne Datum stehen wieder vorn',
    file: 'server.js',
    search: "   ORDER BY CASE WHEN c.due_date IS NULL THEN 1 ELSE 0 END,\n            c.due_date,",
    replacement: "   ORDER BY c.due_date,",
    expected: 'Das Faelligkeitsdatum — 0.29.0'
  },
  {
    nr: '879', name: 'Die Zeilen zweier Eintraege mischen sich in „Offen"',
    file: 'server.js',
    search: "            i.updated_at DESC, c.item_id, c.id`);",
    replacement: "            i.updated_at DESC, c.id`);",
    expected: 'Das Faelligkeitsdatum — 0.29.0'
  },
  {
    nr: '880', name: 'Das Faelligkeitsdatum geht nicht mit hinaus',
    file: 'server.js',
    search: "        ...(c.due_date ? { dueDate: c.due_date } : {}),\n",
    replacement: "",
    expected: 'Das Faelligkeitsdatum — 0.29.0'
  },
  {
    nr: '881', name: 'Der Import schreibt das Datum ungeprueft',
    file: 'server.js',
    search: "                 cDue.error ? null : cDue.value);",
    replacement: "                 c.dueDate || null);",
    expected: 'Das Faelligkeitsdatum — 0.29.0'
  },
  {
    nr: '884', name: 'Der Index laesst nur EINEN Zugang ohne Adresse zu',
    file: 'db.js',
    search: "             ON users(email COLLATE NOCASE) WHERE email IS NOT NULL`);",
    replacement: "             ON users(email COLLATE NOCASE)`);",
    expected: 'Die Adresse ist eindeutig — 0.29.0'
  },
  {
    nr: '885', name: 'Der Index unterscheidet Gross- und Kleinschreibung',
    file: 'db.js',
    search: "  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email\n             ON users(email COLLATE NOCASE) WHERE email IS NOT NULL`);",
    replacement: "  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email\n             ON users(email) WHERE email IS NOT NULL`);",
    expected: 'Die Adresse ist eindeutig — 0.29.0'
  },
  {
    nr: '886', name: 'Der fehlgeschlagene Index wird verschwiegen',
    file: 'db.js',
    search: "  doubleEmails = db.prepare(qDoubleEmails).all();",
    replacement: "  doubleEmails = [];",
    expected: 'Die Adresse ist eindeutig — 0.29.0'
  },
  {
    nr: '887', name: 'Die Karte „Benutzer" meldet keine doppelten Adressen',
    file: 'db.js',
    search: "  return present ? [] : db.prepare(qDoubleEmails).all();",
    replacement: "  return [];",
    expected: 'Die Adresse ist eindeutig — 0.29.0'
  },

  /* ---- Zwei Befunde am Bildschirm ---- */
  {
    nr: '888', name: 'Auch der Ruecksetzer der Sortierzeile geht in Spalte drei',
    file: 'public/style.css',
    search: "  .frow > .frow-right-end { grid-column: 3; }",
    replacement: "  .frow > .frow-right { grid-column: 3; }",
    expected: 'Die Filterzeile und der Kategoriekasten — 0.29.0'
  },
  {
    nr: '889', name: 'Der Und/Oder-Umschalter steht wieder neben der Beschriftung',
    file: 'public/style.css',
    search: "  .frow-tags > .tagmode { grid-column: 1; grid-row: 2; margin-right: 0;",
    replacement: "  .frow-tags > .tagmode { grid-column: 2; grid-row: 1; margin-right: 0;",
    expected: 'Die Filterzeile und der Kategoriekasten — 0.29.0'
  },
  {
    nr: '890', name: 'Der Kategoriekasten bekommt eine ausgerechnete Breite',
    file: 'public/style.css',
    search: "  [data-block=\"kategorie\"] .row-in > #cat,\n  [data-block=\"kategorie\"] .row-in > .input { flex: 1 1 0; min-width: 0; }",
    replacement: "  [data-block=\"kategorie\"] .row-in > #cat { width: 119px; min-width: 119px; }",
    expected: 'Die Filterzeile und der Kategoriekasten — 0.29.0'
  },
  {
    nr: '891', name: 'Der Platzhalter der Kategorie wird wieder lang',
    file: 'public/languages/de.json',
    search: '  "entry.newCategoryHint": "Name",',
    replacement: '  "entry.newCategoryHint": "Neue Kategorie",',
    expected: 'Die Filterzeile und der Kategoriekasten — 0.29.0'
  },

  /* ---- „Titel" in beiden Richtungen ---- */
  {
    nr: '892', name: '„Titel" kennt wieder nur eine Richtung',
    file: 'public/app.js',
    search: "      down: 'list.dirZA',       up: 'list.dirAZ',     start: 'up' },",
    replacement: "      down: null,               up: 'list.dirAZ',     start: 'up' },",
    expected: '„Titel" kehrt um — 0.29.0'
  },
  {
    nr: '893', name: 'Der Vergleicher kennt title_desc nicht',
    file: 'public/app.js',
    search: "      case 'title_desc':  return b.title.localeCompare(a.title, LOCALE);",
    replacement: "",
    expected: '„Titel" kehrt um — 0.29.0'
  },
  {
    nr: '894', name: '„Diese Sortierung hat nur eine Richtung" steht wieder da',
    file: 'public/languages/de.json',
    search: '  "list.sortFlip": "Richtung umkehren",',
    replacement: '  "list.sortFlip": "Richtung umkehren",\n  "list.sortOneWay": "Diese Sortierung hat nur eine Richtung",',
    expected: '„Titel" kehrt um — 0.29.0'
  },

  {
    nr: '895', name: "Der Portblick der Gegenprobe sieht nicht mehr nach",
    file: "counterproof.js",
    search: "  return [...listeningPorts()]\n    .filter(p => p >= span.from && p <= span.to && !taken.has(p))",
    replacement: "  return [].concat()\n    .filter(p => p >= span.from && p <= span.to && !taken.has(p))",
    expected: "Der Waechter erkennt den Prueflauf — 0.30.0"
  },
  {
    nr: '896', name: "Das Wartefenster steht wieder auf zwoelf Sekunden",
    file: 'test/frame.js',
    search: "const READY_TRIES = 300;",
    replacement: "const READY_TRIES = 120;",
    expected: "Das Wartefenster und seine Meldung — 0.30.0"
  },
  {
    nr: '897', name: "Die Meldung des Zweitservers nennt ihn nicht mehr",
    file: 'test/frame.js',
    search: "  `Zweitserver nicht erreichbar: Portbasis ${portBase}, Port ${port}, ` +\n  `Verzeichnis ${dataDirectory} -- ${READY_TRIES * READY_STEP / 1000} s gewartet\\n${log}`;",
    replacement: "  `Zweitserver nicht erreichbar -- ${READY_TRIES * READY_STEP / 1000} s gewartet\\n${log}`;",
    expected: "Das Wartefenster und seine Meldung — 0.30.0"
  },
  {
    nr: '898', name: "Der Aufraeumer beim Start beendet nichts mehr",
    file: 'test/frame.js',
    search: "  for (const z of found) { try { process.kill(z.pid, 'SIGKILL'); } catch {} }",
    replacement: "  for (const z of found) { /* nicht beenden */ }",
    expected: "Der Pruefstand raeumt beim Start auf — 0.30.0"
  },
  {
    nr: '899', name: "Die Schlusstafel bleibt leer",
    file: 'test/frame.js',
    search: "  const worst = [...rows].sort((a, b) => b.ms - a.ms).slice(0, top);",
    replacement: "  const worst = [];",
    expected: "Die Schlusstafel sagt, wo die Zeit hingeht — 0.30.0"
  },
  {
    nr: '900', name: "Die Kurve der Anmeldebremse ist verbogen",
    file: "auth.js",
    search: "  return over > 0 ? Math.min(over * 700, 4000) : 0;",
    replacement: "  return over > 0 ? Math.min(over * 500, 4000) : 0;",
    expected: "Die Anmeldebremse — an der reinen Funktion — 0.30.0"
  },
  {
    nr: '901', name: "Die Route wartet gar nicht mehr",
    file: "auth.js",
    search: "  return { blocked: false, delayMs: keys.brakeWait(delayMs) };",
    replacement: "  return { blocked: false, delayMs: 0 };",
    expected: "Und die Route wartet wirklich — 0.30.0"
  },
  {
    nr: '902', name: "Die Auslieferung traegt eine gesenkte Kostenstufe",
    file: "auth.js",
    search: "const SCRYPT_SHIPPED = 16384;",
    replacement: "const SCRYPT_SHIPPED = 1024;",
    expected: "Der Pruefschalter und seine Grenzen — 0.30.0"
  },
  {
    nr: '903', name: "Die Kostenstufe laesst sich wieder ueber eine gewoehnliche Variable senken",
    file: "keys.js",
    search: "  const wish = set && set.scrypt;",
    replacement: "  const wish = Number(process.env.SCRYPT_N) || (set && set.scrypt);",
    expected: "Der Pruefschalter und seine Grenzen — 0.30.0"
  },
  {
    nr: '904', name: "Die ausgelieferte Mailfrist ist gesenkt",
    file: "mail.js",
    search: "const SEND_SHIPPED = 20 * 1000;",
    replacement: "const SEND_SHIPPED = 5 * 1000;",
    expected: "Der Pruefschalter und seine Grenzen — 0.30.0"
  },
  {
    nr: '905', name: "Der Pruefschalter stellt die Fristen gar nicht mehr kurz",
    file: "keys.js",
    search: "  return Math.max(TESTBENCH_FLOOR.mail, Math.round(shipped / part));",
    replacement: "  return shipped;",
    expected: "Der Pruefschalter und seine Grenzen — 0.30.0"
  },
  {
    nr: '906', name: "„gewichtet\" steht wieder fest im Quelltext",
    file: "public/app.js",
    search: "          (weightedCalc ? ' ' + t('entry.weighted') : '');",
    replacement: "          (weightedCalc ? ' gewichtet' : '');",
    expected: "Kein deutscher Bildschirmsatz sitzt fest — die neue Wache — 0.30.0"
  },
  {
    nr: '907', name: "Die neue Wache schaut an jeder Kennung vorbei",
    file: 'test/release_030.js',
    search: "    const isName = (t) => /^[a-z0-9][a-z0-9._#/-]*$/.test(t.trim()) || /^#\\//.test(t.trim());",
    replacement: "    const isName = (t) => true;",
    expected: "Kein deutscher Bildschirmsatz sitzt fest — die neue Wache — 0.30.0"
  },
  {
    nr: '908', name: "Eine zweite Einteilung steht neben der ersten",
    file: "public/app.js",
    search: "  const SECTIONS = [['overdue', 'list.dueOverdue'], ['today', 'list.dueToday'],",
    replacement: "  const dueOf = (z) => !z.dueDate ? 'none' : 'later';\n  const SECTIONS = [['overdue', 'list.dueOverdue'], ['today', 'list.dueToday'],",
    expected: "Das Faelligkeitsdatum bekommt Farbe — 0.30.0"
  },
  {
    nr: '909', name: "Zwei Zustaende des Faelligkeitsdatums sind gleich gefaerbt",
    file: "public/style.css",
    search: ".cmt-due.due-done { color: var(--green); text-decoration: line-through; }",
    replacement: ".cmt-due.due-done { color: var(--blue); text-decoration: line-through; }",
    expected: "Das Faelligkeitsdatum bekommt Farbe — 0.30.0"
  },
  {
    nr: '910', name: "Das Datum verschwindet beim Abhaken wieder",
    file: "public/app.js",
    search: "              ? (task || done ? `<button class=\"link-btn cmt-due${",
    replacement: "              ? (task ? `<button class=\"link-btn cmt-due${",
    expected: "Das Faelligkeitsdatum bekommt Farbe — 0.30.0"
  },
  {
    nr: '911', name: "Die Vokabelkarte behaelt ihre Luft",
    file: "public/style.css",
    search: "  .vocabulary-grid .field { margin-bottom: 4px; }",
    replacement: "  .vocabulary-grid .field { margin-bottom: 10px; }",
    expected: "Der Bewertungskasten und die Vokabelkarte — 0.30.0"
  },
  {
    nr: '912', name: "Die Luft geht auch dort weg, wo nur ein Zugang ist",
    file: "public/style.css",
    search: "  .rlist:not(.no-average) .rrow .rname { padding-top: 4px; line-height: 1.35; }",
    replacement: "  .rrow .rname { padding-top: 4px; line-height: 1.35; }",
    expected: "Der Bewertungskasten und die Vokabelkarte — 0.30.0"
  },
  {
    nr: '913', name: "Die Zahl am gefallenen Umschalter steht wieder in der Sprachdatei",
    file: "public/languages/de.json",
    search: "  \"list.tags\": ",
    replacement: "  \"list.tagsCount\": \"Tags ({length})\",\n  \"list.tags\": ",
    expected: "Die Tagzeile steht offen — 0.30.0"
  },
  {
    nr: '914', name: "Der Knopf heisst wieder „Wer hat bewertet\"",
    file: "public/languages/de.json",
    search: "  \"entry.whoRated\": \"Wer?\",",
    replacement: "  \"entry.whoRated\": \"Wer hat bewertet\",",
    expected: "Der Bewertungskasten und die Vokabelkarte — 0.30.0"
  },
  {
    nr: '915', name: "Die Sternzeile behaelt ihre Luft unter den Sternen",
    file: "public/style.css",
    search: "  .rlist:not(.no-average) .rrow .rreset-cell { padding-bottom: 5px; }",
    replacement: "  .rlist:not(.no-average) .rrow .rreset-cell { padding-bottom: 9px; }",
    expected: "Der Bewertungskasten und die Vokabelkarte — 0.30.0"
  },
  {
    nr: "916", name: "Beide Rasterzeilen der Tagzeile teilen sich wieder die Hoehe",
    file: "public/style.css",
    search: "  .frow-tags.tags-deep { grid-template-rows: auto auto 1fr; }",
    replacement: "  .frow-tags.tags-deep { grid-template-rows: auto auto auto; }",
    expected: "Die Tagzeile rueckt nach oben \u2014 0.30.1"
  },
  {
    nr: "917", name: "Der Umschalter sitzt wieder mittig in seiner Zeile",
    file: "public/style.css",
    search: "  .frow-tags > .tagmode { grid-column: 1; grid-row: 2; margin-right: 0;\n    align-self: start; }",
    replacement: "  .frow-tags > .tagmode { grid-column: 1; grid-row: 2; margin-right: 0; }",
    expected: "Die Tagzeile rueckt nach oben \u2014 0.30.1"
  },
  {
    nr: "918", name: "Die Tags sind wieder so gross wie vorher",
    file: "public/style.css",
    search: "  .pill-tag { font-size: .72rem; padding: 4px 10px; }",
    replacement: "  .pill-tag { font-size: .77rem; padding: 7px 13px; }",
    expected: "Die Tagzeile rueckt nach oben \u2014 0.30.1"
  },
  {
    nr: "919", name: "Die Festschrift der Tags faellt",
    file: "public/style.css",
    search: "  .pill-tag { font-size: .72rem; padding: 4px 10px; }",
    replacement: "  .pill-tag { font-size: .72rem; padding: 4px 10px; font-family: inherit; }",
    expected: "Die Tagzeile rueckt nach oben \u2014 0.30.1"
  },
  {
    nr: "920", name: "Die Kategorienpille schrumpft mit",
    file: "public/style.css",
    search: "  .pill-tag { font-size: .72rem; padding: 4px 10px; }",
    replacement: "  .pill-tag { font-size: .72rem; padding: 4px 10px; }\n  .pill { font-size: .72rem; }",
    expected: "Die Tagzeile rueckt nach oben \u2014 0.30.1"
  },
  {
    nr: "921", name: "Der Wochentag bleibt auch am Telefon stehen",
    file: "public/style.css",
    search: "  .trow .tweek { display: none; }",
    replacement: "  .trow .tweek { display: inline; }",
    expected: "Die Testtagzeile ordnet sich nach ihrem Inhalt \u2014 0.30.1"
  },
  {
    nr: "922", name: "Der Tagkasten greift sich wieder die ganze Breite",
    file: "public/style.css",
    search: "  .trow .ttags { flex: 1 1 auto; }",
    replacement: "  .trow .ttags { flex: 1 1 0; }",
    expected: "Die Testtagzeile ordnet sich nach ihrem Inhalt \u2014 0.30.1"
  },
  {
    nr: "923", name: "Mit Tags bricht die Zeile nicht mehr vor den Sternen um",
    file: "public/style.css",
    search: "  .trow-tags::after { content: ''; flex-basis: 100%; height: 0; order: 1; }",
    replacement: "  .trow-tags::after { content: ''; height: 0; order: 1; }",
    expected: "Die Testtagzeile ordnet sich nach ihrem Inhalt \u2014 0.30.1"
  },
  {
    nr: "924", name: "Die Zeile sagt nicht mehr, ob sie Tags traegt",
    file: "public/app.js",
    search: "      if ((d.tags || []).length) row.classList.add('trow-tags');",
    replacement: "      if (false) row.classList.add('trow-tags');",
    expected: "Die Testtagzeile ordnet sich nach ihrem Inhalt \u2014 0.30.1"
  },
  {
    nr: "925", name: "\u201emehr\" steht hinter den Sternen statt bei den Tags",
    file: "public/app.js",
    search: "        row.append(date, wd, tagBox, more, s, x);",
    replacement: "        row.append(date, wd, tagBox, s, x, more);",
    expected: "Die Testtagzeile ordnet sich nach ihrem Inhalt \u2014 0.30.1"
  },
  {
    nr: "926", name: "Die Tags eines Testtags werden nicht mehr auf eine Reihe begrenzt",
    file: "public/app.js",
    search: "      const trimmed = limitCloud(tagBox, opened ? 0 : 1);",
    replacement: "      const trimmed = limitCloud(tagBox, 0);",
    expected: "Die Testtagzeile ordnet sich nach ihrem Inhalt \u2014 0.30.1"
  },
  {
    nr: "927", name: "Der Zaehler verliert seinen Titel",
    file: "public/app.js",
    search: "  `<span class=\"mcount\" title=\"${esc(long)}\">${esc(short)}</span>`;",
    replacement: "  `<span class=\"mcount\">${esc(short)}</span>`;",
    expected: "In der Zeile die Zahl, im Titel das Wort \u2014 0.30.1"
  },
  {
    nr: "928", name: "Die Tagkarte schreibt ihre beiden Zahlen wieder aus",
    file: "public/app.js",
    search: "      shortCounter: e => `${e.usage_count} \u00b7 ${e.test_usage_count}`,",
    replacement: "      shortCounter: e => `${e.usage_count} ${vThing(e.usage_count)} \u00b7 ${e.test_usage_count} ${vTime(e.test_usage_count)}`,",
    expected: "In der Zeile die Zahl, im Titel das Wort \u2014 0.30.1"
  },
  {
    nr: "929", name: "Eine zu spaet erledigte Aufgabe verliert ihr Rot",
    file: "public/app.js",
    search: "  if (z.dueDate < todayKey()) return settled ? 'late' : 'overdue';",
    replacement: "  if (settled) return 'done';\n  if (z.dueDate < todayKey()) return 'overdue';",
    expected: "Das Faelligkeitsdatum bekommt Farbe \u2014 0.30.0"
  },
  {
    nr: "930", name: "Gerissen und gehalten tragen dieselbe Farbe",
    file: "public/style.css",
    search: ".cmt-due.due-late { color: var(--red); text-decoration: line-through; }",
    replacement: ".cmt-due.due-late { color: var(--green); text-decoration: line-through; }",
    expected: "Das Faelligkeitsdatum bekommt Farbe \u2014 0.30.0"
  },
  {
    nr: "931", name: "Das Faelligkeitsdatum verschwindet wieder hinter der Bedienung",
    file: "public/app.js",
    search: "      const dueShown = (task || done) && c.dueDate;",
    replacement: "      const dueShown = false;",
    expected: "Das Faelligkeitsdatum sieht jeder, der den Eintrag sieht \u2014 0.30.1"
  },
  {
    nr: "932", name: "Wer nicht aendern darf, bekommt wieder einen Knopf",
    file: "public/app.js",
    search: "              : `<span class=\"cmt-due on due-${esc(dueState)}\"",
    replacement: "              : `<button class=\"cmt-due on due-${esc(dueState)}\"",
    expected: "Das Faelligkeitsdatum sieht jeder, der den Eintrag sieht \u2014 0.30.1"
  },
  {
    nr: "933", name: "Der Stern am Telefon ist wieder so gross wie am Finger",
    file: "public/style.css",
    search: "  .star { font-size: 1.1rem; }",
    replacement: "  .star { font-size: 1.25rem; }",
    expected: "Die Sortierung trennt Grundlage und Richtung \u2014 0.28.1"
  },
  {
    nr: "934", name: "Der Abstand zwischen den Sternen bleibt, wie er war",
    file: "public/style.css",
    search: "  .stars { gap: 2px; }",
    replacement: "  .stars { gap: 3px; }",
    expected: "Die Sortierung trennt Grundlage und Richtung \u2014 0.28.1"
  },
  {
    nr: "935", name: "Die beiden Verweise stehen wieder am Zeilenende",
    file: "public/style.css",
    search: "  .frow-tags.tags-deep > .frow-right-end { grid-column: 1; grid-row: 2;\n    align-self: start; justify-self: start; gap: 4px; }",
    replacement: "  .frow-tags.tags-deep > .frow-right-end { grid-row: 1 / -1; align-self: start; }",
    expected: "Die Tagzeile traegt Zeichen statt Woerter \u2014 0.30.2"
  },
  {
    nr: "936", name: "Der Umschalter steht wieder in der zweiten Rasterzeile",
    file: "public/style.css",
    search: "  .frow-tags.tags-deep > .tagmode { grid-row: 3; }",
    replacement: "  .frow-tags.tags-deep > .tagmode { grid-row: 2; }",
    expected: "Die Tagzeile traegt Zeichen statt Woerter \u2014 0.30.2"
  },
  {
    nr: "937", name: "\u201emehr\" steht wieder als Wort statt als Zeichen",
    file: "public/app.js",
    search: "      m.title = cloudOpen.overview ? t('list.less') : t('list.more');",
    replacement: "      m.textContent = cloudOpen.overview ? t('list.less') : t('list.more');",
    expected: "Die Tagzeile traegt Zeichen statt Woerter \u2014 0.30.2"
  },
  {
    nr: "938", name: "Der Ruecksetzer nimmt wieder das Kreuz",
    file: "public/app.js",
    search: "      c.innerHTML = ICON_RESET;",
    replacement: "      c.innerHTML = ICON_X;",
    expected: "Die Tagzeile traegt Zeichen statt Woerter \u2014 0.30.2"
  },
  {
    nr: "939", name: "Die Zeichen sagen dem Vorleseprogramm nichts mehr",
    file: "public/app.js",
    search: "      m.setAttribute('aria-label', m.title);",
    replacement: "      m.title = m.title;",
    expected: "Die Tagzeile traegt Zeichen statt Woerter \u2014 0.30.2"
  },
  {
    nr: "940", name: "Der Umschalter bleibt verborgen, auch wenn er greift",
    file: "public/app.js",
    search: "    if (cloudOpen.overview || f.tagIds.length > 1) r3.classList.add('tags-live');",
    replacement: "    if (cloudOpen.overview) r3.classList.add('tags-live');",
    expected: "Die Tagzeile traegt Zeichen statt Woerter \u2014 0.30.2"
  },
  {
    nr: "941", name: "Der Umschalter steht immer da, auch zugeklappt",
    file: "public/style.css",
    search: "  .frow-tags:not(.tags-live) > .tagmode { display: none; }",
    replacement: "  .frow-tags.tags-live > .tagmode { display: inline-flex; }",
    expected: "Die Tagzeile traegt Zeichen statt Woerter \u2014 0.30.2"
  },
  {
    nr: "942", name: "Das Zeichen ist kein Ziel mehr fuer den Finger",
    file: "public/style.css",
    search: "  width: 30px; height: 30px; padding: 0; border-radius: 7px;",
    replacement: "  width: 16px; height: 16px; padding: 0; border-radius: 7px;",
    expected: "Die Tagzeile traegt Zeichen statt Woerter \u2014 0.30.2"
  },
  {
    nr: "943", name: "Die zugeklappte Wolke zeigt wieder EINE Reihe",
    file: "public/app.js",
    search: "    const cloudLimit = getComputedStyle(r3).display === 'grid' ? 2 : 1;",
    replacement: "    const cloudLimit = 1;",
    expected: "Die zugeklappte Tagzeile fuellt ihre Hoehe \u2014 0.30.3"
  },
  {
    nr: "944", name: "Die zwei Reihen gelten auch am Schreibtisch",
    file: "public/app.js",
    search: "getComputedStyle(r3).display === 'grid' ? 2 : 1;",
    replacement: "2;",
    expected: "Die zugeklappte Tagzeile fuellt ihre Hoehe \u2014 0.30.3"
  },
  {
    nr: "945", name: "Die Anordnung von 0.30.2 gilt wieder immer",
    file: "public/app.js",
    search: "    if (cloudRows(g3) > 1) r3.classList.add('tags-deep');",
    replacement: "    r3.classList.add('tags-deep');",
    expected: "Die zugeklappte Tagzeile fuellt ihre Hoehe \u2014 0.30.3"
  },
  {
    nr: "946", name: "Die Anordnung greift erst ab drei Reihen",
    file: "public/app.js",
    search: "if (cloudRows(g3) > 1) r3.classList",
    replacement: "if (cloudRows(g3) > 2) r3.classList",
    expected: "Die zugeklappte Tagzeile fuellt ihre Hoehe \u2014 0.30.3"
  },
  {
    nr: "947", name: "Der Reihenzaehler rechnet ohne den Abstand",
    file: "public/app.js",
    search: "  return Math.round((box.scrollHeight + CLOUD_GAP) / (height + CLOUD_GAP));",
    replacement: "  return Math.round(box.scrollHeight / height);",
    expected: "Die zugeklappte Tagzeile fuellt ihre Hoehe \u2014 0.30.3"
  },
  {
    nr: "948", name: "Der Reihenzaehler misst wieder selbst",
    file: "public/app.js",
    search: "function cloudRows(box) {\n  const height = cloudLine(box);",
    replacement: "function cloudRows(box) {\n  const first = box.firstElementChild;\n  const height = first ? first.offsetHeight || 0 : 0;",
    expected: "Die zugeklappte Tagzeile fuellt ihre Hoehe \u2014 0.30.3"
  },
  {
    nr: "949", name: "Der Reihenzaehler sieht nur, was nicht abgeschnitten ist",
    file: "public/app.js",
    search: "  return Math.round((box.scrollHeight + CLOUD_GAP)",
    replacement: "  return Math.round((box.clientHeight + CLOUD_GAP)",
    expected: "Die zugeklappte Tagzeile fuellt ihre Hoehe \u2014 0.30.3"
  },
  {
    nr: "950", name: "Die dritte Rasterzeile gilt wieder ohne Bedingung",
    file: "public/style.css",
    search: "  .frow-tags { grid-template-rows: auto 1fr; }",
    replacement: "  .frow-tags { grid-template-rows: auto auto 1fr; }",
    expected: "Die zugeklappte Tagzeile fuellt ihre Hoehe \u2014 0.30.3"
  },
  {
    nr: "951", name: "Der Umschalter nennt seinen Traeger nicht mehr",
    file: "public/style.css",
    search: "  .frow-tags.tags-deep > .tagmode { grid-row: 3; }",
    replacement: "  .frow-tags > .tagmode { grid-row: 3; }",
    expected: "Die zugeklappte Tagzeile fuellt ihre Hoehe \u2014 0.30.3"
  },
  /* ---- Sprachdateien gegengelesen ---- */
  {
    nr: '952', name: 'Ein Code-Leck steht wieder in der deutschen Sprachdatei',
    file: 'public/languages/de.json',
    search: "  \"entry.testedFirstHint\": ",
    replacement: "  \"entry.targetBlank\": \"_blank\",\n  \"entry.testedFirstHint\": ",
    expected: 'Die Sprachdateien werden gegengelesen — 0.31.0'
  },
  {
    nr: '953', name: 'Der geoeffnete Tab bekommt sein `noopener` nicht mehr',
    file: 'public/app.js',
    search: "          if (!search) return window.open(l.url, '_blank', 'noopener,noreferrer');",
    replacement: "          if (!search) return window.open(l.url, '_blank');",
    expected: 'Die Sprachdateien werden gegengelesen — 0.31.0'
  },
  {
    nr: '954', name: 'Der Abstand der Listenseite steht wieder inline am Knoten',
    file: 'public/app.js',
    search: "    <p class=\"hint page-hint${multipleUsers() ? ' above-pills' : ''}\" id=\"open-hint\"></p>",
    replacement: "    <p class=\"hint\" id=\"open-hint\" style=\"margin:0 0 ${multipleUsers() ? '10px' : '20px'}\"></p>",
    expected: 'Die Sprachdateien werden gegengelesen — 0.31.0'
  },
  {
    nr: '955', name: 'Die englische Datei traegt einen Schluessel weniger',
    file: 'public/languages/en.json',
    search: "  \"card.active\": \"active\",\n",
    replacement: "",
    expected: 'Die Sprachdateien werden gegengelesen — 0.31.0'
  },
  {
    nr: '956', name: 'Ein Text schliesst wieder mit einem geraden Anfuehrungszeichen',
    file: 'public/languages/de.json',
    search: "  \"entry.titleDeleteHint\": \"„{title}“ wird gelöscht.\",",
    replacement: "  \"entry.titleDeleteHint\": \"„{title}\\\" wird gelöscht.\",",
    expected: 'Die Sprachdateien werden gegengelesen — 0.31.0'
  },
  {
    nr: '957', name: 'Eine der vier Video-Meldungen sagt wieder „Standbild"',
    file: 'public/languages/de.json',
    search: "  \"server.videoStill\": \"Video und Video-Vorschaubild gehören zusammen.\",",
    replacement: "  \"server.videoStill\": \"Video und Standbild gehören zusammen.\",",
    expected: 'Die Sprachdateien werden gegengelesen — 0.31.0'
  },
  {
    nr: '958', name: '„gruppiert nach" heisst wieder „sortiert nach"',
    file: 'public/languages/de.json',
    search: "offen, gruppiert nach ",
    replacement: "offen, sortiert nach ",
    expected: 'Die Sprachdateien werden gegengelesen — 0.31.0'
  },
  {
    nr: '960', name: 'Der Export verlaesst wieder „das Haus"',
    file: 'public/languages/de.json',
    search: "in {n} Dateien — mit allen Fotos",
    replacement: "in {n} Dateien, die das Haus verlassen — mit allen Fotos",
    expected: 'Die Sprachdateien werden gegengelesen — 0.31.0'
  },
  {
    nr: '961', name: 'Der Filterhinweis nennt die Knoepfe wieder „Pillen"',
    file: 'public/languages/de.json',
    search: "  \"card.exportWritesHint\": \"Schreibt den gesamten Bestand in eine Datei; die erwartete Größe steht an den Knöpfen.\",",
    replacement: "  \"card.exportWritesHint\": \"Schreibt den gesamten Bestand in eine Datei; die erwartete Größe steht an den Pillen.\",",
    expected: 'Die Sprachdateien werden gegengelesen — 0.31.0'
  },
  {
    nr: '962', name: 'Die Vokabelkarte schreibt wieder „Sache" vor',
    file: 'public/languages/de.json',
    search: "  \"card.itemOne\": \"Das Bewertete, Einzahl\",",
    replacement: "  \"card.itemOne\": \"Sache, Einzahl\",",
    expected: 'Die Sprachdateien werden gegengelesen — 0.31.0'
  },

  /* ---- Deutsche Sprachdatei ---- */
  {
    nr: '964', name: 'Die Gleichlautprobe nennt ihre eigene Blindstelle nicht mehr',
    file: 'tools/gleichlaut.js',
    search: "   WOFUER SIE BLIND IST, UND DAS GEHOERT HIERHER:\n   SIE FUEHRT DEN CODE NICHT AUS.",
    replacement: "   SIE BILDET NACH.",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '965', name: 'Ein Satz faengt wieder mit dem Punkt des Vorgaengers an',
    file: 'public/languages/de.json',
    search: "  \"card.subDirOptional\": \"Optional ein vorhandener Unterordner:\",",
    replacement: "  \"card.subDirOptional\": \". Optional ein vorhandener Unterordner:\",",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '966', name: 'Ein Schluessel traegt wieder ein blosses Fuellwort',
    file: 'public/languages/de.json',
    search: "  \"card.partLoaded\": \"geladen\",",
    replacement: "  \"card.partLoaded\": \"und\",",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '967', name: 'Ein Wert oeffnet wieder eine Klammer, die er nicht schliesst',
    file: 'public/languages/de.json',
    search: "  \"card.includeFiles\": \"Angehängte Dateien mitnehmen (+{size})\",",
    replacement: "  \"card.includeFiles\": \"Angehängte Dateien mitnehmen (+\",",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '968', name: 'Ein Anschlussstueck haengt an keinem Satz mehr',
    file: 'public/languages/de.json',
    search: "dann der Durchschnitt darüber{extra}.",
    replacement: "dann der Durchschnitt darüber.",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '969', name: 'Ein Vergleich steht wieder neben einem Textruf',
    file: 'public/app.js',
    search: "    if (state) state.innerHTML = status.an",
    replacement: "    if (state && t('card.on') !== t('card.off')) state.innerHTML = status.an",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '970', name: 'Die tuerkische Datei traegt einen Schluessel weniger',
    file: 'public/languages/tr.json',
    search: "  \"card.active\": \"etkin\",\n",
    replacement: "",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '971', name: 'Ein deutscher Satz verliert seine Hervorhebung',
    file: 'public/languages/de.json',
    search: "  \"login.welcome\": \"Willkommen, **{name}** — bitte ein Passwort wählen.\",",
    replacement: "  \"login.welcome\": \"Willkommen, {name} — bitte ein Passwort wählen.\",",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '972', name: 'Eine Vokabelbeschriftung nennt wieder ihr Vorgabewort',
    file: 'public/languages/de.json',
    search: "  \"card.itemOne\": \"Das Bewertete, Einzahl\",",
    replacement: "  \"card.itemOne\": \"Das Bewertete, Einzahl (Vorgabe: Eintrag)\",",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '973', name: 'Eine Exportgroesse steht wieder in der Sprachdatei',
    file: 'public/languages/de.json',
    search: "  \"card.mergeExplainHint\":",
    replacement: "  \"card.mb50\": \"50 MB\",\n  \"card.mergeExplainHint\":",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '974', name: 'Ein deutscher Wert traegt wieder eine HTML-Entitaet',
    file: 'public/languages/de.json',
    search: "steht künftig unter „Gelöschter Benutzer {number}“.",
    replacement: "steht künftig unter „Gelöschter Benutzer &lt;{number}&gt;“.",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '975', name: 'Ein Wert traegt wieder die Einrueckung des Quelltexts',
    file: 'public/languages/de.json',
    search: "\"card.storeCaveat\": \"Verlustbehaftet: bei Fotos rund zwei Drittel kleiner,",
    replacement: "\"card.storeCaveat\": \"Verlustbehaftet: bei Fotos rund zwei Drittel kleiner,\\n          ",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '976', name: 'Ein Eintrag der Umbenennungstafel zeigt wieder ins Leere',
    file: 'tools/keys.json',
    search: "  \"karte.laden\": \"card.confirmOnce\",",
    replacement: "  \"karte.laden\": \"card.loadLower\",",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  /* ---- Englische Sprachdatei, Rueckbauten in den Daten ---- */
  {
    nr: '978', name: 'Ein deutscher Wert aendert sich — Deutsch ist nicht mehr unangetastet',
    file: 'public/languages/de.json',
    search: "  \"card.appearance\": \"Darstellung\",",
    replacement: "  \"card.appearance\": \"Aussehen\",",
    expected: 'Englisch sitzt — 0.31.2'
  },
  {
    nr: '979', name: 'Ein englisches Mehrzahlpaar wird ein einzelner Satz',
    file: 'public/languages/en.json',
    search: "  \"card.wordsMissing\": {\n    \"one\": \"1 vocabulary word\",\n    \"other\": \"{n} vocabulary words\"\n  },",
    replacement: "  \"card.wordsMissing\": \"{n} vocabulary words\",",
    expected: 'Englisch sitzt — 0.31.2'
  },
  {
    nr: '980', name: 'Ein englischer Wert verliert einen Platzhalter',
    file: 'public/languages/en.json',
    search: "\"card.deleteFreesHint\": {\n    \"one\": \"**{n} backup will be deleted** — {bytes} free.\",",
    replacement: "\"card.deleteFreesHint\": {\n    \"one\": \"**{n} backup will be deleted** — free.\",",
    expected: 'Englisch sitzt — 0.31.2'
  },
  {
    nr: '981', name: 'Ein englischer Wert traegt wieder ein Wort der Verbotsliste',
    file: 'public/languages/en.json',
    search: "\"card.keyBesideHint\": \"**The key is in the same directory as the database**",
    replacement: "\"card.keyBesideHint\": \"**The key sits next to the database**",
    expected: 'Englisch sitzt — 0.31.2'
  },
  {
    nr: '982', name: 'Ein englischer Wert traegt wieder eine HTML-Entitaet',
    file: 'public/languages/en.json',
    search: "appear under “Deleted user” with a number.",
    replacement: "appear under “Deleted user &lt;number&gt;”.",
    expected: 'Englisch sitzt — 0.31.2'
  },
  {
    /* Laenger ohne zusaetzlichen Satz; den zusaetzlichen Satz prueft 984. */
    nr: '983', name: 'Ein englischer Satz wird wieder deutlich laenger als sein deutscher',
    file: 'public/languages/en.json',
    search: "  \"card.blocksHint\": \"The order of the blocks and their collapsed state apply to all {entryMany}.\",",
    replacement: "  \"card.blocksHint\": \"The order of the blocks and whether they are collapsed applies to all {entryMany}.\",",
    expected: 'Englisch sitzt — 0.31.2'
  },
  {
    nr: '984', name: 'Ein englischer Wert traegt einen Satz mehr als sein deutscher',
    file: 'public/languages/en.json',
    search: "  \"card.wayBackupHint\": \"the emergency. The complete, encrypted copy of the database — including users and settings.\",",
    replacement: "  \"card.wayBackupHint\": \"the emergency. The complete, encrypted copy of the database. Including users and settings.\",",
    expected: 'Englisch sitzt — 0.31.2'
  },
  {
    nr: '985', name: 'Ein englischer Wert traegt eine US-Schreibung',
    file: 'public/languages/en.json',
    search: "  \"card.themeHint\": \"Colour scheme",
    replacement: "  \"card.themeHint\": \"Color scheme",
    expected: 'Englisch sitzt — 0.31.2'
  },
  {
    nr: '986', name: 'Ein englischer Wert traegt wieder die Einrueckung des Quelltexts',
    file: 'public/languages/en.json',
    search: "  \"card.storeCaveat\": \"Lossy: about two thirds smaller for photos,",
    replacement: "  \"card.storeCaveat\": \"Lossy: about two thirds smaller for photos,\\n          ",
    expected: 'Englisch sitzt — 0.31.2'
  },
  {
    nr: '988', name: 'Das Label heisst wieder „Zugang beantragen"',
    file: 'public/languages/de.json',
    search: "  \"login.requestAccess\": \"Account anfragen\",",
    replacement: "  \"login.requestAccess\": \"Zugang beantragen\",",
    expected: "Der Bildschirmtext-Waechter"
  },
  /* ---- Tuerkische Sprachdatei, Rueckbauten in den Daten ---- */
  {
    nr: '990', name: 'Ein tuerkisches Mehrzahlpaar wird ein einzelner Satz',
    file: 'public/languages/tr.json',
    search: "  \"card.wordsMissing\": {\n    \"one\": \"1 sözcük\",\n    \"other\": \"{n} sözcük\"\n  },",
    replacement: "  \"card.wordsMissing\": \"{n} sözcük\",",
    expected: 'Tuerkisch sitzt — 0.31.3'
  },
  {
    nr: '991', name: 'Ein tuerkischer Wert verliert einen Platzhalter',
    file: 'public/languages/tr.json',
    search: "\"card.deleteFreesHint\": {\n    \"one\": \"**{n} yedekleme silinecek** — {bytes} boşalır.\",",
    replacement: "\"card.deleteFreesHint\": {\n    \"one\": \"**{n} yedekleme silinecek** — boşalır.\",",
    expected: 'Tuerkisch sitzt — 0.31.3'
  },
  {
    nr: '992', name: 'Ein tuerkischer Wert traegt wieder „haptan" — mit angeklebter Endung',
    file: 'public/languages/tr.json',
    search: "  \"card.exportWritesHint\": \"Bütün veriyi bir dosyaya yazar; beklenen boyut düğmelerin üzerinde gösterilir.\",",
    replacement: "  \"card.exportWritesHint\": \"Bütün veriyi bir dosyaya yazar; beklenen boyut hapların üzerinde gösterilir.\",",
    expected: 'Tuerkisch sitzt — 0.31.3'
  },
  {
    nr: '993', name: 'Ein tuerkischer Wert traegt wieder ein deutsches Anfuehrungszeichen',
    file: 'public/languages/tr.json',
    search: "  \"card.approveAsk\": \"“{username}” onaylansın mı?\",",
    replacement: "  \"card.approveAsk\": \"„{username}“ onaylansın mı?\",",
    expected: 'Tuerkisch sitzt — 0.31.3'
  },
  {
    /* Laenger ohne zusaetzlichen Satz; den zusaetzlichen Satz prueft 995. */
    nr: '994', name: 'Ein tuerkischer Satz wird wieder deutlich laenger als sein deutscher',
    file: 'public/languages/tr.json',
    search: "  \"card.blocksHint\": \"Blokların sırası ve açık mı kapalı mı olduğu her {entryOne} için geçerlidir.\",",
    replacement: "  \"card.blocksHint\": \"Blokların sırası ve açık mı yoksa kapalı mı olduğu her {entryOne} için geçerlidir.\",",
    expected: 'Tuerkisch sitzt — 0.31.3'
  },
  {
    nr: '995', name: 'Ein tuerkischer Wert traegt einen Satz mehr als sein deutscher',
    file: 'public/languages/tr.json',
    search: "  \"card.wayBackupHint\": \"acil durum. Veritabanının eksiksiz, şifrelenmiş kopyası — kullanıcılar ve ayarlar dahil.\",",
    replacement: "  \"card.wayBackupHint\": \"acil durum. Veritabanının eksiksiz, şifrelenmiş kopyası. Kullanıcılar ve ayarlar dahil.\",",
    expected: 'Tuerkisch sitzt — 0.31.3'
  },
  {
    nr: '996', name: 'Ein tuerkischer Wert traegt wieder eine HTML-Entitaet',
    file: 'public/languages/tr.json',
    search: "Katkılar kalır ve “Silinen kullanıcı” adıyla bir numarayla görünür.",
    replacement: "Katkılar kalır ve “Silinen kullanıcı &lt;numara&gt;” altında görünür.",
    expected: 'Tuerkisch sitzt — 0.31.3'
  },
  {
    nr: '997', name: 'Ein Vokabelwort verliert seine Mehrzahl wieder — „Öğeler" wird „Öğe"',
    file: 'public/languages/tr.json',
    search: "  \"vocabulary.entryMany\": \"Öğeler\",",
    replacement: "  \"vocabulary.entryMany\": \"Öğe\",",
    expected: 'Tuerkisch sitzt — 0.31.3'
  },
  {
    nr: '998', name: 'Eine Mehrzahl steht hinter einer Zahl — „{n} yedeklemeler"',
    file: 'public/languages/tr.json',
    search: "  \"card.backupsDeleted\": {\n    \"one\": \"{n} yedekleme silindi ({bytes} boşaldı){extra}\",\n    \"other\": \"{n} yedekleme silindi ({bytes} boşaldı){extra}\"\n  },",
    replacement: "  \"card.backupsDeleted\": {\n    \"one\": \"{n} yedekleme silindi ({bytes} boşaldı){extra}\",\n    \"other\": \"{n} yedeklemeler silindi ({bytes} boşaldı){extra}\"\n  },",
    expected: 'Tuerkisch sitzt — 0.31.3'
  },
  {
    nr: '999', name: 'Ein tuerkischer Wert spricht den Benutzer wieder hoeflich an',
    file: 'public/languages/tr.json',
    search: "Çift adresleri değiştir ya da boşalt;",
    replacement: "Çift adresleri değiştirin ya da boşaltın;",
    expected: 'Tuerkisch sitzt — 0.31.3'
  },
  {
    nr: '1000', name: 'Ein tuerkischer Wert traegt wieder die Einrueckung des Quelltexts',
    file: 'public/languages/tr.json',
    search: "  \"card.storeCaveat\": \"Kayıplı: fotoğraflarda yaklaşık üçte iki daha küçük,",
    replacement: "  \"card.storeCaveat\": \"Kayıplı: fotoğraflarda yaklaşık üçte iki daha küçük,\\n          ",
    expected: 'Tuerkisch sitzt — 0.31.3'
  },
  /* ---- Einzahl nach einer Zahl ---- */
  {
    nr: '1002', name: 'Deutsch bekommt die tuerkische Stellungsregel',
    file: 'public/languages/de.json',
    search: "  \"_afterNumber\": \"plural\",",
    replacement: "  \"_afterNumber\": \"one\",",
    expected: 'Nach einer Zahl die Einzahl — 0.31.4'
  },
  {
    nr: '1003', name: 'Tuerkisch verliert seine Stellungsregel',
    file: 'public/languages/tr.json',
    search: "  \"_afterNumber\": \"one\",",
    replacement: "  \"_afterNumber\": \"plural\",",
    expected: 'Nach einer Zahl die Einzahl — 0.31.4'
  },
  {
    nr: '1004', name: 'Eine Zaehlerstelle greift wieder zu `plural()`',
    file: 'public/app.js',
    search: "const vTask = (n) => counted(n, V.taskOne, V.taskMany);",
    replacement: "const vTask = (n) => plural(n, V.taskOne, V.taskMany);",
    expected: 'Nach einer Zahl die Einzahl — 0.31.4'
  },
  {
    nr: '1005', name: '`counted()` entscheidet an der Locale statt an der Datei',
    file: 'public/app.js',
    search: "  return AFTER_NUMBER === 'one' ? one : plural(n, one, other);",
    replacement: "  return LOCALE.startsWith('tr') ? one : plural(n, one, other);",
    expected: 'Nach einer Zahl die Einzahl — 0.31.4'
  },
  {
    nr: '1006', name: 'Ein Satz mit `her` faellt auf die Mehrzahlform zurueck',
    file: 'public/languages/tr.json',
    search: "olduğu her {entryOne} için geçerlidir.",
    replacement: "olduğu her {entryMany} için geçerlidir.",
    expected: 'Nach einer Zahl die Einzahl — 0.31.4'
  },
  {
    nr: '1007', name: 'Die Kruecke „listesi" kommt hinter das Vokabelwort zurueck',
    file: 'public/languages/tr.json',
    search: "  \"list.openTasks\": \"Açık {taskMany}\",",
    replacement: "  \"list.openTasks\": \"Açık {taskMany} listesi\",",
    expected: 'Nach einer Zahl die Einzahl — 0.31.4'
  },
  {
    nr: '1008', name: 'Die Vorschau der Vokabelkarte setzt wieder eine Zahl vor die Mehrzahl',
    file: 'public/app.js',
    search: "</span><span>${many(7, sm)}</span>",
    replacement: "</span><span>7 ${esc(sm)}</span>",
    expected: 'Nach einer Zahl die Einzahl — 0.31.4'
  },
  {
    nr: '1009', name: 'Die Vorschau fragt die Sprache des LESERS statt der gezeigten',
    file: 'public/app.js',
    search: "(afterNumberOf(namesLanguage()) === 'one' ? esc(word) : `${n} ${esc(word)}`);",
    replacement: "(AFTER_NUMBER === 'one' ? esc(word) : `${n} ${esc(word)}`);",
    expected: 'Nach einer Zahl die Einzahl — 0.31.4'
  },

  /* ---- Einen anderen markieren ---- */
  {
    nr: '1010', name: 'Die Glocke zaehlt jeden neuen Kommentar als Markierung',
    file: 'server.js',
    search: "          SUM(CASE WHEN m.comment_id IS NULL THEN 0 ELSE 1 END) AS marked",
    replacement: "          COUNT(*) AS marked",
    expected: 'Einen anderen markieren — 0.32.0'
  },
  {
    nr: '1011', name: 'Die Markierung wird zur Fundstelle der Suche',
    file: 'public/app.js',
    search: "    const at = document.createElement('span');\n    at.className = 'mention';",
    replacement: "    const at = document.createElement('mark');\n    at.className = '';",
    expected: 'Der Kommentartext: Links, Hervorhebung und Markierung'
  },
  {
    nr: '1012', name: 'Die Markierung gilt wieder jedem',
    file: 'server.js',
    search: "     LEFT JOIN comment_mentions m ON m.comment_id = c.id AND m.user_id = ?",
    replacement: "     LEFT JOIN comment_mentions m ON m.comment_id = c.id AND (m.user_id = ? OR 1)",
    expected: 'Einen anderen markieren — 0.32.0'
  },
  {
    nr: '1013', name: 'Die Markierung schickt den Namen statt der Nummer',
    file: 'server.js',
    search: "    markedPer.get(z.comment_id).push({ handle: z.handle, author: authorFrom(card, z.user_id) });",
    replacement: "    markedPer.get(z.comment_id).push({ handle: z.handle, author: { id: z.user_id, name: z.handle, deleted: false } });",
    expected: 'Einen anderen markieren — 0.32.0'
  },
  {
    nr: '1014', name: 'Das fuenfzehnte Vokabelwort faellt aus der Karte',
    file: 'public/app.js',
    search: "  ['v15', 'grade', () => t('card.grade')]",
    replacement: "",
    expected: 'Oberflaeche'
  },
  {
    nr: '1016', name: 'Ein Vokabelwort wird wieder zusammengesetzt',
    file: 'public/languages/de.json',
    search: "  \"list.sortAvg\": \"Durchschnitt: {grade}\",",
    replacement: "  \"list.sortAvg\": \"Durchschnitts{grade}\",",
    expected: 'Die Sprachdatei ist die Quelle'
  },
  {
    nr: '1017', name: 'Ein fester deutscher Satz kommt in server.js zurueck',
    file: 'server.js',
    search: "  if (!mail.configured(raw)) return { ok: false, key: 'server.noAccountOwner' };",
    replacement: "  if (!mail.configured(raw)) return { ok: false, key: 'Es ist kein Mailzugang eingerichtet. Das macht der Eigentuemer dieser Installation.' };",
    expected: 'Die Sprachdatei ist die Quelle'
  },
  {
    nr: '1018', name: 'Der Server prueft die Form der Zugangsanfrage nicht mehr',
    file: 'server.js',
    search: "  if (!mail.isAddress(address))\n    return res.status(400).json({ error: t(localeOf(req), 'login.emailInvalid') });",
    replacement: "",
    expected: 'Die Selbstanmeldung: die immer gleiche Antwort'
  },
  {
    nr: '1020', name: 'Der `yedek`-Waechter bekommt seine Wortgrenzen zurueck',
    file: 'test/ui_overview.js',
    search: "      const YEDEK_STEM = /(?<![\\p{L}])yede[kğ](?!leme)[\\p{L}]*/iu;",
    replacement: "      const YEDEK_STEM = /\\byedek(ler|leri|le|tir)?\\b/i;",
    expected: '„Backup" heisst auf Tuerkisch yedekleme — 0.25.1'
  },
  {
    /* Wie 787, aber mit „Son yedeğe" statt „Son yedek". */
    nr: '1021', name: 'Ein erweichtes „yedeğe" bleibt im Tuerkischen stehen',
    file: 'public/languages/tr.json',
    search: "\"card.lastBackup\": \"Son yedekleme\"",
    replacement: "\"card.lastBackup\": \"Son yedeğe\"",
    expected: '„Backup" heisst auf Tuerkisch yedekleme — 0.25.1'
  },
  {
    nr: '1023', name: 'Der Anbietername geht wieder fest auf Deutsch hinaus',
    file: 'server.js',
    search: "      ({ ...a, name: a.nameKey ? t(localeOf(req), a.nameKey) : a.name,",
    replacement: "      ({ ...a, name: a.name,",
    expected: 'Der Bildschirmtext-Waechter — 0.22.0'
  },
  {
    nr: '1024', name: 'Der „Mehr"-Aufklapper fragt die Breite nicht mehr',
    file: 'public/app.js',
    search: "  if (!root || isNarrow()) return;",
    replacement: "  if (!root) return;",
    expected: 'Server-Befehle nur im Kasten — 0.22.0'
  },
  {
    nr: '1025', name: 'Die Messung der Aufklapper laeuft gar nicht mehr',
    file: 'public/app.js',
    search: "  trimMore(app);",
    replacement: "",
    expected: 'Server-Befehle nur im Kasten — 0.22.0'
  },
  {
    nr: '1026', name: 'Der eingerichtete Anbieter heisst in der Karte wieder fest deutsch',
    file: 'server.js',
    search: `    providerName: state.providerNameKey
      ? t(localeOf(req), state.providerNameKey) : state.providerName,`,
    replacement: "    providerName: state.providerName,",
    expected: 'Der Mailzugang: wer ihn setzen darf'
  },
  /* ---- Ableitung, Zaehlzeile, tuerkische Endungen ---- */
  {
    nr: '1027', name: 'Der Statusfilter folgt wieder der Sortierung',
    file: 'public/app.js',
    search: "const statusEffective = (f) => f.tested;",
    replacement: "const SORT_STATUS = { rating_desc: 'tested', rating_asc: 'tested',\n"
      + "  potential_desc: 'untested', potential_asc: 'untested' };\n"
      + "const statusEffective = (f) => SORT_STATUS[f.sort] || f.tested;",
    expected: 'Die Sortierung gibt den Status NICHT mehr vor — 0.32.1'
  },
  {
    nr: '1028', name: 'Die Filterzahl misst wieder gegen eine Ruhestellung',
    file: 'public/app.js',
    search: "  if (f.tested !== v.tested) n++;",
    replacement: "  if (f.tested !== (/^(rating|potential)_/.test(f.sort) ? f.tested : v.tested)) n++;",
    expected: 'Die Sortierung gibt den Status NICHT mehr vor — 0.32.1'
  },
  {
    nr: '1029', name: 'Die Zaehlzeile setzt wieder ein Wort neben die Zahl',
    file: 'public/app.js',
    search: "    marks.push(countMark('report', ICON_REPORT, reports));",
    replacement: "    marks.push(countMark('report', ICON_REPORT, `${reports} ${vReport(reports)}`));",
    expected: 'Der Kommentarblock zaehlt'
  },
  {
    nr: '1030', name: 'Die Zahl der Berichte traegt nur noch Farbe, kein Zeichen',
    file: 'public/app.js',
    search: "    marks.push(countMark('report', ICON_REPORT, reports));",
    replacement: "    marks.push(countMark('report', '', reports));",
    expected: 'Der Kommentarblock zaehlt'
  },
  {
    nr: '1031', name: 'Der Hinweis der Zaehlzeile wird wieder ein Satz',
    file: 'public/app.js',
    search: "  return { html: marks.join(' · '), text: words.join(' · ') };",
    replacement: "  return { html: marks.join(' · '), text: words[0] + ', davon ' + words.slice(1).join(' und ') };",
    expected: 'Der Kommentarblock zaehlt'
  },
  {
    nr: '1032', name: 'Der tuerkische Loeschbefehl haengt wieder am Platzhalter',
    file: 'public/languages/tr.json',
    search: '"entry.deleteEntry": "{entryOne} kaydını sil"',
    replacement: '"entry.deleteEntry": "{entryOne} sil"',
    expected: 'Endungen, Woerter und Zahlen — 0.32.1'
  },
  {
    nr: '1033', name: 'Die tuerkische Fragepartikel haengt wieder am Platzhalter',
    file: 'public/languages/tr.json',
    search: '"server.criterionKindFixed": "Bir ölçüt ya “{potential}” ya da “{ratingOne}” kutusuna aittir; sonradan değişmez."',
    replacement: '"server.criterionKindFixed": "Bir ölçütün {potential} mı yoksa {ratingOne} kutusuna mı ait olduğu sonradan değiştirilemez."',
    expected: 'Endungen, Woerter und Zahlen — 0.32.1'
  },
  {
    nr: '1034', name: 'Das fuenfzehnte Vokabelwort steht wieder fest im deutschen Satz',
    file: 'public/languages/de.json',
    search: '"entry.noDaysYet": "Noch keine {dayMany} — unten Datum und {grade} eintragen."',
    replacement: '"entry.noDaysYet": "Noch keine {dayMany} — unten Datum und Note eintragen."',
    expected: 'Endungen, Woerter und Zahlen — 0.32.1'
  },
  /* ---- Unvollstaendige Datenbank und Formatnummer ---- */
  {
    nr: '1035', name: 'Der Hinweis auf eine unvollstaendige Datenbank wird nicht mehr gerufen',
    file: 'db.js',
    search: 'warnIncompleteDatabase(incompleteDatabase());',
    replacement: '// warnIncompleteDatabase(incompleteDatabase());',
    expected: 'Der Hinweis auf einen unvollstaendigen Bestand — 0.33.0'
  },
  {
    nr: '1036', name: 'Der Kasten nennt die fehlende Spalte nicht mehr beim Namen',
    file: 'db.js',
    search: "    `    ${f.place.padEnd(22)} is missing` +",
    replacement: "    `    something is missing` +",
    expected: 'Der Hinweis auf einen unvollstaendigen Bestand — 0.33.0'
  },
  {
    nr: '1037', name: 'Die Probe fragt nur noch eine einzige Spalte ab',
    file: 'db.js',
    search: "  for (const [table, column, old] of REQUIRED_COLUMNS) {",
    replacement: "  for (const [table, column, old] of REQUIRED_COLUMNS.slice(0, 1)) {",
    expected: 'Der Hinweis auf einen unvollstaendigen Bestand — 0.33.0'
  },
  {
    nr: '1039', name: 'Aus dem Hinweis wird ein Abbruch — die Instanz oeffnet nicht mehr',
    file: 'db.js',
    search: 'function warnIncompleteDatabase(findings) {\n  if (!isMainThread || !findings.length) return;',
    replacement: 'function warnIncompleteDatabase(findings) {\n  if (!isMainThread || !findings.length) return;\n' +
      "  throw new Error('Diese Datenbank ist unvollstaendig.');",
    expected: 'Der Hinweis auf einen unvollstaendigen Bestand — 0.33.0'
  },
  {
    nr: '1040', name: 'Die Probe fragt einen Merker statt des Bestands',
    file: 'db.js',
    search: "function incompleteDatabase() {\n  const tables = new Set(db.prepare(\"SELECT name FROM sqlite_master WHERE type = 'table'\")",
    replacement: "function incompleteDatabase() {\n  if (!db.prepare(\"SELECT 1 FROM settings WHERE key = 'schemaIncomplete'\").get()) return [];\n" +
      "  const tables = new Set(db.prepare(\"SELECT name FROM sqlite_master WHERE type = 'table'\")",
    expected: 'Der Hinweis auf einen unvollstaendigen Bestand — 0.33.0'
  },
  {
    nr: '1041', name: 'Die Indizes auf nachgeruestete Spalten fallen wieder hart',
    file: 'db.js',
    search: "  } catch (e) {\n    if (isMainThread)",
    replacement: "  } catch (e) {\n    throw e;\n    if (isMainThread)",
    expected: 'Der Hinweis auf einen unvollstaendigen Bestand — 0.33.0'
  },
  {
    nr: '1042', name: 'Der Rueckfall uebergeht eine fehlende Spalte nicht mehr',
    file: 'db.js',
    search: "    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'user_id')) {\n      counts[table] = 0;\n      continue;\n    }",
    replacement: "",
    expected: 'Der Hinweis auf einen unvollstaendigen Bestand — 0.33.0'
  },
  {
    nr: '1044', name: 'Der Import liest die Formatnummer nicht mehr',
    file: 'server.js',
    search: "  if (!Number.isFinite(fileFormat) || fileFormat < EXCHANGE_FORMAT_MIN) {",
    replacement: "  if (false) {",
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  {
    /* Formatnummer 13 steht fuer zwei verschiedene Feldnamen; die Untergrenze liegt darueber. */
    nr: '1045', name: 'Die aelteste gelesene Formatnummer rutscht auf 13',
    file: 'server.js',
    search: 'const EXCHANGE_FORMAT_MIN = 14;',
    replacement: 'const EXCHANGE_FORMAT_MIN = 13;',
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  {
    nr: '1046', name: 'Die Exportdatei nennt die Programmfassung nicht mehr',
    file: 'server.js',
    search: "           appVersion: VERSION,\n           criteria: critRows.map(c => c.name), criteriaWeights, criteriaPhase,",
    replacement: "           criteria: critRows.map(c => c.name), criteriaWeights, criteriaPhase,",
    expected: 'Der Rueckfall der Namen — 0.24.3'
  },
  {
    nr: '1047', name: 'Der Stempel behauptet, ein gewachsener Bestand sei neu angelegt',
    file: 'db.js',
    search: "  if (!grown) setDefault.run('versionCreated', JSON.stringify(APP_VERSION));",
    replacement: "  setDefault.run('versionCreated', JSON.stringify(APP_VERSION));",
    expected: 'Der Stempel der Datenbank — 0.33.0'
  },
  {
    nr: '1048', name: 'Die Zeile „zuletzt geoeffnet" bleibt stehen',
    file: 'db.js',
    search: "    db.prepare(\"UPDATE settings SET value = ? WHERE key = 'versionLastOpened'\")\n      .run(JSON.stringify(APP_VERSION));",
    replacement: "    void 0;",
    expected: 'Der Stempel der Datenbank — 0.33.0'
  },
  {
    nr: '1049', name: 'Der Bestandslauf fasst die Ableitungen wieder an',
    file: 'batchrun.js',
    search: "  const write = db.prepare(\n    'UPDATE photos SET mime_type = ?, data = ? WHERE id = ?');",
    replacement: "  const write = db.prepare(\n    'UPDATE photos SET mime_type = ?, data = ?, thumb = thumb, medium = medium WHERE id = ?');",
    expected: 'Die Bildablage: PNG kommt herein, WebP geht in die Tabelle'
  },
  {
    nr: '1050', name: 'Der Fertigsatz des Laufs zaehlt wieder Ableitungen',
    file: 'public/languages/de.json',
    search: '"card.convertFinished": "Konvertierung fertig: {converted} von {total} Originalen konvertiert{stayed}{freed}."',
    replacement: '"card.convertFinished": "Konvertierung fertig: {converted} von {total} Originalen konvertiert, {derived} Vorschaubilder neu generiert{stayed}{freed}."',
    expected: 'Die Bildablage in der Oberflaeche'
  },
  {
    nr: '1051', name: 'Eine Konsolenansage spricht wieder deutsch',
    file: 'server.js',
    search: "  logLine(`Running on port ${PORT} -- ` +",
    replacement: "  logLine(`Laeuft auf Port ${PORT} -- ` +",
    expected: 'Die sieben Waechter der Sprachdatei — 0.24.0'
  },
  {
    nr: '1052', name: 'Der Schluesselhinweis spricht wieder deutsch',
    file: 'keys.js',
    search: "    '  CAUTION: the key sits NEXT TO the database, as\\n' +",
    replacement: "    '  ACHTUNG: Der Schluessel liegt NEBEN der Datenbank, als\\n' +",
    expected: 'Die sieben Waechter der Sprachdatei — 0.24.0'
  },

  /* ---- Anbietername im Containerprotokoll ---- */
  {
    nr: '1053', name: 'Die Protokollzeile nimmt wieder den rohen Anbieternamen',
    file: 'server.js',
    search: "      const providerShown = z.providerNameKey\n        ? t('en', z.providerNameKey) : z.providerName;",
    replacement: "      const providerShown = z.providerName;",
    expected: 'Der Mailversand: das Passwort steht nirgends'
  },
  {
    nr: '1054', name: 'Die Protokollzeile jagt auch Marken durch den Schluessel',
    file: 'mail.js',
    search: "  { key: 'strato', name: 'Strato',        server: 'smtp.strato.de',     port: 465, secure: true },",
    replacement: "  { key: 'strato', name: 'Strato', nameKey: 'mail.ownServer', server: 'smtp.strato.de', port: 465, secure: true },",
    expected: 'Der Anbietername im Containerprotokoll — 0.33.1'
  },
  {
    nr: '1055', name: 'Der englische Name des eigenen Servers faellt weg',
    file: 'public/languages/en.json',
    search: '"mail.ownServer": "Own server"',
    replacement: '"mail.ownServer": "Eigener Server"',
    expected: 'Der Anbietername im Containerprotokoll — 0.33.1'
  },
  {
    nr: '1056', name: 'Der Sprachwaechter verliert mail.js wieder',
    file: 'test/source.js',
    search: "'images.js', 'batchrun.js', 'mail.js'];",
    replacement: "'images.js', 'batchrun.js'];",
    expected: 'Der Sprachwaechter'
  },

  /* ---- Deutsche Saetze und roher Schluessel ---- */
  {
    nr: '1057', name: 'Die Sicherungszeile schreibt den Schluessel wieder roh hin',
    file: 'server.js',
    search: "  logLine('Backup location: ' + (situation.input\n    ? situation.root\n    : `off -- ${t('en', situation.reason, situation.values)}`));",
    replacement: "  logLine('Backup location: ' + (situation.input ? situation.root : `off -- ${situation.reason}`));",
    expected: 'Die Sicherungsprobe — 0.29.0'
  },
  {
    nr: '1058', name: 'Der Grund der Sicherungszeile reist ohne seine Werte',
    file: 'server.js',
    search: "`off -- ${t('en', situation.reason, situation.values)}`",
    replacement: "`off -- ${t('en', situation.reason)}`",
    expected: 'Die Sicherungsprobe — 0.29.0'
  },
  {
    nr: '1059', name: 'Die PUBLIC_ADDRESS-Probe antwortet wieder auf Deutsch',
    file: 'auth.js',
    search: "problem: 'The host name is missing.' };",
    replacement: "problem: 'Es fehlt der Rechnername.' };",
    expected: 'Die sieben Waechter der Sprachdatei — 0.24.0'
  },
  {
    nr: '1060', name: 'Der Grund einer uebergangenen Sprachdatei wird wieder deutsch',
    file: 'server.js',
    search: "languageSkip(file, 'it does not carry an object');",
    replacement: "languageSkip(file, 'sie traegt kein Objekt');",
    expected: 'Die sieben Waechter der Sprachdatei — 0.24.0'
  },

  /* ---- Funde beim Lesen ---- */
  {
    /* Zwischen checkToken und dieser Zeile liegt das await auf hashPassword; ohne
       `AND used_at IS NULL` gelingen zwei gleichzeitige Einloesungen. */
    nr: '1061', name: 'Der Link wird wieder ohne Bedingung in Anspruch genommen',
    file: 'auth.js',
    search: "\"UPDATE tokens SET used_at = datetime('now') WHERE hash = ? AND used_at IS NULL\"",
    replacement: "\"UPDATE tokens SET used_at = datetime('now') WHERE hash = ?\"",
    expected: 'Der Token: der Rundlauf'
  },
  {
    /* Ein Modul, das nach seiner Meldung stirbt, zaehlt dann als bestanden. */
    nr: '1062', name: 'Der Treiber liest wieder nur die Meldung',
    file: 'testbench.js',
    search: "if (!report.abort && !report.failed && r.status !== 0) {",
    replacement: "if (false) {",
    expected: 'Der Treiber sieht den Rueckgabewert — 0.34.4'
  },

  /* ---- Befunde der Messung ---- */
  {
    /* Die Pruefung ist dann nur gruen, solange der Elternlauf keinen Schalter traegt. */
    nr: '1063', name: 'Die Schalterprobe vererbt den Schalter wieder an das Kind',
    file: 'test/release_030.js',
    search: "        env: { ...process.env, TESTBENCH_PROBE: '1', TESTBENCH_TIME: '' } });",
    replacement: "        env: { ...process.env, TESTBENCH_PROBE: '1' } });",
    expected: 'Die Schalterprobe haengt nicht am Elternlauf — 0.35.0'
  },

  /* ---- Tot in den ausgelieferten Dateien ---- */
  {
    nr: '1064', name: 'Der Sprachname traegt wieder ename statt engine-name',
    file: 'public/app.js',
    search: "      st.onclick = () => sendLanguages({ languageDefault: a.code }, t('card.languageDefaultSaved'));\n      const nm = document.createElement('span');\n      nm.className = 'engine-name';",
    replacement: "      st.onclick = () => sendLanguages({ languageDefault: a.code }, t('card.languageDefaultSaved'));\n      const nm = document.createElement('span');\n      nm.className = 'ename';",
    expected: 'Die Karte sagt, wo Arbeit liegt — 0.25.0'
  },
  {
    nr: '1065', name: 'Die Route /api/health steht wieder da',
    file: 'server.js',
    search: "app.get('/api/manifest.json'",
    replacement: "app.get('/api/health', (req, res) => res.json({ ok: true }));\napp.get('/api/manifest.json'",
    expected: 'Das Startbildzeichen — 0.28.0'
  },

  /* ---- Sprachdateien und Stilblatt ---- */
  {
    nr: '1066', name: 'Die Ausnahmeliste vergisst einen gebauten Schluessel',
    file: 'test/source.js',
    search: "      ...['confirm', 'invite', 'reset', 'test'].flatMap(k =>",
    replacement: "      ...['invite', 'reset', 'test'].flatMap(k =>",
    expected: 'Jeder Schluessel der Sprachdatei hat einen Leser — 0.35.0'
  },
  {
    nr: '1067', name: 'Der englischen Sprachdatei fehlt ein Schluessel',
    file: 'public/languages/en.json',
    search: "  \"list.backToList\":",
    replacement: "  \"list.backToListGone\":",
    expected: 'Jeder Schluessel der Sprachdatei hat einen Leser — 0.35.0'
  },

  /* ---- Umstaendlich in server.js ---- */
  {
    nr: '1068', name: 'Die Stufeneinstellung faellt nicht mehr auf ihre Vorgabe zurueck',
    file: 'server.js',
    search: "  return a.list.includes(v) ? v : a.fallback;",
    replacement: "  return v;",
    expected: 'Persoenliche Einstellungen'
  },
  {
    nr: '1069', name: 'Die Stufeneinstellung nimmt jeden Wert an',
    file: 'server.js',
    search: "    if (!a.list.includes(v)) refuse(a.wrong);",
    replacement: "",
    expected: 'Die Einstellung streifen — 0.22.0'
  },
  {
    nr: '1070', name: 'Der Export liest die Fotos wieder ohne ihren Ausschnitt',
    file: 'server.js',
    search: "  'SELECT mime_type, data, thumb, medium, focus_x, focus_y, zoom, kind, duration FROM photos WHERE item_id = ? ORDER BY sort_order, id');",
    replacement: "  'SELECT mime_type, data, thumb, medium, NULL AS focus_x, NULL AS focus_y, NULL AS zoom, kind, duration FROM photos WHERE item_id = ? ORDER BY sort_order, id');",
    expected: 'Der Export in Teilen'
  },
  {
    nr: '1071', name: 'Suchen und Anlegen legt immer neu an',
    file: 'server.js',
    search: "  const f = find.get(name);\n  return f ? f.id : add.run(name, ...extra()).lastInsertRowid;",
    replacement: "  const f = null;\n  return f ? f.id : add.run(name, ...extra()).lastInsertRowid;",
    expected: 'Export und Import'
  },
  {
    nr: '1072', name: 'Die Sicherungsantwort sagt ihre Dauer nicht mehr an',
    file: 'server.js',
    search: "  const base = { place, dbBytes, durationSeconds: duration, cleanup: rule };",
    replacement: "  const base = { place, dbBytes, cleanup: rule };",
    expected: 'Die Sicherung auf Knopfdruck'
  },

  /* ---- Umstaendlich in public/app.js ---- */
  {
    nr: '1073', name: 'Das Dialoggeruest haengt den Knoten nicht mehr an',
    file: 'public/app.js',
    search: "  bd.innerHTML = html;\n  document.body.appendChild(bd);",
    replacement: "  bd.innerHTML = html;",
    expected: 'Keine Browserfenster mehr — 0.22.0'
  },
  {
    nr: '1074', name: 'Das Dialoggeruest laesst den Tastenhorcher stehen',
    file: 'public/app.js',
    search: "    document.removeEventListener('keydown', onKey, true);\n    bd.remove();\n    atClose(v);",
    replacement: "    bd.remove();\n    atClose(v);",
    expected: 'Keine Browserfenster mehr — 0.22.0'
  },
  {
    nr: '1075', name: 'Die Pillenreihe zeichnet sich nach dem Klick nicht neu',
    file: 'public/app.js',
    search: "        if (apply) apply();          // sofort sichtbar, auch wenn das Speichern scheitert\n        draw();",
    replacement: "        if (apply) apply();          // sofort sichtbar, auch wenn das Speichern scheitert",
    expected: 'Oberflaeche'
  },
  {
    nr: '1076', name: 'Die Pillenreihe faellt bei einem Fehlschlag nicht zurueck',
    file: 'public/app.js',
    search: "        catch (e) { set(before); if (apply) apply(); draw(); toast(e.message, true); }",
    replacement: "        catch (e) { toast(e.message, true); }",
    expected: 'Oberflaeche'
  },

  /* ---- Langsam in der Auslieferung ---- */
  {
    nr: '1077', name: 'Die Auslieferung geht wieder ungezippt hinaus',
    file: 'server.js',
    search: "  if (!one || !/\\bgzip\\b/.test(req.headers['accept-encoding'] || '')) return next();",
    replacement: "  if (one || true) return next();",
    expected: 'Die Auslieferung geht gezippt hinaus — 0.35.0'
  },
  {
    nr: '1078', name: 'Die gezippte Fassung traegt dieselbe Marke wie die rohe',
    file: 'server.js',
    search: "      tag: `W/\"${raw.length.toString(16)}-${at.getTime().toString(16)}-gz\"`",
    replacement: "      tag: `W/\"${raw.length.toString(16)}-${at.getTime().toString(16)}\"`",
    expected: 'Die Auslieferung geht gezippt hinaus — 0.35.0'
  },
  {
    nr: '1079', name: 'Die Fotoroute liest wieder alle drei Blobs',
    file: 'server.js',
    search: "  const want = req.query.size === 'thumb' ? 'thumb'\n             : req.query.size === 'medium' ? 'medium' : 'data';",
    replacement: "  const want = 'data';",
    expected: 'Der Ausschnitt steckt in der Kachel — 0.19.5'
  },
  {
    nr: '1080', name: 'Die Bilder eines Kommentars kommen nicht mehr mit',
    file: 'server.js',
    search: "    c.images = imagesPer.get(c.id) || [];",
    replacement: "    c.images = [];",
    expected: 'Bilder in Kommentaren'
  },

  /* ---- Einzelne Befunde ---- */
  {
    nr: '1081', name: 'Der Waechter liest wieder je Rueckbau seine Datei neu',
    file: 'test/selfcheck.js',
    search: "    const n = gpFileText(file).split(r.search).length - 1;",
    replacement: "    gpText.delete(file);\n    const n = gpFileText(file).split(r.search).length - 1;",
    expected: 'Die Gegenproben greifen'
  },
  {
    nr: '1082', name: 'Der Fotoweg behaelt, was vor der ungeeigneten Datei kam',
    file: 'server.js',
    search: "      if (!await gridImage(f.buffer))\n        return res.status(400).json({ error: t(localeOf(req), 'server.imagesOnly')});",
    replacement: "      if (!await gridImage(f.buffer)) break;",
    expected: 'Eine ungeeignete Datei laesst nichts zurueck — 0.35.0'
  },
  {
    nr: '1083', name: 'Ein gefangener Fehler ohne Schluessel bleibt wieder stumm',
    file: 'server.js',
    search: "  if (!(e && e.key)) logFail(e && e.stack ? e.stack : e);",
    replacement: "",
    expected: 'Ein gefangener Fehler bleibt nicht stumm — 0.35.0'
  },
  {
    nr: '1084', name: 'Zwei deutsche Saetze stehen wieder fest im Skript',
    file: 'public/app.js',
    search: "            x.title = t('entry.removeRating');",
    replacement: "            x.title = `${V.ratingOne} entfernen`;",
    expected: 'Kein deutscher Bildschirmsatz sitzt fest — die neue Wache — 0.30.0'
  },
  {
    nr: '1085', name: 'Die Zahl der Suchplaetze steht wieder fest im Skript',
    file: 'public/app.js',
    search: "    const list = SEARCH_PROVIDERS.filter(a => a.own).map((a, i) => ({",
    replacement: "    const list = [1, 2, 3].map((a, i) => ({",
    expected: 'Die Zahl der eigenen Suchplaetze steht an einer Stelle — 0.35.0'
  },
  {
    nr: '1086', name: 'Das Stilblatt zaehlt die Suchplaetze wieder einzeln auf',
    file: 'public/style.css',
    search: '.engine-slot input[id^="se-name-"] { flex: 0 0 8.5em; }',
    replacement: '.engine-slot #se-name-1, .engine-slot #se-name-2 { flex: 0 0 8.5em; }',
    expected: 'Die Zahl der eigenen Suchplaetze steht an einer Stelle — 0.35.0'
  },
  {
    nr: '1089', name: 'Ein Block des Stilblatts wird wieder lang',
    file: 'public/style.css',
    search: "  /* Gold leiser: voll gesaettigt gehoert Gold den Sternen. */",
    replacement: "  /* Gold leiser: voll gesaettigt gehoert Gold den Sternen.\n     Zeile 01 des wieder langen Blocks -- Erzaehlform statt Sachverhalt.\n     Zeile 02 des wieder langen Blocks -- Erzaehlform statt Sachverhalt.\n     Zeile 03 des wieder langen Blocks -- Erzaehlform statt Sachverhalt.\n     Zeile 04 des wieder langen Blocks -- Erzaehlform statt Sachverhalt. */",
    expected: 'Das Stilblatt traegt weniger Kommentar als vorher — 0.35.0'
  },
  {
    nr: '1090', name: 'Beim Kuerzen faellt eine Regelzeile mit',
    file: 'public/style.css',
    search: "  --gold-line: rgba(var(--gold-rgb), .52);",
    replacement: "",
    expected: 'Das Stilblatt traegt weniger Kommentar als vorher — 0.35.0'
  },
  {
    nr: '1091', name: 'Die Sekundengrenze wird wieder als feste Dauer abgewartet',
    file: 'test/roundtrip.js',
    search: "  const zpBefore = zpFresh[0].set_at;\n  await nextSecond();",
    replacement: "  const zpBefore = zpFresh[0].set_at;\n  await new Promise(r => setTimeout(r, 1100));",
    expected: 'Die Wartezeiten des Pruefstands — 0.35.0'
  },
  {
    nr: '1092', name: 'Der Helfer laeuft an der Grenze stillschweigend weiter',
    file: 'test/dom.js',
    search: "      throw new Error(`until(): ${what} ist in ${limitMs} ms nicht eingetreten`);",
    replacement: "      return;",
    expected: 'Die Wartezeiten des Pruefstands — 0.35.0'
  },
  {
    nr: '1093', name: 'Der Filter des Protokolls heisst im Browser wieder `gruppe`',
    file: 'public/app.js',
    search: "        (logGroup ? `?group=${encodeURIComponent(logGroup)}` : ''));",
    replacement: "        (logGroup ? `?gruppe=${encodeURIComponent(logGroup)}` : ''));",
    expected: 'Jeder Abfrageparameter des Browsers hat einen Leser — 0.35.0'
  },
  {
    nr: '1094', name: 'Der Mock des Pruefstands liest wieder den deutschen Namen',
    file: 'test/dom.js',
    search: "      const group = (String(url).match(/[?&]group=([^&]*)/) || [])[1];",
    replacement: "      const group = (String(url).match(/[?&]gruppe=([^&]*)/) || [])[1];",
    expected: 'Jeder Abfrageparameter des Browsers hat einen Leser — 0.35.0'
  },
  {
    nr: '1095', name: 'Die Schluesseldatei wird ungeprueft gelesen',
    file: 'keys.js',
    search: "    if (!HEX_PATTERN.test(hex))\n" +
      "      throw new Error(`${keyPath} enthaelt keine 64 Hex-Zeichen, sondern `",
    replacement: "    if (false)\n" +
      "      throw new Error(`${keyPath} enthaelt keine 64 Hex-Zeichen, sondern `",
    expected: 'Die Schluesseldatei: was darin steht, wird geprueft'
  },
  {
    nr: '1096', name: 'Die Einstellungsroute schreibt wieder ohne Transaktion',
    file: 'server.js',
    search: "    answer = db.transaction(() => {",
    replacement: "    answer = (() => {",
    expected: 'Eine Absage von PUT /api/settings schreibt nichts'
  },
  {
    nr: '1097', name: 'Das Wiederherstellen nimmt die Zeile nicht in Anspruch',
    file: 'server.js',
    search: "    if (trashRestoring.has(z.id))\n" +
      "      return res.status(409).json({ error: t(localeOf(req), 'server.trashRestoring')});",
    replacement: "",
    expected: 'Der Papierkorb: zweimal gleichzeitig zurueckholen'
  },
  {
    nr: '1098', name: 'Die Nummer bleibt nach dem Fehlerweg besetzt',
    file: 'server.js',
    search: "    if (claimed !== null) trashRestoring.delete(claimed);",
    replacement: "",
    expected: 'Der Papierkorb: zweimal gleichzeitig zurueckholen'
  },
  {
    nr: '1099', name: 'Die .env.example nennt wieder eine alte Version',
    file: '.env.example',
    search: "# BEHIND_PROXY -- 1, wenn ein Reverse Proxy mit HTTPS davor steht.",
    replacement: "# BIS 0.12.4 WAREN ES FUENF.\n"
      + "# BEHIND_PROXY -- 1, wenn ein Reverse Proxy mit HTTPS davor steht.",
    expected: 'Keine Versionsnummer als Herkunft'
  },
  {
    nr: '1100', name: 'Der Versionsleser haelt eine Adresse fuer eine Version',
    file: 'test/source.js',
    search: "    const vnPattern = () => /(?<![\\d.])\\d+\\.\\d+\\.\\d+(?!\\.?\\d)/g;",
    replacement: "    const vnPattern = () => /\\b\\d+\\.\\d+\\.\\d+\\b/g;",
    expected: 'Keine Versionsnummer als Herkunft'
  },
  /* ---- Fotogrenzen ---- */
  {
    nr: '1101', name: 'Die Fotoroute nennt die 40 wieder ohne Namen',
    file: 'server.js',
    search: "         cappedLive(bytes => photoUpload(bytes).array('photos', PHOTO_COUNT),",
    replacement: "         cappedLive(bytes => photoUpload(bytes).array('photos', 40),",
    expected: 'Die Fotogrenzen haben Namen — 0.35.2'
  },
  {
    nr: '1102', name: 'Der Browser schickt die Fotos wieder in einem Zug',
    file: 'public/app.js',
    search: "        for (let at = 0; at < images.length; at += PHOTO_COUNT) {",
    replacement: "        for (let at = 0; at < images.length; at += 10000) {",
    expected: 'Die Fotogrenzen haben Namen — 0.35.2'
  },
  {
    nr: '1103', name: 'Der Browser teilt nach einer anderen Zahl als der Server',
    file: 'public/app.js',
    search: "const PHOTO_COUNT = 40;",
    replacement: "const PHOTO_COUNT = 60;",
    expected: 'Die Fotogrenzen haben Namen — 0.35.2'
  },
  {
    nr: '1104', name: 'Die Absage an zu viele Fotos steht wieder auf Englisch da',
    file: 'server.js',
    search: "    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT')",
    replacement: "    if (false)",
    expected: 'Mehr als 40 Fotos auf einmal — 0.35.2'
  },
  /* ---- Containerprotokoll und Zeit ---- */
  {
    nr: '1105', name: 'Der Zeitstempel verliert seinen Versatz',
    file: 'log.js',
    search: "         `${sign}${two(Math.floor(away / 60))}:${two(away % 60)}`;",
    replacement: "         'Z';",
    expected: 'Das Containerprotokoll traegt seine Zeit — 0.35.2'
  },
  {
    nr: '1106', name: 'Eine Protokollzeile umgeht den Helfer wieder',
    file: 'keys.js',
    search: "  if (isMainThread) logLine('New key created.');",
    replacement: "  if (isMainThread) console.log('[Kriterion] New key created.');",
    expected: 'Das Containerprotokoll traegt seine Zeit — 0.35.2'
  },
  {
    /* Ohne TZ laeuft der Container auf UTC. */
    nr: '1107', name: 'Die Beispieldatei setzt TZ nicht mehr',
    file: 'docker-compose.example.yml',
    search: "      - TZ=Europe/Berlin\n",
    replacement: "",
    expected: 'Das Containerprotokoll traegt seine Zeit — 0.35.2'
  },
  /* ---- Jede Route hat einen Rufer ---- */
  {
    nr: '1108', name: 'Eine Route verliert ihren Rufer im Browser',
    file: 'public/app.js',
    search: "api('PUT', `/api/items/${id}/photo-order`",
    replacement: "api('PUT', `/api/eintrag/${id}/fotoreihenfolge`",
    expected: 'Jede Route hat einen Rufer — 0.35.2'
  },
  {
    nr: '1109', name: 'Die Ausnahmeliste des Routenwaechters deckt zu viel zu',
    file: 'test/source.js',
    search: "    const RR_OVER_TABLE = ['/api/product-categories/:id', '/api/tags/:id'];",
    replacement: "    const RR_OVER_TABLE = ['/api/product-categories/:id', '/api/tags/:id', '/api/items/:id'];",
    expected: 'Jede Route hat einen Rufer — 0.35.2'
  },
  /* ---- Kein Verweis auf Doku/ ---- */
  {
    nr: '1110', name: 'Das Stilblatt verweist wieder auf eine Datei unter Doku/',
    file: 'public/style.css',
    search: "/* ---- Helles Schema ---- */",
    replacement: "/* ---- Helles Schema -- Doku/Farbkonzept_0_23_0.md ---- */",
    expected: 'Kein Verweis auf Doku/ geht mit hinaus — 0.35.2'
  },
  /* ---- Jeder Rueckbau laesst eine ladbare Datei zurueck ---- */
  {
    /* Kuerzt den Suchtext von 377 auf die erste Zeile des Rufs; der Rest bliebe
       stehen und zerbraeche public/app.js. */
    nr: '1111', name: 'Ein Rueckbau laesst die Klammer wieder stehen',
    file: 'counterproof.js',
    search: "    search: \"      if (!await secondConfirm('mail', null, t('card.saveMailAccount'),\\n        t('card.mailServerHint'))) return;\\n\",",
    replacement: "    search: \"      if (!await secondConfirm('mail', null, t('card.saveMailAccount'),\\n\",",
    expected: 'Die Gegenproben greifen'
  },
  /* ---- Deutsch ist keine id ---- */
  {
    /* Die id steht in keiner Stilblattregel und in keinem `id="…"`; nur die
       dritte Quelle der Gestaltprobe sieht sie. */
    nr: '1112', name: 'Eine gesetzte id heisst wieder deutsch',
    file: 'public/app.js',
    search: "    b.id = 'f-cat-none';",
    replacement: "    b.id = 'f-kat-ohne';",
    expected: 'Der Quelltext spricht Englisch — die sechs Waechter'
  },
  {
    nr: '1113', name: 'Die Gestaltprobe liest die gesetzten id nicht mehr',
    file: 'test/source.js',
    search: "    for (const m of appSource.matchAll(/\\.id = ['\"]([\\w-]+)['\"]/g)) shapes.add('#' + m[1]);",
    replacement: "",
    expected: 'Der Quelltext spricht Englisch — die sechs Waechter'
  },
  /* ---- Nummernwaechter ---- */
  {
    nr: '1114', name: 'Das Stilblatt nennt wieder eine solche Nummer',
    file: 'public/style.css',
    search: "   im Vierspaltenraster verschoeben sich sonst alle Zellen. */",
    replacement: "   im Vierspaltenraster verschoeben sich sonst alle Zellen (Stolper" + "stein 47). */",
    expected: 'Kein Stolpersteinverweis mehr — 0.34.3'
  },
  {
    /* Die Zeile steht in einer Vorlage, und tools/segments.js haelt eine Vorlage fuer Text. */
    nr: '1115', name: 'Eine SQL-Zeile des Schemas nennt wieder eine Nummer',
    file: 'db.js',
    search: "  -- ON DELETE SET NULL wie an jedem Traeger: ein entfernter",
    replacement: "  -- ON DELETE SET NULL wie an jedem Traeger (Stolper" + "stein 54): ein entfernter",
    expected: 'Kein Stolpersteinverweis mehr — 0.34.3'
  },
  /* ---- Der Grund eines Versands reist als Schluessel ---- */
  {
    nr: '1116', name: 'Der Versandgrund steht wieder in der Sprache des Empfaengers',
    file: 'server.js',
    search: "              : { delivery: 'fehlgeschlagen', deliveryReason: sendWhy(e, readerLocale) };",
    replacement: "              : { delivery: 'fehlgeschlagen', deliveryReason: sendWhy(e, locale) };",
    expected: 'Der Grund eines Versands reist als Schluessel — 0.35.2'
  },
  {
    nr: '1117', name: 'Der Schluessel der Frist reist wieder als Text',
    file: 'mail.js',
    search: "  if (e && e.key) return { reasonKey: e.key, reason: '' };",
    replacement: "  if (e && e.key) return { reasonKey: '', reason: e.key };",
    expected: 'Der Mailversand: die Frist wird gemessen, nicht behauptet'
  },
  /* ---- Anmeldesperre in der Datenbank ---- */
  {
    nr: '1118', name: 'Der Aufraeumer nimmt auch die laufende Sperre mit',
    file: 'auth.js',
    search: "  const n = delAttemptsOld.run(`-${ATTEMPT_KEEP_MINUTES} minutes`).changes;",
    replacement: "  const n = db.prepare('DELETE FROM login_attempts').run().changes;",
    expected: 'Erstanmeldung: die Sperre ueberlebt den Neustart'
  },
  {
    nr: '1119', name: 'Der Aufraeumer laeuft nicht mehr beim Start',
    file: 'server.js',
    search: "auth.cleanupAttempts();\nsetInterval(auth.cleanupAttempts, 60 * 60 * 1000).unref();",
    replacement: "setInterval(auth.cleanupAttempts, 60 * 60 * 1000).unref();",
    expected: 'Erstanmeldung: die Sperre ueberlebt den Neustart'
  },
  /* ---- Schutz gegen fremde Formulare ---- */
  {
    nr: '1120', name: 'Der Waechter laesst jede schreibende Anfrage durch',
    file: 'server.js',
    search: "  if (auth.csrfOk(req, token)) return next();",
    replacement: "  if (true) return next();",
    expected: 'Kein fremdes Formular kommt an eine schreibende Route'
  },
  {
    nr: '1121', name: 'Die Ausnahmeliste nennt eine Route hinter der Anmeldung',
    file: 'server.js',
    search: "  'POST /api/signup/confirm'\n];",
    replacement: "  'POST /api/signup/confirm',\n  'POST /api/items'\n];",
    expected: 'Der Waechter ueber den Quelltext'
  },
  {
    nr: '1122', name: 'Der Token reist wieder mit HttpOnly und ist unlesbar',
    file: 'auth.js',
    search: "  `${csrfName(req)}=${csrfToken(token)}; Path=/; SameSite=Lax` +",
    replacement: "  `${csrfName(req)}=${csrfToken(token)}; HttpOnly; Path=/; SameSite=Lax` +",
    expected: 'Kein fremdes Formular kommt an eine schreibende Route'
  },
  {
    nr: '1123', name: 'Der Token wird gewuerfelt statt abgeleitet',
    file: 'auth.js',
    search: "  crypto.createHash('sha256').update('csrf:' + String(token)).digest('hex');",
    replacement: "  crypto.createHash('sha256').update('csrf:').digest('hex');",
    expected: 'Kein fremdes Formular kommt an eine schreibende Route'
  },
  /* ---- Einsetzungen in innerHTML ---- */
  {
    nr: '1124', name: 'Ein Titel geht wieder ungefuehrt in innerHTML',
    file: 'public/app.js',
    search: '      <h3 class="card-title">${esc(it.title)}</h3>',
    replacement: '      <h3 class="card-title">${it.title}</h3>',
    expected: 'Keine nackte Einsetzung in innerHTML'
  },
  {
    nr: '1125', name: 'Die Ausnahmeliste traegt einen Namen, den es nicht gibt',
    file: 'test/source.js',
    search: "    'changeBox', 'listBox', 'outdatedBox', 'tooBigBox'",
    replacement: "    'changeBox', 'listBox', 'outdatedBox', 'tooBigBox', 'gibtEsNicht'",
    expected: 'Keine nackte Einsetzung in innerHTML'
  },
  /* ---- npm audit faerbt den Lauf ---- */
  {
    nr: '1126', name: 'Eine gemeldete Luecke faerbt den Lauf nicht mehr',
    file: 'test/selfcheck.js',
    search: "      const naCounts = (naReport.metadata && naReport.metadata.vulnerabilities) || {};",
    replacement: "      const naCounts = { total: 1 };",
    expected: 'Bekannte Luecken in den Abhaengigkeiten'
  },

  /* ---- Papierverweise ---- */
  {
    nr: '1127', name: 'Ein Kommentar nennt wieder ein Papier beim Namen',
    file: 'server.js',
    search: "// req.caps: der Fehler-Handler kennt die Route nicht mehr.",
    replacement: "// req.caps -- Projektstand 5.3. Der Fehler-Handler kennt die Route nicht mehr.",
    expected: 'Kein Papierverweis geht mit hinaus'
  },
  {
    nr: '1128', name: 'Ein Kommentar nennt wieder eine Bauabschnittsnummer',
    file: 'public/style.css',
    search: '/* ---- Die Vergleichsleiste ---- Statt mittig als Pille nimmt sie auf dem',
    replacement: '/* ---- Die Vergleichsleiste, BA 5 ---- Statt mittig als Pille nimmt sie auf dem',
    expected: 'Kein Papierverweis geht mit hinaus'
  },
  {
    nr: '1129', name: 'Eine SQL-Kommentarzeile des Schemas nennt wieder ein Papier',
    file: 'db.js',
    search: '-- Anhaenge am Eintrag. mime_type ist der vom Browser gemeldete Typ und dient',
    replacement: '-- Anhaenge am Eintrag (Konzept 4.6). mime_type ist der gemeldete Typ und dient',
    expected: 'Kein Papierverweis geht mit hinaus'
  },
  /* ---- Die Auszeichnung ---- */
  {
    nr: '1130', name: 'Der Unterstrich zeichnet auch mitten im Wort aus',
    file: 'public/app.js',
    search: "    canOpen: c === '*' ? flank.left : flank.left && (!flank.right || flank.markBefore),",
    replacement: "    canOpen: flank.left,",
    expected: 'Kriterion zeichnet wie die Spezifikation oder gar nicht'
  },
  {
    nr: '1131', name: 'Ein einzelner Stern zeichnet kursiv aus',
    file: 'public/app.js',
    search: "  (char === '*' && used > 1) ? 'strong' : (char === '_' && used < 2) ? 'em' : '';",
    replacement: "  (char === '*' && used > 1) ? 'strong' : 'em';",
    expected: 'Kriterion zeichnet wie die Spezifikation oder gar nicht'
  },
  {
    nr: '1132', name: 'Der Backslash verliert seine Wirkung',
    file: 'public/app.js',
    search: "    if (c === '\\\\' && MARKUP_ASCII_MARK.test(source[pos + 1] || '')) {\n      plain += source[pos + 1]; plainSource += source.slice(pos, pos + 2); pos += 2; continue;\n    }",
    replacement: "    if (false) { continue; }",
    expected: 'Kriterion zeichnet wie die Spezifikation oder gar nicht'
  },
  {
    nr: '1133', name: 'Ein Code-Abschnitt laeuft wieder ueber den Zeilenumbruch',
    file: 'public/app.js',
    search: "    if (found < 0 || found >= line) return null;",
    replacement: "    if (found < 0) return null;",
    expected: 'Kriterion zeichnet wie die Spezifikation oder gar nicht'
  },
  {
    nr: '1134', name: 'Ein Lauf ohne Gegenstueck gibt nur sein erstes Zeichen zurueck',
    file: 'public/app.js',
    search: "        plain += '`'.repeat(run); plainSource += '`'.repeat(run); pos += run; continue;",
    replacement: "        plain += '`'; plainSource += '`'; pos += 1; continue;",
    expected: 'Kriterion zeichnet wie die Spezifikation oder gar nicht'
  },
  {
    nr: '1135', name: 'Ein Ziel ohne http(s) wird doch ein Link',
    file: 'public/app.js',
    search: "const MARKUP_TARGET = /^https?:\\/\\//i;",
    replacement: "const MARKUP_TARGET = /./;",
    expected: 'Was nicht in der Teilmenge liegt, bleibt Text'
  },
  {
    nr: '1136', name: 'Aus einem einzelnen Zeilenumbruch wird ein Leerzeichen',
    file: 'public/app.js',
    search: "      markupInlineNodes(markupInline(b.lines.join('\\n')), into, term, marks, false);",
    replacement: "      markupInlineNodes(markupInline(b.lines.join(' ')), into, term, marks, false);",
    expected: 'Was nicht in der Teilmenge liegt, bleibt Text'
  },
  {
    nr: '1137', name: 'Die Herkunft eines Verweises wird nicht mehr geprueft',
    file: 'public/app.js',
    search: "  if (!text.startsWith(here + '#/')) return '';\n  const found = text.slice(here.length).match(ENTRY_PATTERN);",
    replacement: "  const found = text.replace(/^[^#]*/, '').match(ENTRY_PATTERN);",
    expected: 'Was nicht in der Teilmenge liegt, bleibt Text'
  },
  {
    nr: '1138', name: 'Die Kommentarnummer folgt wieder der Anzeige',
    file: 'public/app.js',
    search: "  [...(comments || [])].sort((a, b) => a.id - b.id).forEach((c, i) => order.set(c.id, i + 1));",
    replacement: "  [...(comments || [])].forEach((c, i) => order.set(c.id, i + 1));",
    expected: 'Was nicht in der Teilmenge liegt, bleibt Text'
  },
  {
    nr: '1139', name: 'Die Auszeichnung erreicht die Markierung mit @ nicht mehr',
    file: 'public/app.js',
    search: "      into.appendChild(inLink ? raiseHighlight(p.text, term)\n        : buildCommentNodes(splitCommentText(p.text, term, marks)));",
    replacement: "      into.appendChild(buildCommentNodes(splitCommentText(p.text, term)));",
    expected: 'Was nicht in der Teilmenge liegt, bleibt Text'
  },
  {
    nr: '1140', name: 'Die beiden Fassungen des Kerns laufen auseinander',
    file: 'server.js',
    search: "const MARKUP_SPACE = /[ \\t\\n\\v\\f\\r]/;",
    replacement: "const MARKUP_SPACE = /[ \\t\\n\\v\\f]/;",
    expected: 'Kriterion zeichnet wie die Spezifikation oder gar nicht'
  },
  {
    nr: '1141', name: 'Der Trefferausschnitt bekommt die Marken nicht mehr heraus',
    file: 'server.js',
    search: "    text: MARKUP_SOURCES.has(first.key)\n      ? snippet(markupPlain(r['f_' + first.key]), term, r['f_' + first.key])\n      : snippet(r['f_' + first.key], term),",
    replacement: "    text: snippet(r['f_' + first.key], term),",
    expected: 'Kriterion zeichnet wie die Spezifikation oder gar nicht'
  },
  {
    nr: '1142', name: 'Die eingeklappte Blockkopfzeile zeigt die Marken wieder',
    file: 'public/app.js',
    search: "      const text = markupPlain(item.description || '').trim().replace(/\\s+/g, ' ');",
    replacement: "      const text = (item.description || '').trim().replace(/\\s+/g, ' ');",
    expected: 'Kriterion zeichnet wie die Spezifikation oder gar nicht'
  },
  {
    nr: '1143', name: 'Der Kommentarverweis verliert seinen Leser im Browser',
    file: 'public/app.js',
    search: "  try { return Number(new URLSearchParams(askKey || '').get('c')) || 0; }",
    replacement: "  try { return Number((askKey || '').split('c=')[1]) || 0; }",
    expected: 'Jeder Abfrageparameter des Browsers hat einen Leser — 0.35.0'
  },
  {
    nr: '1144', name: 'Das schwebende Menue bekommt Milchglas',
    file: 'public/style.css',
    search: "  border-radius: var(--r-sm); box-shadow: var(--sh-menu);",
    replacement: "  border-radius: var(--r-sm); box-shadow: var(--sh-menu); backdrop-filter: blur(12px);",
    expected: 'Kein Milchglas im Stilblatt — 0.22.0'
  },
  {
    nr: '1145', name: 'Das Menue laeuft auf schmalem Bildschirm aus dem Bild',
    file: 'public/style.css',
    search: "  gap: 3px; padding: 3px; max-width: calc(100vw - 16px);",
    replacement: "  gap: 3px; padding: 3px;",
    expected: 'Das schwebende Menue bleibt im Bild'
  },
  {
    nr: '1146', name: 'Die Klammern eines Ziels haben wieder keine Grenze',
    file: 'public/app.js',
    search: "      if (c === '(') { if (++depth > MARKUP_NESTING) return null; target += c; i++; continue; }",
    replacement: "      if (c === '(') { depth++; target += c; i++; continue; }",
    expected: 'Die Beschreibung wird gelesen und geschrieben'
  },
  {
    nr: '1147', name: 'Die Zeilenebene hat wieder keine Tiefengrenze',
    file: 'public/app.js',
    search: "  const deep = depth >= MARKUP_DEPTH;",
    replacement: "  const deep = false;",
    expected: 'Die Beschreibung wird gelesen und geschrieben'
  },
  {
    nr: '1148', name: 'Escape in der Beschreibung speichert, statt zu verwerfen',
    file: 'public/app.js',
    search: "    descEl.value = item.description;\n    descWrite(false);\n  };",
    replacement: "    descWrite(false);\n  };",
    expected: 'Die Beschreibung wird gelesen und geschrieben'
  },
  {
    nr: '1149', name: 'Die untere Schranke je Zeichen faellt weg',
    file: 'public/app.js',
    search: "    const floor = Math.max(bottom, (floors.has(key) ? floors.get(key) : -1) + 1);",
    replacement: "    const floor = bottom;",
    expected: 'Kriterion zeichnet wie die Spezifikation oder gar nicht'
  },
  {
    nr: '1150', name: 'Die Verschachtelung der Auszeichnung hat wieder keine Grenze',
    file: 'public/app.js',
    search: "    if (deep >= MARKUP_DEPTH) { at++; continue; }\n",
    replacement: "",
    expected: 'Kriterion zeichnet wie die Spezifikation oder gar nicht'
  },
  {
    nr: '1151', name: 'Die Zwischenablage hat wieder keinen zweiten Weg',
    file: 'public/app.js',
    search: "    if (copyByField(text)) toast(message);\n    else toast(t(byHand), true);",
    replacement: "    toast(t(byHand), true);",
    expected: 'Was der Betrieb an der Auszeichnung gefunden hat'
  },
  {
    nr: '1152', name: 'Der Leerraum der Auswahl steht wieder in den Marken',
    file: 'public/app.js',
    search: "  const core = flanked ? raw.trim() : raw;",
    replacement: "  const core = raw;",
    expected: 'Was der Betrieb an der Auszeichnung gefunden hat'
  },
  {
    nr: '1153', name: 'Der Stift traegt wieder den leisesten Wert',
    file: 'public/style.css',
    search: ".mact.ed { color: var(--accent-text); }",
    replacement: ".mact.ed { color: var(--faint); }",
    expected: 'Der Stift steht da, und das Loeschen steht abseits'
  },
  {
    nr: '1154', name: 'Vor dem Loeschkreuz steht wieder kein Abstand',
    file: 'public/style.css',
    search: ".cmt-head button.rm { margin-left: .6em; }",
    replacement: ".cmt-head button.rm { margin-left: 0; }",
    expected: 'Der Stift steht da, und das Loeschen steht abseits'
  },
  {
    nr: '1155', name: 'Der Verweis springt wieder nur ueber die Adresse',
    file: 'public/app.js',
    search: "  const target = commentRow(id);\n  if (!target) { LIT_COMMENT = 0; return false; }",
    replacement: "  const target = document.querySelector('.cmt.lit');\n  if (!target) { LIT_COMMENT = 0; return false; }",
    expected: 'Was der Betrieb an der Auszeichnung gefunden hat'
  },
  {
    nr: '1156', name: 'Die roh eingefuegte Adresse wird wieder keine Marke',
    file: 'public/app.js',
    search: "    if (p.type === 'text')\n      for (const piece of splitCommentText(p.text, '', []))\n        if (piece.target) { const k = markupRefOf(piece.target); if (k) want.add(k); }",
    replacement: "",
    expected: 'Was der Betrieb an der Auszeichnung gefunden hat'
  },
  {
    nr: '1157', name: 'Der Trefferausschnitt zeigt das Ziel eines Links wieder nicht',
    file: 'server.js',
    search: "  if (hit < 0 && fallback != null\n      && searchFold(oneLine(fallback)).includes(searchFold(b)))\n    return snippet(fallback, term);",
    replacement: "",
    expected: 'Der Trefferkontext an der Antwort'
  },
  {
    nr: '1158', name: 'Die Nummer steht in der schmalen Ansicht wieder vor den Aktionen',
    file: 'public/style.css',
    search: "  .cmt-head .acts { order: 2; }\n  .cmt-head .cmt-no { order: 3; }",
    replacement: "  .cmt-head .cmt-no { order: 2; }\n  .cmt-head .acts { order: 3; }",
    expected: 'Der Stift steht da, und das Loeschen steht abseits'
  },
  {
    nr: '1159', name: 'Die Nummer steht wieder vor der Aktionsgruppe',
    file: 'public/app.js',
    search: "          <span class=\"acts\"><button class=\"mact cite\" title=\"${esc(t('entry.quoteComment'))}\">${ICON_QUOTE}</button>${\n            mine ? `<button class=\"mact ed\" title=\"${esc(t('entry.edit'))}\">${ICON_PEN}</button>` : ''\n            }${manage ? `<button class=\"mact rm\" title=\"${esc(t('dialog.delete'))}\">${ICON_X}</button>` : ''}</span>\n          ${/* Ausserhalb von .acts: die Aktionen werden beim Bearbeiten\n               unsichtbar, die Nummer bleibt. */''}\n          <button class=\"link-btn cmt-no\"\n              title=\"${esc(t('entry.copyCommentLink'))}\">#${Number(order.get(c.id))}</button>",
    replacement: "          <button class=\"link-btn cmt-no\"\n              title=\"${esc(t('entry.copyCommentLink'))}\">#${Number(order.get(c.id))}</button>\n          <span class=\"acts\"><button class=\"mact cite\" title=\"${esc(t('entry.quoteComment'))}\">${ICON_QUOTE}</button>${\n            mine ? `<button class=\"mact ed\" title=\"${esc(t('entry.edit'))}\">${ICON_PEN}</button>` : ''\n            }${manage ? `<button class=\"mact rm\" title=\"${esc(t('dialog.delete'))}\">${ICON_X}</button>` : ''}</span>",
    expected: 'Der Stift steht da, und das Loeschen steht abseits'
  },
  {
    nr: '1160', name: 'Das Zitatzeichen ist wieder ein Satzzeichen',
    file: 'public/app.js',
    search: "${ICON_QUOTE}</button>",
    replacement: "„</button>",
    expected: 'Linkliste und Aktionszeichen'
  },
  {
    nr: '1161', name: 'Der Kasten ohne Nummer springt wieder nicht',
    file: 'public/app.js',
    search: "    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;",
    replacement: "    if (!row.number || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;",
    expected: 'Was der Betrieb an der Auszeichnung gefunden hat'
  },
  {
    nr: '1162', name: 'Der Klick entscheidet wieder nach der Adresse statt nach dem Eintrag',
    file: 'public/app.js',
    search: "    if (Number(open) !== Number(row.itemId)) return;",
    replacement: "    if (location.hash !== a.getAttribute('href')) return;",
    expected: 'Der Sprung zum Kommentar trifft und haelt'
  },
  {
    nr: '1163', name: 'Die Adresse zieht nach dem Sprung im eigenen Eintrag wieder nicht nach',
    file: 'public/app.js',
    search: "    const want = entryAddress(row.itemId, term, row.number ? row.id : 0);\n    if (location.hash !== want && typeof history !== 'undefined'\n        && typeof history.replaceState === 'function')\n      history.replaceState(null, '', want);",
    replacement: "",
    expected: 'Der Sprung zum Kommentar trifft und haelt'
  },
  {
    nr: '1164', name: 'Der Sprung im eigenen Eintrag gleitet wieder nicht',
    file: 'public/app.js',
    search: "  const smooth = soft && SOFT_OK();",
    replacement: "  const smooth = false;",
    expected: 'Der Sprung zum Kommentar trifft und haelt'
  },
  {
    nr: '1165', name: 'Der Halt nach dem Sprung hat wieder keine Frist',
    file: 'public/app.js',
    search: "const JUMP_HOLD_MS = 1600;",
    replacement: "const JUMP_HOLD_MS = 0;",
    expected: 'Der Sprung zum Kommentar trifft und haelt'
  },
  {
    nr: '1166', name: 'Ein laufender Ruf gilt wieder als Auskunft',
    file: 'public/app.js',
    search: "  const ask = keys.filter(k => !COMMENT_REFS_ASK.has(k)).slice(0, 400);",
    replacement: "  const ask = keys.slice(0, 400);",
    expected: 'Der Sprung zum Kommentar trifft und haelt'
  },
  {
    nr: '1167', name: 'Ein gescheiterter Ruf zeichnet wieder neu',
    file: 'public/app.js',
    search: "  return came;",
    replacement: "  return true;",
    expected: 'Der Sprung zum Kommentar trifft und haelt'
  },
  {
    nr: '1168', name: 'Die leuchtende Zeile steht wieder in jeder Zeichnung fuer sich',
    file: 'public/app.js',
    search: "  LIT_COMMENT = Number(id);",
    replacement: "",
    expected: 'Der Sprung zum Kommentar trifft und haelt'
  },
  /* ---- Die drei mitgelieferten Kriterien ---- */
  {
    nr: '1169', name: 'Die drei Kriterien entstehen wieder auf Deutsch',
    file: 'server.js',
    search: "    const base = languageBase();",
    replacement: "    const base = 'de';",
    expected: 'Frische Installation'
  },
  {
    nr: '1170', name: 'Die weiteren Sprachen bekommen wieder einen Namen daneben',
    file: 'server.js',
    search: "    insert.run(t(base, key), i, base);",
    replacement: "    const row = insert.run(t(base, key), i, base);\n    for (const code of LANGUAGE_CODES) if (code !== base) db.prepare('INSERT OR IGNORE INTO criterion_names (criterion_id, language, name) VALUES (?, ?, ?)').run(row.lastInsertRowid, code, t(code, key));",
    expected: 'Frische Installation'
  },
  {
    nr: '1171', name: 'Eingesetzt wird nicht mehr nur in eine leere Tabelle',
    file: 'server.js',
    search: "if (!DATABASE_INCOMPLETE &&\n    db.prepare('SELECT COUNT(*) n FROM rating_criteria').get().n === 0) {",
    replacement: "if (!DATABASE_INCOMPLETE) {",
    expected: 'Die mitgelieferten Kriterien an einer bestehenden Instanz'
  },
  /* ---- Die Marke am Verweis auf einen geloeschten Kommentar ---- */
  {
    nr: '1172', name: 'Ein gefragter Schluessel ohne Antwort wird wieder nichts',
    file: 'public/app.js',
    search: "      if (!COMMENT_REFS.has(k)) COMMENT_REFS.set(k, { key: k, gone: true });",
    replacement: "      if (!COMMENT_REFS.has(k)) COMMENT_REFS.set(k, null);",
    expected: 'Was der Betrieb an der Auszeichnung gefunden hat'
  },
  {
    nr: '1173', name: 'Die Marke des geloeschten Kommentars bekommt wieder ein Klickziel',
    file: 'public/app.js',
    search: "  if (row.gone) {\n    a.classList.add('gone');\n    a.appendChild(raiseHighlight(t('entry.refGone'), term));\n    return a;\n  }",
    replacement: "",
    expected: 'Was der Betrieb an der Auszeichnung gefunden hat'
  },
  /* ---- Das Kommentarfeld ---- */
  {
    nr: '1174', name: 'Das Kommentarfeld verlangt wieder eine Tastenkombination',
    file: 'public/languages/de.json',
    search: "\"entry.commentPlaceholder\": \"Kommentar schreiben …\"",
    replacement: "\"entry.commentPlaceholder\": \"Kommentar schreiben, Bilder mit Strg+V einfügen …\"",
    expected: 'Kein Bildschirmtext verlangt eine Tastenkombination'
  },
  /* ---- Die drei Indexe ---- */
  {
    nr: '1175', name: 'Der Index auf criterion_id faellt weg',
    file: 'db.js',
    search: "CREATE INDEX IF NOT EXISTS idx_ratings_criterion ON ratings(criterion_id, value, item_id);",
    replacement: "",
    expected: 'Die drei Indexe und der Abfrageplaner'
  },
  {
    nr: '1176', name: 'Der deckende Index der Dateiliste faellt weg',
    file: 'db.js',
    search: "tryIndex('idx_attachments_list', `CREATE INDEX IF NOT EXISTS idx_attachments_list",
    replacement: "tryIndex('idx_attachments_list', `SELECT 1 -- (",
    expected: 'Die drei Indexe und der Abfrageplaner'
  },
  {
    nr: '1177', name: 'Die Fassung der Kachel faellt aus der Spaltenliste des Index',
    file: 'db.js',
    search: "kind, duration, length(thumb))`);",
    replacement: "kind, duration)`);",
    expected: 'Die drei Indexe und der Abfrageplaner'
  },
  {
    /* `CREATE INDEX IF NOT EXISTS` fasst einen Index mit alter Spaltenliste nicht an. */
    nr: '1178', name: 'Ein Index mit alter Spaltenliste bleibt wieder stehen',
    file: 'db.js',
    search: "    if (there && indexWording(there.sql) !== indexWording(sql))\n      db.exec(`DROP INDEX ${name}`);",
    replacement: "",
    expected: 'Die drei Indexe und der Abfrageplaner'
  },
  /* ---- Das Verzeichnis der lesenden Routen ---- */
  {
    nr: '1179', name: 'Das Verzeichnis der lesenden Routen verliert eine Zeile',
    file: 'test/frame.js',
    search: "  ['/api/comment-refs',            'angemeldet',\n    'Titel und Stellung fuer die Marke am Verweis; dieselbe Schranke wie am Eintrag.'],",
    replacement: "",
    expected: 'Der Waechter ueber den Quelltext'
  },
  {
    nr: '1180', name: 'Eine Zeile des Verzeichnisses nennt die falsche Klemme',
    file: 'test/frame.js',
    search: "  ['/api/stats',                   'adminOnly',",
    replacement: "  ['/api/stats',                   'angemeldet',",
    expected: 'Der Waechter ueber den Quelltext'
  },
  /* ---- Die beiden abgelegten Woerter ---- */
  {
    nr: '1191', name: 'Der Sprachwaechter kennt die beiden Abschnittsnamen nicht mehr',
    file: 'test/source.js',
    search: "    ['Auffangnetz', 'Rueckfall'], ['Grundausstattung', 'Vorgabewerte']",
    replacement: "    ['Auffangnetz', 'Rueckfall']",
    expected: 'Der Sprachwaechter'
  },
  {
    nr: '1192', name: 'Der Abschnitt in db.js heisst wieder Auffangnetz',
    file: 'db.js',
    search: "/* ---- Rueckfall: Bestand ohne Benutzer ---- */",
    replacement: "/* ---- Auffangnetz: Bestand ohne Benutzer ---- */",
    expected: 'Der Sprachwaechter'
  },
  /* ---- Das Inhaltsverzeichnis der Anleitung ---- */
  {
    nr: '1189', name: 'Eine Sprungmarke der README zeigt auf nichts',
    file: 'README.md',
    search: "- [Konfiguration](#konfiguration)",
    replacement: "- [Konfiguration](#einstellungen-der-dateien)",
    expected: "Die Anleitung liegt in zwei Dateien \u2014 0.34.2"
  },
  {
    nr: '1190', name: 'Ein Abschnitt des Handbuchs fehlt im Inhaltsverzeichnis',
    file: 'manual-de.md',
    search: "- [Vokabular](#vokabular)\n",
    replacement: "",
    expected: "Die Anleitung liegt in zwei Dateien \u2014 0.34.2"
  },
  /* ---- Der Rest einer Nebenspur ---- */
  {
    nr: '1187', name: 'Der Aufraeumer fragt nicht mehr, wem ein Rest gehoert',
    file: 'test/frame.js',
    search: "    const run = Number((environment.find(z => z.startsWith('KRITERION_RUN=')) || '').slice(14));\n    if (run && run !== process.pid && alive(run)) continue;",
    replacement: "",
    expected: "Ein Rest gehoert dem Lauf, der ihn hinterlassen hat \u2014 0.38.5"
  },
  {
    nr: '1188', name: 'Die Laufnummer steht nicht mehr in der Umgebung',
    file: 'test/frame.js',
    search: "process.env.KRITERION_RUN = String(process.pid);",
    replacement: "",
    expected: "Ein Rest gehoert dem Lauf, der ihn hinterlassen hat \u2014 0.38.5"
  },
  /* ---- Die Zusage „die Instanz startet trotzdem" ---- */
  {
    /* db.prepare wirft bei fehlender Spalte; beim Laden haelt das die ganze Instanz unten. */
    nr: '1185', name: 'Ein Gesuch ueber rating_criteria wird wieder beim Laden vorbereitet',
    file: 'server.js',
    search: "const qCriterionBase = lateStatement('SELECT id, name, language FROM rating_criteria');",
    replacement: "const qCriterionBase = (() => { const s = db.prepare('SELECT id, name, language FROM rating_criteria'); return () => s; })();",
    expected: 'Der Hinweis auf einen unvollstaendigen Bestand — 0.33.0'
  },
  {
    nr: '1186', name: 'Der Start setzt die Kriterien wieder in eine unvollstaendige Datenbank',
    file: 'server.js',
    search: "if (!DATABASE_INCOMPLETE &&\n    db.prepare('SELECT COUNT(*) n FROM rating_criteria').get().n === 0) {",
    replacement: "if (db.prepare('SELECT COUNT(*) n FROM rating_criteria').get().n === 0) {",
    expected: 'Der Hinweis auf einen unvollstaendigen Bestand — 0.33.0'
  },
  /* ---- Die Zaehlzeile der Meldungstafel ---- */
  {
    nr: '1183', name: 'Die Bewertungen stehen wieder als Wort in der Zeile',
    file: 'public/app.js',
    search: "           b ? countMark('rating', '\u2605', b) : ''].filter(Boolean).join(' \u00b7 '),\n    text: [comments, markedWords, b ? `${b} ${vRating(b)}` : ''].filter(Boolean).join(' \u00b7 ')",
    replacement: "           b ? esc(`${b} ${vRating(b)}`) : ''].filter(Boolean).join(' \u00b7 '),\n    text: [comments, markedWords, b ? `${b} ${vRating(b)}` : ''].filter(Boolean).join(' \u00b7 ')",
    expected: 'Die Glocke in der Kopfzeile'
  },
  {
    nr: '1184', name: 'Der Ueberfahrtext der Zaehlzeile faellt weg',
    file: 'public/app.js',
    search: "      a.querySelector('.mcount').title = counts.text;",
    replacement: "",
    expected: 'Die Glocke in der Kopfzeile'
  },
  /* ---- Die Rechentabelle in der schmalen Ansicht ---- */
  {
    nr: '1182', name: 'Die erste Spalte der Rechentabelle darf nicht mehr umbrechen',
    file: 'public/style.css',
    search: "  .calc-row > span:first-child { min-width: 0; overflow-wrap: anywhere; }",
    replacement: "",
    expected: 'Die Rechnung hinter der Kopfzahl'
  },
  /* ---- Die Zeitstempel der Sitzungen ---- */
  {
    /* Feste Zeitstempel fallen mit der Zeit aus dem Fenster von dreissig Tagen. */
    nr: '1181', name: 'Die Sitzungen der Prueflage tragen wieder feste Zeitstempel',
    file: 'test/roundtrip.js',
    search: "    const sitz = [\n      ['cookie-ms-anna-1', 1, '-10 days', '-1 days'],\n      ['cookie-ms-anna-2', 1, '-12 days', '-2 days'],\n      ['cookie-ms-carla-1', 2, '-14 days', '-3 days'],\n      ['cookie-ms-carla-2', 2, '-16 days', '-4 days']\n    ];\n    for (const [t, u, c, l] of sitz)\n      d.prepare(`INSERT INTO sessions (token, user_id, created_at, last_seen)\n                 VALUES (?, ?, datetime('now', ?), datetime('now', ?))`)\n        .run(t, u, c, l);",
    replacement: "    const sitz = [\n      ['cookie-ms-anna-1', 1, '2026-08-20 08:00:00', '2026-08-24 07:30:00'],\n      ['cookie-ms-anna-2', 1, '2026-08-18 19:15:00', '2026-08-23 21:00:00'],\n      ['cookie-ms-carla-1', 2, '2026-08-19 09:00:00', '2026-08-24 06:00:00'],\n      ['cookie-ms-carla-2', 2, '2026-08-01 11:00:00', '2026-08-22 09:45:00']\n    ];\n    for (const [t, u, c, l] of sitz)\n      d.prepare('INSERT INTO sessions (token, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)')\n        .run(t, u, c, l);",
    expected: 'Meine Sitzungen: nur die eigenen'
  },
  /* ---- Die Lizenz ---- */
  {
    nr: '1193', name: 'LICENSE nennt die Lizenz nicht mehr beim Namen',
    file: 'LICENSE',
    search: "MIT License",
    replacement: "Lizenzbestimmungen",
    expected: 'Die Lizenz geht mit hinaus'
  },
  {
    nr: '1194', name: 'Der Haftungsausschluss faellt aus der LICENSE',
    file: 'LICENSE',
    search: "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR",
    replacement: "THE SOFTWARE IS PROVIDED AS IS, EXPRESS OR",
    expected: 'Die Lizenz geht mit hinaus'
  },
  {
    nr: '1195', name: 'package.json traegt kein Lizenzfeld mehr',
    file: 'package.json',
    search: "  \"license\": \"MIT\",\n",
    replacement: "",
    expected: 'Die Lizenz geht mit hinaus'
  },
  {
    nr: '1196', name: 'Das Lizenzabzeichen faellt aus der README',
    file: 'README.md',
    search: "![Lizenz](https://img.shields.io/badge/Lizenz-MIT-informational)\n",
    replacement: "",
    expected: 'Die Lizenz geht mit hinaus'
  },
  {
    nr: '1197', name: 'Die README nennt die LGPL-Pakete nicht mehr',
    file: 'README.md',
    search: "**Die zwei LGPL-Pakete sind `@img/sharp-libvips-linux-x64` und\n`@img/sharp-libvips-linuxmusl-x64`**",
    replacement: "**Die zwei LGPL-Pakete gehoeren zur Bildbibliothek**",
    expected: 'Die Lizenz geht mit hinaus'
  },
  {
    nr: '1198', name: 'Der Transparenzvermerk faellt aus der README',
    file: 'README.md',
    search: "## Wie dieser Code entstanden ist",
    replacement: "## Woher der Code kommt",
    expected: 'Die Lizenz geht mit hinaus'
  },
  /* ---- Die Spaltenfolge ---- */
  {
    nr: '1199', name: 'Das Schema faellt auf die alte Folge zurueck',
    file: 'db.js',
    search: "  filename TEXT NOT NULL DEFAULT 'image.jpg',\n  thumb BLOB,\n"
      + "  sort_order INTEGER NOT NULL DEFAULT 0,\n"
      + "  created_at TEXT NOT NULL DEFAULT (datetime('now')),\n"
      + "  -- data am Ende: was dahinter steht, ist nur ueber die Overflow-Kette zu lesen.\n"
      + "  data BLOB NOT NULL\n);",
    replacement: "  filename TEXT NOT NULL DEFAULT 'image.jpg',\n  data BLOB NOT NULL,\n"
      + "  thumb BLOB,\n  sort_order INTEGER NOT NULL DEFAULT 0,\n"
      + "  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);",
    expected: 'Die Spaltenfolge: data steht am Ende'
  },
  /* ---- Export und Import ohne den Arbeitsspeicher ---- */
  {
    nr: '1200', name: 'Der Export schreibt den Schluss nicht mehr',
    file: 'server.js',
    search: "  res.end(']}');",
    replacement: '  res.end();',
    expected: 'Der Export schreibt stueckweise'
  },
  {
    nr: '1201', name: 'Der Import laesst seine Datei liegen',
    file: 'server.js',
    search: '  } finally {\n    try { fs.rmSync(req.file.path, { force: true }); }\n'
      + '    catch (e) { logWarn(`Import: ${req.file.path} stayed behind -- ${e.message}`); }\n  }\n});',
    replacement: '  }\n});',
    expected: 'Der Export schreibt stueckweise'
  },
  {
    nr: '1202', name: 'Der Export beachtet den Rueckstau nicht mehr',
    file: 'server.js',
    search: '  const push = async (text) => { if (!res.write(text)) await untilDrained(res); };',
    replacement: '  const push = async (text) => { res.write(text); };',
    expected: 'Der Export schreibt stueckweise'
  },
  {
    nr: '1203', name: 'Die blobfreie Abfrage des Papierkorbs liest wieder die Bytes',
    file: 'server.js',
    search: '  `SELECT id, mime_type, focus_x, focus_y, zoom, kind, duration,',
    replacement: '  `SELECT id, data, mime_type, focus_x, focus_y, zoom, kind, duration,',
    expected: 'Der Waechter ueber den Quelltext'
  },
  /* ---- Videos in Kommentaren, Download, Hinweisfeld, Leiste, Cookie, Backup, Grenzen ---- */
  {
    nr: '1204', name: 'Eine feste Wartezeit kommt in ein Modul zurueck',
    file: 'test/ui_translator.js',
    search: "    const spW = spDom.w;\n",
    replacement: "    await new Promise(r => setTimeout(r, 60));\n    const spW = spDom.w;\n",
    expected: 'Die Wartezeiten des Pruefstands — 0.35.0'
  },
  {
    nr: '1205', name: 'Die Route der Kommentarvideos kennt keinen Range mehr',
    file: 'server.js',
    search: '  sendRanged(req, res, v.bytes);\n});',
    replacement: '  res.send(v.bytes);\n});',
    expected: 'Kommentarvideos: Auslieferung mit Range'
  },
  {
    nr: '1206', name: 'Der Import kodiert ein Kommentarvideo als Bild',
    file: 'server.js',
    search: "                      duration: durationValue(v.duration), thumb: still, data });",
    replacement: "                      duration: durationValue(v.duration), thumb: still,\n"
      + "                      data: (await encodeCommentImage(still)).big });",
    expected: 'Kommentarvideos: Rundlauf mit Format 19'
  },
  {
    nr: '1207', name: 'Der Papierkorb kopiert das Standbild nicht',
    file: 'server.js',
    search: "    'INSERT INTO trash_bytes (trash_id, part, data) SELECT ?, ?, thumb FROM comment_videos WHERE id = ?'),",
    replacement: "    'INSERT INTO trash_bytes (trash_id, part, data) SELECT ?, ?, data FROM comment_videos WHERE id = ?'),",
    expected: 'Kommentarvideos: der Papierkorb'
  },
  {
    nr: '1208', name: 'Der Link in der Bildansicht verliert download',
    file: 'public/app.js',
    search: '        <a class="lb-btn download" download title=',
    replacement: '        <a class="lb-btn download" title=',
    expected: 'Download je Foto und Video in der Bildansicht'
  },
  {
    nr: '1209', name: 'Die Verschiebung des Hinweisfelds faellt weg',
    file: 'public/app.js',
    search: '  return Math.min(axis - width / 2, Math.max(width / 2, point));',
    replacement: '  return point;',
    expected: 'Das Hinweisfeld bleibt in der Zeitleiste'
  },
  {
    nr: '1210', name: 'Die Formatierleiste wird nicht mehr angedockt',
    file: 'public/app.js',
    search: "  if (box.nextElementSibling !== field) wrap.insertBefore(box, field);\n  box.classList.add('docked');",
    replacement: "  return markupMenuShow(field.getBoundingClientRect());",
    expected: 'Die Formatierleiste steht am Feld'
  },
  {
    nr: '1211', name: 'Das Cookie unter dem anderen Namen bleibt stehen',
    file: 'server.js',
    search: '  if (stale) res.append(\'Set-Cookie\', stale);\n',
    replacement: '',
    expected: 'Das Cookie unter dem anderen Namen wird geloescht'
  },
  {
    nr: '1212', name: 'Ein Wert in de.json sagt wieder Sicherung',
    file: 'public/languages/de.json',
    search: '  "card.lastBackup": "Letztes Backup",',
    replacement: '  "card.lastBackup": "Letzte Sicherung",',
    expected: 'Das Wort heisst Backup'
  },
  {
    nr: '1213', name: 'Die .env.example bekommt wieder einen Abschnitt ohne Einstellung',
    file: '.env.example',
    search: '# PUBLIC_ADDRESS=https://kriterion.beispiel.de\n',
    replacement: '# PUBLIC_ADDRESS=https://kriterion.beispiel.de\n\n'
      + '# ' + '-'.repeat(75) + '\n# NICHT IN DIESER DATEI\n# Mailzugang: in der Oberflaeche.\n',
    expected: 'Die Beispieldateien'
  },
  {
    nr: '1214', name: 'Die Compose-Vorlage haengt wieder kriterion-sicherung ein',
    file: 'docker-compose.example.yml',
    search: '      - ./kriterion-backup:/app/backup\n',
    replacement: '      - ./kriterion-sicherung:/app/backup\n',
    expected: 'Englische Bezeichnungen in neuen Installationen'
  },
  {
    nr: '1215', name: 'Der Server nimmt eine Grenze ueber der Obergrenze an',
    file: 'server.js',
    search: '          if (!Number.isInteger(n) || n < g.min || n > g.max)\n            refuse(\'server.uploadLimitRange\'',
    replacement: '          if (!Number.isInteger(n) || n < g.min)\n            refuse(\'server.uploadLimitRange\'',
    expected: 'Die Grenzen beim Hochladen'
  },
  {
    nr: '1216', name: 'Die Pruefung je Eintrag beim Hochladen faellt weg',
    file: 'server.js',
    search: '  const z = qPartSizeOf().get(itemId);\n  if (!z) return false;',
    replacement: '  const z = qPartSizeOf().get(itemId);\n  return false;',
    expected: 'Die Grenze je Eintrag'
  },
  {
    nr: '1217', name: 'Eine Antwort 413 ohne JSON zeigt wieder den Statuscode',
    file: 'public/app.js',
    search: "    else if (res.status === 413) m = t('error.proxyTooLarge');\n",
    replacement: '',
    expected: 'Die Antwort 413 vom Reverse Proxy'
  },
  {
    nr: '1218', name: 'tH() zeigt die Sterne statt Fettdruck',
    file: 'public/app.js',
    search: "  const sentence = languageSentence(key, values).replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');",
    replacement: "  const sentence = languageSentence(key, values);",
    expected: 'Was Export, Import und Backup enthalten'
  },
  {
    nr: '1219', name: 'Ein Satz wird wieder aus Schluesseln zusammengesetzt',
    file: 'public/app.js',
    search: "${tMarks('card.withoutKeyFrom', { word: '<code>.env</code>' })}",
    replacement: "${tMarks('card.withoutKeyFrom', { word: `<code>.env</code> ${tH('card.backupNowHint')}` })}",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '1220', name: 'Ein Text des Servers traegt wieder `**`',
    file: 'public/languages/de.json',
    search: "\"mail.confirm.subject\": \"",
    replacement: "\"mail.confirm.subject\": \"**Kriterion** ",
    expected: 'Deutsch sitzt — 0.31.1'
  },
  {
    nr: '1221', name: 'Die Probe des Treibers steht wieder hinter dem Aufraeumen',
    file: 'test/frame.js',
    search: "  if (process.env.TESTBENCH_DIE_AFTER_REPORT === name) process.exit(9);\n  if (kind) { try { kind.kill(); } catch {} }\n  for (const l of CASES) { try { l.kind.kill(); } catch {} }\n",
    replacement: "  if (kind) { try { kind.kill(); } catch {} }\n  for (const l of CASES) { try { l.kind.kill(); } catch {} }\n  if (process.env.TESTBENCH_DIE_AFTER_REPORT === name) process.exit(9);\n",
    expected: 'Der Treiber sieht den Rueckgabewert — 0.34.4'
  },
];

/* ---- Spuren und Versatz ---- */
/* OFFSET_LEVEL steht nur in test/frame.js; der Treiber liest es von dort. */
function offsetLevel() {
  const t = fs.readFileSync(path.join(__dirname, 'test', 'frame.js'), 'utf8');
  const m = t.match(/^const OFFSET_LEVEL = (\d+);$/m);
  if (!m) {
    console.error('In test/frame.js steht keine Zeile "const OFFSET_LEVEL = <Zahl>;".');
    console.error('Ohne sie faehrt der Treiber keine Nebenspuren.');
    process.exit(1);
  }
  return Number(m[1]);
}

const MAX_TRACES = 4;

/* ---- Kopie und Aufraeumen ---- */

function makeCopy(target) {
  fs.mkdirSync(target, { recursive: true });
  const tar = spawnSync('sh', ['-c',
    `git -C ${JSON.stringify(__dirname)} archive HEAD | tar -x -C ${JSON.stringify(target)}`],
    { encoding: 'utf8' });
  if (tar.status !== 0)
    throw new Error(`git archive gescheitert: ${(tar.stderr || '').trim()}`);
  /* Verknuepft statt kopiert: native Anteile, einige hundert MB je Kopie,
     und kein Rueckbau fasst node_modules an. */
  fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(target, 'node_modules'), 'dir');
}

function processesUnder(dirPath) {
  const outcome = [];
  let entries;
  try { entries = fs.readdirSync('/proc'); } catch { return outcome; }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    let cwd;
    try { cwd = fs.readlinkSync(`/proc/${e}/cwd`); } catch { continue; }
    if (cwd === dirPath || cwd.startsWith(dirPath + path.sep)) outcome.push(Number(e));
  }
  return outcome;
}

/* ---- Fremde Server vor dem Lauf ---- */
function foreignServer() {
  const outcome = [];
  let entries;
  try { entries = fs.readdirSync('/proc'); } catch { return outcome; }
  for (const e of entries) {
    if (!/^\d+$/.test(e) || Number(e) === process.pid) continue;
    let row;
    try { row = fs.readFileSync(`/proc/${e}/cmdline`, 'utf8'); } catch { continue; }
    const parts = row.split('\0').filter(Boolean);
    /* Nach dem Skript suchen; hinter ihm koennen weitere Argumente stehen. */
    const script = parts.find(t => /(^|\/)(server\.js|testbench\.js|test\/[a-z0-9_]+\.js)$/.test(t));
    if (!script) continue;
    /* Der Port aus der Umgebung zeigt, welches Fenster belegt ist. */
    let port = '';
    try {
      port = (fs.readFileSync(`/proc/${e}/environ`, 'utf8').split('\0')
        .find(z => z.startsWith('PORT=')) || '').slice(5);
    } catch { /* ein fremder Prozess muss seine Umgebung nicht hergeben */ }
    let wo = '';
    try { wo = fs.readlinkSync(`/proc/${e}/cwd`); } catch { /* ebenso */ }
    outcome.push({ pid: Number(e), port, wo, script: path.basename(script) });
  }
  return outcome;
}

/* ---- Horchende Ports im Fenster des Prueflaufs ---- */
function portSpan() {
  const t = fs.readFileSync(path.join(__dirname, 'test', 'frame.js'), 'utf8');
  const from = t.match(/^const PORT_SPAN_FROM = (\d+);$/m);
  const to = t.match(/^const PORT_SPAN_TO = (\d+);$/m);
  if (!from || !to) {
    console.error('In test/frame.js fehlt PORT_SPAN_FROM oder PORT_SPAN_TO.');
    console.error('Ohne die Spanne kann die Gegenprobe die Ports nicht ansehen.');
    process.exit(1);
  }
  return { from: Number(from[1]), to: Number(to[1]) };
}

function listeningPorts() {
  const outcome = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let rows;
    try { rows = fs.readFileSync(file, 'utf8').split('\n').slice(1); } catch { continue; }
    for (const row of rows) {
      const piece = row.trim().split(/\s+/);
      if (piece.length < 4 || piece[3] !== '0A') continue;
      const port = parseInt((piece[1].split(':')[1] || ''), 16);
      if (port) outcome.add(port);
    }
  }
  return outcome;
}

/* Ports im Fenster, die keinem erkannten Prozess gehoeren. */
function foreignPort(known = []) {
  const span = portSpan();
  const taken = new Set(known.map(Number).filter(Boolean));
  return [...listeningPorts()]
    .filter(p => p >= span.from && p <= span.to && !taken.has(p))
    .sort((a, b) => a - b);
}

function cleanUp(dirPath) {
  const first = processesUnder(dirPath);
  for (const pid of first) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  // SIGKILL wirkt nicht sofort; der Kern braucht einen Augenblick.
  const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const to = Date.now() + 5000;
  let left = processesUnder(dirPath);
  while (left.length && Date.now() < to) { wait(100); left = processesUnder(dirPath); }
  fs.rmSync(dirPath, { recursive: true, force: true });
  return { cleared: first.length, left: left.length };
}

/* ---- Den Rueckbau anbringen ---- */

function applyRegression(copy, r) {
  const file = path.join(copy, r.file);
  if (!fs.existsSync(file)) throw new Error(`${r.file} gibt es in der Kopie nicht.`);
  /* r.copy: eine entfernte Datei wieder hinlegen. */
  if (r.copy) {
    const target = path.join(copy, r.copy);
    if (fs.existsSync(target))
      throw new Error(`${r.copy} liegt schon da -- der Rueckbau haette nichts zu tun.`);
    fs.copyFileSync(file, target);
    return;
  }
  const text = fs.readFileSync(file, 'utf8');
  const parts = text.split(r.search);
  if (parts.length !== 2)
    throw new Error(`Der gesuchte Text steht ${parts.length - 1}-mal in ${r.file}, erwartet ist genau einmal.`);
  fs.writeFileSync(file, parts.join(r.replacement));
}

/* ---- Den Prueflauf lesen ---- */
/* Die Selbstprobe, die bei jedem gefahrenen Rueckbau rot wird. */
const SELF_CHECK = 'Jeder Suchtext kommt in seiner Datei genau einmal vor';

function readRun(output) {
  const red = [];
  let group = '(vor der ersten Gruppe)';
  for (const row of output.split('\n')) {
    // ─* statt ─+: eine Ueberschrift, die die Zeile fuellt, traegt keinen Strich.
    const g = row.match(/^── (.+?) ─*\s*$/);
    if (g) { group = g[1]; continue; }
    const p = row.match(/^ {2}✗ (.+)$/);
    if (p) red.push({ group, name: p[1] });
  }
  const end = output.match(/^\s+(\d+) von (\d+) Pruefungen bestanden/m);
  const teardown = output.match(/^Prueflauf abgebrochen: (.+)$/m);
  return {
    red,
    byContentRed: red.filter(t => !(t.group === 'Die Gegenproben greifen' &&
      t.name === SELF_CHECK)),
    ranThrough: Boolean(end),
    passedCount: end ? Number(end[1]) : null,
    total: end ? Number(end[2]) : null,
    teardown: teardown ? teardown[1] : null,
    /* Damit ein abgerissener Lauf zeigt, warum er abriss. */
    tail: output.split('\n').map(z => z.trimEnd()).filter(z => z).slice(-20)
  };
}

/* ---- Eine Gegenprobe ---- */

function drive(r, trace, level) {
  return new Promise((done) => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), `kriterion-gegenprobe-${r.nr}-`));
    const startedAt = Date.now();
    const endRecord = (result) => {
      let cleanup = { cleared: 0, left: 0 };
      try { cleanup = cleanUp(copy); } catch (e) { result.cleanupError = e.message; }
      done({ ...r, trace, seconds: Math.round((Date.now() - startedAt) / 1000),
               ...cleanup, ...result });
    };
    try {
      makeCopy(copy);
      applyRegression(copy, r);
    } catch (e) { return endRecord({ error: e.message }); }
    const kind = spawn(process.execPath, ['testbench.js'], {
      cwd: copy,
      env: { ...process.env, PORT_OFFSET: String(trace * level) }
    });
    let output = '';
    kind.stdout.on('data', d => { output += d; });
    kind.stderr.on('data', d => { output += d; });
    const LIMIT_MS = 12 * 60 * 1000;
    const clock = setTimeout(() => { try { kind.kill('SIGKILL'); } catch {} }, LIMIT_MS);
    kind.on('exit', (code, signal) => {
      const overdue = Date.now() - startedAt >= LIMIT_MS;
      clearTimeout(clock);
      endRecord({ code, signal, overdue, ...readRun(output) });
    });
  });
}

/* ---- Die Spuren ---- */

async function runAll(list, traces, level) {
  const results = new Array(list.length);
  let nextIndex = 0;
  const trace = async (nr) => {
    for (;;) {
      const i = nextIndex++;
      if (i >= list.length) return;
      const r = list[i];
      console.log(`  [Spur ${nr}] ${r.nr} — ${r.name}`);
      results[i] = await drive(r, nr, level);
      const e = results[i];
      /* Ein abgerissener Lauf zaehlt nicht als stumm. */
      const word = e.error ? 'FEHLER'
        : e.overdue ? 'ZEITGRENZE'
        : !e.ranThrough ? 'ABGERISSEN'
        : e.byContentRed?.length ? `${e.byContentRed.length} rot` : 'STUMM';
      console.log(`  [Spur ${nr}] ${r.nr} fertig nach ${e.seconds}s — ${word}`);
    }
  };
  // Spur 0 gibt es auch: sie faehrt ohne Versatz, wie ein gewoehnlicher Lauf.
  await Promise.all(Array.from({ length: traces }, (_, k) => trace(k)));
  return results;
}

/* ---- Die Tabelle ---- */
function writeTable(results) {
  console.log('\n| # | Rückbau | Namentlich rot |');
  console.log('|---|---|---|');
  for (const e of results) {
    let right;
    if (e.error) right = `**RÜCKBAU GESCHEITERT** — ${e.error}`;
    else if (e.overdue)
      right = '**LAUF AN DER ZEITGRENZE ABGEBROCHEN** — er hängt, statt rot zu werden';
    else if (!e.ranThrough)
      right = `**LAUF ABGERISSEN** — ${e.teardown || `Code ${e.code}`}` +
               (e.red.length ? ` (davor ${e.red.length} rot)` : '');
    else if (!e.byContentRed?.length) right = '**STUMM — das ist ein FUND**';
    else if (e.red.length <= 3)
      right = e.red.map(p => `„${p.name}"`).join(', ');
    else {
      const groups = [...new Set(e.red.map(p => p.group))];
      right = `${e.red.length} Prüfungen, darunter „${e.red[0].name}"` +
               (groups.length === 1 ? ` (Gruppe „${groups[0]}")`
                                     : ` (${groups.length} Gruppen)`);
    }
    console.log(`| ${e.nr} | ${e.name} | ${right} |`);
  }

  console.log('\n### Im Einzelnen\n');
  for (const e of results) {
    console.log(`**${e.nr} — ${e.name}** (${e.file}, Spur ${e.trace}, ${e.seconds}s)`);
    if (e.error) { console.log(`  RÜCKBAU GESCHEITERT: ${e.error}\n`); continue; }
    if (!e.ranThrough) {
      console.log(`  LAUF ABGERISSEN: ${e.teardown || `Rückgabewert ${e.code}`}`);
      for (const z of e.tail || []) console.log(`     │ ${z}`);
    } else
      console.log(`  ${e.passedCount} von ${e.total} bestanden, erwartet in „${e.expected}"`);
    if (!e.byContentRed?.length && e.ranThrough)
      console.log('  STUMM — kein einziger roter Punkt. Das ist ein FUND und gehört untersucht.');
    let last = null;
    for (const p of e.red) {
      if (p.group !== last) { console.log(`  ── ${p.group}`); last = p.group; }
      console.log(`     ✗ ${p.name}`);
    }
    if (e.left) console.log(`  ACHTUNG: ${e.left} Prozess(e) haben das Aufräumen überlebt.`);
    if (e.cleanupError) console.log(`  ACHTUNG: Aufräumen gescheitert — ${e.cleanupError}`);
    console.log('');
  }

  const silent = results.filter(e => e.ranThrough && !e.byContentRed?.length);
  const broken = results.filter(e => e.error || !e.ranThrough);
  const corpses = results.filter(e => e.left || e.cleanupError);
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  ${results.length} Gegenproben gefahren.`);
  console.log(`  ${silent.length} STUMM${silent.length ? ': ' + silent.map(e => e.nr).join(', ') : ''}` +
              (silent.length ? '  — jede davon ist ein Fund.' : ''));
  if (broken.length)
    console.log(`  ${broken.length} nicht auswertbar: ${broken.map(e => e.nr).join(', ')}`);
  if (corpses.length)
    console.log(`  ${corpses.length} mit übriggebliebenen Prozessen: ${corpses.map(e => e.nr).join(', ')}`);
  console.log('══════════════════════════════════════════════════════════════\n');
  return (silent.length || broken.length || corpses.length) ? 1 : 0;
}

/* ---- Bedienung ---- */
/* Ein Argument aus Ziffern gilt nur als Nummer, nicht als Teil eines Namens. */
const matchesRegression = (r, argument) => {
  const a = String(argument).toLowerCase();
  if (/^\d+$/.test(a)) return r.nr.toLowerCase() === a;
  return r.nr.toLowerCase() === a || r.name.toLowerCase().includes(a);
};

/* Exportiert fuer test/selfcheck.js: readRun an gestellten Ausgaben,
   foreignServer am laufenden Prueflauf selbst. */
module.exports = { REGRESSIONS, readRun, matchesRegression, writeTable,
                   foreignServer, foreignPort, listeningPorts, portSpan };
if (require.main !== module) return;

(async function main() {
  const argumente = process.argv.slice(2);
  let traces = 2;
  if (argumente.length && /^\d+$/.test(argumente[0])) traces = Number(argumente.shift());
  if (traces < 1 || traces > MAX_TRACES) {
    console.error(`Zwischen 1 und ${MAX_TRACES} Nebenspuren. Mehr Spuren heissen mehr ` +
                  `gleichzeitige Server, und der Rechner hat nicht beliebig viele Kerne.`);
    process.exit(1);
  }
  const list = argumente.length
    ? REGRESSIONS.filter(r => argumente.some(a => matchesRegression(r, a)))
    : REGRESSIONS;
  /* Ein Filter ohne Treffer bricht ab; sonst meldete ein Tippfehler wortlos Erfolg. */
  if (!list.length) {
    console.error(`Kein Rueckbau passt auf ${argumente.join(', ')}.`);
    console.error('Vorhanden: ' + REGRESSIONS.map(r => r.nr).join(', '));
    process.exit(1);
  }
  const foreign = foreignServer();
  const busy = foreignPort(foreign.map(f => f.port));
  if (foreign.length || busy.length) {
    console.error(`\nIm Portfenster des Prueflaufs ist etwas los -- ` +
                  `${foreign.length} fremde(r) Server, ${busy.length} weitere(r) ` +
                  `horchende(r) Port (Stolperstein 139).`);
    for (const f of foreign)
      console.error(`  PID ${f.pid}  ${f.script}${f.port ? `  PORT=${f.port}` : ''}` +
                    `${f.wo ? `  in ${f.wo}` : ''}`);
    /* Ohne PID: /proc/net/tcp nennt je Socket nur die Inode, die Zuordnung
       verlangte einen Gang durch jedes /proc/<pid>/fd. */
    for (const p of busy)
      console.error(`  PORT ${p}  horcht -- sein Befehl verraet ihn nicht ` +
                    `(z. B. node -e). Finden:  ss -lptn 'sport = :${p}'`);
    console.error('\nErst beenden, dann fahren.' +
                  (foreign.length ? '  kill -9 ' + foreign.map(f => f.pid).join(' ') : ''));
    process.exit(1);
  }
  const level = offsetLevel();
  console.log(`\nGegenproben: ${list.length} Rückbauten, ${traces} Nebenspur(en), ` +
              `Versatz ${level} je Spur.`);
  console.log('Jede läuft in einer eigenen Kopie aus `git archive HEAD`; ' +
              'der Arbeitsbaum wird nicht angefasst.\n');
  const results = await runAll(list, traces, level);
  process.exit(writeTable(results));
})().catch(e => {
  console.error('\nGegenproben abgebrochen:', e.message);
  process.exit(1);
});
