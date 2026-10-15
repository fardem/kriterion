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
    search: "{ oldPassword: e.password, username: name, email: address }",
    replacement: "{ oldPassword: e.password, username: name }",
    expected: 'Die eigene Adresse in der Karte „Mein Account“'
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
    search: "  if (!mailTestState(raw)) return { ok: false, key: self ? 'server.noTestMailSelf' : 'server.noTestMail' };\n  if (!PUBLIC.address)",
    replacement: "  if (!mailTestState(raw)) return { ok: false, key: self ? 'server.noTestMailSelf' : 'server.noTestMail' };\n  if (false)",
    expected: 'Die Selbstanmeldung: der Schalter braucht drei Dinge'
  },
  {
    nr: '46', name: 'Ausschalten wird an dieselbe Bedingung gehaengt wie Einschalten',
    file: 'server.js',
    search: "  if (an) {\n    const b = deliveryReady(isOwner(req));",
    replacement: "  if (true) {\n    const b = deliveryReady(isOwner(req));",
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
    search: "  try { ({ created, token } = auth.approveRequest(a.id, req.user.id)); }",
    replacement: "  try { ({ created, token } = auth.approveRequest(a.id, req.user.id)); if ((req.body || {}).role) auth.setRole(created.id, req.body.role, req.user.id); }",
    expected: 'Die Selbstanmeldung: die Rolle ist immer user'
  },
  {
    nr: '54', name: 'Die Zeile bleibt nach der Freischaltung stehen',
    file: 'auth.js',
    search: "    removeRequest(a.id);\n    return { created, token, continued: Boolean(half) };",
    replacement: "    return { created, token, continued: Boolean(half) };",
    expected: 'Die Selbstanmeldung: die Freischaltung'
  },
  {
    nr: '55', name: 'Die Freischaltung erzeugt keinen Token',
    file: 'auth.js',
    search: "    const token = createToken(created.id, 'invite', actor);",
    replacement: "    const token = { plain: 'x'.repeat(64), purpose: 'invite', days: 7, id: created.id, username: created.username };",
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
    replacement: "  const id = Number((req.body || {}).id) || auth.useLoginTicket(ticket);",
    expected: 'Der zweite Faktor: ohne Code kommt niemand herein'
  },
  /* ---- Der zweite Faktor: die Bremse ---- */
  {
    nr: '97', name: 'Die Bremse fehlt am zweiten Schritt',
    file: 'server.js',
    search: "  const throttle = auth.checkThrottle(ip, null);\n  if (throttle.blocked) {\n    return throttled(req, res, throttle);\n  }\n  if (throttle.delayMs) await new Promise(r => setTimeout(r, throttle.delayMs));\n  const id = auth.useLoginTicket(ticket);",
    replacement: "  const id = auth.useLoginTicket(ticket);",
    expected: 'Der zweite Faktor: die Anmeldebremse greift am zweiten Schritt'
  },
  {
    nr: '123', name: 'Die Bremse steht wieder HINTER dem Ausweis',
    file: 'server.js',
    search: "  const throttle = auth.checkThrottle(ip, null);\n  if (throttle.blocked) {\n    return throttled(req, res, throttle);\n  }\n  if (throttle.delayMs) await new Promise(r => setTimeout(r, throttle.delayMs));\n  const id = auth.useLoginTicket(ticket);\n  if (!id) {\n    auth.noteFailure(ip, null);\n    return res.status(401).json({ error: t(localeOf(req), 'server.sessionExpired')});\n  }",
    replacement: "  const id = auth.useLoginTicket(ticket);\n  if (!id) {\n    auth.noteFailure(ip, null);\n    return res.status(401).json({ error: t(localeOf(req), 'server.sessionExpired')});\n  }\n  const throttle = auth.checkThrottle(ip, null);\n  if (throttle.blocked) {\n    return throttled(req, res, throttle);\n  }\n  if (throttle.delayMs) await new Promise(r => setTimeout(r, throttle.delayMs));",
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
    search: "  if (!await ownPasswordMatches(req, res, password)) return;\n  if (!ownCodeMatches(req, res, code)) return;\n  auth.turnTwoFactorOff(req.user.id, req.user.id);",
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
    file: 'schema.js',
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
    search: "        takeVocabulary((await api('PUT', '/api/settings', { language: code })));",
    replacement: "        await api('PUT', '/api/settings', { language: code });",
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
    search: "const titleWords = (raw) => String(raw || '').toLocaleLowerCase(LOCALE)",
    replacement: "const titleWords = (raw) => String(raw || '')",
    expected: 'Doppelte Eintraege beim Anlegen'
  },
  {
    nr: '151', name: 'Der Hinweis greift erst ab acht Zeichen',
    file: 'public/app.js',
    search: "const SIMILAR_WORD = 4, SIMILAR_START = 5;",
    replacement: "const SIMILAR_WORD = 8, SIMILAR_START = 5;",
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
    search: "    exportPhotoBytes += z.o;",
    replacement: "    exportPhotoBytes += z.o + z.n * 1000;",
    expected: 'Audio bei den Fotos: Zaehlung'
  },
  {
    nr: '174', name: 'Der Warnwert liegt auf der Grenze statt darunter',
    file: 'server.js',
    search: 'const EXCHANGE_WARN = 300 * 1024 * 1024;',
    replacement: 'const EXCHANGE_WARN = 483183799;',
    expected: 'Videos am Fotoplatz'
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
    nr: '185', name: 'Ein Eintrag ueber der Teilgroesse teilt sich einen Teil',
    file: 'server.js',
    search: "    if (!open || open.bytes + b > targetSize) {",
    replacement: '    if (!open || (open.bytes + b > targetSize && b <= targetSize)) {',
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
    search: "  const r5 = r4;\n  const viewsGroup = secondLabel(r5, t('list.views')).parentNode;",
    replacement: "  const r5 = row(t('list.views'));\n  const viewsGroup = r5;",
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
    file: 'schema.js',
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
    search: "const EXCHANGE_FORMAT = 23;",
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
    search: "    const who = item.rejectedAuthor && multipleUsers() ? authorName(item.rejectedAuthor) : '';",
    replacement: "    const who = '';",
    expected: 'Die Aussage an der Marke — 0.14.0'
  },
  {
    nr: '247', name: 'Der Name steht auch bei einem einzigen Zugang da',
    file: 'public/app.js',
    search: "    const who = item.rejectedAuthor && multipleUsers() ?",
    replacement: "    const who = item.rejectedAuthor ?",
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
    search: "  secondLabel(r1, t('list.rejection')).parentNode.appendChild(",
    replacement: "  r1.appendChild(",
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
    search: "      a.href = entryAddress(it.id, '', it.first);\n      a.dataset.mid = String(it.id);",
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
    search: "    if (!await confirmBox(t('entry.deleteWordAsk', { word: word }), t('entry.deleteHint', { word: word }), t('dialog.delete'), 'danger')) return false;",
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
    search: "    .sort((a, b) => (b.fresh - a.fresh) || String(a.title).localeCompare(String(b.title), LOCALE));",
    replacement: "    .sort((a, b) => ((state.all.find(i => i.id === b.id)?.newComments || 0) - (state.all.find(i => i.id === a.id)?.newComments || 0)) || String(a.title).localeCompare(String(b.title), LOCALE));",
    expected: 'Die Glocke in der Kopfzeile'
  },

  /* ---- Die Glocke ersetzt die Pille ---- */
  {
    nr: '320', name: 'Die Tafel sagt nicht mehr, von wem etwas kommt',
    file: 'public/app.js',
    search: "      a.querySelector('.bell-from').textContent = it.from;",
    replacement: "      a.querySelector('.bell-from').textContent = '';",
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
    search: "        ${setting('', tH('card.resetMailHint'), SIGNUP ?",
    replacement: "        ${setting('', tH('card.resetMailHint'), false ?",
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
    search: "        videoPlayer.currentTime = handover.position;\n",
    replacement: "",
    expected: 'Genau ein Abspieler laeuft — 0.17.1'
  },
  {
    nr: '352', name: 'Der Rueckweg beim Schliessen faellt weg',
    file: 'public/app.js',
    search: "    hold();\n    restore();\n    shown?.(null);\n    lightboxOpen = false;",
    replacement: "    halteAn();\n    shown?.(null);\n    lightboxOpen = false;",
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
    search: "\"card.testMailGoesHint\": \"Die Testmail geht **ausschließlich an die Adresse deines eigenen Accounts**.\"",
    replacement: "\"card.testMailGoesHint\": \"Die Testmail geht an deinen Account — es gibt kein Adressfeld daneben, und zwar mit Absicht: ein Knopf, der an eine beliebige Adresse schickt, wäre ein offener Mailverteiler hinter einer Anmeldung.\"",
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
    search: "      <h3 class=\"card-title\" title=\"${esc(it.title)}\">${esc(it.title)}</h3>\n      ${findingRow}",
    replacement: "      ${findingRow}\n      <h3 class=\"card-title\" title=\"${esc(it.title)}\">${esc(it.title)}</h3>",
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
    search: "    from = end;\n    at = i + b.length;\n  }",
    replacement: "    from = end;\n    at = i + b.length;\n    break;\n  }",
    expected: 'Die Hervorhebung in der Uebersicht'
  },
  {
    /* Als Muster gelesen findet ein eingegebener Punkt jedes Zeichen. */
    nr: '416', name: 'Der Begriff wird als Muster gelesen',
    file: 'public/app.js',
    search: "    const i = flat.indexOf(b, at);",
    replacement: "    const i = flat.slice(at).search(new RegExp(b, 'i')) < 0 ? -1 : at + flat.slice(at).search(new RegExp(b, 'i'));",
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
    search: "const EXCHANGE_FORMAT = 23;",
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
    search: "        ${OWNER ? `\n        <h4 class=\"sys-sub\">${tH('card.storeMethod')}</h4>",
    replacement: "        ${true ? `\n        <h4 class=\"sys-sub\">${tH('card.storeMethod')}</h4>",
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
    search: "  \"SELECT id FROM photos WHERE kind = 'image'\");",
    replacement: "  \"SELECT id FROM photos WHERE kind = 'image' AND mime_type = 'image/png'\");",
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
    file: 'README-de.md',
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
    file: 'schema.js',
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
    search: "\"card.storeLosslessHint\": \"verlustfrei, gemessen rund zwei Drittel kleiner\",",
    replacement: "\"card.storeLosslessHint\": \"gemessen rund zwei Drittel kleiner\",",
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
    search: "\"card.emailOptionalMore\": \"Ohne Mailzugang zeigt Kriterion",
    replacement: "\"card.emailOptionalMore\": \"Ohne Mailzugang zeigt die Instanz",
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
    search: "const sourceFrom = (z) => (isPlayedRow(z) ? z.medium : z.data);",
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
    search: "    // Nach einem await kann die Ansicht schon gewechselt haben.\n    if (!box || !here()) return;\n",
    replacement: "    // Nach einem await kann die Ansicht schon gewechselt haben.\n",
    expected: 'Die Ansicht kann fort sein — 0.19.6'
  },
  {
    nr: '542', name: 'Der Betrachter fragt nicht, ob seine Ansicht noch steht',
    file: 'public/app.js',
    search: "    if (!v || !here()) return;\n    // #viewer bleibt dasselbe Element; die Handler des Ausschnittmodus loeschen.",
    replacement: "    // #viewer bleibt dasselbe Element; die Handler des Ausschnittmodus loeschen.",
    expected: 'Die Ansicht kann fort sein — 0.19.6'
  },
  {
    nr: '543', name: 'Der Bilderstreifen zeichnet ueberhaupt keine Kacheln mehr',
    file: 'public/app.js',
    search: "    drawPhotoPick();\n    item.photos.forEach((p, i) => {",
    replacement: "    drawPhotoPick();\n    [].forEach((p, i) => {",
    expected: 'Die Ansicht kann fort sein — 0.19.6'
  },

  /* ---- Alte Sicherungen aufraeumen ---- */
  {
    nr: '544', name: 'Die Regel kennt nur das Alter -- der Boden faellt weg',
    file: 'backup.js',
    search: "  return usable.slice(keep).filter(d => d.time < limit);",
    replacement: "  return brauchbar.filter(d => d.zeit < grenze);",
    expected: 'Die Aufraeumregel an der Tafel'
  },
  {
    nr: '545', name: 'Die Regel kennt nur die Zahl -- die Schere faellt weg',
    file: 'backup.js',
    search: "  return usable.slice(keep).filter(d => d.time < limit);",
    replacement: "  return brauchbar.slice(behalten);",
    expected: 'Die Aufraeumregel an der Tafel'
  },
  {
    nr: '546', name: 'Die Musterpruefung faellt weg -- die fremde Datei faellt mit',
    file: 'backup.js',
    search: "const BACKUP_PATTERN = /^kriterion-.+\\.sqlite$/;",
    replacement: "const BACKUP_PATTERN = /./;",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '547', name: 'Die zweite Musterpruefung vor dem unlink faellt weg',
    file: 'backup.js',
    search: "    if (short !== String(n) || !BACKUP_PATTERN.test(short)) { stayed.push(short); continue; }",
    replacement: "    if (false) { stayed.push(kurz); continue; }",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '548', name: 'Die Liste folgt dem Symlink statt ihn zu sehen',
    file: 'backup.js',
    search: "      const st = fs.lstatSync(path.join(filePath, n));",
    replacement: "      const st = fs.statSync(path.join(pfad, n));",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '549', name: 'Das Entfernen folgt dem Symlink',
    file: 'backup.js',
    search: "      const st = fs.lstatSync(full);",
    replacement: "      const st = fs.statSync(voll);",
    expected: 'Alte Sicherungen aufraeumen: der echte Ordner'
  },
  {
    nr: '550', name: 'Der Boden zaehlt auch die veralteten Kopien mit',
    file: 'backup.js',
    search: "    .filter(d => changeMs == null || d.time >= changeMs)",
    replacement: "    .filter(() => true)",
    expected: 'Die Aufraeumregel an der Tafel'
  },
  {
    nr: '551', name: 'Nach der gescheiterten Sicherung wird doch aufgeraeumt',
    file: 'server.js',
    search: "    if (written.error) return answer(written.status, { error: t(localeOf(req), written.error, written.values) });",
    replacement: "    if (written.error) {\n      const r = cleanupStatus();\n      if (r.an) removeBackups(target.filePath, ruleHit(backupList(target.filePath) || [],\n        r.keep, r.days, Date.now(), (changeMark() || {}).ms ?? null).map(d => d.name));\n      return answer(written.status, { error: t(localeOf(req), written.error, written.values) });\n    }",
    expected: "Alte Sicherungen aufraeumen: nicht mehr im Anschluss an die Sicherung"
  },
  {
    nr: '552', name: 'Das Aufraeumen der Kopien reisst die gelungene Sicherung mit',
    file: 'server.js',
    search: "    try { cleanBackupFiles(target.filePath); } catch (e) { logFail('Clearing up after the backup failed:', e.message); }",
    replacement: "    cleanBackupFiles(target.filePath);",
    expected: "Alte Sicherungen aufraeumen: nicht mehr im Anschluss an die Sicherung"
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
    file: 'backup.js',
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
    search: "  inventory: ['export', 'import', 'backup', 'backup.delete', 'backup.fetch', 'key']",
    replacement: "  bestand: ['export', 'import', 'backup', 'backup.fetch', 'key']",
    expected: 'Das Sicherheitsprotokoll in der Oberflaeche'
  },
  {
    nr: '561', name: 'Die Karte „Alte Sicherungen" faellt aus dem Systembereich',
    file: 'public/app.js',
    search: "  { key: 'cleanup',      section: 'backup', visible: () => OWNER,\n    markup: cardCleanup,   wireUp: setUpCleanupOut },",
    replacement: "",
    expected: 'Der Systembereich nach Rolle'
  },
  {
    nr: '562', name: 'Die Karte „Alte Sicherungen" steht schon beim Admin',
    file: 'public/app.js',
    search: "  { key: 'cleanup',      section: 'backup', visible: () => OWNER,",
    replacement: "  { key: 'cleanup',      section: 'backup', visible: () => ADMIN,",
    expected: 'Der Systembereich nach Rolle'
  },
  {
    nr: '563', name: 'Eine Aenderung am Feld rechnet die Vorschau nicht neu',
    file: 'public/app.js',
    search: "        el.oninput = previewNew;",
    replacement: "        el.oninput = null;",
    expected: 'Die Karte „Alte Backups" in der Oberflaeche'
  },
  {
    nr: '564', name: 'Die Karte schickt die Dateinamen an die Loeschroute mit',
    file: 'public/app.js',
    search: "      try { r = await api('POST', '/api/backup/cleanup', kind === 'rule' ? { kind, ...values() } : { kind }); }",
    replacement: "      try { r = await api('POST', '/api/backup/cleanup',\n" +
            "        { art, dateien: (a.treffer || []).map(t => t.datei) }); }",
    expected: 'Die Karte „Alte Backups" in der Oberflaeche'
  },
  {
    nr: '565', name: 'Der Knopf ist auch ohne Treffer bedienbar',
    file: 'public/app.js',
    search: "id=\"cleanup-run\"${matched.length ? '' : ' disabled'}>${tH('card.deleteNow')}",
    replacement: "id=\"cleanup-run\">${tH('card.deleteNow')}",
    expected: 'Die Karte „Alte Backups" in der Oberflaeche'
  },
  {
    nr: '566', name: 'Die Sicherungsliste bekommt keinen Deckel',
    file: 'public/style.css',
    search: '#cleanup-list { flex: none; max-height: 19.58rem; }',
    replacement: '#cleanup-list { flex: none; }',
    expected: 'Die Karte „Alte Backups" in der Oberflaeche'
  },
  {
    nr: '567', name: 'Die Karte listet die Sicherungen nicht mehr',
    file: 'public/app.js',
    search: '           <div class="manage-list" id="cleanup-list">${all.map(row).join(\'\')}</div>\n',
    replacement: '           <div class="manage-list" id="cleanup-list"></div>\n',
    expected: 'Die Karte „Alte Backups" in der Oberflaeche'
  },
  {
    nr: '568', name: 'Die Nummern laufen von der aeltesten zur juengsten',
    file: 'server.js',
    search: '      ...cleanupRow(d, now), nr: i + 1,',
    replacement: '      ...cleanupRow(d, jetzt), nr: dateien.length - i,',
    expected: 'Die Karte „Alte Backups" in der Oberflaeche'
  },
  {
    nr: '569', name: 'Die Zeilen sagen nicht mehr, welche geloescht wird',
    file: 'public/app.js',
    search: "      const mark = z.affected ? `<span class=\"cleanup-badge remove\">${tH('card.deleteLower')}</span>`",
    replacement: "      const marke = z.faellt ? ''",
    expected: 'Die Karte „Alte Backups" in der Oberflaeche'
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
    search: "  side: ['potenzial', 'bewertung', 'kategorie', 'tags'],",
    replacement: "  side: ['bewertung', 'potenzial', 'kategorie', 'tags'],",
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
    search: "  GLANCE.clear();\n  JUMPED.clear();\n  /* Suchbegriff aus der Adresse oder aus state.search; danach sind beide gleich. */",
    replacement: "  JUMPED.clear();\n  /* Suchbegriff aus der Adresse oder aus state.search; danach sind beide gleich. */",
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
    search: "                          'images.js', 'batchrun.js', 'mail.js', 'docserver.js',\n                          'schema.js', 'backup.js', 'backuptool.js', 'videoproxy.js'];",
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
    search: "      if (!await confirmBox(t('card.endSessionsAsk'), t('card.thisSessionStays'), t('card.end'), 'accent')) return;",
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
    search: "    return mask ? esc(value) : value;",
    replacement: "    return value;",
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
    search: "          : (OWNER\n            ? `<div class=\"warn-box\" style=\"margin-top:14px\">${tH('card.keyBesideHint')}",
    replacement: "          : (ADMIN\n            ? `<div class=\"warn-box\" style=\"margin-top:14px\">${tH('card.keyBesideHint')}",
    expected: 'Die Rollenweichen — 0.22.0'
  },
  {
    nr: '640', name: "Benutzer sehen die Karte „Kategorien“ wieder",
    file: 'public/app.js',
    search: "  { key: 'categories',   section: 'inventory', visible: () => ADMIN,",
    replacement: "  { key: 'categories',   section: 'inventory', visible: () => true,",
    expected: 'Die Rollenweichen — 0.22.0'
  },
  {
    nr: '641', name: 'Abbrechen im Loeschfenster fuer einen Benutzer bricht nicht ab',
    file: 'public/app.js',
    search: "    bd.querySelector('[data-no]').onclick = () => done(null);\n    bd.querySelector('[data-yes]').onclick = take;\n    bd.onclick = e => { if (fromBackdrop(e, bd)) done(null); };\n    const onKey = e => { if (e.key === 'Escape') done(null); };",
    replacement: "    bd.querySelector('[data-no]').onclick = nimm;\n    bd.querySelector('[data-yes]').onclick = nimm;\n    bd.onclick = e => { if (fromBackdrop(e, bd)) done(null); };\n    const onKey = e => { if (e.key === 'Escape') done(null); };",
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
    file: 'schema.js',
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
    search: "<input type=\"file\" id=\"file\" accept=\"${MEDIA_ACCEPT}\" multiple><span\n          id=\"drop-text\">",
    replacement: "<input type=\"file\" id=\"file\" accept=\"${MEDIA_ACCEPT}\" multiple>\n          <span-ohne-kennung>",
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
    nr: '801', name: "Benutzer sehen die Karte „Potenzial: Kriterien“ wieder",
    file: 'public/app.js',
    search: "  { key: 'potentialcriteria', section: 'inventory', visible: () => ADMIN,",
    replacement: "  { key: 'potentialcriteria', section: 'inventory', visible: () => true,",
    expected: "Der Systembereich nach Rolle"
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
    search: "  potentialMode: potentialMode(),\n  partialShare: partialShare(),",
    replacement: "  partialShare: partialShare(),",
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
    search: "{ mb: UPLOAD_LIMITS.video })} ${tH('entry.clipboardLarger')}</p>` : ''}",
    replacement: "{ mb: UPLOAD_LIMITS.video })}</p>` : ''}",
    expected: 'Eintrag: Zaehler, Hinweis bei Touch, Auswahlmodus, Platzhalter'
  },
  {
    /* renderCompare() eigens: eine Pruefung nur an renderDetail() bliebe gruen,
       wenn renderCompare() seine alte Zeile behaelt. */
    /* Ersetzt auch wireSubhead(); ohne Kopfzeile bricht der Lauf sonst ab und belegt nichts. */
    nr: '825', name: 'Der Vergleich behaelt seine alte Rueckzeile',
    file: 'public/app.js',
    search: "    ${subhead()}\n    <h1 class=\"page-title\">${tH('list.compare')}</h1>\n    <p class=\"hint page-hint${multipleUsers() ? ' above-pills' : ''}\" id=\"cmp-hint\"></p>\n    ${multipleUsers() ? `<div class=\"pills seg\" id=\"cmp-view\" style=\"margin:0 0 20px\"></div>` : ''}\n    <div class=\"cmp-grid\" id=\"cg\" style=\"grid-template-columns:repeat(auto-fit,minmax(240px,1fr))\"></div>\n  </div>`;\n  wireSubhead();",
    replacement: "    <a href=\"#/\" class=\"back\">${tH('list.backToList')}</a>\n    <h1 class=\"page-title\">${tH('list.compare')}</h1>\n    <p class=\"hint page-hint${multipleUsers() ? ' above-pills' : ''}\" id=\"cmp-hint\"></p>\n    ${multipleUsers() ? `<div class=\"pills seg\" id=\"cmp-view\" style=\"margin:0 0 20px\"></div>` : ''}\n    <div class=\"cmp-grid\" id=\"cg\" style=\"grid-template-columns:repeat(auto-fit,minmax(240px,1fr))\"></div>\n  </div>`;",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '826', name: 'Der Fehlerweg des Eintrags bleibt ohne Kopfzeile',
    file: 'public/app.js',
    search: "    if (here() && e.message !== SESSION_GONE) viewFailed(loadFailed(e), {}, { term });",
    replacement: "    if (here() && e.message !== SESSION_GONE) app.innerHTML = `<div class=\"shell\"><a href=\"#/\" class=\"back\">${tH('list.backToList')}</a><p class=\"hint\">${loadFailed(e)}</p></div>`;",
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
    search: "  const list = shown.some(x => x.id === id) ? shown : (state.items || []);",
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
    search: ":is(.btn, .mact, .link-btn, .pill, .icon-btn, .sdefault):disabled { opacity: .42; cursor: not-allowed; }",
    replacement: ":is(.btn, .mact, .link-btn, .pill, .icon-btn, .sdefault):disabled { display: none; }",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '834', name: 'Die Reihenfolge wird im Browser abgelegt',
    file: 'public/app.js',
    search: "  const list = shown.some(x => x.id === id) ? shown : (state.items || []);",
    replacement: "  const list = shown.some(x => x.id === id) ? shown : (state.items || []); try { sessionStorage.setItem('reihe', JSON.stringify(list.map(x => x.id))); } catch {}",
    expected: 'Die gemeinsame Kopfzeile und das Blaettern — 0.28.0'
  },
  {
    nr: '835', name: 'Bild auf und Bild ab blaettern doch den Eintrag',
    file: 'public/app.js',
    search: "  const wireNav = () => document.querySelectorAll('.entry-nav .step').forEach(b => {",
    replacement: "  document.addEventListener('keydown', e => { if (e.key === 'PageDown' || e.key === 'PageUp') e.preventDefault(); });\n  const wireNav = () => document.querySelectorAll('.entry-nav .step').forEach(b => {",
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
    search: "\"entry.addMediaHint\": \"Add photos, videos and audio — several at a time\",",
    replacement: "\"entry.addMediaHint\": \"Add photos, videos and audio — several at a time, or paste with Ctrl+V\",",
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
    search: "  const name = getSetting('title_public', TITLE_DEFAULT);",
    replacement: "  const name = 'App';",
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
    search: "  sortPair.appendChild(dirBar);",
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
    search: "  :is(.frow, .fgroup) > .pills:not(.cloud) { flex-wrap: nowrap; overflow-x: auto;",
    replacement: "  :is(.frow, .fgroup) > .pills:not(.cloud) { flex-wrap: wrap;",
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
    search: "    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email\n               ON users(email COLLATE NOCASE) WHERE email IS NOT NULL`);",
    replacement: "    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email\n               ON users(email) WHERE email IS NOT NULL`);",
    expected: 'Die Adresse ist eindeutig — 0.29.0'
  },
  {
    nr: '886', name: 'Der fehlgeschlagene Index wird verschwiegen',
    file: 'db.js',
    search: "    logLine('The address stays without a lock: ' +\n      db.prepare(qDoubleEmails).all().map(z => `${z.address} (${z.n})`).join(', ') +\n      ' -- used more than once. The \"Users\" card names them.');",
    replacement: "",
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
    nr: '891', name: 'Der Platzhalter der Kategorie sagt wieder nur „Name“',
    file: 'public/languages/de.json',
    search: '  "entry.newCategoryHint": "Neue Kategorie",',
    replacement: '  "entry.newCategoryHint": "Name",',
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
    search: "        row.append(date, wd, ...(open ? [open] : []), tagBox, more, tail);",
    replacement: "        row.append(date, wd, ...(open ? [open] : []), tagBox, tail, more);",
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
    search: "  `<span class=\"mcount\" title=\"${esc(long)}\">${esc(text)}</span>`;",
    replacement: "  `<span class=\"mcount\">${esc(text)}</span>`;",
    expected: "Der Zaehler entsteht an einer Stelle, mit Zahl und Wort \u2014 0.30.1"
  },
  {
    nr: "928", name: "Die Tagkarte nennt nur die beiden Zahlen",
    file: "public/app.js",
    search: "      counter: e => `${e.usage_count} ${vThing(e.usage_count)} \u00b7 ${e.test_usage_count} ${vTime(e.test_usage_count)}`,",
    replacement: "      counter: e => `${e.usage_count} \u00b7 ${e.test_usage_count}`,",
    expected: "Der Zaehler entsteht an einer Stelle, mit Zahl und Wort \u2014 0.30.1"
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
    nr: '947', name: "Der Zeilenzaehler nimmt jede Marke als eigene Zeile",
    file: 'public/app.js',
    search: "    if (!tops.length || k.offsetTop - tops[tops.length - 1] > height / 2) tops.push(k.offsetTop);",
    replacement: "    tops.push(k.offsetTop);",
    expected: "Die zugeklappte Tagzeile fuellt ihre Hoehe \u2014 0.30.3"
  },
  {
    nr: '948', name: "Der Zeilenzaehler misst wieder selbst",
    file: 'public/app.js',
    search: "function cloudTops(box) {\n  const height = cloudLine(box);",
    replacement: "function cloudTops(box) {\n  const first = box.firstElementChild;\n  const height = first ? first.offsetHeight || 0 : 0;",
    expected: "Die zugeklappte Tagzeile fuellt ihre Hoehe \u2014 0.30.3"
  },
  {
    nr: '949', name: "Eine Rundung beginnt wieder eine neue Zeile",
    file: 'public/app.js',
    search: "k.offsetTop - tops[tops.length - 1] > height / 2",
    replacement: "k.offsetTop - tops[tops.length - 1] > 0",
    expected: "Tagwolken"
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
    search: "        if (!search) return window.open(l.url, '_blank', 'noopener,noreferrer');",
    replacement: "        if (!search) return window.open(l.url, '_blank');",
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
    search: "in {n} Dateien — {contents}",
    replacement: "in {n} Dateien, die das Haus verlassen — {contents}",
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
    search: "  \"card.setTheme\": \"Colour scheme\"",
    replacement: "  \"card.setTheme\": \"Color scheme\"",
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
    search: "  if (!mail.configured(raw)) return { ok: false, key: self ? 'server.noAccountSelf' : 'server.noAccountOwner' };",
    replacement: "  if (!mail.configured(raw)) return { ok: false, key: self ? 'server.noAccountSelf' : 'Es ist kein Mailzugang eingerichtet. Das macht der Eigentuemer dieser Installation.' };",
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
    nr: '1024', name: "„Mehr“ misst bei neuer Breite oder Schrift nicht neu",
    file: 'public/app.js',
    search: "  trimMore(app);\n  watchMore(app);\n}",
    replacement: "  trimMore(app);\n}",
    expected: "„Mehr“: ab drei Zeilen hinter dem Knopf, darunter direkt, neu gemessen bei anderer Breite"
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
    search: 'if (isMainThread) warnIncompleteDatabase(incompleteDatabase());',
    replacement: '// if (isMainThread) warnIncompleteDatabase(incompleteDatabase());',
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
    search: "function warnIncompleteDatabase(findings) {\n  if (!findings.length) return;",
    replacement: "function warnIncompleteDatabase(findings) {\n  if (!findings.length) return;\n  throw new Error('Diese Datenbank ist unvollstaendig.');",
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
    search: "  } catch (e) {\n    logWarn(`Index ${name} not created:",
    replacement: "  } catch (e) {\n    throw e;\n    logWarn(`Index ${name} not created:",
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
    search: "'images.js', 'batchrun.js', 'mail.js', 'docserver.js',",
    replacement: "'images.js', 'batchrun.js', 'docserver.js',",
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
    search: "if (!report.abort && !report.failed && r.status !== 0)",
    replacement: "if (false)",
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
    search: "      st.onclick = () => {\n        LANGUAGE_SWITCHED = a.code;\n        sendLanguages({ languageDefault: a.code }, t('card.languageDefaultSaved'));\n      };\n      const nm = document.createElement('span');\n      nm.className = 'engine-name';",
    replacement: "      st.onclick = () => {\n        LANGUAGE_SWITCHED = a.code;\n        sendLanguages({ languageDefault: a.code }, t('card.languageDefaultSaved'));\n      };\n      const nm = document.createElement('span');\n      nm.className = 'ename';",
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
    search: "  `SELECT mime_type, data, thumb, medium, focus_x, focus_y, zoom, kind, duration,\n",
    replacement: "  `SELECT mime_type, data, thumb, medium, NULL AS focus_x, NULL AS focus_y, NULL AS zoom, kind, duration,\n",
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
    search: "  const base = { dbBytes, durationSeconds: duration, cleanup: rule, copy: BACKUP_COPY };",
    replacement: "  const base = { dbBytes, cleanup: rule, copy: BACKUP_COPY };",
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
    search: "      const n = gpFileText(path.join(__dirname, r.file)).split(r.search).length - 1;",
    replacement: "      gpText.delete(path.join(__dirname, r.file));\n      const n = gpFileText(path.join(__dirname, r.file)).split(r.search).length - 1;",
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
    file: 'schema.js',
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
    search: "      <h3 class=\"card-title\" title=\"${esc(it.title)}\">${esc(it.title)}</h3>",
    replacement: "      <h3 class=\"card-title\" title=\"${esc(it.title)}\">${it.title}</h3>",
    expected: 'Keine nackte Einsetzung in innerHTML'
  },
  {
    nr: '1125', name: 'Die Ausnahmeliste traegt einen Namen, den es nicht gibt',
    file: 'test/source.js',
    search: "    'changeBox', 'rest', 'ruleText', 'copyBox'",
    replacement: "    'changeBox', 'rest', 'ruleText', 'copyBox', 'gibtEsNicht'",
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
    search: '/* ---- Vergleichsleiste ---- */',
    replacement: '/* ---- Vergleichsleiste, BA 5 ---- */',
    expected: 'Kein Papierverweis geht mit hinaus'
  },
  {
    nr: '1129', name: 'Eine SQL-Kommentarzeile des Schemas nennt wieder ein Papier',
    file: 'schema.js',
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
    search: "  if (!text.startsWith(here + '#/')) return '';\n  const hash = text.slice(here.length);",
    replacement: "  const hash = text.replace(/^[^#]*/, '');",
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
    search: ".cmt-head .mact.rm { margin-left: .6em; }",
    replacement: ".cmt-head .mact.rm { margin-left: 0; }",
    expected: 'Der Stift steht da, und das Loeschen steht abseits'
  },
  {
    nr: '1155', name: 'Der Verweis springt wieder nur ueber die Adresse',
    file: 'public/app.js',
    search: "  if (!commentRow(id)) { LIT_COMMENT = 0; return false; }",
    replacement: "  if (!document.querySelector('.cmt.lit')) { LIT_COMMENT = 0; return false; }",
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
    search: "          <span class=\"acts\"><button class=\"mact cite\" title=\"${esc(t('entry.quoteComment'))}\">${ICON_QUOTE}</button>${\n            mine ? `<button class=\"mact ed\" title=\"${esc(t('entry.edit'))}\">${ICON_PEN}</button>` : ''\n            }${manage ? `<button class=\"mact rm\" title=\"${esc(t('dialog.delete'))}\">${ICON_DELETE}</button>` : ''}</span>\n          ${/* Ausserhalb von .acts: die Aktionen werden beim Bearbeiten\n               unsichtbar, die Nummer bleibt. */''}\n          <button class=\"link-btn cmt-no\"\n              title=\"${esc(t('entry.copyCommentLink'))}\">#${Number(order.get(c.id))}</button>",
    replacement: "          <button class=\"link-btn cmt-no\"\n              title=\"${esc(t('entry.copyCommentLink'))}\">#${Number(order.get(c.id))}</button>\n          <span class=\"acts\"><button class=\"mact cite\" title=\"${esc(t('entry.quoteComment'))}\">${ICON_QUOTE}</button>${\n            mine ? `<button class=\"mact ed\" title=\"${esc(t('entry.edit'))}\">${ICON_PEN}</button>` : ''\n            }${manage ? `<button class=\"mact rm\" title=\"${esc(t('dialog.delete'))}\">${ICON_DELETE}</button>` : ''}</span>",
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
    search: "  const fresh = keys.filter(k => !COMMENT_REFS_ASK.has(k));",
    replacement: "  const fresh = keys;",
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
    file: 'schema.js',
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
    search: "  ['/api/comment-refs',            'angemeldet',\n    'Titel, Stellung und Dateiname fuer die Marke am Verweis; dieselbe Schranke wie am Eintrag.'],",
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
    search: "/* ---- Rueckfall: Eigentuemer ---- */",
    replacement: "/* ---- Auffangnetz: Eigentuemer ---- */",
    expected: 'Der Sprachwaechter'
  },
  /* ---- Das Inhaltsverzeichnis der Anleitung ---- */
  {
    nr: '1189', name: 'Eine Sprungmarke der README zeigt auf nichts',
    file: 'README-de.md',
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
    search: "      a.querySelector('.mcount').title = it.counts.text;",
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
    file: 'README-de.md',
    search: "![Lizenz](https://img.shields.io/badge/Lizenz-MIT-informational)\n",
    replacement: "",
    expected: 'Die Lizenz geht mit hinaus'
  },
  {
    nr: '1197', name: 'Die README nennt die LGPL-Pakete nicht mehr',
    file: 'README-de.md',
    search: "**Die zwei LGPL-Pakete sind `@img/sharp-libvips-linux-x64` und\n`@img/sharp-libvips-linuxmusl-x64`**",
    replacement: "**Die zwei LGPL-Pakete gehoeren zur Bildbibliothek**",
    expected: 'Die Lizenz geht mit hinaus'
  },
  {
    nr: '1198', name: 'Der Transparenzvermerk faellt aus der README',
    file: 'README-de.md',
    search: "## Wie dieser Code entstanden ist",
    replacement: "## Woher der Code kommt",
    expected: 'Die Lizenz geht mit hinaus'
  },
  /* ---- Die Spaltenfolge ---- */
  {
    nr: '1199', name: 'Das Schema faellt auf die alte Folge zurueck',
    file: 'schema.js',
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
    search: '  } finally {\n    file?.close();\n    try { fs.rmSync(req.file.path, { force: true }); }\n'
      + '    catch (e) { logWarn(`Import: ${req.file.path} stayed behind -- ${e.message}`); }\n  }\n  reply();\n});',
    replacement: '  }\n  reply();\n});',
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
    search: "                      duration: durationValue(v.duration), thumb: still, data: laterOf(v, 'data', spilled) || data });",
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
    nr: '1217', name: 'Eine Antwort 413 ohne JSON zeigt wieder den Statuscode',
    file: 'public/app.js',
    search: "const proxyAnswer = (status) => (status === 413 ? t('error.proxyTooLarge')",
    replacement: "const proxyAnswer = (status) => (status === 413 ? ''",
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
  {
    nr: '1222', name: 'verify() prueft alg nicht',
    file: 'docserver.js',
    search: "  if (head.alg !== 'HS256') return { ok: false, reason: 'alg' };\n",
    replacement: "",
    expected: 'Document Server: JWT'
  },
  {
    nr: '1223', name: 'Der Abruf vergleicht die URL im JWT nicht',
    file: 'docserver.js',
    search: "  return same ? { ok: true } : { ok: false, reason: 'url' };",
    replacement: "  return { ok: true };",
    expected: 'Document Server: Abruf und Konfiguration'
  },
  {
    nr: '1224', name: 'Die Abrufroute liest den Schalter nicht',
    file: 'server.js',
    search: "  if (!documentServerOn()) return res.status(404).end();\n",
    replacement: "",
    expected: 'Document Server: Abruf und Konfiguration'
  },
  {
    nr: '1225', name: 'Die CSP nimmt den Document Server nicht auf',
    file: 'server.js',
    search: "const DOC_ORIGIN = docserver.scriptOrigin();",
    replacement: "const DOC_ORIGIN = '';",
    expected: 'Document Server: Abruf und Konfiguration'
  },
  {
    nr: '1226', name: 'detail() liefert office auch fuer PDF, Bild und Text',
    file: 'server.js',
    search: "        : officeOn && docserver.officeType(a2.filename) ? 'office' : kind,",
    replacement: "        : officeOn ? 'office' : kind,",
    expected: 'Document Server: Abruf und Konfiguration'
  },
  {
    nr: '1227', name: 'Die Pruefung unterscheidet -4 nicht nach der Probe-Route',
    file: 'docserver.js',
    search: "  if (j.error === -4 && lastTestFetch && !lastTestFetch.ok)",
    replacement: "  if (false)",
    expected: 'Document Server: die Pruefung der Karte'
  },
  {
    nr: '1228', name: 'destroyEditor() wird beim Schliessen der Vorschau nicht gerufen',
    file: 'public/app.js',
    search: "  function dropPreview() {\n    endOfficeViewer();\n",
    replacement: "  function dropPreview() {\n",
    expected: 'Document Server: der Betrachter im Browser'
  },
  {
    nr: '1229', name: 'Dateinamen werden wieder als Latin-1 gelesen',
    file: 'server.js',
    search: "const upload = (options) => multer({ defParamCharset: 'utf8', ...options });",
    replacement: "const upload = (options) => multer({ ...options });",
    expected: 'Document Server: Account, Chat und Dateinamen'
  },
  {
    nr: '1230', name: 'Der Betrachter bekommt keinen Account',
    file: 'docserver.js',
    search: "      mode: 'view', lang,\n      user: { id: String(user.id), name: user.name },\n",
    replacement: "      mode: 'view', lang,\n",
    expected: 'Document Server: Account, Chat und Dateinamen'
  },
  {
    nr: '1231', name: 'Kommentare stehen im Betrachter wieder da',
    file: 'docserver.js',
    search: "      customization: { comments: false }\n",
    replacement: "      customization: {}\n",
    expected: 'Document Server: Account, Chat und Dateinamen'
  },
  {
    nr: '1232', name: 'Das Menue verliert Oeffnen',
    file: 'public/app.js',
    search: "    else if (FILE_READABLE.includes(a.preview))\n      open.push({ label: t('entry.openFile')",
    replacement: "    else if (false)\n      open.push({ label: t('entry.openFile')",
    expected: 'Document Server: die eigene Ansicht'
  },
  {
    nr: '1233', name: 'route() baut den Betrachter der Ansicht nicht ab',
    file: 'public/app.js',
    search: "  redrawCloud = null;\n  redrawLinks = null;\n  endFileViewer();\n",
    replacement: "  redrawCloud = null;\n  redrawLinks = null;\n",
    expected: 'Document Server: die eigene Ansicht'
  },
  {
    nr: '1234', name: 'Auf dem Telefon klappt die Vorschau wieder im Eintrag auf',
    file: 'public/app.js',
    search: "    if (isNarrow()) { location.hash = fileAddress(id, a.id); return; }\n",
    replacement: "",
    expected: 'Document Server: die eigene Ansicht'
  },
  {
    nr: '1235', name: 'Lange Werte in .kv brechen nicht mehr um',
    file: 'public/style.css',
    search: ".kv .k, .kv .v { min-width: 0; overflow-wrap: anywhere; }\n",
    replacement: "",
    expected: 'Document Server: die eigene Ansicht'
  },
  {
    nr: '1236', name: 'Auf dem Telefon wieder der mobile Editor',
    file: 'docserver.js',
    search: "    type: mobile ? 'embedded' : 'desktop',",
    replacement: "    type: mobile ? 'mobile' : 'desktop',",
    expected: 'Document Server: Abruf und Konfiguration'
  },
  {
    nr: '1237', name: 'Die Ansicht traegt wieder die Kopfzeile von Kriterion',
    file: 'public/app.js',
    search: "  app.innerHTML = `<div class=\"fileview\">\n    <div class=\"fileview-bar\">",
    replacement: "  app.innerHTML = `<div class=\"fileview\">\n    ${subhead({ searchBox: false })}\n    <div class=\"fileview-bar\">",
    expected: 'Document Server: die eigene Ansicht'
  },
  {
    nr: '1238', name: 'Die Ansicht liegt nicht mehr fest ueber dem Fenster',
    file: 'public/style.css',
    search: ".fileview { position: fixed; inset: 0; ",
    replacement: ".fileview { ",
    expected: 'Document Server: die eigene Ansicht'
  },
  {
    nr: '1239', name: 'Das Zeichen Vollbild schickt nichts ins Vollbild',
    file: 'public/app.js',
    search: "  atElement('fileview-full', b => b.onclick = () =>\n    document.querySelector('.fileview-doc')?.requestFullscreen().catch(() => {}));",
    replacement: "  atElement('fileview-full', b => b.onclick = () => {});",
    expected: 'Document Server: die eigene Ansicht'
  },
  {
    nr: '1240', name: 'Das Zeichen Vollbild steht auch ohne Vollbild im Browser',
    file: 'public/app.js',
    search: "  const fullOk = shown && !!document.fullscreenEnabled;",
    replacement: "  const fullOk = shown;",
    expected: 'Document Server: die eigene Ansicht'
  },
  {
    nr: '1241', name: 'Die Karte Dokumente zeigt Name und Wert wieder nebeneinander',
    file: 'public/app.js',
    search: "  const row = (r) => `<div class=\"kv kv-stack\"><span class=\"k\">",
    replacement: "  const row = (r) => `<div class=\"kv\"><span class=\"k\">",
    expected: 'Document Server: die eigene Ansicht'
  },
  {
    nr: '1242', name: 'Die Rechte beim Bearbeiten fallen weg',
    file: 'server.js',
    search: "const mayEditFile = (userId, a) =>\n  editingOf(a.id).edit_all === 1 || (a.user_id != null && a.user_id === userId);",
    replacement: "const mayEditFile = (userId, a) => true;",
    expected: 'Bearbeiten: Haken und Rechte'
  },
  {
    nr: '1243', name: 'detail() meldet edit auch ohne Recht',
    file: 'server.js',
    search: "    const rights = a2.edit_all === 1 || (a2.user_id != null && a2.user_id === userId);",
    replacement: "    const rights = true;",
    expected: 'Bearbeiten: Haken und Rechte'
  },
  {
    nr: '1244', name: 'Der Callback nimmt jeden Schluessel an',
    file: 'docserver.js',
    search: "  for (let r = revision; r >= 0; r--) if (editorKey(attachment, r) === key) return true;\n  return false;",
    replacement: "  return true;",
    expected: 'Bearbeiten: der Rueckweg'
  },
  {
    nr: '1245', name: 'Der Download folgt Umleitungen',
    file: 'docserver.js',
    search: "  try { r = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(DOWNLOAD_MS) }); }",
    replacement: "  try { r = await fetch(target, { signal: AbortSignal.timeout(DOWNLOAD_MS) }); }",
    expected: 'Bearbeiten: der Rueckweg'
  },
  {
    nr: '1246', name: 'Jede Speicherung legt die vorige Fassung neu ab',
    file: 'server.js',
    search: "    const first = (qPreviousKey.get(id) || {}).session_key !== key;",
    replacement: "    const first = true;",
    expected: 'Bearbeiten: der Rueckweg'
  },
  {
    nr: '1247', name: 'Der Haken reist nicht im Export',
    file: 'server.js',
    search: "                    ...(a2.edit_all === 1 ? { edit_all: true } : {}),\n",
    replacement: "",
    expected: 'Bearbeiten: Export und Papierkorb'
  },
  {
    nr: '1248', name: 'Der Import liest den Haken nicht',
    file: 'server.js',
    search: "        if (a2.editAll) putEditAll.run(added.lastInsertRowid, 1);\n",
    replacement: "",
    expected: 'Bearbeiten: Export und Papierkorb'
  },
  {
    nr: '1249', name: 'Der Admin stellt den Haken um',
    file: 'server.js',
    search: "  if (!selfOnly(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});\n  putEditAll.run(",
    replacement: "  if (!mayChange(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});\n  putEditAll.run(",
    expected: 'Bearbeiten: Haken und Rechte'
  },
  {
    nr: '1250', name: 'Auf dem Telefon kommt der Editor',
    file: 'server.js',
    search: "    if (req.query.edit === '1' && !mobile && docserver.editFormat(a.filename) &&",
    replacement: "    if (req.query.edit === '1' && docserver.editFormat(a.filename) &&",
    expected: 'Bearbeiten: Haken und Rechte'
  },
  {
    nr: '1251', name: 'Status 2 beendet die Sitzung nicht',
    file: 'server.js',
    search: "    countSave.run(id, sessionEnds && current ? 1 : 0);",
    replacement: "    countSave.run(id, 0);",
    expected: 'Bearbeiten: der Rueckweg'
  },
  {
    nr: '1252', name: 'Eine fremde Adresse wird geholt',
    file: 'docserver.js',
    search: "    if (base && text.startsWith(base + '/')) return internalBase() + text.slice(base.length);\n  return null;",
    replacement: "    if (base && text.startsWith(base + '/')) return internalBase() + text.slice(base.length);\n  return text || null;",
    expected: 'Bearbeiten: der Rueckweg'
  },
  {
    nr: '1253', name: 'Der Hochladende sieht den Haken in der Ansicht nicht',
    file: 'public/app.js',
    search: "      ${shown && a.mine && a.edit ? `<label class=\"fileview-editall\"",
    replacement: "      ${shown && false ? `<label class=\"fileview-editall\"",
    expected: 'Bearbeiten: im Browser'
  },
  {
    nr: '1254', name: 'Die Ansicht fragt nie nach dem Editor',
    file: 'public/app.js',
    search: "  let edit = editWanted && a.edit === true;",
    replacement: "  let edit = false;",
    expected: 'Bearbeiten: im Browser'
  },
  {
    nr: '1255', name: 'Das Hochladen uebergeht die eigene Vorgabe',
    file: 'server.js',
    search: "    if (filesEditAllOf(u.user_id) && docserver.editFormat(u.filename)) putEditAll.run(fresh, 1);",
    replacement: "    if (getSetting('documentEditAll', false) === true && docserver.editFormat(u.filename)) putEditAll.run(fresh, 1);",
    expected: 'Bearbeiten: Haken und Rechte'
  },
  {
    nr: '1256', name: 'Der Knopf Speichern schreibt nicht sofort',
    file: 'docserver.js',
    search: "      customization: { forcesave: true }",
    replacement: "      customization: {}",
    expected: 'Bearbeiten: Haken und Rechte'
  },
  {
    nr: '1257', name: 'Die Umwandlung startet ohne Rueckfrage',
    file: 'public/app.js',
    search: "  if (edit && a.convertTo && !isNarrow())",
    replacement: "  if (false)",
    expected: 'Bearbeiten: im Browser'
  },
  {
    nr: '1258', name: 'detail() nennt kein Format nach dem Speichern',
    file: 'server.js',
    search: "      convertTo: docserver.needsConversion(a2.filename) ? docserver.editFormat(a2.filename) : null,",
    replacement: "      convertTo: null,",
    expected: 'Bearbeiten: Haken und Rechte'
  },
  {
    nr: '1259', name: 'Die gezippte Auslieferung verliert Cache-Control',
    file: 'server.js',
    search: "  // Wie express.static; ohne den Kopf nimmt der Browser nach einem Update eine Weile die alte Datei.\n  res.set('Cache-Control', 'public, max-age=0');\n",
    replacement: "",
    expected: 'Die Auslieferung geht gezippt hinaus — 0.35.0'
  },
  {
    nr: '1260', name: 'Der Name fehlt wieder an Dateien des Verfassers',
    file: 'public/app.js',
    search: "    const from = multipleUsers() ? authorName(a.author) : '';",
    replacement: "    const from = multipleUsers() && (a.author?.id ?? null) !== (item.author?.id ?? null) ? authorName(a.author) : '';",
    expected: 'Der Name an der Dateikachel'
  },
  {
    nr: '1261', name: 'Der Name fehlt wieder an Links des Verfassers',
    file: 'public/app.js',
    search: "      // Ab dem zweiten Account steht der Name an jedem Link, auch am eigenen.\n      const showFrom = multipleUsers();",
    replacement: "      // Ab dem zweiten Account steht der Name an jedem Link, auch am eigenen.\n      const showFrom = multipleUsers() && (l.author?.id ?? null) !== (item.author?.id ?? null);",
    expected: 'Der Name an der Linkzeile'
  },
  {
    nr: '1262', name: 'Bearbeiten steht im Menue jeder Buerodatei',
    file: 'public/app.js',
    search: "    if (!a.missing && a.preview === 'office' && a.edit && !isNarrow())\n      open.push({ label: t('entry.edit')",
    replacement: "    if (a.preview === 'office')\n      open.push({ label: t('entry.edit')",
    expected: 'Bearbeiten: im Browser'
  },
  {
    nr: '1263', name: 'Das Zeichen Oeffnen oeffnet wieder den Editor',
    file: 'public/app.js',
    search: "  if (f) return renderFileView(+f[1], +f[2], !!f[3]);",
    replacement: "  if (f) return renderFileView(+f[1], +f[2], true);",
    expected: 'Bearbeiten: im Browser'
  },
  {
    nr: '1264', name: 'Zurueck landet wieder oben im Eintrag',
    file: 'public/app.js',
    search: "  if (back && back.itemId === Number(id) && !LIT_COMMENT) {",
    replacement: "  if (false) {",
    expected: 'Bearbeiten: im Browser'
  },
  {
    nr: '1265', name: 'Das Thema geht nicht an den Document Server',
    file: 'docserver.js',
    search: "  if (UI_THEMES[theme]) config.editorConfig.customization.uiTheme = UI_THEMES[theme];\n",
    replacement: "",
    expected: 'Bearbeiten: Haken und Rechte'
  },
  {
    nr: '1266', name: 'Der Browser meldet immer das dunkle Thema',
    file: 'public/app.js',
    search: "      : document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' });",
    replacement: "      : 'dark' });",
    expected: 'Bearbeiten: im Browser'
  },
  {
    nr: '1267', name: 'Die eigene Vorgabe fehlt, es gilt nur die Karte',
    file: 'server.js',
    search: "  getUserSetting(userId, 'filesEditAll', getSetting('documentEditAll', false)) === true;",
    replacement: "  getSetting('documentEditAll', false) === true;",
    expected: 'Bearbeiten: Haken und Rechte'
  },
  {
    nr: '1268', name: 'Bearbeiten durch alle steht an jeder bearbeitbaren Datei',
    file: 'public/app.js',
    search: "    if (a.mine && a.edit) keep.push({ label: t('entry.editAll')",
    replacement: "    if (a.edit) keep.push({ label: t('entry.editAll')",
    expected: 'Bearbeiten: im Browser'
  },
  {
    nr: '1269', name: 'Der Kasten Dokumente fehlt im eigenen Bereich',
    file: 'public/app.js',
    search: "  { key: 'mydocuments',  section: 'personal', visible: () => !!DOC_SETTINGS,",
    replacement: "  { key: 'mydocuments',  section: 'personal', visible: () => false,",
    expected: 'Bearbeiten: im Browser'
  },
  {
    nr: '1270', name: 'Die eigene Darstellung geht nicht an den Document Server',
    file: 'public/app.js',
    search: "    theme: ['light', 'dark'].includes(DOC_SETTINGS?.theme) ? DOC_SETTINGS.theme\n      : document",
    replacement: "    theme: false ? DOC_SETTINGS.theme\n      : document",
    expected: 'Bearbeiten: im Browser'
  },
  {
    nr: '1271', name: 'Der Server kennt am Verweis keine Dateien',
    file: 'server.js',
    search: "  for (const x of numbers(req.query.files)) {",
    replacement: "  for (const x of numbers(req.query.nothing)) {",
    expected: 'Verweise auf Dateien: die Auskunft des Servers'
  },
  {
    nr: '1272', name: 'Die Frage nach dem Foto liest wieder die ganze Zeile',
    file: 'server.js',
    search: "   WHERE p.item_id = (SELECT item_id FROM photos WHERE id = ?) AND +p.id = ?`);",
    replacement: "   WHERE p.id = ? AND p.id = ?`);",
    expected: 'Verweise auf Dateien: die Auskunft des Servers'
  },
  {
    nr: '1273', name: 'Die Buerodatei heisst am Verweis nie office',
    file: 'server.js',
    search: "      preview: officeOn && docserver.officeType(row.filename)\n        ? 'office' : attachments.previewKind(row.filename) });",
    replacement: "      preview: attachments.previewKind(row.filename) });",
    expected: 'Verweise auf Dateien: die Auskunft des Servers'
  },
  {
    nr: '1274', name: 'Eine Art verdraengt wieder die andere',
    file: 'public/app.js',
    search: "  const ask = Object.keys(REF_KINDS).flatMap(sign => fresh.filter(k => k[0] === sign).slice(0, 200));",
    replacement: "  const ask = fresh.slice(0, 400);",
    expected: 'Verweise auf Dateien: Marken im Browser'
  },
  {
    nr: '1275', name: 'Die Adresse einer Datei wird wieder keine Marke',
    file: 'public/app.js',
    search: "  const file = hash.match(FILE_PATTERN);\n  if (file) return `f${Number(file[2])}`;\n",
    replacement: "",
    expected: 'Verweise auf Dateien: Marken im Browser'
  },
  {
    nr: '1276', name: 'Der Betrachter laedt schon beim Zeichnen',
    file: 'public/app.js',
    search: "  if (row.preview !== 'office') return a;\n",
    replacement: "  if (row.preview !== 'office') return a;\n  setTimeout(() => refViewerToggle(a, row), 0);\n",
    expected: 'Verweise auf Dateien: Marken im Browser'
  },
  {
    nr: '1277', name: 'Der kleine Betrachter kommt als Desktop',
    file: 'public/app.js',
    search: "  const query = new URLSearchParams({ mobile: embedded || isNarrow() ? 1 : 0, edit: edit ? 1 : 0,",
    replacement: "  const query = new URLSearchParams({ mobile: isNarrow() ? 1 : 0, edit: edit ? 1 : 0,",
    expected: 'Verweise auf Dateien: Marken im Browser'
  },
  {
    nr: '1278', name: 'Ein zweiter Klick oeffnet einen zweiten Betrachter',
    file: 'public/app.js',
    search: "  if (shown && REF_VIEWERS.has(shown)) {",
    replacement: "  if (false) {",
    expected: 'Verweise auf Dateien: Marken im Browser'
  },
  {
    nr: '1279', name: 'Das Verlassen des Eintrags laesst den Betrachter stehen',
    file: 'public/app.js',
    search: "  endFileViewer();\n  endRefViewers();\n",
    replacement: "  endFileViewer();\n",
    expected: 'Verweise auf Dateien: Marken im Browser'
  },
  {
    nr: '1280', name: 'Die Bilddatei im Verweis bekommt kein Vorschaubild',
    file: 'public/app.js',
    search: "  if (row.preview === 'image' || ((row.preview === 'video' || row.preview === 'audio') && row.still)) {\n    markupThumb(",
    replacement: "  if (false) {\n    markupThumb(",
    expected: 'Verweise auf Dateien: Marken im Browser'
  },
  {
    nr: '1281', name: 'Das Video im Verweis traegt kein Zeichen',
    file: 'public/app.js',
    search: "thumbLength: row.thumbLength }, 'thumb'), isVideo(row));",
    replacement: "thumbLength: row.thumbLength }, 'thumb'), false);",
    expected: 'Verweise auf Dateien: Marken im Browser'
  },
  {
    nr: '1282', name: 'Die Adresse des Fotos oeffnet kein Vollbild',
    file: 'public/app.js',
    search: "  if (photoWanted) showPhoto(photoWanted);\n",
    replacement: "",
    expected: 'Verweise auf Dateien: Adresse des Fotos und Link kopieren'
  },
  {
    nr: '1283', name: 'Der Klick auf das Foto baut den Eintrag wieder neu auf',
    file: 'public/app.js',
    search: "    if (PHOTO_SHOW.show(row.id)) e.preventDefault();",
    replacement: "    if (false) e.preventDefault();",
    expected: 'Verweise auf Dateien: Adresse des Fotos und Link kopieren'
  },
  {
    nr: '1284', name: 'Das Vollbild hat keinen Knopf Link kopieren',
    file: 'public/app.js',
    search: "  const photoLink = (p) => fullAddress(photoAddress(id, p.id));",
    replacement: "  const photoLink = null;",
    expected: 'Verweise auf Dateien: Adresse des Fotos und Link kopieren'
  },
  {
    nr: '1285', name: 'Link kopieren im Menue kopiert den Eintrag',
    file: 'public/app.js',
    search: "  const fileLink = (a) => fullAddress(fileAddress(id, a.id));",
    replacement: "  const fileLink = (a) => fullAddress(entryAddress(id));",
    expected: 'Verweise auf Dateien: Adresse des Fotos und Link kopieren'
  },
  {
    nr: '1286', name: 'Die eigene Ansicht zeigt nur Dateien fuer den Document Server',
    file: 'public/app.js',
    search: "  if (plain && a.preview !== 'keine') filePreview(a, document.querySelector('.fileview-doc'));\n",
    replacement: "",
    expected: 'Verweise auf Dateien: die eigene Ansicht jeder Datei'
  },
  {
    nr: '1287', name: 'Ein Klick in den Betrachter oeffnet das Feld der Beschreibung',
    file: 'public/app.js',
    search: "    if (!mayEdit() || e.target.closest('.markup-viewer, a')) return;",
    replacement: "    if (!mayEdit() || e.target.closest('a')) return;",
    expected: 'Verweise auf Dateien: Marken im Browser'
  },
  {
    nr: '1289', name: 'Der erste Abruf legt die Kachel nicht ab',
    file: 'server.js',
    search: "    if (current) putFileTile.run(id, row.thumb);\n",
    replacement: "",
    expected: 'Verweise auf Dateien: die Kachel einer Bilddatei'
  },
  {
    nr: '1290', name: 'Die Kachel ist nicht aus der Mitte beschnitten',
    file: 'server.js',
    search: "const fileTile = async (bytes) => (await makeVariants(bytes, DEFAULT_CROP, ['thumb'])).thumb;",
    replacement: "const fileTile = async (bytes) => (await makeVariants(bytes, null, ['thumb'])).thumb;",
    expected: 'Verweise auf Dateien: die Kachel einer Bilddatei'
  },
  {
    nr: '1291', name: 'Jede Datei bekommt beim Abruf eine Kachel',
    file: 'server.js',
    search: "  const picture = kind === 'image' || fromStill;\n  if (!picture && !(a && docTileKind(a.filename))) return res.status(404).end();",
    replacement: "  const picture = !!a;\n  if (!a) return res.status(404).end();",
    expected: 'Verweise auf Dateien: die Kachel einer Bilddatei'
  },
  {
    nr: '1292', name: 'Marke und Dateizeile laden wieder die ganze Datei',
    file: 'public/app.js',
    search: "const fileTileSource = (a) => `/api/attachments/${Number(a.id)}/raw?size=thumb${a.still || a.thumb\n  ? `&v=${Number(a.still || a.thumb)}` : ''}`;",
    replacement: "const fileTileSource = (a) => `/api/attachments/${Number(a.id)}/raw?inline=1`;",
    expected: 'Verweise auf Dateien: Marken im Browser'
  },
  {
    nr: '1293', name: 'Ohne Kachel bleibt die Marke leer',
    file: 'public/app.js',
    search: "    img.onerror = () => { a.classList.remove('markup-pic'); markupFileSign(a, row, term, name); };\n",
    replacement: "",
    expected: 'Verweise auf Dateien: Marken im Browser'
  },
  {
    nr: '1294', name: 'Die Kachel einer Bilddatei zeigt nur die Endung',
    file: 'public/app.js',
    search: "      picture: a.missing ? '' : a.preview === 'image' || ((video || audio) && a.still) || a.thumb ? fileTileSource(a) : coming,",
    replacement: "      picture: a.missing ? '' : coming,",
    expected: 'Verweise auf Dateien: Adresse des Fotos und Link kopieren'
  },
  {
    nr: '1295', name: 'Ohne Vorschaubild bleibt die Bildflaeche leer',
    file: 'public/app.js',
    search: "        pic.innerHTML = `${withoutPicture()}${video ? '<span class=\"play-badge\">▶</span>' : ''}`\n          + `${shown ? `<span class=\"duration\">${esc(shown)}</span>` : ''}`; };\n",
    replacement: "        null; };\n",
    expected: 'Verweise auf Dateien: Adresse des Fotos und Link kopieren'
  },
  {
    nr: '1296', name: 'Der Text der Karte beginnt wieder mit dem Startwert',
    file: 'public/languages/de.json',
    search: "\"card.documentsEditAll\": \"Wer bearbeiten darf: Startwert, solange ein Account keinen eigenen gesetzt hat.\",",
    replacement: "\"card.documentsEditAll\": \"Startwert dafür, wer bearbeiten darf, solange ein Account keinen eigenen gesetzt hat.\",",
    expected: 'Link am Bild'
  },
  {
    nr: '1297', name: 'Das grosse Bild hat keinen Knopf Link kopieren',
    file: 'public/app.js',
    search: "        ${cropMode ? '' : `<button class=\"vlink\"",
    replacement: "        ${true ? '' : `<button class=\"vlink\"",
    expected: 'Link am Bild'
  },
  {
    nr: '1298', name: 'Im Ausschnittmodus steht der Knopf Link kopieren',
    file: 'public/app.js',
    search: "        ${cropMode ? '' : `<button class=\"vlink\"",
    replacement: "        ${false ? '' : `<button class=\"vlink\"",
    expected: 'Link am Bild'
  },
  {
    nr: '1299', name: 'Der Knopf am Bild kopiert den Eintrag',
    file: 'public/app.js',
    search: "      () => copyText(photoLink(ps[idx]), t('card.linkCopied')));",
    replacement: "      () => copyText(fullAddress(entryAddress(id)), t('card.linkCopied')));",
    expected: 'Link am Bild'
  },
  {
    nr: '1303', name: 'Der Name steht wieder hinter dem Pfad',
    file: 'public/app.js',
    search: "      const bottom = search ? '<span class=\"snames\"></span>'\n                          : (path ? `<span class=\"path\">${esc(path)}</span>` : '');\n      row.innerHTML = `${mayEdit() ? `<span class=\"grip\" title=\"${esc(t('entry.dragToSort'))}\">⣿</span>` : ''}\n        <span class=\"lnum\">${Number(n + 1)}</span>\n        <span class=\"lurl\"><span class=\"dom\">${esc(top)}</span>${\n          bottom ? `<span class=\"lbottom\">${bottom}</span>` : ''\n        }</span>\n        ${showFrom ? `<span class=\"lfrom\">(${esc(authorName(l.author))})</span>` : ''}\n",
    replacement: "      const bottom = (search ? '<span class=\"snames\"></span>'\n                          : (path ? `<span class=\"path\">${esc(path)}</span>` : '')) + (showFrom\n        ? `<span class=\"lfrom\">(${esc(authorName(l.author))})</span>` : '');\n      row.innerHTML = `${mayEdit() ? `<span class=\"grip\" title=\"${esc(t('entry.dragToSort'))}\">⣿</span>` : ''}\n        <span class=\"lnum\">${Number(n + 1)}</span>\n        <span class=\"lurl\"><span class=\"dom\">${esc(top)}</span>${\n          bottom ? `<span class=\"lbottom\">${bottom}</span>` : ''\n        }</span>\n",
    expected: 'Der Name an der Linkzeile'
  },
  {
    nr: '1304', name: 'Die Linkzeile uebernimmt die Spalten der Liste nicht',
    file: 'public/style.css',
    search: "  .lrow { display: grid; grid-template-columns: subgrid; gap: 0; }\n",
    replacement: "",
    expected: 'Der Name an der Linkzeile'
  },
  {
    nr: '1305', name: 'Das Kreuz der Linkzeile hat keine eigene Spalte',
    file: 'public/style.css',
    search: "  .lrow .mact { grid-column: del; }\n",
    replacement: "",
    expected: 'Der Name an der Linkzeile'
  },
  {
    nr: '1306', name: 'Der Name an der Linkzeile darf wieder schrumpfen',
    file: 'public/style.css',
    search: ".lrow .lfrom { flex-shrink: 0; font-size: .7rem; color: var(--muted); }",
    replacement: ".lrow .lfrom { font-size: .7rem; color: var(--muted); }",
    expected: 'Der Name an der Linkzeile'
  },
  {
    nr: '1307', name: 'Ein Klick auf eine Datei ohne Vorschau laedt sie herunter',
    file: 'public/app.js',
    search: "    if (!FILE_READABLE.includes(a.preview) && a.preview !== 'audio') return tileMenu(li);\n",
    replacement: "    if (!FILE_READABLE.includes(a.preview) && a.preview !== 'audio') {\n      const load = document.createElement('a');\n      load.href = `/api/attachments/${a.id}/raw`;\n      load.setAttribute('download', '');\n      load.click();\n      return;\n    }\n",
    expected: 'Dateien in Kacheln: Kachel und Klick'
  },
  {
    nr: '1308', name: 'Set statt Nummer: die erste Vorschau bleibt neben der zweiten stehen',
    file: 'public/app.js',
    search: "  function showPreview(a) {\n    dropPreview();\n",
    replacement: "  function showPreview(a) {\n    if (openPreview) previewBox.after(previewBox.cloneNode(true));\n    dropPreview();\n",
    expected: 'Dateien in Kacheln: Kachel und Klick'
  },
  {
    nr: '1309', name: 'Das Neuzeichnen beendet den Betrachter',
    file: 'public/app.js',
    search: "    // Nach einem await kann die Ansicht schon gewechselt haben.\n    if (!attsBox.isConnected) return;\n",
    replacement: "    // Nach einem await kann die Ansicht schon gewechselt haben.\n    if (!attsBox.isConnected) return;\n    endOfficeViewer();\n",
    expected: 'Dateien in Kacheln: der Betrachter uebersteht das Neuzeichnen'
  },
  {
    nr: '1310', name: 'Das Menue bietet Datei loeschen ohne Pruefung der Rechte an',
    file: 'public/app.js',
    search: "    if (mayDeleteFile(a)) drop.push({ label: t('entry.deleteFile'), danger: true, own: true,",
    replacement: "    if (true) drop.push({ label: t('entry.deleteFile'), danger: true, own: true,",
    expected: 'Dateien in Kacheln: das Menue zeigt nur Erlaubtes'
  },
  {
    nr: '1311', name: 'Abbrechen laesst die Datei in der Warteschlange',
    file: 'public/app.js',
    search: "  const at = UPLOADS.indexOf(u);\n  if (at >= 0) UPLOADS.splice(at, 1);\n",
    replacement: "  const at = UPLOADS.indexOf(u);\n",
    expected: 'Dateien in Kacheln: die Warteschlange'
  },
  {
    nr: '1312', name: 'Die Adresse einer Bilddatei oeffnet wieder die eigene Ansicht',
    file: 'public/app.js',
    search: "  if (a && (a.preview === 'video' || a.preview === 'audio' || (a.preview === 'image' && !editWanted))) {",
    replacement: "  if (a && (a.preview === 'video' || a.preview === 'audio')) {",
    expected: 'Dateien in Kacheln: Adresse und Vollbild einer Bilddatei'
  },
  {
    nr: '1313', name: 'Der Server zaehlt je Eintrag bis 20',
    file: 'server.js',
    search: "  if (fileSlots(itemId) >= FILES_PER_ENTRY)\n    return res.status(400)",
    replacement: "  if (fileSlots(itemId) >= 20)\n    return res.status(400)",
    expected: "Dateien in Kacheln: 100 je Eintrag"
  },
  {
    nr: '1314', name: 'Die Warteschlange endet mit der Ansicht des Eintrags',
    file: 'public/app.js',
    search: "  /* Von Hand geoeffnete oder geschlossene Bloecke gelten nur fuer einen Eintrag. */\n  GLANCE.clear();\n",
    replacement: "  /* Von Hand geoeffnete oder geschlossene Bloecke gelten nur fuer einen Eintrag. */\n  GLANCE.clear();\n  for (const u of [...UPLOADS]) uploadCancel(u);\n",
    expected: 'Dateien in Kacheln: die Warteschlange'
  },
  {
    nr: '1315', name: "/raw schickt die Datei ohne Range",
    file: 'server.js',
    search: "    sendRanged(req, res, a.data.subarray(skip));\n",
    replacement: "    res.send(a.data.subarray(skip));\n",
    expected: "Audio bei den Fotos: Auslieferung, FLAC mit ID3-Tag"
  },
  {
    nr: '1316', name: "Ein Video ohne Standbild bekommt ein Bild ohne Quelle",
    file: 'public/app.js',
    search: "      picture: a.missing ? '' : a.preview === 'image' || ((video || audio) && a.still) || a.thumb ? fileTileSource(a) : coming,",
    replacement: "      picture: a.missing ? '' : a.preview === 'image' || video || audio || a.thumb ? fileTileSource(a) : coming,",
    expected: "Videos unter Dateien: Kachel, Vollbild und Tasten"
  },
  {
    nr: '1317', name: "Das Standbild setzt auch der Admin",
    file: 'server.js',
    search: "  if (!selfOnly(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});\n  if (!playsAsVideo(req.params.id, a.filename))",
    replacement: "  if (!mayChange(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});\n  if (!playsAsVideo(req.params.id, a.filename))",
    expected: "Videos unter Dateien: Vorschauart, Range und Standbild am Server"
  },
  {
    nr: '1318', name: "Der Umschlag des Papierkorbs traegt kein Standbild",
    file: 'server.js',
    search: "                    ...(a2.still ? { duration: a2.duration,\n                                     ['still' + extension]: funnel.take(funnel.blobs ? a2.still : null,",
    replacement: "                    ...(a2.still && funnel.blobs ? { duration: a2.duration,\n                                     ['still' + extension]: funnel.take(funnel.blobs ? a2.still : null,",
    expected: "Videos unter Dateien: Papierkorb und Export"
  },
  {
    nr: '1319', name: "Im Vollbild blaettern die Pfeile trotz Fokus auf dem Video",
    file: 'public/app.js',
    search: "    else if (document.activeElement === player || document.activeElement?.mediaPlayer === player) { if (seekVideo(e)) e.stopPropagation(); }\n",
    replacement: "",
    expected: "Videos unter Dateien: Kachel, Vollbild und Tasten"
  },
  {
    nr: '1320', name: "Im Eintrag blaettern die Pfeile trotz Fokus auf dem Kurzvideo",
    file: 'public/app.js',
    search: "    // Ein Video mit Fokus spult, statt zu blaettern.\n    if (seekVideo(e)) return;\n",
    replacement: "",
    expected: "Videos unter Dateien: Kachel, Vollbild und Tasten"
  },
  {
    nr: '1321', name: "Die Adresse eines Videos oeffnet die eigene Ansicht",
    file: 'public/app.js',
    search: "  if (a && (a.preview === 'video' || a.preview === 'audio' || (a.preview === 'image' && !editWanted))) {",
    replacement: "  if (a && (a.preview === 'audio' || (a.preview === 'image' && !editWanted))) {",
    expected: "Videos unter Dateien: Adresse, Marke und Bildleiste"
  },
  {
    nr: '1322', name: "Das Nachholen laeuft bei jedem Zeichnen",
    file: 'public/app.js',
    search: "  if (STILLS_TRIED.has(a.id) || STILLS_ON_WAY.has(a.id)) return;",
    replacement: "  if (STILLS_ON_WAY.has(a.id)) return;",
    expected: "Videos unter Dateien: Standbild beim Hochladen, von Hand und nachgeholt"
  },
  {
    nr: '1323', name: "Die Bildleiste nennt „Dateien“ ohne Blick auf die Grenze „Datei“",
    file: 'public/app.js',
    search: "        + (bigVideo.size > fileLimit() * 1048576 ? '' : ' ' + t('entry.videoToFiles')));",
    replacement: "        + ' ' + t('entry.videoToFiles'));",
    expected: "Videos unter Dateien: Adresse, Marke und Bildleiste"
  },
  {
    nr: '1324', name: "Das Wiederherstellen legt das Standbild nicht an",
    file: 'server.js',
    search: "        if (a2.still) putStill.run(added.lastInsertRowid, a2.duration, a2.still);\n",
    replacement: "",
    expected: "Videos unter Dateien: Papierkorb und Export"
  },
  {
    nr: '1325', name: "Nach dem Upload geht kein Standbild an den Server",
    file: 'public/app.js',
    search: "  stillAfterUpload(u, data);\n",
    replacement: "",
    expected: "Videos unter Dateien: Standbild beim Hochladen, von Hand und nachgeholt"
  },
  {
    nr: '1326', name: "Ein neues Standbild laesst die alte Kachel stehen",
    file: 'server.js',
    search: "      dropFileTile.run(req.params.id);\n",
    replacement: "",
    expected: "Videos unter Dateien: Vorschauart, Range und Standbild am Server"
  },
  {
    nr: '1327', name: "Der Browser spult zusaetzlich zum festen Sprung",
    file: 'public/app.js',
    search: "  else return false;\n  e.preventDefault();\n",
    replacement: "  else return false;\n",
    expected: "Videos unter Dateien: Kachel, Vollbild und Tasten"
  },
  {
    nr: '1328', name: "Der Sprung laeuft ueber Anfang und Ende hinaus",
    file: 'public/app.js',
    search: "  v.currentTime = Math.min(end, Math.max(0, v.currentTime + (e.key === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP)));",
    replacement: "  v.currentTime = v.currentTime + (e.key === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP);",
    expected: "Videos unter Dateien: Kachel, Vollbild und Tasten"
  },
  {
    nr: '1329', name: "Verschieben legt die Datei neu an",
    file: 'server.js',
    search: "    putFileFolder.run(a.id, f.id);\n  }\n  touch.run(a.item_id);",
    replacement: "    const copy = db.prepare(`INSERT INTO attachments (item_id, filename, mime_type, size, data, sort_order, user_id)\n      SELECT item_id, filename, mime_type, size, data, sort_order, user_id FROM attachments WHERE id = ?`)\n      .run(a.id).lastInsertRowid;\n    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);\n    putFileFolder.run(copy, f.id);\n  }\n  touch.run(a.item_id);",
    expected: "Ordner: Schema und Routen"
  },
  {
    nr: '1330', name: "Ordner loeschen loescht die Dateien darin mit",
    file: 'server.js',
    search: "  dropFolder.run(f.id);",
    replacement: "  db.prepare('DELETE FROM attachments WHERE id IN (SELECT attachment_id FROM attachment_folders WHERE folder_id = ?)').run(f.id);\n  dropFolder.run(f.id);",
    expected: "Ordner: Schema und Routen"
  },
  {
    nr: '1331', name: "Ein Ordner nimmt einen Testtag eines anderen Eintrags an",
    file: 'server.js',
    search: "  if (d.item_id !== Number(itemId) || !selfOnly(req, d.user_id)) {",
    replacement: "  if (!selfOnly(req, d.user_id)) {",
    expected: "Platte: Ordner mit Testtag"
  },
  {
    nr: '1332', name: "Umbenennen darf auch der Admin",
    file: 'server.js',
    search: "  if (!selfOnly(req, f.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});\n  const b = req.body || {};",
    replacement: "  if (!mayChange(req, f.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});\n  const b = req.body || {};",
    expected: "Ordner: Schema und Routen"
  },
  {
    nr: '1333', name: "Verschieben vergleicht den Eintrag von Datei und Ordner nicht",
    file: 'server.js',
    search: "    if (f.item_id !== a.item_id || !selfOnly(req, f.user_id))",
    replacement: "    if (!selfOnly(req, f.user_id))",
    expected: "Ordner: Schema und Routen"
  },
  {
    nr: '1334', name: "Der Export traegt keine Ordner",
    file: 'server.js',
    search: "    o.folders = folders.map(f => ({ name: f.name, author: authorName(f.user_id), created_at: f.created_at,\n",
    replacement: "    o.folders = funnel.blobs ? [] : folders.map(f => ({ name: f.name, author: authorName(f.user_id), created_at: f.created_at,\n",
    expected: "Ordner: Export, Import und Papierkorb"
  },
  {
    nr: '1335', name: "Der Export traegt kein Standbild",
    file: 'server.js',
    search: "                    ...(a2.still ? { duration: a2.duration,\n                                     ['still' + extension]: funnel.take(funnel.blobs ? a2.still : null,",
    replacement: "                    ...(a2.still && !funnel.blobs ? { duration: a2.duration,\n                                     ['still' + extension]: funnel.take(funnel.blobs ? a2.still : null,",
    expected: "Ordner: Export, Import und Papierkorb"
  },
  {
    nr: '1336', name: "Der Import legt keine Ordner an",
    file: 'server.js',
    search: "      const folderIds = (Array.isArray(it.folders) ? it.folders : []).map((f, fi) => {",
    replacement: "      const folderIds = [].map((f, fi) => {",
    expected: "Ordner: Export, Import und Papierkorb"
  },
  {
    nr: '1337', name: "Der Papierkorb vergisst die Ordner",
    file: 'server.js',
    search: "    o.folders = folders.map(f => ({ name: f.name, author: authorName(f.user_id), created_at: f.created_at,\n",
    replacement: "    o.folders = !funnel.blobs ? [] : folders.map(f => ({ name: f.name, author: authorName(f.user_id), created_at: f.created_at,\n",
    expected: "Ordner: Export, Import und Papierkorb"
  },
  {
    nr: '1338', name: "Beim Oeffnen eines Eintrags stehen die Ordner offen",
    file: 'public/app.js',
    search: "      const open = FOLDERS_OPEN.open.has(f.id);",
    replacement: "      const open = true;",
    expected: "Ordner: Block, Kopf und Menue"
  },
  {
    nr: '1339', name: "Das Vollbild blaettert ueber die Gruppe hinaus",
    file: 'public/app.js',
    search: "      .filter(a => ['image', 'video', 'audio'].includes(a.preview) && groupOf(a) === key))",
    replacement: "      .filter(a => ['image', 'video', 'audio'].includes(a.preview)))",
    expected: "Ordner: Block, Kopf und Menue"
  },
  {
    nr: '1340', name: "Das Menue eines fremden Ordners steht jedem offen",
    file: 'public/app.js',
    search: "    if (f.mine === true || ADMIN)\n      items.push({ label: t('entry.folderDelete')",
    replacement: "    if (true)\n      items.push({ label: t('entry.folderDelete')",
    expected: "Ordner: Block, Kopf und Menue"
  },
  {
    nr: '1341', name: "Beim Bearbeiten fehlt das ✕ der eigenen Ansicht",
    file: 'public/app.js',
    search: "      <a class=\"fileview-full fileview-close\" href=\"${esc(entryAddress(itemId))}\"",
    replacement: "      <a class=\"fileview-full fileview-close\"${editWanted ? ' hidden' : ''} href=\"${esc(entryAddress(itemId))}\"",
    expected: "Ordner: Adresse, Rueckkehr und das ✕ der eigenen Ansicht"
  },
  {
    nr: '1342', name: "Eine 403 ohne Text zeigt beim Hochladen wieder nur den Statuscode",
    file: 'public/app.js',
    search: "    : data?.error || proxyAnswer(xhr.status) || t('error.serverStatus', { status: xhr.status }));",
    replacement: "    : data?.error || t('error.serverStatus', { status: xhr.status }));",
    expected: "Ordner: Loeschdialoge und die Meldung bei 403"
  },
  /* ---- Dateien auf der Platte ---- */
  {
    nr: '1343', name: "Ein Testtag nimmt einen zweiten Ordner an",
    file: 'server.js',
    search: "  if (taken && taken.id !== folderId) {",
    replacement: "  if (false) {",
    expected: "Platte: Ordner mit Testtag"
  },
  {
    nr: '1344', name: "Der Admin verbindet einen fremden Testtag",
    file: 'server.js',
    search: "  if (d.item_id !== Number(itemId) || !selfOnly(req, d.user_id)) {",
    replacement: "  if (d.item_id !== Number(itemId) || !mayChange(req, d.user_id)) {",
    expected: "Platte: Ordner mit Testtag"
  },
  {
    nr: '1345', name: "Testtag loeschen loescht den Ordner mit",
    file: 'schema.js',
    search: "  test_day_id INTEGER UNIQUE REFERENCES test_days(id) ON DELETE SET NULL",
    replacement: "  test_day_id INTEGER UNIQUE REFERENCES test_days(id) ON DELETE CASCADE",
    expected: "Platte: Ordner mit Testtag"
  },
  {
    nr: '1346', name: "Der Export traegt den Testtag eines Ordners nicht",
    file: 'server.js',
    search: "                                     ...(dayAt.has(f.test_day_id) ? { testDay: dayAt.get(f.test_day_id) } : {}) }));",
    replacement: "                                     }));",
    expected: "Platte: Ordner mit Testtag"
  },
  {
    nr: '1347', name: "Der Beginn eines Uploads nennt den Ordner nicht",
    file: 'public/app.js',
    search: "      { filename: u.name, size: u.size, modified: u.file.lastModified, folderId: u.folderId || null });",
    replacement: "      { filename: u.name, size: u.size, modified: u.file.lastModified, folderId: null });",
    expected: "Ordner: Hochladen und Ablegen"
  },
  {
    nr: '1356', name: "Ein erneutes Stueck wird verschluesselt",
    file: 'server.js',
    search: "  const n = Number(req.headers['upload-offset']);\n  if (n !== u.received)",
    replacement: "  const n = Number(req.headers['upload-offset']);\n  if (n > u.received)",
    expected: "Platte: Stueck, Laenge und Fortsetzen"
  },
  {
    nr: '1357', name: "Die Laenge der Datei unter upload/ wird nicht geprueft",
    file: 'server.js',
    search: "  if (there !== encLen(n)) {",
    replacement: "  if (there < 0) {",
    expected: "Platte: Stueck, Laenge und Fortsetzen"
  },
  {
    nr: '1358', name: "Die Zahlen werden vor der Suche nach dem eigenen Upload geprueft",
    file: 'server.js',
    search: "  // Fortsetzen ohne Pruefung der Zahlen und Grenzen: sie galten beim Beginn.\n  const own = qOwnUpload.get(itemId, req.user.id, filename, size, modified);",
    replacement: "  if (fileSlots(itemId) >= FILES_PER_ENTRY)\n    return res.status(400).json({ error: t(locale, 'server.fileCap', { cap: FILES_PER_ENTRY })});\n  const own = qOwnUpload.get(itemId, req.user.id, filename, size, modified);",
    expected: "Platte: Stueck, Laenge und Fortsetzen"
  },
  {
    nr: '1359', name: "Die Pruefung eines Uploads liest erst den Rumpf",
    file: 'server.js',
    search: "app.put('/api/uploads/:id', uploadTurn, uploadBody, async (req, res, next) => {",
    replacement: "app.put('/api/uploads/:id', express.raw({ type: 'application/octet-stream', limit: '8mb', inflate: false }), uploadTurn, uploadBody, async (req, res, next) => {",
    expected: "Platte: Pruefungen vor dem Rumpf"
  },
  {
    nr: '1360', name: "Ein fremder Upload nimmt Stuecke an",
    file: 'server.js',
    search: "  if (!u || !selfOnly(req, u.user_id)) return res.status(404).json({ error: t(locale, 'server.uploadGone') });",
    replacement: "  if (!u) return res.status(404).json({ error: t(locale, 'server.uploadGone') });",
    expected: "Platte: Pruefungen vor dem Rumpf"
  },
  {
    nr: '1361', name: "Ein falscher Offset wird nicht abgewiesen",
    file: 'server.js',
    search: "  const n = Number(req.headers['upload-offset']);\n  if (n !== u.received)\n    return res.status(409).json({ error: t(locale, 'server.uploadOffset'), received: u.received });\n",
    replacement: "  const n = Number(req.headers['upload-offset']);\n",
    expected: "Platte: Pruefungen vor dem Rumpf"
  },
  {
    nr: '1362', name: "Zu viele Bytes werden nicht abgewiesen",
    file: 'server.js',
    search: "  if (Number(req.headers['content-length']) !== piece)\n    return res.status(400).json({ error: t(locale, 'server.uploadPiece') });\n",
    replacement: "",
    expected: "Platte: Pruefungen vor dem Rumpf"
  },
  {
    nr: '1363', name: "Ohne Platz nimmt ein Upload weiter Stuecke an",
    file: 'server.js',
    search: "  const short = spaceShort(encLen(u.size) - encLen(n), u.id);\n  if (short) return refuseSpace(req, res, short);\n",
    replacement: "",
    expected: "Platte: Pruefungen vor dem Rumpf"
  },
  {
    nr: '1364', name: "Die volle Zahl offener Uploads sperrt nicht",
    file: 'server.js',
    search: "  if (open.length >= UPLOADS_PER_USER)",
    replacement: "  if (false)",
    expected: "Platte: Pruefungen vor dem Rumpf"
  },
  {
    nr: '1365', name: "Scheitert statfs, gilt die Platte als voll",
    file: 'server.js',
    search: "  const free = diskFree();\n  if (free === null) return null;",
    replacement: "  const free = diskFree();\n  if (free === null) return { free: 0, reserved: 0, needed, reserve: 0 };",
    expected: "Platte: Pruefungen vor dem Rumpf"
  },
  {
    nr: '1366', name: "Die Stueckgrenze ist verschoben",
    file: 'server.js',
    search: "    const first = Math.floor(from / f.chunk), last = f.size ? Math.floor(to / f.chunk) : -1;",
    replacement: "    const first = Math.floor((from + 1) / f.chunk), last = f.size ? Math.floor(to / f.chunk) : -1;",
    expected: "Platte: Ranges und HEAD"
  },
  {
    nr: '1367', name: "Ein Range hinter dem Ende wird zurechtgebogen",
    file: 'attachments.js',
    search: "    if (from >= size) return { invalid: true };",
    replacement: "    if (from >= size) from = size - 1;",
    expected: "Platte: Ranges und HEAD"
  },
  {
    nr: '1368', name: "HEAD prueft die Laenge der Datei nicht",
    file: 'server.js',
    search: "      if ((await handle.stat()).size !== encLen(f.size, f.chunk)) return res.status(500).end();\n",
    replacement: "",
    expected: "Platte: Ranges und HEAD"
  },
  {
    nr: '1369', name: "Ein Proxy darf die Auslieferung umformen",
    file: 'server.js',
    search: "  res.set('Cache-Control', 'private, max-age=3600, no-transform');",
    replacement: "  res.set('Cache-Control', 'private, max-age=3600');",
    expected: "Platte: Ranges und HEAD"
  },
  {
    nr: '1372', name: "Die Umlagerung leert data nicht",
    file: 'server.js',
    search: "      emptyFile.run(id);\n      if (before) emptyPrevious.run(id);",
    replacement: "      if (before) emptyPrevious.run(id);",
    expected: "Platte: Umlagerung"
  },
  {
    nr: '1373', name: "Die Umlagerung vergleicht saves nicht",
    file: 'server.js',
    search: "      if (editingOf(id).saves !== saves) return 'changed';\n",
    replacement: "",
    expected: "Platte: Umlagerung"
  },
  {
    nr: '1375', name: "Der Lauf holt die Umlagerung nicht nach",
    file: 'server.js',
    search: "  if (!DATABASE_INCOMPLETE) await relocate(qRelocatePending.all().map(z => z.id));\n",
    replacement: "",
    expected: "Platte: Umlagerung"
  },
  {
    nr: '1376', name: "Das Verschieben aus dem Ordner holt die Datei in die Datenbank zurueck",
    file: 'server.js',
    search: "  if (wanted === null) dropFileFolder.run(a.id);",
    replacement: "  if (wanted === null) { dropFileFolder.run(a.id); db.prepare('DELETE FROM disk_files WHERE attachment_id = ?').run(a.id); }",
    expected: "Platte: kein Weg zurueck"
  },
  {
    nr: '1377', name: "Der Rueckschrieb ueberschreibt die Datei an ihrer Stelle",
    file: 'server.js',
    search: "      ? { name: freshName(), key: crypto.randomBytes(32), chunk: CHUNK, size: got.data.length } : null;",
    replacement: "      ? { name: qDiskName.get(id).name, key: crypto.randomBytes(32), chunk: CHUNK, size: got.data.length } : null;",
    expected: "Platte: Rueckschrieb des Document Servers"
  },
  {
    nr: '1378', name: "Die aeltere vorige Fassung bleibt",
    file: 'server.js',
    search: "      if (first) diskDropPrevious.run(id);\n",
    replacement: "",
    expected: "Platte: Rueckschrieb des Document Servers"
  },
  {
    nr: '1379', name: "Wiederherstellen nimmt die Groesse aus data",
    file: 'server.js',
    search: "  const before = db.prepare('SELECT filename, mime_type, size FROM attachment_previous WHERE attachment_id = ?').get(id);",
    replacement: "  const before = db.prepare('SELECT filename, mime_type, length(data) AS size FROM attachment_previous WHERE attachment_id = ?').get(id);",
    expected: "Platte: Rueckschrieb des Document Servers"
  },
  {
    nr: '1380', name: "Vorschau und Document Server entschluesseln die Datei nicht",
    file: 'server.js',
    search: "  if (!f) return data;\n  if (f.large) return null;",
    replacement: "  if (!f) return data;\n  return null;",
    expected: "Platte: Rueckschrieb des Document Servers"
  },
  {
    nr: '1381', name: "Der Trigger disk_files_orphaned fehlt",
    file: 'db.js',
    search: "  INSERT OR IGNORE INTO disk_files_gone (name) VALUES (new.name);\n  DELETE FROM disk_files WHERE id = new.id;",
    replacement: "  SELECT 1;",
    expected: "Platte: Trigger und Loeschliste"
  },
  {
    nr: '1382', name: "Der Trigger disk_files_held fehlt",
    file: 'db.js',
    search: "BEGIN SELECT RAISE(ABORT, 'disk file stays with its attachment'); END",
    replacement: "BEGIN SELECT 1; END",
    expected: "Platte: Trigger und Loeschliste"
  },
  {
    nr: '1383', name: "Der Trigger disk_files_kept fehlt",
    file: 'db.js',
    search: "BEGIN SELECT RAISE(ABORT, 'disk file has an owner'); END",
    replacement: "BEGIN SELECT 1; END",
    expected: "Platte: Trigger und Loeschliste"
  },
  {
    nr: '1384', name: "Die Ausnahme in disk_files_held vergleicht old.attachment_id nicht",
    file: 'db.js',
    search: "   AND NOT (new.attachment_id IS NULL AND new.previous_of IS old.attachment_id)",
    replacement: "   AND NOT (new.attachment_id IS NULL AND new.previous_of IS NOT NULL)",
    expected: "Platte: Trigger und Loeschliste"
  },
  {
    nr: '1385', name: "Die Datei wird vor dem Commit geloescht",
    file: 'server.js',
    search: "    fileIntoTrash(Number(req.params.id), req.user.id);\n    db.prepare('DELETE FROM attachments WHERE id = ?').run(req.params.id);",
    replacement: "    const early = qDiskName.get(req.params.id);\n    if (early) fs.rmSync(diskPath(early.name), { force: true });\n    fileIntoTrash(Number(req.params.id), req.user.id);\n    db.prepare('DELETE FROM attachments WHERE id = ?').run(req.params.id);",
    expected: "Platte: Trigger und Loeschliste"
  },
  {
    nr: '1386', name: "sweepDisk gleicht das Verzeichnis ab statt der Liste",
    file: 'server.js',
    search: "  const names = qGone.all().map(z => z.name);\n  if (!names.length) return;",
    replacement: "  const known = new Set(qDiskNames.all().map(z => z.name));\n  const names = [...qGone.all().map(z => z.name),\n    ...fs.readdirSync(FILES_DIR).filter(n => DISK_NAME.test(n) && !known.has(n))];\n  if (!names.length) return;",
    expected: "Platte: unbekannte Dateien und Wiederherstellen"
  },
  {
    nr: '1387', name: "/api/import loest data_stored auf",
    file: 'server.js',
    search: "      const stored = bytesSource && typeof a2.data_stored === 'string' && DISK_NAME.test(a2.data_stored)",
    replacement: "      const stored = typeof a2.data_stored === 'string' && DISK_NAME.test(a2.data_stored)",
    expected: "Platte: unbekannte Dateien und Wiederherstellen"
  },
  {
    nr: '1388', name: "Wiederherstellen prueft nicht, ob die Datei noch zur Zeile in trash gehoert",
    file: 'server.js',
    search: "        const fromTrash = a2.stored ? qTrashDisk.get(a2.stored, trashId) : null;\n        if (a2.stored && !fromTrash) throw trashGone();\n        const size = a2.disk ? a2.disk.size : fromTrash ? fromTrash.size : a2.buf.length;\n        const added = iAttachmentAdd().run(id, a2.name, a2.mime, size, a2.buf || NO_BYTES, i, whose);\n        if (a2.disk) addDiskFile.run(a2.disk.name, a2.disk.size, CHUNK, a2.disk.key, added.lastInsertRowid, null);\n        if (a2.stored && diskFromTrash.run(added.lastInsertRowid, a2.stored, trashId).changes !== 1) throw trashGone();",
    replacement: "        const fromTrash = a2.stored ? qTrashDisk.get(a2.stored, trashId) : null;\n        const size = a2.disk ? a2.disk.size : fromTrash ? fromTrash.size : a2.buf ? a2.buf.length : 0;\n        const added = iAttachmentAdd().run(id, a2.name, a2.mime, size, a2.buf || NO_BYTES, i, whose);\n        if (a2.disk) addDiskFile.run(a2.disk.name, a2.disk.size, CHUNK, a2.disk.key, added.lastInsertRowid, null);\n        if (a2.stored) diskFromTrash.run(added.lastInsertRowid, a2.stored, trashId);",
    expected: "Platte: unbekannte Dateien und Wiederherstellen"
  },
  {
    nr: '1389', name: "Die Backup-Kopie haelt das Loeschen nicht an",
    file: 'server.js',
    search: "  SWEEP_HELD++;\n  let answered = false;",
    replacement: "  let answered = false;",
    expected: "Platte: Backup mit Dateien"
  },
  {
    nr: '1390', name: "Die Liste des Backups kommt aus der laufenden Datenbank",
    file: 'backup.js',
    search: "    writeList(file, rows, version, before);",
    replacement: "    writeList(file, db.prepare('SELECT name, size, chunk FROM disk_files ORDER BY id').all()\n      .map(z => ({ name: z.name, length: encLen(z.size, z.chunk) })), version, before);",
    expected: "Platte: Backup mit Dateien"
  },
  {
    nr: '1391', name: "Das Backup antwortet immer mit 202",
    file: 'server.js',
    search: "        if (!state.running) return;\n        res.status(202)",
    replacement: "        if (false) return;\n        res.status(202)",
    expected: "Platte: Backup mit Dateien"
  },
  {
    nr: '1392', name: "Die Sperre des Backups gilt nur im Speicher",
    file: 'backup.js',
    search: "      fs.writeFileSync(lock, note, { flag: 'wx' });",
    replacement: "      fs.writeFileSync(lock, note);",
    expected: "Platte: Backup mit Dateien"
  },
  {
    nr: '1393', name: "Das Aufraeumen nach dem Backup loescht ohne Muster",
    file: 'backup.js',
    search: "    if (!m || (!m[2] && named.has(m[1]))) continue;",
    replacement: "    if (m && !m[2] && named.has(m[1])) continue;",
    expected: "Platte: Backup mit Dateien"
  },
  {
    nr: '1394', name: "Dateien ohne Verweis loescht jeder Admin",
    file: 'server.js',
    search: "app.delete('/api/files/unknown', ownerOnly, (req, res) => {",
    replacement: "app.delete('/api/files/unknown', adminOnly, (req, res) => {",
    expected: "Platte: Dateien ohne Verweis loeschen"
  },
  {
    nr: '1395', name: "Dateien ohne Verweis: die Freigabe des Abgleichs wird nicht geprueft",
    file: 'server.js',
    search: "    for (const f of unknownScan().filter(z => z.free && wanted.has(z.name))) {",
    replacement: "    for (const f of unknownScan().filter(z => wanted.has(z.name))) {",
    expected: "Platte: Dateien ohne Verweis loeschen"
  },
  {
    nr: '1396', name: "Dateien ohne Verweis: die Laenge der Kopie wird nicht verglichen",
    file: 'server.js',
    search: "    else if (folder && backup.copyPresent(folder, { name: f.name, length: f.size })) why = 'copied';",
    replacement: "    else if (folder && fs.existsSync(path.join(folder, COPY_DIR, f.name))) why = 'copied';",
    expected: "Platte: Dateien ohne Verweis loeschen"
  },
  {
    nr: '1397', name: "Dateien ohne Verweis: der Abgleich kennt disk_files nicht",
    file: 'server.js',
    search: "  const known = new Set([...qDiskNames.all(), ...qGone.all()].map(z => z.name));",
    replacement: "  const known = new Set(qGone.all().map(z => z.name));",
    expected: "Platte: Dateien ohne Verweis loeschen"
  },
  {
    nr: '1398', name: "Dateien ohne Verweis: der Abgleich kennt die Loeschliste nicht",
    file: 'server.js',
    search: "  const known = new Set([...qDiskNames.all(), ...qGone.all()].map(z => z.name));",
    replacement: "  const known = new Set(qDiskNames.all().map(z => z.name));",
    expected: "Platte: Dateien ohne Verweis loeschen"
  },
  {
    nr: '1399', name: "Dateien ohne Verweis: upload/ gilt als fremdes Verzeichnis",
    file: 'server.js',
    search: "    if (st.isDirectory() && OWN_DIRS.has(name)) continue;\n",
    replacement: "",
    expected: "Platte: Dateien ohne Verweis loeschen"
  },
  {
    nr: '1400', name: "Dateien ohne Verweis: die Sperre des Backups wird nicht genommen",
    file: 'server.js',
    search: "  const lock = folder ? takeBackupLock(folder) : null;\n  if (folder ? !lock : BACKUP_BUSY) return res.status(409).json({ error: t(localeOf(req), 'server.backupRunning')});\n",
    replacement: "  const lock = null;\n",
    expected: "Platte: Dateien ohne Verweis loeschen"
  },
  {
    nr: '1401', name: "Der Abgleich unter upload/ kennt disk_files nicht",
    file: 'server.js',
    search: "  const known = new Set([...qUploadNames.all(), ...qDiskNames.all()].map(z => z.name));",
    replacement: "  const known = new Set(qUploadNames.all().map(z => z.name));",
    expected: "Platte: Lauf und upload/"
  },
  {
    nr: '1402', name: "Nur der Start holt ein rename nach",
    file: 'server.js',
    search: "    // Abschluesse nachholen: die Zeile steht, die Datei liegt noch unter upload/.\n    try {",
    replacement: "    // Abschluesse nachholen: die Zeile steht, die Datei liegt noch unter upload/.\n    if (start) try {",
    expected: "Platte: Lauf und upload/"
  },
  {
    nr: '1403', name: "Der Lauf liest die Namen im Speicher nicht",
    file: 'server.js',
    search: "  const known = new Set([...qUploadNames.all(), ...qDiskNames.all()].map(z => z.name));\n  for (const name of names) {\n    if (!DISK_NAME.test(name) || known.has(name) || DISK_WRITING.has(name)) continue;",
    replacement: "  const known = new Set([...qUploadNames.all(), ...qDiskNames.all()].map(z => z.name));\n  for (const name of names) {\n    if (!DISK_NAME.test(name) || known.has(name)) continue;",
    expected: "Platte: Lauf und upload/"
  },
  {
    nr: '1404', name: "sweepDisk vergleicht checkpointed nicht mit log",
    file: 'server.js',
    search: "  if (!mark || mark.checkpointed !== mark.log) return;",
    replacement: "  if (!mark) return;",
    expected: "Platte: Checkpoint und FULL"
  },
  {
    nr: '1405', name: "Der Abschluss committet ohne synchronous = FULL",
    file: 'server.js',
    search: "  db.pragma('synchronous = FULL');\n",
    replacement: "",
    expected: "Platte: Checkpoint und FULL"
  },
  {
    nr: '1406', name: "Eine Datei auf der Platte geht ohne Inhalt in den Export",
    file: 'server.js',
    search: "  if (a2.large) return {};\n  if (funnel.stream)",
    replacement: "  if (a2.large || a2.stored) return {};\n  if (funnel.stream)",
    expected: "Platte: Export und Import"
  },
  {
    nr: '1407', name: "Ein grosses Video geht mit Inhalt in den Export",
    file: 'server.js',
    search: "  if (a2.large) return {};\n  if (funnel.stream) return { ['data' + extension]: funnel.take(null, ['disk', a2.id]) };",
    replacement: "  if (funnel.stream) return { ['data' + extension]: funnel.take(null, ['disk', a2.id]) };\n  if (a2.large) return {};",
    expected: "Platte: Export und Import"
  },
  {
    nr: '1408', name: "Der Import legt alles in die Datenbank",
    file: 'server.js',
    search: "      if (buf) {",
    replacement: "      if (false) {",
    expected: "Platte: Export und Import"
  },
  {
    nr: '1409', name: "Der Plan zaehlt grosse Videos mit",
    file: 'server.js',
    search: "                    WHERE a.item_id = i.id AND d.large = 0), 0) AS attachment,",
    replacement: "                    WHERE a.item_id = i.id), 0) AS attachment,",
    expected: "Platte: Export und Import"
  },
  {
    nr: '1410', name: "Der Plan zaehlt Dateien auf der Platte nicht",
    file: 'server.js',
    search: "      + COALESCE((SELECT SUM(d.size) FROM disk_files d JOIN attachments a ON a.id = d.attachment_id\n                    WHERE a.item_id = i.id AND d.large = 0), 0) AS attachment,",
    replacement: "      AS attachment,",
    expected: "Platte: Export und Import"
  },
  {
    nr: '1411', name: "Der Upload in einen geloeschten Ordner geht verloren",
    file: 'server.js',
    search: "function finishUpload(req, res, u) {\n  const added = commitFull(() => {",
    replacement: "function finishUpload(req, res, u) {\n  if (u.folder_id == null) { dropUpload.run(u.id); return res.status(404).json({ error: t(localeOf(req), 'server.folderGone') }); }\n  const added = commitFull(() => {",
    expected: "Platte: Upload in einen geloeschten Ordner"
  },
  {
    nr: '1412', name: "Die Sperre eines Uploads faellt bei close",
    file: 'server.js',
    search: "  rawPiece(req, res, (err) => {",
    replacement: "  req.on('close', () => UPLOADS_RUNNING.delete(req.upload.id));\n  rawPiece(req, res, (err) => {",
    expected: "Platte: Abbruch und zweite Anfrage"
  },
  {
    nr: '1413', name: "Das Entschluesseln gibt ein Stueck vor der Pruefung der Marke heraus",
    file: 'attachments.js',
    search: "  try { d.final(); } catch { throw damaged('tag'); }",
    replacement: "  try { d.final(); } catch {}",
    expected: "Platte: beschaedigte Datei"
  },
  {
    nr: '1414', name: "Ein Stueck geht unverschluesselt auf die Platte",
    file: 'attachments.js',
    search: "  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);",
    replacement: "  c.update(plain);\n  c.final();\n  return Buffer.concat([plain, c.getAuthTag()]);",
    expected: "Platte: beschaedigte Datei"
  },
  {
    nr: '1415', name: "Ein Klick auf den Kopf nach einem Sprung schreibt BLOCKS.closed",
    file: 'public/app.js',
    search: "      } else if (JUMPED.has(name)) {\n        // Ein Sprung hat ihn geoeffnet: zuklappen, die Einstellung bleibt.\n        JUMPED.delete(name);\n      } else {",
    replacement: "      } else {",
    expected: "Platte: ein Sprung oeffnet den Block nur fuer die Ansicht"
  },
  {
    nr: '1416', name: "keytool.sh nennt wieder rm -rf data als Rueckweg",
    file: 'keytool.sh',
    search: "      echo \"      find data -mindepth 1 -maxdepth 1 ! -name files -exec rm -rf {} + && cp -a $ZIEL/. data/\"",
    replacement: "      echo \"      rm -rf data && cp -a $ZIEL data\"",
    expected: "Dateien auf der Platte im Quelltext"
  },
  {
    nr: '1417', name: "Die Liste der Anweisungen auf data ist gekuerzt",
    file: 'test/source.js',
    search: "    'SELECT COALESCE(SUM(length(data)),0) n FROM attachments',\n",
    replacement: "",
    expected: "Dateien auf der Platte im Quelltext"
  },
  {
    nr: '1418', name: "file_key wird mit SELECT * gelesen",
    file: 'server.js',
    search: "const qDiskFile = db.prepare('SELECT id, name, size, chunk, large, file_key FROM disk_files WHERE attachment_id = ?');",
    replacement: "const qDiskFile = db.prepare('SELECT * FROM disk_files WHERE attachment_id = ?');",
    expected: "Dateien auf der Platte im Quelltext"
  },
  {
    nr: '1419', name: "filesView fehlt unter den persoenlichen Schluesseln",
    file: 'server.js',
    search: "const PERSONAL_KEYS = ['documentTheme', 'filesEditAll', 'filesView',",
    replacement: "const PERSONAL_KEYS = ['documentTheme', 'filesEditAll',",
    expected: "Dateien: die Einstellung Kacheln oder Liste"
  },
  {
    nr: '1420', name: "filesView nimmt jeden Wert an",
    file: 'server.js',
    search: "      take('filesView');\n",
    replacement: "      if (req.body.filesView !== undefined) putUserSetting(req.user.id, 'filesView', JSON.stringify(String(req.body.filesView)));\n",
    expected: "Dateien: die Einstellung Kacheln oder Liste"
  },
  {
    nr: '1421', name: "Ohne eigene Wahl gilt die Liste",
    file: 'server.js',
    search: "  filesView:   { list: ['tiles', 'list'],  cast: String, fallback: 'tiles',",
    replacement: "  filesView:   { list: ['tiles', 'list'],  cast: String, fallback: 'list',",
    expected: "Dateien: die Einstellung Kacheln oder Liste"
  },
  {
    nr: '1422', name: "Das SVG aus Text maskiert nichts",
    file: 'attachments.js',
    search: "const xmlText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');",
    replacement: "const xmlText = (s) => s;",
    expected: "Dateien: Vorschaubild einer Textdatei"
  },
  {
    nr: '1423', name: "Steuerzeichen bleiben im SVG",
    file: 'attachments.js',
    search: "const XML_UNFIT = /[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\ufffe\\uffff]/g;",
    replacement: "const XML_UNFIT = /(?!)/g;",
    expected: "Dateien: Vorschaubild einer Textdatei"
  },
  {
    nr: '1424', name: "Das SVG aus Text zeigt keine Zeile",
    file: 'attachments.js',
    search: "  const spans = rows.map((l, i) =>",
    replacement: "  const spans = [].map((l, i) =>",
    expected: "Dateien: Vorschaubild einer Textdatei"
  },
  {
    nr: '1426', name: "Der Upload in Stuecken stellt nichts in die Warteschlange",
    file: 'server.js',
    search: "  if (docTileKind(u.filename)) docTilesSoon([added]);\n",
    replacement: "",
    expected: "Dateien: Vorschaubild einer Textdatei im Ordner mit Testtag"
  },
  {
    nr: '1427', name: "Ein PDF bekommt kein Vorschaubild",
    file: 'server.js',
    search: "  return kind === 'pdf' || docserver.officeType(filename) ? 'office' : null;",
    replacement: "  return docserver.officeType(filename) ? 'office' : null;",
    expected: "Dateien: Vorschaubild ueber den Document Server"
  },
  {
    nr: '1428', name: "Die Abrufroute liefert kein PDF",
    file: 'server.js',
    search: "  if (!a || docTileKind(a.filename) !== 'office') return res.status(404).end();",
    replacement: "  if (!a || !docserver.officeType(a.filename)) return res.status(404).end();",
    expected: "Dateien: Vorschaubild ueber den Document Server"
  },
  {
    nr: '1429', name: "Die Abrufroute liefert jede Datei",
    file: 'server.js',
    search: "  if (!a || docTileKind(a.filename) !== 'office') return res.status(404).end();",
    replacement: "  if (!a) return res.status(404).end();",
    expected: "Dateien: Vorschaubild ueber den Document Server"
  },
  {
    nr: '1430', name: "Die Umwandlung verlangt keine erste Seite",
    file: 'docserver.js',
    search: "      url: fileUrl(attachment.id), thumbnail: { aspect: 1, first: true, width: 512, height: 724 }\n",
    replacement: "      url: fileUrl(attachment.id)\n",
    expected: "Dateien: Vorschaubild ueber den Document Server"
  },
  {
    nr: '1431', name: "Der Schluessel des Vorschaubilds kennt keine Speicherung",
    file: 'docserver.js',
    search: "      key: 'tile-' + documentKey(attachment, `v${saves}`), title: attachment.filename,",
    replacement: "      key: 'tile-' + documentKey(attachment, 'v0'), title: attachment.filename,",
    expected: "Dateien: ein neuer Stand bekommt ein neues Vorschaubild"
  },
  {
    nr: '1432', name: "-3 gilt als voruebergehend",
    file: 'docserver.js',
    search: "const PAGE_REFUSED = new Set([-3, -5, -9, -10]);",
    replacement: "const PAGE_REFUSED = new Set([-5, -9, -10]);",
    expected: "Dateien: Fehler des Document Servers"
  },
  {
    nr: '1433', name: "Jede Antwort ohne Bild gilt als Absage",
    file: 'docserver.js',
    search: "  if (j.endConvert !== true || !j.fileUrl) return {};",
    replacement: "  if (j.endConvert !== true || !j.fileUrl) return { refused: true };",
    expected: "Dateien: Fehler des Document Servers"
  },
  {
    nr: '1434', name: "Das Vorschaubild eines Dokuments entsteht beim Abruf",
    file: 'server.js',
    search: "  if (!row && picture) {",
    replacement: "  if (!row) {",
    expected: "Dateien: Fehler des Document Servers"
  },
  {
    nr: '1435', name: "Ein Fehlschlag steht weiter aus",
    file: 'server.js',
    search: "\n                                                  && !TILES_FAILED.has(a2.id) } : {})",
    replacement: "\n                                                  } : {})",
    expected: "Dateien: Fehler des Document Servers"
  },
  {
    nr: '1436', name: "Ohne Document Server steht ein Vorschaubild aus",
    file: 'server.js',
    search: "thumbSoon: !a2.has_tile && (tileKind === 'text' || officeOn)",
    replacement: "thumbSoon: !a2.has_tile && (tileKind === 'text' || true)",
    expected: "Dateien: Nachholen beim Start, stuendlich und beim Einschalten"
  },
  {
    nr: '1437', name: "Beim Start wird nichts nachgeholt",
    file: 'server.js',
    search: "  // Erst hier: der Document Server holt die Datei bei diesem Server ab.\n  docTilesSoon();\n",
    replacement: "",
    expected: "Dateien: Nachholen beim Start, stuendlich und beim Einschalten"
  },
  {
    nr: '1438', name: "Der wiederkehrende Lauf holt nichts nach",
    file: 'server.js',
    search: "  diskRunLogged(false);\n  docTilesAgain();\n",
    replacement: "  diskRunLogged(false);\n",
    expected: "Dateien: Nachholen beim Start, stuendlich und beim Einschalten"
  },
  {
    nr: '1439', name: "Das Einschalten des Document Servers holt nichts nach",
    file: 'server.js',
    search: "  if (req.body.documentServer === true) docTilesAgain();\n",
    replacement: "",
    expected: "Dateien: Nachholen beim Start, stuendlich und beim Einschalten"
  },
  {
    nr: '1440', name: "Das Einschalten versucht nicht, was ohne Antwort blieb",
    file: 'server.js',
    search: "  if (req.body.documentServer === true) docTilesAgain();\n",
    replacement: "  if (req.body.documentServer === true) docTilesSoon();\n",
    expected: "Dateien: Nachholen beim Start, stuendlich und beim Einschalten"
  },
  {
    nr: '1441', name: "Speichern aus dem Editor behaelt das alte Vorschaubild",
    file: 'server.js',
    search: "    recordSave.run(id, by);\n    dropFileTile.run(id);\n",
    replacement: "    recordSave.run(id, by);\n",
    expected: "Dateien: ein neuer Stand bekommt ein neues Vorschaubild"
  },
  {
    nr: '1442', name: "Die vorige Fassung behaelt das Vorschaubild",
    file: 'server.js',
    search: "  dropFileTile.run(a.id);\n",
    replacement: "",
    expected: "Dateien: ein neuer Stand bekommt ein neues Vorschaubild"
  },
  {
    nr: '1443', name: "Import und Papierkorb holen kein Vorschaubild nach",
    file: 'server.js',
    search: "  if (stats.attachments) {\n    docTilesSoon();\n",
    replacement: "  if (stats.attachments) {\n",
    expected: "Dateien: ein neuer Stand bekommt ein neues Vorschaubild"
  },
  {
    nr: '1444', name: "Ein Bild vom Stand vor dem Speichern wird gespeichert",
    file: 'server.js',
    search: "  if (!now || now.has_tile || now.saves !== a.saves || now.size !== a.size || now.filename !== a.filename) return;",
    replacement: "  if (!now || now.has_tile) return;",
    expected: "Dateien: ein neuer Stand bekommt ein neues Vorschaubild"
  },
  {
    nr: '1445', name: "Die Gruppe ist keine Karte",
    file: 'public/style.css',
    search: ".agroup { padding: 2px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); }",
    replacement: ".agroup { padding: 2px 10px; }",
    expected: "Dateien: Stilblatt, Dockerfile und Quelltext"
  },
  {
    nr: '1446', name: "Der offene Ordner rueckt wieder ein",
    file: 'public/style.css',
    search: ".afolder-body { padding: 0 6px 2px; }",
    replacement: ".afolder-body { padding-left: 18px; }",
    expected: "Dateien: Stilblatt, Dockerfile und Quelltext"
  },
  {
    nr: '1447', name: "Das Image hat keine Schrift",
    file: 'Dockerfile',
    search: " && apt-get install -y --no-install-recommends fonts-dejavu-core libx264-164",
    replacement: " && apt-get install -y --no-install-recommends libx264-164",
    expected: "Dateien: Stilblatt, Dockerfile und Quelltext"
  },
  {
    nr: '1448', name: "Die gespeicherte Wahl wird nicht gelesen",
    file: 'public/app.js',
    search: "  if (SETTINGS.filesView === 'tiles' || SETTINGS.filesView === 'list') FILES_VIEW = SETTINGS.filesView;\n",
    replacement: "",
    expected: "Dateien: Kacheln oder Liste im Browser"
  },
  {
    nr: '1449', name: "Der Umschalter setzt die Klasse nicht",
    file: 'public/app.js',
    search: "    fileBlock.classList.toggle('alist', FILES_VIEW === 'list');\n",
    replacement: "",
    expected: "Dateien: Kacheln oder Liste im Browser"
  },
  {
    nr: '1450', name: "Der Umschalter speichert nicht",
    file: 'public/app.js',
    search: "    try { await api('PUT', '/api/settings', { filesView: FILES_VIEW }); }\n",
    replacement: "    try { await Promise.resolve(); }\n",
    expected: "Dateien: Kacheln oder Liste im Browser"
  },
  {
    nr: '1451', name: "Die Spalte Von steht immer",
    file: 'public/app.js',
    search: "    fileBlock.classList.toggle('afrom-on', multipleUsers());\n",
    replacement: "    fileBlock.classList.toggle('afrom-on', true);\n",
    expected: "Dateien: Kacheln oder Liste im Browser"
  },
  {
    nr: '1452', name: "Die Spalte Datum bleibt leer",
    file: 'public/app.js',
    search: "    li.querySelector('.adate').textContent = date;\n",
    replacement: "",
    expected: "Dateien: Kacheln oder Liste im Browser"
  },
  {
    nr: '1453', name: "„+“ hat in der Liste keinen Namen",
    file: 'public/app.js',
    search: "    li.querySelector('.aname').textContent = t('entry.fileAdd');\n",
    replacement: "",
    expected: "Dateien: Kacheln oder Liste im Browser"
  },
  {
    nr: '1454', name: "Ein Dokument mit Vorschaubild zeigt die Endung",
    file: 'public/app.js',
    search: "      picture: a.missing ? '' : a.preview === 'image' || ((video || audio) && a.still) || a.thumb ? fileTileSource(a) : coming,",
    replacement: "      picture: a.missing ? '' : a.preview === 'image' || ((video || audio) && a.still) ? fileTileSource(a) : coming,",
    expected: "Dateien: Vorschaubild und Nachladen im Browser"
  },
  {
    nr: '1455', name: "Das Vorschaubild eines Dokuments hat kein v=",
    file: 'public/app.js',
    search: "const fileTileSource = (a) => `/api/attachments/${Number(a.id)}/raw?size=thumb${a.still || a.thumb\n  ? `&v=${Number(a.still || a.thumb)}` : ''}`;",
    replacement: "const fileTileSource = (a) => `/api/attachments/${Number(a.id)}/raw?size=thumb${a.still\n  ? `&v=${Number(a.still)}` : ''}`;",
    expected: "Dateien: Vorschaubild und Nachladen im Browser"
  },
  {
    nr: '1456', name: "Ueber dem Vorschaubild steht keine Endung",
    file: 'public/app.js',
    search: "badge: a.thumb ? kind : '',",
    replacement: "badge: '',",
    expected: "Dateien: Vorschaubild und Nachladen im Browser"
  },
  {
    nr: '1457', name: "Der Browser fragt nicht nach",
    file: 'public/app.js',
    search: "    setUpBlocksOut(item);\n    awaitTiles();\n",
    replacement: "    setUpBlocksOut(item);\n",
    expected: "Dateien: Vorschaubild und Nachladen im Browser"
  },
  {
    nr: '1458', name: "Der Browser fragt auch nach dem Verlassen nach",
    file: 'public/app.js',
    search: "      tileTries++;\n      if (!attsBox.isConnected) return;\n",
    replacement: "      tileTries++;\n",
    expected: "Dateien: Vorschaubild und Nachladen im Browser"
  },
  {
    nr: '1459', name: "Der Pfad fuer NPMplus traegt wieder {32}",
    file: 'README-de.md',
    search: "  `^/api/(import|uploads/[0-9a-f]+|(items|comments)/[0-9]+/(photos|videos|audio|comments|images))$`",
    replacement: "  `^/api/(import|uploads/[0-9a-f]{32}|(items|comments)/[0-9]+/(photos|videos|audio|comments|images))$`",
    expected: "Reverse Proxy: die Pfade fuer NPMplus in der README"
  },
  /* ---- 0.50.0: ein Weg fuer Dateien, Umlagerung, Videostelle, Ordnerzustand, Auswahl ---- */
  {
    nr: '1460', name: "Die Umlagerung nach dem Start faellt weg",
    file: 'server.js',
    search: "  if (!DATABASE_INCOMPLETE) await relocate(qRelocatePending.all().map(z => z.id));\n",
    replacement: "",
    expected: "Umlagerung: der Bestand der Datenbank geht nach dem Start auf die Platte"
  },
  {
    nr: '1461', name: "Die vorige Fassung bleibt bei der Umlagerung zurueck",
    file: 'server.js',
    search: "                 ...(before ? [{ data: before.data, current: null, previous: id }] : [])]",
    replacement: "                 ...([])]",
    expected: "Umlagerung: der Bestand der Datenbank geht nach dem Start auf die Platte"
  },
  {
    nr: '1462', name: "Der Start prueft den Platz fuer die Umlagerung nicht",
    file: 'server.js',
    search: "  if (free === null || free >= need + DB_SPARE) return;",
    replacement: "  return;",
    expected: "Umlagerung: zu wenig Platz verweigert den Start"
  },
  {
    nr: '1463', name: "„Kennzahlen\" zaehlt auch die Dateien auf der Platte als wartend",
    file: 'server.js',
    search: "  const an = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS o FROM attachments a\n    WHERE NOT EXISTS (SELECT 1 FROM disk_files d WHERE d.attachment_id = a.id)`).get();",
    replacement: "  const an = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS o FROM attachments a`).get();",
    expected: "Umlagerung: der Bestand der Datenbank geht nach dem Start auf die Platte"
  },
  {
    nr: '1464', name: "Ueber „Anhang\" ist ein Upload nicht large",
    file: 'server.js',
    search: "  const large = size > limits.attachment * MB;",
    replacement: "  const large = false;",
    expected: "Platte: Upload in Stuecken, Weg und Ordner"
  },
  {
    nr: '1465', name: "Die Grenze „Datei\" gilt beim Beginn nicht",
    file: 'server.js',
    search: "  if (size > most * MB) return res.status(413)",
    replacement: "  if (false) return res.status(413)",
    expected: "Platte: Upload in Stuecken, Weg und Ordner"
  },
  {
    nr: '1466', name: "In einen fremden Ordner beginnt ein Upload",
    file: 'server.js',
    search: "  if (target && (target.item_id !== itemId || !selfOnly(req, target.user_id)))",
    replacement: "  if (target && target.item_id !== itemId)",
    expected: "Ordner: Schema und Routen"
  },
  {
    nr: '1467', name: "Die kompatiblen Marken im ftyp-Kasten zaehlen nicht",
    file: 'attachments.js',
    search: "    for (let at = 16; at + 4 <= end; at += 4)",
    replacement: "    for (let at = 16; at < 0; at += 4)",
    expected: "Ein Weg fuer Dateien: Grenze „Datei\" und Erkennung"
  },
  {
    nr: '1468', name: "Eine grosse Datei bekommt die Textvorschau",
    file: 'server.js',
    search: "  if (kind !== 'text' && kind !== 'docx') return res.status(400).json({ error: t(localeOf(req), 'server.noTextPreview')});\n  if (largeFile(a.id)) return res.status(400).json({ error: t(localeOf(req), 'server.largeDownloadOnly')});\n",
    replacement: "  if (kind !== 'text' && kind !== 'docx') return res.status(400).json({ error: t(localeOf(req), 'server.noTextPreview')});\n",
    expected: "Grosse Dokumente: nur zum Herunterladen"
  },
  {
    nr: '1469', name: "Der Document Server oeffnet eine grosse Datei",
    file: 'server.js',
    search: "      return res.status(409).json({ error: t(localeOf(req), 'server.docOff')});\n    if (largeFile(a.id)) return res.status(400).json({ error: t(localeOf(req), 'server.largeDownloadOnly')});\n",
    replacement: "      return res.status(409).json({ error: t(localeOf(req), 'server.docOff')});\n",
    expected: "Grosse Dokumente: nur zum Herunterladen"
  },
  {
    nr: '1470', name: "Ueber „Anhang\" behaelt jede Datei ihre Vorschau",
    file: 'server.js',
    search: "      preview: large ? (['image', 'video', 'audio', 'pdf'].includes(kind) ? kind : 'keine')",
    replacement: "      preview: large ? kind",
    expected: "Grosse Dokumente: nur zum Herunterladen"
  },
  {
    nr: '1471', name: "Die Stelle wird auch unter 10 s gemerkt",
    file: 'server.js',
    search: "  const kept = seconds >= POSITION_MIN_S && !seen;",
    replacement: "  const kept = !seen;",
    expected: "Stelle im Video: Regeln am Server"
  },
  {
    nr: '1472', name: "Das Ende eines Videos zaehlt nicht als gesehen",
    file: 'server.js',
    search: "  const seen = duration !== null && seconds >= duration - Math.max(POSITION_MIN_S, duration * POSITION_END_SHARE);",
    replacement: "  const seen = false;",
    expected: "Stelle im Video: Regeln am Server"
  },
  {
    nr: '1473', name: "Eine Datei ohne Video nimmt eine Stelle an",
    file: 'server.js',
    search: "  if (!target || (b.kind === 'file' && !playsAsVideo(id, target.filename) && !isAudioFile(target.filename)))",
    replacement: "  if (!target)",
    expected: "Stelle im Video: Regeln am Server"
  },
  {
    nr: '1474', name: "detail() nennt die Stellen der anderen Accounts",
    file: 'server.js',
    search: "  FROM video_positions WHERE user_id = ? AND (attachment_id IN",
    replacement: "  FROM video_positions WHERE user_id IS NOT ? AND (attachment_id IN",
    expected: "Stelle im Video: Regeln am Server"
  },
  {
    nr: '1475', name: "Ein neuer Ordner steht fuer seinen Verfasser nicht offen",
    file: 'server.js',
    search: "  putFolderOpen.run(req.user.id, made);\n",
    replacement: "",
    expected: "Ordner: offen oder zu je Account"
  },
  {
    nr: '1476', name: "Der Zustand eines Ordners gilt fuer alle Accounts",
    file: 'server.js',
    search: "  WHERE o.user_id = ? AND f.item_id = ?`);",
    replacement: "  WHERE ? IS NOT NULL AND f.item_id = ?`);",
    expected: "Ordner: offen oder zu je Account"
  },
  {
    nr: '1477', name: "Der Browser merkt sich den Klick auf den Ordnerkopf nicht",
    file: 'public/app.js',
    search: "    api('PUT', `/api/folders/${Number(folderId)}/open`, { open })",
    replacement: "    Promise.resolve()",
    expected: "Ordnerzustand im Browser"
  },
  {
    nr: '1478', name: "Beim Oeffnen eines Eintrags sind wieder alle Ordner zu",
    file: 'public/app.js',
    search: "    FOLDERS_OPEN = { itemId: Number(id), open: new Set((item.folders || []).filter(f => f.open).map(f => f.id)) };",
    replacement: "    FOLDERS_OPEN = { itemId: Number(id), open: new Set() };",
    expected: "Ordnerzustand im Browser"
  },
  {
    nr: '1479', name: "Das Video springt nicht an die gemerkte Stelle",
    file: 'public/app.js',
    search: "    if (!(at > 0) || player.currentTime >= 1) return;\n    player.currentTime = at;\n",
    replacement: "    if (!(at > 0) || player.currentTime >= 1) return;\n",
    expected: "Stelle im Video im Browser"
  },
  {
    nr: '1480', name: "Der Hinweis „ab 3:12\" fehlt",
    file: 'public/app.js',
    search: "    box.appendChild(hint);\n",
    replacement: "",
    expected: "Stelle im Video im Browser"
  },
  {
    nr: '1481', name: "Beim Anhalten wird die Stelle nicht gespeichert",
    file: 'public/app.js',
    search: "  const onPause = () => { save(); if (!player.isConnected) watcher.stop(); };",
    replacement: "  const onPause = () => { if (!player.isConnected) watcher.stop(); };",
    expected: "Stelle im Video im Browser"
  },
  {
    nr: '1482', name: "Die Stelle geht ohne keepalive",
    file: 'public/app.js',
    search: "      method: 'PUT', credentials: 'same-origin', keepalive: true,",
    replacement: "      method: 'PUT', credentials: 'same-origin',",
    expected: "Stelle im Video im Browser"
  },
  {
    nr: '1483', name: "Die Auswahl laesst Dateien ohne Recht zum Loeschen waehlen",
    file: 'public/app.js',
    search: "    pickState(li, filesPicked && mayDeleteFile(a) ? filesPicked.has(a.id) : null);",
    replacement: "    pickState(li, filesPicked ? filesPicked.has(a.id) : null);",
    expected: "Auswahl unter „Dateien\" im Browser"
  },
  {
    nr: '1484', name: "Die Auswahl loescht ohne Rueckfrage",
    file: 'public/app.js',
    search: "    if (!await confirmBox(t('entry.pickDeleteAsk', { n: chosen.length }),\n      t('entry.pickTrashHint', { trashDays: TRASH_DAYS }), t('dialog.delete'), 'danger')) return;\n",
    replacement: "",
    expected: "Auswahl unter „Dateien\" im Browser"
  },
  {
    nr: '1485', name: "Die Bildleiste bietet die Auswahl ohne Recht zum Loeschen an",
    file: 'public/app.js',
    search: "      !!photosPicked || !item.photos.length || !mayEdit();",
    replacement: "      !!photosPicked || !item.photos.length;",
    expected: "Auswahl in der Bildleiste im Browser"
  },
  {
    nr: '1486', name: "Das Kaestchen im Ordnerkopf fehlt in der Auswahl",
    file: 'public/app.js',
    search: "    check.hidden = !choosable.length;",
    replacement: "    check.hidden = true;",
    expected: "Auswahl unter „Dateien\" im Browser"
  },
  {
    nr: '1487', name: "Die Liste nennt die Version nicht mehr",
    file: 'backup.js',
    search: "  const head = [`# version ${version}\\n`, ...(before ? [`# vor ${before}\\n`] : [])];",
    replacement: "  const head = before ? [`# vor ${before}\\n`] : [];",
    expected: "Backup: die Liste mit Version, auch ohne Dateien"
  },
  {
    nr: '1488', name: "Ohne Dateien entsteht keine Liste",
    file: 'backup.js',
    search: "    writeList(file, rows, version, before);",
    replacement: "    if (rows.length) writeList(file, rows, version, before);",
    expected: "Backup: die Liste mit Version, auch ohne Dateien"
  },
  {
    nr: '1489', name: "Das Alter kommt aus dem Namen statt aus der Aenderungszeit",
    file: 'backup.js',
    search: "      if (st.isFile()) files.push({ name: n, time: st.mtimeMs, bytes: st.size });",
    replacement: "      if (st.isFile()) files.push({ name: n, time: Date.parse(n.slice(10, 20) + 'T' + n.slice(21, 29).replace(/-/g, ':') + 'Z') || st.mtimeMs, bytes: st.size });",
    expected: "Backup: die Liste mit Version, auch ohne Dateien"
  },
  {
    nr: '1490', name: "list nennt die Version nicht",
    file: 'backuptool.js',
    search: "      return [String(i + 1), localTime(d.time), (info.list && info.list.version) || '–', size(d.bytes),",
    replacement: "      return [String(i + 1), localTime(d.time), '–', size(d.bytes),",
    expected: "backuptool.js: list und show"
  },
  {
    nr: '1491', name: "show vergleicht nicht mit dem laufenden Stand",
    file: 'backuptool.js',
    search: "    try { compare(info.probe, ctx.live.db, options.all); }",
    replacement: "    try { }",
    expected: "backuptool.js: list und show"
  },
  {
    nr: '1492', name: "Ein falscher Aufruf endet mit 1 statt 2",
    file: 'backuptool.js',
    search: "    process.exit(e instanceof Misuse ? 2 : 1);",
    replacement: "    process.exit(1);",
    expected: "backuptool.js: list und show"
  },
  {
    nr: '1493', name: "restore spielt bei laufendem Server zurueck",
    file: 'backuptool.js',
    search: "  if (inUse(key))",
    replacement: "  if (false)",
    expected: "backuptool.js: abgelehnt, ohne etwas zu aendern"
  },
  {
    nr: '1494', name: "restore prueft die Kopien im Backup-Ordner nicht",
    file: 'backuptool.js',
    search: "    const missing = list.rows.filter(z => !z.absent && !backup.copyPresent(folder, z));",
    replacement: "    const missing = [];",
    expected: "backuptool.js: abgelehnt, ohne etwas zu aendern"
  },
  {
    nr: '1495', name: "restore prueft das Schema nicht",
    file: 'backuptool.js',
    search: "  if (info.schema.differences.length)\n    problems.push(`Das Schema passt nicht zu Version",
    replacement: "  if (false)\n    problems.push(`Das Schema passt nicht zu Version",
    expected: "backuptool.js: abgelehnt, ohne etwas zu aendern"
  },
  {
    nr: '1496', name: "restore uebergeht ein gehaltenes Lockfile",
    file: 'backuptool.js',
    search: "  const lock = backup.takeLock(folder);\n  if (!lock)",
    replacement: "  const lock = backup.takeLock(folder) || path.join(folder, backup.COPY_DIR, '.lock');\n  if (!lock)",
    expected: "backuptool.js: abgelehnt, ohne etwas zu aendern"
  },
  {
    nr: '1497', name: "Eine mehrdeutige Auswahl nimmt das juengste Backup",
    file: 'backuptool.js',
    search: "  if (hits.length > 1) {",
    replacement: "  if (hits.length > 1) hits = hits.slice(0, 1);\n  if (false) {",
    expected: "backuptool.js: abgelehnt, ohne etwas zu aendern"
  },
  {
    nr: '1498', name: "restore legt kein Backup davor an",
    file: 'backuptool.js',
    search: "    if (!verdict.same && ctx.live.db) {\n      out('', 'Backup des aktuellen Stands …');",
    replacement: "    if (false) {\n      out('', 'Backup des aktuellen Stands …');",
    expected: "backuptool.js: restore und der Rueckweg"
  },
  {
    nr: '1499', name: "Das Backup davor traegt kein „# vor\"",
    file: 'backuptool.js',
    search: "        dbFile: DB_FILE, filesDir: FILES_DIR, keyHex: ctx.key, version: VERSION, before: chosen.d.name,",
    replacement: "        dbFile: DB_FILE, filesDir: FILES_DIR, keyHex: ctx.key, version: VERSION, before: null,",
    expected: "backuptool.js: restore und der Rueckweg"
  },
  {
    nr: '1500', name: "restore loescht in data/files/ nichts",
    file: 'backuptool.js',
    search: "    if (named.has(n) && backup.copyPresent(folder, { name: n, length })) {",
    replacement: "    if (false) {",
    expected: "backuptool.js: restore und der Rueckweg"
  },
  {
    nr: '1501', name: "restore loescht auch Dateien ohne Kopie und ohne Liste",
    file: 'backuptool.js',
    search: "    if (named.has(n) && backup.copyPresent(folder, { name: n, length })) {",
    replacement: "    if (true) {",
    expected: "backuptool.js: ohne und mit unlesbarer laufender Datenbank"
  },
  {
    nr: '1502', name: "Eine unlesbare Datenbank wird ersetzt statt beiseitegelegt",
    file: 'backuptool.js',
    search: "      } else if (ctx.live.error) aside = setAside();",
    replacement: "      }",
    expected: "backuptool.js: ohne und mit unlesbarer laufender Datenbank"
  },
  {
    nr: '1503', name: "Der zweite Aufruf legt ueber den zurueckgespielten Stand ein weiteres Backup",
    file: 'backuptool.js',
    search: "  verdict.same = sameBytes(DB_FILE, file);",
    replacement: "  verdict.same = false;",
    expected: "backuptool.js: Abbruch nach Schritt 3, 5 und 6; ein zweiter Aufruf fuehrt zu Ende"
  },
  {
    nr: '1504', name: "Die Auswahl loescht auch gesperrte Backups",
    file: 'server.js',
    search: "    if (chosen.some(n => !known.has(n) || locked.has(n)))",
    replacement: "    if (chosen.some(n => !known.has(n)))",
    expected: "Alte Backups: mehrere auswaehlen und loeschen"
  },
  {
    nr: '1505', name: "Ein unbekanntes Backup in der Auswahl haelt das Loeschen nicht an",
    file: 'server.js',
    search: "    if (chosen.some(n => !known.has(n) || locked.has(n)))",
    replacement: "    if (false)",
    expected: "Alte Backups: mehrere auswaehlen und loeschen"
  },
  {
    nr: '1506', name: "Die Auswahl schreibt nichts ins Sicherheitsprotokoll",
    file: 'server.js',
    search: "    logRemoved(req.user.id, out2.removed);",
    replacement: "    if (kind !== 'selected') logRemoved(req.user.id, out2.removed);",
    expected: "Alte Backups: mehrere auswaehlen und loeschen"
  },
  {
    nr: '1507', name: "Gesperrt ist jedes Backup statt der juengsten",
    file: 'backup.js',
    search: "    .sort((a, b) => b.time - a.time).slice(0, keep).map(d => d.name));",
    replacement: "    .sort((a, b) => b.time - a.time).map(d => d.name));",
    expected: "Alte Backups: mehrere auswaehlen und loeschen"
  },
  {
    nr: '1508', name: "Die Karte zaehlt die Dateien nicht, die nur ein Backup nennt",
    file: 'backup.js',
    search: "      if (named.get(z.name) === 1) { sum.onlyCount++; sum.onlyBytes += z.length; }",
    replacement: "",
    expected: "Alte Backups: mehrere auswaehlen und loeschen"
  },
  {
    nr: '1509', name: "Die Rueckfrage der Auswahl bekommt keine Groesse",
    file: 'server.js',
    search: "    ? { freed: copiesFreed(root, req.query.freed.split('|').slice(0, 1000)) } : {};",
    replacement: "    ? { freed: 0 } : {};",
    expected: "Alte Backups: mehrere auswaehlen und loeschen"
  },
  {
    nr: '1510', name: "„pruefen\" nennt das Schema nicht",
    file: 'server.js',
    search: "    out.schema = { ok: !differences.length, differences };",
    replacement: "",
    expected: "Alte Backups: mehrere auswaehlen und loeschen"
  },
  {
    nr: '1511', name: "filesSort nimmt jeden Wert an",
    file: 'server.js',
    search: "      take('filesSort');\n",
    replacement: "      if (req.body.filesSort !== undefined) putUserSetting(req.user.id, 'filesSort', JSON.stringify(String(req.body.filesSort)));\n",
    expected: "Dateien sortieren: die Einstellung"
  },
  {
    nr: '1512', name: "filesSort fehlt unter den persoenlichen Schluesseln",
    file: 'server.js',
    search: "                                'filesSort', 'filesGroup', 'filters', 'font',",
    replacement: "                                'filesGroup', 'filters', 'font',",
    expected: "Dateien sortieren: die Einstellung"
  },
  {
    nr: '1513', name: "Die Karte zeigt die zweite Zeile je Backup nicht",
    file: 'public/app.js',
    search: "        ${filesLine(z)}\n",
    replacement: "\n",
    expected: "Alte Backups: die Auswahl in der Oberflaeche"
  },
  {
    nr: '1514', name: "Gesperrte Backups lassen sich auswaehlen",
    file: 'public/app.js',
    search: "        aria-label=\"${esc(label)}\"${z.locked ? ` disabled title=\"${esc(label)}\"` : ''}${",
    replacement: "        aria-label=\"${esc(label)}\"${''}${",
    expected: "Alte Backups: die Auswahl in der Oberflaeche"
  },
  {
    nr: '1515', name: "„Alle auswählen\" nimmt auch die gesperrten",
    file: 'public/app.js',
    search: "    const pickable = all.filter(z => !z.locked);",
    replacement: "    const pickable = all;",
    expected: "Alte Backups: die Auswahl in der Oberflaeche"
  },
  {
    nr: '1516', name: "Die Rueckfrage fragt den freien Platz nicht ab",
    file: 'public/app.js',
    search: "      try { freed = (await api('GET', `/api/backup?freed=${encodeURIComponent(names.join('|'))}`)).freed || 0; }",
    replacement: "      try { freed = 0; }",
    expected: "Alte Backups: die Auswahl in der Oberflaeche"
  },
  {
    nr: '1517', name: "Die Auswahl loescht nach der Regel statt der Namen",
    file: 'public/app.js',
    search: "      try { r = await api('POST', '/api/backup/cleanup', { kind: 'selected', names }); }",
    replacement: "      try { r = await api('POST', '/api/backup/cleanup', { kind: 'rule' }); }",
    expected: "Alte Backups: die Auswahl in der Oberflaeche"
  },
  {
    nr: '1518', name: "Der Hinweis beim Weiterspielen steht wieder 5 s",
    file: 'public/app.js',
    search: "const SPOT_HINT_MS = 10000;",
    replacement: "const SPOT_HINT_MS = 5000;",
    expected: "Hinweis beim Weiterspielen: 10 s"
  },
  {
    nr: '1519', name: "Die Richtung kehrt die Folge der Dateien nicht um",
    file: 'public/app.js',
    search: "    const sign = FILES_SORT.asc ? 1 : -1;\n",
    replacement: "    const sign = 1;\n",
    expected: "Dateien sortieren im Browser"
  },
  {
    nr: '1520', name: "Name sortiert Zahlen nicht in natuerlicher Folge",
    file: 'public/app.js',
    search: "  const byName = (x, y) => x.localeCompare(y, LOCALE, { numeric: true, sensitivity: 'accent' });",
    replacement: "  const byName = (x, y) => x.localeCompare(y, LOCALE);",
    expected: "Dateien sortieren im Browser"
  },
  {
    nr: '1521', name: "Die Ordner folgen der Sortierung nicht",
    file: 'public/app.js',
    search: "    sortedFolders(folders).forEach((f, at) => {",
    replacement: "    folders.forEach((f, at) => {",
    expected: "Dateien sortieren im Browser"
  },
  {
    nr: '1522', name: "Die Sortierung wird nicht gespeichert",
    file: 'public/app.js',
    search: "    try { await api('PUT', '/api/settings', { filesSort: `${key}_${asc ? 'asc' : 'desc'}` }); }",
    replacement: "    try { await Promise.resolve(); }",
    expected: "Dateien sortieren im Browser"
  },
  {
    nr: '1523', name: "Laufende Uploads stehen vor den Dateien ihrer Gruppe",
    file: 'public/app.js',
    search: "      ...fileEntries(key, shown),\n      ...remote.filter(x => remoteGroup(x) === key).map(x => ['s' + x.id, li => fillRemoteTile(li, x)]),",
    replacement: "      ...remote.filter(x => remoteGroup(x) === key).map(x => ['s' + x.id, li => fillRemoteTile(li, x)]),\n      ...fileEntries(key, shown),",
    expected: "Dateien sortieren im Browser"
  },
  {
    nr: '1524', name: "„Bearbeiten\" steht auch ohne Recht zum Bearbeiten und am Telefon",
    file: 'public/app.js',
    search: "    edit.hidden = !!filesPicked || !(a.preview === 'office' && a.edit && !isNarrow());",
    replacement: "    edit.hidden = !!filesPicked || a.preview !== 'office';",
    expected: "Bearbeiten in der Listenzeile"
  },
  {
    nr: '1525', name: "„Bearbeiten\" oeffnet die Ansicht statt des Editors",
    file: 'public/app.js',
    search: "    edit.onclick = () => { location.hash = fileAddress(id, a.id, true); };",
    replacement: "    edit.onclick = () => { location.hash = fileAddress(id, a.id); };",
    expected: "Bearbeiten in der Listenzeile"
  },
  {
    nr: '1526', name: "Die Kacheln zeigen „Bearbeiten\"",
    file: 'public/style.css',
    search: ".aacts { display: none; }\n",
    replacement: "",
    expected: "Bearbeiten in der Listenzeile"
  },
  {
    nr: '1527', name: "backuptool.sh spielt zurueck, ohne die Instanz anzuhalten",
    file: 'backuptool.sh',
    search: "    docker compose stop\n",
    replacement: "",
    expected: "Quelltext: backuptool.sh und backuptool.js"
  },
  {
    nr: '1528', name: "Alte Werte ohne Richtung gelten nicht mehr",
    file: 'server.js',
    search: "  const v = a.alias?.[raw] ?? raw;\n",
    replacement: "  const v = raw;\n",
    expected: "Dateien sortieren und gruppieren: die Einstellungen"
  },
  {
    nr: '1529', name: "filesGroup nimmt jeden Wert an",
    file: 'server.js',
    search: "      take('filesGroup');\n",
    replacement: "      if (req.body.filesGroup !== undefined) putUserSetting(req.user.id, 'filesGroup', JSON.stringify(String(req.body.filesGroup)));\n",
    expected: "Dateien sortieren und gruppieren: die Einstellungen"
  },
  {
    nr: '1530', name: "Nach dem Upload liest niemand die Angaben",
    file: 'server.js',
    search: "  if (attachments.mediaKind(u.filename)) mediaSoon([added]);\n",
    replacement: "",
    expected: "Erweiterte Infos: Warteschlange nach dem Upload und Route"
  },
  {
    nr: '1531', name: "Die Liste nennt den Codec nicht",
    file: 'server.js',
    search: "      ...(kind === 'video' ? { codec: a2.codec, width:",
    replacement: "      ...(kind === 'video' ? { codec: null, width:",
    expected: "Erweiterte Infos: Warteschlange nach dem Upload und Route"
  },
  {
    nr: '1532', name: "Erweiterte Infos auch fuer Textdateien",
    file: 'attachments.js',
    search: "  : ['image', 'video', 'audio'].includes(previewKind(filename)) ? previewKind(filename) : null);",
    replacement: "  : previewKind(filename));",
    expected: "Erweiterte Infos: Warteschlange nach dem Upload und Route"
  },
  {
    nr: '1533', name: "Nur die erste Tonspur kommt an",
    file: 'attachments.js',
    search: "    audio: of('Audio').map(tr => ({",
    replacement: "    audio: of('Audio').slice(0, 1).map(tr => ({",
    expected: "Erweiterte Infos: Warteschlange nach dem Upload und Route"
  },
  {
    nr: '1534', name: "Beim Start liest niemand nach",
    file: 'server.js',
    search: "  // Erst hier: der Document Server holt die Datei bei diesem Server ab.\n  docTilesSoon();\n  mediaSoon();\n",
    replacement: "  // Erst hier: der Document Server holt die Datei bei diesem Server ab.\n  docTilesSoon();\n",
    expected: "Erweiterte Infos: sofort, beim Start, ohne Datei und mit der Datei geloescht"
  },
  {
    nr: '1535', name: "GET /info liest nicht sofort",
    file: 'server.js',
    search: "    const facts = await inMediaTurn(() => makeMedia(a.id));",
    replacement: "    const facts = qMedia.get(a.id) ? JSON.parse(qMedia.get(a.id).info) : undefined;",
    expected: "Erweiterte Infos: sofort, beim Start, ohne Datei und mit der Datei geloescht"
  },
  {
    nr: '1536', name: "Die Zeile faellt nicht mit der Datei",
    file: 'schema.js',
    search: "CREATE TABLE IF NOT EXISTS attachment_media (\n  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,",
    replacement: "CREATE TABLE IF NOT EXISTS attachment_media (\n  attachment_id INTEGER PRIMARY KEY,",
    expected: "Erweiterte Infos: sofort, beim Start, ohne Datei und mit der Datei geloescht"
  },
  {
    nr: '1537', name: "Ohne lesbare Datei fragt der Browser ohne Ende nach",
    file: 'server.js',
    search: "    if (!e.damaged) throw e;\n    MEDIA_FAILED.add(id);\n    return known;",
    replacement: "    if (!e.damaged) throw e;\n    return known;",
    expected: "Erweiterte Infos: sofort, beim Start, ohne Datei und mit der Datei geloescht"
  },
  {
    nr: '1538', name: "GET /info liest neben der Warteschlange",
    file: 'server.js',
    search: "    const facts = await inMediaTurn(() => makeMedia(a.id));",
    replacement: "    const facts = await makeMedia(a.id);",
    expected: "Erweiterte Infos: Quelltext"
  },
  {
    nr: '1539', name: "Die Instanz von MediaInfo bleibt offen",
    file: 'attachments.js',
    search: "  finally { mi.close(); }\n",
    replacement: "  finally { mi.reset(); }\n",
    expected: "Erweiterte Infos: Quelltext"
  },
  {
    nr: '1540', name: "Groesse beginnt mit klein nach gross",
    file: 'public/app.js',
    search: "up: 'entry.dirSmallLarge', down: 'entry.dirLargeSmall', start: false }",
    replacement: "up: 'entry.dirSmallLarge', down: 'entry.dirLargeSmall', start: true }",
    expected: "Sortieren mit Richtung"
  },
  {
    nr: '1541', name: "Die Ordner zaehlen nach Groesse ihre Nummer",
    file: 'public/app.js',
    search: "    const by = key === 'name' || key === 'type' ? (x, y) => byName(x.name, y.name) : (x, y) => sum(x) - sum(y);",
    replacement: "    const by = key === 'name' || key === 'type' ? (x, y) => byName(x.name, y.name) : (x, y) => x.id - y.id;",
    expected: "Sortieren mit Richtung"
  },
  {
    nr: '1542', name: "Die gespeicherte Richtung gilt nach dem Laden nicht",
    file: 'public/app.js',
    search: "  if (sortSet) FILES_SORT = { key: sortSet[1], asc: sortSet[2] === 'asc' };",
    replacement: "  if (sortSet) FILES_SORT = { key: sortSet[1], asc: true };",
    expected: "Sortieren mit Richtung"
  },
  {
    nr: '1543', name: "Der zweite Klick in der Kopfzeile kehrt nicht um",
    file: 'public/app.js',
    search: "    ? takeFilesSort(FILES_SORT.key, !FILES_SORT.asc)\n    : takeFilesSort(b.dataset.sort",
    replacement: "    ? takeFilesSort(FILES_SORT.key, FILES_SORT.asc)\n    : takeFilesSort(b.dataset.sort",
    expected: "Kopfzeile der Liste"
  },
  {
    nr: '1544', name: "Die Kopfzeile zeigt die sortierte Spalte nicht an",
    file: 'public/app.js',
    search: "      b.textContent = on ? `${word} ${FILES_SORT.asc ? '▲' : '▼'}` : word;\n      b.setAttribute('aria-pressed', String(on));",
    replacement: "      b.textContent = on ? `${word} ${FILES_SORT.asc ? '▲' : '▼'}` : word;\n      b.setAttribute('aria-pressed', 'false');",
    expected: "Kopfzeile der Liste"
  },
  {
    nr: '1545', name: "Die Kopfzeile steht auch ueber den Kacheln",
    file: 'public/style.css',
    search: "\n.acols { display: none; }\n",
    replacement: "\n",
    expected: "Kopfzeile der Liste"
  },
  {
    nr: '1546', name: "Nach Typ zeigt keine Zwischenzeilen",
    file: 'public/app.js',
    search: "        if (FILES_GROUP !== 'type' || (at && kindOf(files[at - 1]) === k)) return [row];",
    replacement: "        if (true) return [row];",
    expected: "Nach Typ gruppiert"
  },
  {
    nr: '1547', name: "Sonstige steht nicht zuletzt",
    file: 'public/app.js',
    search: "  const kindOrder = (x, y) => (x === 'other') - (y === 'other') || byName(",
    replacement: "  const kindOrder = (x, y) => byName(",
    expected: "Nach Typ gruppiert"
  },
  {
    nr: '1548', name: "Das Vollbild blaettert nach der Sortierung statt nach der Anzeige",
    file: 'public/app.js',
    search: "    const pictures = shownFiles((item.attachments || [])",
    replacement: "    const pictures = sortedFiles((item.attachments || [])",
    expected: "Nach Typ gruppiert"
  },
  {
    nr: '1549', name: "Die Gruppierung wird nicht gespeichert",
    file: 'public/app.js',
    search: "    try { await api('PUT', '/api/settings', { filesGroup: FILES_GROUP }); }",
    replacement: "    try { await Promise.resolve(); }",
    expected: "Nach Typ gruppiert"
  },
  {
    nr: '1550', name: "Art zeigt wieder die Endung",
    file: 'public/app.js',
    search: "kindCell: kindParts(a), codec:",
    replacement: "kindCell: kind, codec:",
    expected: "Zeile: Art, Bearbeiten und Link"
  },
  {
    nr: '1551', name: "Link fehlt in der Zeile",
    file: 'public/app.js',
    search: "    link.hidden = !!filesPicked;",
    replacement: "    link.hidden = true;",
    expected: "Zeile: Art, Bearbeiten und Link"
  },
  {
    nr: '1552', name: "Link kopiert die Adresse der Seite",
    file: 'public/app.js',
    search: "    link.onclick = () => copyText(fileLink(a), t('card.linkCopied'));",
    replacement: "    link.onclick = () => copyText(location.href, t('card.linkCopied'));",
    expected: "Zeile: Art, Bearbeiten und Link"
  },
  {
    nr: '1553', name: "Bearbeiten und Link haben keine feste Zelle",
    file: 'public/style.css',
    search: ".aedit { grid-column: 1; }\n",
    replacement: "",
    expected: "Zeile: Art, Bearbeiten und Link"
  },
  {
    nr: '1554', name: "Link steht auch waehrend der Auswahl",
    file: 'public/app.js',
    search: "    link.hidden = !!filesPicked;",
    replacement: "    link.hidden = false;",
    expected: "Zeile: Art, Bearbeiten und Link"
  },
  {
    nr: '1555', name: "Das Menue hat keine Trennlinien",
    file: 'public/app.js',
    search: "      .flatMap((g, at) => at ? [{ line: true }, ...g] : g);",
    replacement: "      .flatMap(g => g);",
    expected: "Menü „…\" in fünf Gruppen"
  },
  {
    nr: '1556', name: "Oeffnen fehlt bei Bildern und Videos",
    file: 'public/app.js',
    search: "    else if (a.preview === 'image' || a.preview === 'video' || a.preview === 'audio')\n      open.push(",
    replacement: "    else if (false)\n      open.push(",
    expected: "Menü „…\" in fünf Gruppen"
  },
  {
    nr: '1557', name: "Infos stehen an jeder Datei",
    file: 'public/app.js',
    search: "    if (a.preview === 'image' || kindOf(a) === 'video' || a.preview === 'audio' || DOCUMENT_KINDS.includes(kindOf(a)))\n      pass.push(",
    replacement: "    if (true)\n      pass.push(",
    expected: "Menü „…\" in fünf Gruppen"
  },
  {
    nr: '1558', name: "Das Menue sagt wieder „Dieses Bild als Vorschaubild\"",
    file: 'public/app.js',
    search: "sort.push({ label: t('entry.chooseStill')",
    replacement: "sort.push({ label: t('entry.setStill')",
    expected: "Menü „…\" in fünf Gruppen"
  },
  {
    nr: '1559', name: "Die Trennlinie ist ein Menueeintrag",
    file: 'public/app.js',
    search: "      line.setAttribute('role', 'separator');",
    replacement: "      line.setAttribute('role', 'menuitem');",
    expected: "Menü „…\" in fünf Gruppen"
  },
  {
    nr: '1560', name: "Der Codec fehlt am Vorschaubild",
    file: 'public/app.js',
    search: "codec: video || image || audio ? codecName(a.codec) : '',",
    replacement: "codec: '',",
    expected: "Erweiterte Infos: Dialog und Codec am Vorschaubild"
  },
  {
    nr: '1561', name: "Die Liste zeigt den Codec am kleinen Bild",
    file: 'public/style.css',
    search: ".alist .apic .play-badge,\n.alist .apic .acodec { display: none; }",
    replacement: ".alist .apic .play-badge { display: none; }",
    expected: "Erweiterte Infos: Dialog und Codec am Vorschaubild"
  },
  {
    nr: '1562', name: "Der Dialog steht leer, bis die Angaben kommen",
    file: 'public/app.js',
    search: "<div class=\"minfo-body\" aria-live=\"polite\"><p>${tH('entry.mediaReading')}</p></div>",
    replacement: "<div class=\"minfo-body\" aria-live=\"polite\"></div>",
    expected: "Erweiterte Infos: Dialog und Codec am Vorschaubild"
  },
  {
    nr: '1563', name: "Die Tonspuren tragen keine Nummer",
    file: 'public/app.js',
    search: "    ...audio.map((s, at) => mediaGroup(audio.length > 1\n",
    replacement: "    ...audio.map((s, at) => mediaGroup(false\n",
    expected: "Erweiterte Infos: Dialog und Codec am Vorschaubild"
  },
  {
    nr: '1564', name: "Nach dem Dialog steht der Fokus nirgends",
    file: 'public/app.js',
    search: "      () => { if (back && back.isConnected) back.focus(); }, null);",
    replacement: "      () => {}, null);",
    expected: "Erweiterte Infos: Dialog und Codec am Vorschaubild"
  },
  {
    nr: '1565', name: "Zeilen ohne Wert stehen im Dialog",
    file: 'public/app.js',
    search: "  const shown = rows.filter(([, v]) => v !== '' && v !== null && v !== undefined);",
    replacement: "  const shown = rows;",
    expected: "Erweiterte Infos: Dialog und Codec am Vorschaubild"
  },
  {
    nr: '1566', name: "Die Zahl der Tonspuren fehlt",
    file: 'public/app.js',
    search: "    ['entry.mediaAudioTracks', video.length ? String(audio.length) : '']]) + (video.length ? moreGroup(tracks) : tracks);",
    replacement: "    ['entry.mediaAudioTracks', '']]) + (video.length ? moreGroup(tracks) : tracks);",
    expected: "Erweiterte Infos: Dialog und Codec am Vorschaubild"
  },
  {
    nr: '1567', name: "Bitraten unter 1 Mbit/s stehen in Mbit/s",
    file: 'public/app.js',
    search: "  return bps >= 1e6 ? t('entry.mediaMbits'",
    replacement: "  return bps >= 1e3 ? t('entry.mediaMbits'",
    expected: "Erweiterte Infos: Dialog und Codec am Vorschaubild"
  },
  {
    nr: '1568', name: "Das Video laedt wieder beim Abspielen statt auf Knopfdruck",
    file: 'public/app.js',
    search: "  wholeButton.onclick = () => (loading ? stopLoading(true) : wholeButton.classList.contains('done') ? null : loadWhole());",
    replacement: "  wholeButton.onclick = () => (loading ? stopLoading(true) : wholeButton.classList.contains('done') ? null : loadWhole());\n  videoPlayer.addEventListener('play', loadWhole);",
    expected: "Video ganz laden"
  },
  {
    nr: '1569', name: "Der ganze Abruf geht durch den Cache",
    file: 'public/app.js',
    search: "{ credentials: 'same-origin', cache: 'no-store', signal: mine.stop.signal }",
    replacement: "{ credentials: 'same-origin', signal: mine.stop.signal }",
    expected: "Video ganz laden"
  },
  {
    nr: '1570', name: "Beim Laden steht keine Anzeige",
    file: 'public/app.js',
    search: "        mine.percent = Math.floor(got * 100 / total);\n        markWhole();\n",
    replacement: "        mine.percent = Math.floor(got * 100 / total);\n",
    expected: "Video ganz laden"
  },
  {
    nr: '1571', name: "Nach dem Wechsel beginnt das Video von vorn",
    file: 'public/app.js',
    search: "      player.src = wholeCopy.url;\n      player.currentTime = mine.at;\n",
    replacement: "      player.src = wholeCopy.url;\n      player.currentTime = 0;\n",
    expected: "Video ganz laden"
  },
  {
    nr: '1572', name: "Die Kopie geht beim Schliessen verloren",
    file: 'public/app.js',
    search: "    stopLoading(false);\n  };",
    replacement: "    stopLoading(false);\n    if (wholeCopy) { URL.revokeObjectURL(wholeCopy.url); wholeCopy = null; }\n  };",
    expected: "Video ganz laden"
  },
  {
    nr: '1573', name: "Schliessen bricht den Abruf nicht ab",
    file: 'public/app.js',
    search: "    loading = null;\n    was.stop.abort();\n",
    replacement: "    loading = null;\n",
    expected: "Video ganz laden"
  },
  {
    nr: '1574', name: "Am Telefon gilt die Grenze des Rechners",
    file: 'public/app.js',
    search: "const WHOLE_BYTES = () => (isNarrow() ? 500 : 2048) * 1024 * 1024;",
    replacement: "const WHOLE_BYTES = () => 2048 * 1024 * 1024;",
    expected: "Video ganz laden"
  },
  {
    nr: '1575', name: "Bei Datensparen fehlt der Knopf",
    file: 'public/app.js',
    search: "    wholeButton.hidden = player !== videoPlayer || player.hidden || !note.hidden || bytes > WHOLE_BYTES() || (!loading && !source);",
    replacement: "    wholeButton.hidden = player !== videoPlayer || player.hidden || !note.hidden || !!navigator.connection?.saveData || bytes > WHOLE_BYTES() || (!loading && !source);",
    expected: "Video ganz laden"
  },
  {
    nr: '1576', name: "Content-Length zaehlt nicht",
    file: 'public/app.js',
    search: "      if (!r.ok || !r.body || !(total > 0) || total > limit) throw new Error('not whole');",
    replacement: "      if (!r.ok || !r.body || !(total > 0)) throw new Error('not whole');",
    expected: "Video ganz laden"
  },
  {
    nr: '1577', name: "Ein kurzer Blob ersetzt die Quelle",
    file: 'public/app.js',
    search: "      if (ready.size !== total) throw new Error('not whole');\n",
    replacement: "",
    expected: "Video ganz laden"
  },
  {
    nr: '1578', name: "Die zweite Kopie gibt die erste nicht frei",
    file: 'public/app.js',
    search: "      if (wholeCopy) URL.revokeObjectURL(wholeCopy.url);\n",
    replacement: "",
    expected: "Video ganz laden"
  },
  {
    nr: '1579', name: "Eine geloeschte Datei geht nicht in den Papierkorb",
    file: 'server.js',
    search: "    fileIntoTrash(Number(req.params.id), req.user.id);\n",
    replacement: "",
    expected: "Papierkorb fuer Dateien: Loeschen legt ab"
  },
  {
    nr: '1580', name: "Der Papierkorb haelt die Datei nicht auf der Platte",
    file: 'server.js',
    search: "  diskFileIntoTrash.run(row, id);\n",
    replacement: "",
    expected: "Papierkorb fuer Dateien: Loeschen legt ab"
  },
  {
    nr: '1581', name: "Jeder Admin stellt Dateien wieder her",
    file: 'server.js',
    search: "app.post('/api/trash/:id/restore', ownerOnly,",
    replacement: "app.post('/api/trash/:id/restore', adminOnly,",
    expected: "Papierkorb fuer Dateien: Wiederherstellen"
  },
  {
    nr: '1582', name: "Der geloeschte Ordner entsteht nicht neu",
    file: 'server.js',
    search: "function folderBack(itemId, old, made) {\n  if (!old) return null;\n",
    replacement: "function folderBack(itemId, old, made) {\n  return null;\n",
    expected: "Papierkorb fuer Dateien: Wiederherstellen"
  },
  {
    nr: '1583', name: "Die Datei kommt ohne Verfasser zurueck",
    file: 'server.js',
    search: "  if (!p || p.id == null) return null;\n  const u = qAccountOf.get(p.id);\n",
    replacement: "  return null;\n  const u = qAccountOf.get(p.id);\n",
    expected: "Papierkorb fuer Dateien: Wiederherstellen"
  },
  {
    nr: '1584', name: "Das Standbild kommt nicht zurueck",
    file: 'server.js',
    search: "  const still = bytes(f.still);\n  if (still) putStill.run(id, f.duration ?? null, still);\n",
    replacement: "",
    expected: "Papierkorb fuer Dateien: Wiederherstellen"
  },
  {
    nr: '1585', name: "Der Papierkorb fuellt den Eintrag ueber 100 Dateien",
    file: 'server.js',
    search: "  if (itemId == null) throw refusal(404, 'server.fileEntryGone');\n  if (fileSlots(itemId) >= FILES_PER_ENTRY) throw refusal(400, 'server.fileCap', { cap: FILES_PER_ENTRY });\n",
    replacement: "  if (itemId == null) throw refusal(404, 'server.fileEntryGone');\n",
    expected: "Papierkorb fuer Dateien: Frist, Grenze und geloeschter Eintrag"
  },
  {
    nr: '1586', name: "Nach dem Papierkorb findet die Datei ihren Eintrag nicht",
    file: 'server.js',
    search: "const entryOf = (e) => (e ? (qEntrySame.get(e.id, e.created_at) || qEntryLike.get(e.created_at, e.title))?.id ?? null",
    replacement: "const entryOf = (e) => (e ? qEntrySame.get(e.id, e.created_at)?.id ?? null",
    expected: "Papierkorb fuer Dateien: Frist, Grenze und geloeschter Eintrag"
  },
  {
    nr: '1587', name: "Nach der Frist bleibt die Datei auf der Platte",
    file: 'server.js',
    search: "  if (cleanupTrash()) sweepSoon();\n",
    replacement: "  cleanupTrash();\n",
    expected: "Papierkorb fuer Dateien: Frist, Grenze und geloeschter Eintrag"
  },
  {
    nr: '1588', name: "Die Karte haelt jeden Eintrag fuer vorhanden",
    file: 'server.js',
    search: "    size: f.size, entryThere: entryOf(item) != null };",
    replacement: "    size: f.size, entryThere: true };",
    expected: "Papierkorb fuer Dateien: Frist, Grenze und geloeschter Eintrag"
  },
  {
    nr: '1589', name: "Der Dialog liest keine Backups",
    file: 'server.js',
    search: "  for (const d of list) {\n    let probe;\n",
    replacement: "  for (const d of []) {\n    let probe;\n",
    expected: "Dateien aus Backups zurueckholen: B zurueck, D bleibt"
  },
  {
    nr: '1590', name: "Jeder Admin sieht die geloeschten Dateien",
    file: 'server.js',
    search: "app.get('/api/items/:id/deleted-files', ownerOnly,",
    replacement: "app.get('/api/items/:id/deleted-files', adminOnly,",
    expected: "Dateien aus Backups zurueckholen: B zurueck, D bleibt"
  },
  {
    nr: '1591', name: "Das Zurueckholen steht nicht im Sicherheitsprotokoll",
    file: 'server.js',
    search: "                auth.log('backup.fetch', { actor: req.user.id });\n",
    replacement: "",
    expected: "Dateien aus Backups zurueckholen: B zurueck, D bleibt"
  },
  {
    nr: '1592', name: "Oefter gespeicherte Dateien fehlen im Dialog",
    file: 'server.js',
    search: "  if (now !== undefined && !(now > r.saves)) return null;\n",
    replacement: "  if (now !== undefined) return null;\n",
    expected: "Dateien aus Backups zurueckholen: aeltere Fassung, fehlende Kopie, fremder Schluessel"
  },
  {
    nr: '1593', name: "Die aeltere Fassung traegt den Namen der jetzigen",
    file: 'server.js',
    search: "  const dot = filename.lastIndexOf('.');\n  return dot > 0 ? filename.slice(0, dot) + mark + filename.slice(dot) : filename + mark;\n",
    replacement: "  return filename;\n",
    expected: "Dateien aus Backups zurueckholen: aeltere Fassung, fehlende Kopie, fremder Schluessel"
  },
  {
    nr: '1594', name: "Eine fehlende Kopie wird nicht abgelehnt",
    file: 'server.js',
    search: "  if (from && !backup.copyPresent(folder, { name: r.disk, length: encLen(f.size, f.chunk) }))\n    throw refusal(409, 'server.backupCopyMissing');\n",
    replacement: "",
    expected: "Dateien aus Backups zurueckholen: aeltere Fassung, fehlende Kopie, fremder Schluessel"
  },
  {
    nr: '1595', name: "Aus der Datenbank eines Backups kommen leere Stuecke",
    file: 'server.js',
    search: "    const bytes = part.get(i * f.chunk + 1, f.chunk, id)?.part || NO_BYTES;\n",
    replacement: "    const bytes = NO_BYTES;\n",
    expected: "Dateien aus Backups zurueckholen: aus der Datenbank eines alten Backups"
  },
  {
    nr: '1596', name: "Das Lockfile eines anderen Laufs haelt nichts auf",
    file: 'server.js',
    search: "    const lock = list ? takeBackupLock(target.filePath) : null;\n",
    replacement: "    const lock = list ? (takeBackupLock(target.filePath) || 'ohne') : null;\n",
    expected: "Dateien aus Backups zurueckholen: Eintrag aus dem Papierkorb, Grenze, laufendes Backup"
  },
  {
    nr: '1597', name: "Der Server nimmt filesSort nach Typ nicht an",
    file: 'server.js',
    search: "'size_asc', 'size_desc', 'type_asc', 'type_desc'],",
    replacement: "'size_asc', 'size_desc'],",
    expected: "Sortieren nach Typ: die Einstellung"
  },
  {
    nr: '1598', name: "Nach dem Hochladen eines Fotos liest niemand die Angaben",
    file: 'server.js',
    search: "    photoMediaSoon(added);\n",
    replacement: "",
    expected: "Erweiterte Infos zu Fotos und Videos des Eintrags"
  },
  {
    nr: '1599', name: "Mit dem Foto bleiben seine Angaben",
    file: 'schema.js',
    search: "CREATE TABLE IF NOT EXISTS photo_media (\n  photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,",
    replacement: "CREATE TABLE IF NOT EXISTS photo_media (\n  photo_id INTEGER PRIMARY KEY REFERENCES photos(id),",
    expected: "Erweiterte Infos zu Fotos und Videos des Eintrags"
  },
  {
    nr: '1600', name: "Jeder sieht „Gelöschte Dateien …“",
    file: 'public/app.js',
    search: "${OWNER\n          ? `<button class=\"link-btn\" id=\"adeleted\">",
    replacement: "${true\n          ? `<button class=\"link-btn\" id=\"adeleted\">",
    expected: "Gelöschte Dateien: Knopf, Dialog und Zurückholen"
  },
  {
    nr: '1601', name: "Die Rueckfrage nennt die Frist nicht",
    file: 'public/app.js',
    search: "t('entry.fileDeleteHint', { filename: a.filename, trashDays: TRASH_DAYS })",
    replacement: "t('entry.fileDeleteHint', { filename: a.filename })",
    expected: "Papierkorb: Dateien in der Karte, die Rückfrage beim Löschen"
  },
  {
    nr: '1602', name: "Die Karte nennt nur den Dateinamen",
    file: 'public/app.js',
    search: "      const name = file ? [z.entry, z.folder, z.title].filter(Boolean).join(' › ') : z.title;\n",
    replacement: "      const name = z.title;\n",
    expected: "Papierkorb: Dateien in der Karte, die Rückfrage beim Löschen"
  },
  {
    nr: '1603', name: "Der fehlende Eintrag steht nicht in der Zeile",
    file: 'public/app.js',
    search: "        file && !z.entryThere ? t('card.trashEntryGone') : ''\n",
    replacement: "        ''\n",
    expected: "Papierkorb: Dateien in der Karte, die Rückfrage beim Löschen"
  },
  {
    nr: '1604', name: "„Typ“ fehlt in der Auswahl",
    file: 'public/app.js',
    search: "Object.entries(FILES_SORTS).map(([v, s]) => `<option",
    replacement: "Object.entries(FILES_SORTS).filter(([v]) => v !== 'type').map(([v, s]) => `<option",
    expected: "Sortieren nach Typ: Auswahl, Kopfzeile und Ordner"
  },
  {
    nr: '1605', name: "Nach Typ zaehlt nur der Name",
    file: 'public/app.js',
    search: "    type: (a, b) => kindOrder(kindOf(a), kindOf(b)) || byName(a.filename, b.filename)",
    replacement: "    type: (a, b) => byName(a.filename, b.filename)",
    expected: "Sortieren nach Typ: Auswahl, Kopfzeile und Ordner"
  },
  {
    nr: '1606', name: "Ordner stehen bei „Typ“ nach Groesse",
    file: 'public/app.js',
    search: "    const by = key === 'name' || key === 'type' ? (x, y)",
    replacement: "    const by = key === 'name' ? (x, y)",
    expected: "Sortieren nach Typ: Auswahl, Kopfzeile und Ordner"
  },
  {
    nr: '1607', name: "Die Spalte „Typ“ ist kein Knopf",
    file: 'public/app.js',
    search: "<button type=\"button\" class=\"acol\" data-sort=\"type\"></button>",
    replacement: "<span class=\"acol\" data-sort=\"type\"></span>",
    expected: "Sortieren nach Typ: Auswahl, Kopfzeile und Ordner"
  },
  {
    nr: '1608', name: "Der Codec heisst wie bei MediaInfo",
    file: 'public/app.js',
    search: "const CODEC_NAMES = { AVC: 'H.264', HEVC: 'H.265', avif: 'AVIF', Bitmap: 'BMP', 'MPEG Audio': 'MP3' };",
    replacement: "const CODEC_NAMES = {};",
    expected: "Erweiterte Infos: Audio, Container und H.264"
  },
  {
    nr: '1609', name: "Auch bei Videos steht „Format“",
    file: 'public/app.js',
    search: "[[video.length ? 'entry.mediaContainer' : 'entry.mediaFormat', g.format],",
    replacement: "[['entry.mediaFormat', g.format],",
    expected: "Erweiterte Infos: Audio, Container und H.264"
  },
  {
    nr: '1610', name: "Hinter einem Dialog blaettert das Vollbild weiter",
    file: 'public/app.js',
    search: "nur ihn.\n    if (document.querySelector('.backdrop')) return;\n",
    replacement: "nur ihn.\n",
    expected: "ⓘ im Vollbild und die Tasten bei offenem Dialog"
  },
  {
    nr: '1611', name: "ⓘ fehlt im Vollbild der Dateien",
    file: 'public/app.js',
    search: "      info: fileInfo, stillWanted\n",
    replacement: "      stillWanted\n",
    expected: "ⓘ im Vollbild und die Tasten bei offenem Dialog"
  },
  {
    nr: '1612', name: "ⓘ fehlt im Vollbild der Fotos",
    file: 'public/app.js',
    search: "        openLightbox([...item.photos], idx, item.title, photoRemove(), innerPlayer, photoLink, { info: photoInfo });\n    };\n",
    replacement: "        openLightbox([...item.photos], idx, item.title, photoRemove(), innerPlayer, photoLink);\n    };\n",
    expected: "ⓘ im Vollbild und die Tasten bei offenem Dialog"
  },
  {
    nr: '1613', name: "Die englische README weicht im Codeblock ab",
    file: 'README.md',
    search: "docker compose logs --tail 30 kriterion",
    replacement: "docker compose logs --tail 50 kriterion",
    expected: "README und Anleitung in drei Sprachen"
  },
  {
    nr: '1614', name: "Die englische README nennt nicht alle Sprachen",
    file: 'README.md',
    search: "English · [Deutsch](README-de.md) · [Türkçe](README-tr.md)",
    replacement: "English · [Deutsch](README-de.md)",
    expected: "README und Anleitung in drei Sprachen"
  },
  {
    nr: '1615', name: "Auf Tuerkisch steht yedek allein",
    file: 'README-tr.md',
    search: "Önce bir yedekleme oluştur.",
    replacement: "Önce bir yedek oluştur.",
    expected: "README und Anleitung in drei Sprachen"
  },
  {
    nr: '1616', name: "Das CHANGELOG verweist auf die deutsche Fassung von Keep a Changelog",
    file: 'CHANGELOG.md',
    search: "https://keepachangelog.com/en/1.1.0/",
    replacement: "https://keepachangelog.com/de/1.1.0/",
    expected: "Das CHANGELOG ist englisch und kurz"
  },
  {
    nr: '1617', name: "Ein Admin benennt fremde Dateien um",
    file: 'server.js',
    search: "  if (!selfOnly(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});\n  const ext = path.extname(a.filename);",
    replacement: "  const ext = path.extname(a.filename);",
    expected: "Dateien umbenennen: die Route"
  },
  {
    nr: '1618', name: "Die Endung geht beim Umbenennen verloren",
    file: 'server.js',
    search: "  const filename = stem + ext;\n",
    replacement: "  const filename = stem;\n",
    expected: "Dateien umbenennen: die Route"
  },
  {
    nr: '1619', name: "Gleiche Namen im selben Ordner gehen durch",
    file: 'server.js',
    search: "  if (qNamesBeside.all(a.item_id, a.id, a.folder_id).some(o => o.filename.toLowerCase() === lower))",
    replacement: "  if (false)",
    expected: "Dateien umbenennen: die Route"
  },
  {
    nr: '1620', name: "Gross- und Kleinschreibung trennt gleiche Namen",
    file: 'server.js',
    search: "some(o => o.filename.toLowerCase() === lower)",
    replacement: "some(o => o.filename === lower)",
    expected: "Dateien umbenennen: die Route"
  },
  {
    nr: '1621', name: "Die vorige Fassung behaelt den alten Namen",
    file: 'server.js',
    search: "    if (before) renamePrevious.run(stem + path.extname(before.filename), a.id);\n",
    replacement: "",
    expected: "Dateien umbenennen: die Route"
  },
  {
    nr: '1622', name: "Steuerzeichen im Namen gehen durch",
    file: 'server.js',
    search: "  return /^[.\\s]*$/.test(stem) || /[\\x00-\\x1f\\x7f]/.test(stem) ? null : stem;",
    replacement: "  return /^[.\\s]*$/.test(stem) ? null : stem;",
    expected: "Dateien umbenennen: die Route"
  },
  {
    nr: '1623', name: "Nach dem Umbenennen gilt der Eintrag nicht als geaendert",
    file: 'server.js',
    search: "renamePrevious.run(stem + path.extname(before.filename), a.id);\n    touch.run(a.item_id);",
    replacement: "renamePrevious.run(stem + path.extname(before.filename), a.id);",
    expected: "Dateien umbenennen: die Route"
  },
  {
    nr: '1624', name: "„Umbenennen …“ steht auch an fremden Dateien",
    file: 'public/app.js',
    search: "    if (a.mine === true) sort.push({ label: t('entry.renameFileMenu')",
    replacement: "    if (true) sort.push({ label: t('entry.renameFileMenu')",
    expected: "Dateien umbenennen: Menü und Dialog"
  },
  {
    nr: '1625', name: "Der Dialog zeigt die Endung im Feld",
    file: 'public/app.js',
    search: "value=\"${esc(a.filename.slice(0, a.filename.length - ext.length))}\"",
    replacement: "value=\"${esc(a.filename)}\"",
    expected: "Dateien umbenennen: Menü und Dialog"
  },
  {
    nr: '1626', name: "Nach dem Dialog steht der Fokus nicht auf „…“",
    file: 'public/app.js',
    search: "    const back = () => attsBox.querySelector(`[data-key=\"f${Number(a.id)}\"] .amore`)?.focus();",
    replacement: "    const back = () => {};",
    expected: "Dateien umbenennen: Menü und Dialog"
  },
  {
    nr: '1627', name: "Eine Ablehnung schliesst den Dialog",
    file: 'public/app.js',
    search: "      catch (e) {\n        yes.disabled = false;\n        return e.message === SESSION_GONE ? done() : fieldError(field, e.message);\n      }\n      const fresh = fileOf('f' + a.id);",
    replacement: "      catch (e) { toast(e.message, true); return done(); }\n      const fresh = fileOf('f' + a.id);",
    expected: "Dateien umbenennen: Menü und Dialog"
  },
  {
    nr: '1628', name: "Die Pixel kennen keine Ausrichtung",
    file: 'server.js',
    search: "  (orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height });",
    replacement: "  ({ width, height });",
    expected: "Bilder: Format, Pixel, EXIF und das Nachlesen"
  },
  {
    nr: '1629', name: "Bilder tragen kein Format",
    file: 'server.js',
    search: "      ...(kind === 'image' ? { codec: a2.image_format,",
    replacement: "      ...(kind === 'image' ? { codec: null,",
    expected: "Bilder: Format, Pixel, EXIF und das Nachlesen"
  },
  {
    nr: '1630', name: "EXIF wird nicht gelesen",
    file: 'attachments.js',
    search: "    exif: meta.exif ? exifSummary(meta.exif) : null };",
    replacement: "    exif: null };",
    expected: "Bilder: Format, Pixel, EXIF und das Nachlesen"
  },
  {
    nr: '1631', name: "Die Koordinaten werden gespeichert",
    file: 'attachments.js',
    search: "    focal35: exifNumber(photo.FocalLengthIn35mmFilm), gps: Array.isArray(gps.GPSLatitude) && Array.isArray(gps.GPSLongitude) };",
    replacement: "    focal35: exifNumber(photo.FocalLengthIn35mmFilm), gps: Array.isArray(gps.GPSLatitude) && Array.isArray(gps.GPSLongitude), place: gps };",
    expected: "Bilder: Format, Pixel, EXIF und das Nachlesen"
  },
  {
    nr: '1632', name: "Alte Zeilen von Bildern werden nicht nachgelesen",
    file: 'server.js',
    search: "  if (known && !(kind === 'image' && a.stale) && !a.soundless && !a.unscanned) return known;",
    replacement: "  if (known) return known;",
    expected: "Bilder: Format, Pixel, EXIF und das Nachlesen"
  },
  {
    nr: '1633', name: "Videos mit alter Zeile liest der Server neu",
    file: 'server.js',
    search: "  if (known && !(kind === 'image' && a.stale) && !a.soundless && !a.unscanned) return known;",
    replacement: "  if (known && !a.stale && !a.soundless && !a.unscanned) return known;",
    expected: "Bilder: Format, Pixel, EXIF und das Nachlesen"
  },
  {
    nr: '1634', name: "Alte Zeilen von Fotos werden nicht nachgelesen",
    file: 'server.js',
    search: "  if (known && !p.stale) return known;",
    replacement: "  if (known) return known;",
    expected: "Bilder: Format, Pixel, EXIF und das Nachlesen"
  },
  {
    nr: '1635', name: "Office-Dateien ohne Ersteller",
    file: 'attachments.js',
    search: "  return { title: xmlValue(core, 'title'), createdBy: xmlValue(core, 'creator'),",
    replacement: "  return { title: xmlValue(core, 'title'), createdBy: null,",
    expected: "Infos zu Dokumenten: aus Kriterion und aus der Datei"
  },
  {
    nr: '1636', name: "In meta.xml gilt dc:creator als Ersteller",
    file: 'attachments.js',
    search: "  return { title: xmlValue(meta, 'title'), createdBy: xmlValue(meta, 'initial-creator'),",
    replacement: "  return { title: xmlValue(meta, 'title'), createdBy: xmlValue(meta, 'creator'),",
    expected: "Infos zu Dokumenten: aus Kriterion und aus der Datei"
  },
  {
    nr: '1637', name: "Die Grenze fuer Dokumente liegt bei 4 MiB",
    file: 'attachments.js',
    search: "const DOCUMENT_PART = 1024 * 1024;",
    replacement: "const DOCUMENT_PART = 4 * 1024 * 1024;",
    expected: "Infos zu Dokumenten: aus Kriterion und aus der Datei"
  },
  {
    nr: '1638', name: "PDF-Texte in UTF-16 bleiben unlesbar",
    file: 'attachments.js',
    search: "  if (bytes[0] === 0xfe && bytes[1] === 0xff) {",
    replacement: "  if (false) {",
    expected: "Infos zu Dokumenten: aus Kriterion und aus der Datei"
  },
  {
    nr: '1639', name: "Der Rueckruf vergisst, wer gespeichert hat",
    file: 'server.js',
    search: "      const by = Number([].concat(cb.data.users || [])[0]) || null;",
    replacement: "      const by = null;",
    expected: "Infos zu Dokumenten: aus Kriterion und aus der Datei"
  },
  {
    nr: '1640', name: "Eine fremde Nummer aus `users` gilt als Account",
    file: 'server.js',
    search: "  VALUES (?, datetime('now'), (SELECT id FROM users WHERE id = ?))",
    replacement: "  VALUES (?, datetime('now'), ?)",
    expected: "Infos zu Dokumenten: aus Kriterion und aus der Datei"
  },
  {
    nr: '1641', name: "Die Angaben gehen im Papierkorb verloren",
    file: 'server.js',
    search: "  if (f.changes) putChanges.run(",
    replacement: "  if (false) putChanges.run(",
    expected: "Infos zu Dokumenten: aus Kriterion und aus der Datei"
  },
  {
    nr: '1642', name: "Die Aenderungszeit beim Hochladen fehlt",
    file: 'server.js',
    search: "    if (u.modified > 0) recordModified.run(fresh, u.modified);\n",
    replacement: "",
    expected: "Infos zu Dokumenten: aus Kriterion und aus der Datei"
  },
  {
    nr: '1643', name: "Dokumente bekommen keine Infos",
    file: 'server.js',
    search: "    if (a && attachments.isDocument(a.filename)) {",
    replacement: "    if (false) {",
    expected: "Infos zu Dokumenten: aus Kriterion und aus der Datei"
  },
  {
    nr: '1644', name: "„Infos“ fehlt im Menue",
    file: 'public/app.js',
    search: " || DOCUMENT_KINDS.includes(kindOf(a)))\n      pass.push(",
    replacement: ")\n      pass.push(",
    expected: "Infos zu Dokumenten: Menüpunkt und Dialog"
  },
  {
    nr: '1645', name: "Dokumente zeigen im Dialog die Gruppen eines Bildes oder Videos",
    file: 'public/app.js',
    search: "      body.innerHTML = facts.document ? documentInfoHtml(facts) : mediaInfoHtml(facts);",
    replacement: "      body.innerHTML = mediaInfoHtml(facts);",
    expected: "Infos zu Dokumenten: Menüpunkt und Dialog"
  },
  {
    nr: '1646', name: "Zugeklappt steht „Dateien“ wieder in Klammern",
    file: 'public/app.js',
    search: "    sum.textContent = !short ? '' : name === 'dateien' ? short : `(${short})`;",
    replacement: "    sum.textContent = short ? `(${short})` : '';",
    expected: "Der zugeklappte Kopf von „Dateien“"
  },
  {
    nr: '1647', name: "Zugeklappt bleiben die Bedienelemente stehen",
    file: 'public/style.css',
    search: ".block.closed > *:not(.block-head), .block.closed .ahead-acts, .block.closed #acount { display: none; }",
    replacement: ".block.closed > *:not(.block-head) { display: none; }",
    expected: "Der zugeklappte Kopf von „Dateien“"
  },
  {
    nr: '1648', name: "Videos zaehlen unter „weitere“",
    file: 'public/app.js',
    search: "  const videos = files.filter(a => kindOf(a) === 'video').length,",
    replacement: "  const videos = 0,",
    expected: "Der zugeklappte Kopf von „Dateien“"
  },
  {
    nr: '1649', name: "Die Ablehnung nennt „am“ und „von“ fest",
    file: 'public/app.js',
    search: "    const head = when && who ? t('entry.rejectedBy', { date: when, name: who })",
    replacement: "    const head = when && who ? `Abgelehnt am ${when} von ${who}`",
    expected: "Texte ohne festes Deutsch: Ablehnung und Aufgabenknopf"
  },
  {
    nr: '1650', name: "Der Aufgabenknopf sagt „offen“ fest",
    file: 'public/app.js',
    search: "    ? t('list.openTitle', { n: open, task: vTask(open) })",
    replacement: "    ? `${open} ${vTask(open)} offen`",
    expected: "Texte ohne festes Deutsch: Ablehnung und Aufgabenknopf"
  },
  {
    nr: '1651', name: "„keine“ steht fest im Code",
    file: 'public/app.js',
    search: "    case 'kategorie': return item.category ? item.category.name : t('entry.sumNone');",
    replacement: "    case 'kategorie': return item.category ? item.category.name : 'keine';",
    expected: "Texte ohne festes Deutsch: Ablehnung und Aufgabenknopf"
  },
  {
    nr: '1652', name: "Die Schwelle selbst gilt als teilweise",
    file: 'server.js',
    search: "n * 100 < share * total ? 'partial' : 'full';",
    replacement: "n * 100 <= share * total ? 'partial' : 'full';",
    expected: "Filter nach Potenzial und Bewertung: der Server"
  },
  {
    nr: '1653', name: "Fremde Werte zaehlen mit",
    file: 'server.js',
    search: "JOIN rating_criteria c ON c.id = r.criterion_id WHERE r.user_id = ? AND r.value > 0 GROUP BY r.item_id, c.phase`);",
    replacement: "JOIN rating_criteria c ON c.id = r.criterion_id WHERE (r.user_id = ? OR 1) AND r.value > 0 GROUP BY r.item_id, c.phase`);",
    expected: "Filter nach Potenzial und Bewertung: der Server"
  },
  {
    nr: '1654', name: "Ungetestete Eintraege zaehlen bei „Bewertung“",
    file: 'server.js',
    search: "      out[phase] = phase === 'after' && !tested ? null : ",
    replacement: "      out[phase] = ",
    expected: "Filter nach Potenzial und Bewertung: der Server"
  },
  {
    nr: '1655', name: "Die Schwelle nimmt 0 und 101 an",
    file: 'server.js',
    search: "        if (!Number.isInteger(n) || n < PARTIAL_SHARE.min || n > PARTIAL_SHARE.max)",
    replacement: "        if (!Number.isInteger(n))",
    expected: "Filter nach Potenzial und Bewertung: der Server"
  },
  {
    nr: '1656', name: "Ohne Potenzialmodus bleibt die Phase stehen",
    file: 'server.js',
    search: "  if (!potentialMode()) delete totals.before;\n",
    replacement: "",
    expected: "Filter nach Potenzial und Bewertung: der Server"
  },
  {
    nr: '1657', name: "Der Filter „Eigene Werte“ wirkt nicht",
    file: 'public/app.js',
    search: "  if (own !== 'all') out = out.filter(i => i.share?.[sharePhase(i)] === own);\n",
    replacement: "",
    expected: "Eigene Werte: eine Gruppe in der Statuszeile"
  },
  {
    nr: '1658', name: "Der Filter „Eigene Werte“ zaehlt nicht als aktiv",
    file: 'public/app.js',
    search: "  if (shareWanted(f) !== 'all') n++;\n",
    replacement: "",
    expected: "Eigene Werte: eine Gruppe in der Statuszeile"
  },
  {
    nr: '1659', name: "Eine ausgeblendete Gruppe filtert weiter",
    file: 'public/app.js',
    search: "const shareWanted = (f) => (shareShown() ? f.own : 'all');",
    replacement: "const shareWanted = (f) => f.own;",
    expected: "Eigene Werte: alte Filter, ohne Potenzialmodus, ohne Kriterien"
  },
  {
    nr: '1660', name: "Das Feld fuer die Schwelle steht auch ohne Adminrechte da",
    file: 'public/app.js',
    search: "  { key: 'criteria',     section: 'inventory', visible: () => ADMIN,",
    replacement: "  { key: 'criteria',     section: 'inventory', visible: () => true,",
    expected: "Filter „Teilweise“: die Schwelle in den Einstellungen"
  },
  {
    nr: '1661', name: "Eine abgelehnte Schwelle bleibt im Feld stehen",
    file: 'public/app.js',
    search: "    } catch (e) { toast(e.message, true); }\n    shareField.value = String(PARTIAL_SHARE);",
    replacement: "    } catch (e) { toast(e.message, true); }",
    expected: "Filter „Teilweise“: die Schwelle in den Einstellungen"
  },
  {
    nr: '1662', name: "Bilder heissen in der Spalte „Typ“ nur „Bild“",
    file: 'public/app.js',
    search: "  if (kind === 'image') {\n    const parts = [codecName(a.codec), pixelText(a.width, a.height)].filter(Boolean);\n    return parts.length ? parts : [t(KIND_WORDS.image)];\n  }\n",
    replacement: "",
    expected: "Bilder: Typ, Vorschaubild und Erweiterte Infos"
  },
  {
    nr: '1663', name: "Die Vorschaubilder in der Datei fehlen",
    file: 'public/app.js',
    search: "  const [main, ...thumbs] = f.image || [];",
    replacement: "  const [main] = f.image || [], thumbs = [];",
    expected: "Bilder: Typ, Vorschaubild und Erweiterte Infos"
  },
  {
    nr: '1664', name: "„Aufnahmedatum“ bleibt neben der Zeit aus EXIF",
    file: 'public/app.js',
    search: "    ['entry.mediaRecorded', shot.taken ? '' : recorded ? fmtDate(recorded[0]) : g.recorded],",
    replacement: "    ['entry.mediaRecorded', recorded ? fmtDate(recorded[0]) : g.recorded],",
    expected: "Bilder: Typ, Vorschaubild und Erweiterte Infos"
  },
  {
    nr: '1665', name: "Die Belichtungszeit steht als Dezimalzahl",
    file: 'public/app.js',
    search: "t('entry.mediaSeconds', { n: s < 0.4 ? `1/${Math.round(1 / s)}` : number(s, 0, 1) });",
    replacement: "t('entry.mediaSeconds', { n: number(s, 0, 3) });",
    expected: "Bilder: Typ, Vorschaubild und Erweiterte Infos"
  },
  {
    nr: '1666', name: "Die Pixel im Dialog kennen keine Ausrichtung",
    file: 'public/app.js',
    search: "    ['entry.mediaResolution', turned ? pixelText(main.height, main.width) : pixelText(main.width, main.height)],",
    replacement: "    ['entry.mediaResolution', pixelText(main.width, main.height)],",
    expected: "Bilder: Typ, Vorschaubild und Erweiterte Infos"
  },
  {
    nr: '1667', name: "Die deutsche Anleitung beschreibt wieder „Eintrag exportieren“",
    file: 'manual-de.md',
    search: "## Kommentare\n\nEin Kommentar hat eine **Art**",
    replacement: "### Eintrag exportieren\n\nNur für den Eigentümer-Admin.\n\n## Kommentare\n\nEin Kommentar hat eine **Art**",
    expected: "Anleitung, README und Namen"
  },
  {
    nr: '1668', name: "Die Anleitung sagt wieder „Ähnlich:“",
    file: 'manual-de.md',
    search: "Beim Anlegen zeigt „Ähnliche Titel: …“",
    replacement: "Beim Anlegen zeigt „Ähnlich: …“",
    expected: "Anleitung, README und Namen"
  },
  {
    nr: '1669', name: "Die Anleitung beschreibt „Infos“ nicht",
    file: 'manual-de.md',
    search: "- **Infos zu Dokumenten:** „Infos“ im Menü ⋯ einer Word-, Excel-, PowerPoint-",
    replacement: "- „Infos“ im Menü ⋯ einer Word-, Excel-, PowerPoint-",
    expected: "Anleitung, README und Namen"
  },
  {
    nr: '1670', name: "Die englische README nennt `exif-reader` nicht",
    file: 'README.md',
    search: "`sharp`, `nodemailer`, `mediainfo.js` and `exif-reader`. The frontend uses no",
    replacement: "`sharp`, `nodemailer` and `mediainfo.js`. The frontend uses no",
    expected: "Anleitung, README und Namen"
  },
  {
    nr: '1671', name: "Der Abschnitt heisst englisch wieder „User“",
    file: 'public/app.js',
    search: "  { key: 'users',        name: () => t('card.users') },",
    replacement: "  { key: 'users',        name: () => t('card.user') },",
    expected: "Anleitung, README und Namen"
  },
  {
    nr: '1672', name: "Der Player behaelt waehrend des Ladens seine Quelle",
    file: 'public/app.js',
    search: "    player.removeAttribute('src');\n    player.load();\n    markWhole();",
    replacement: "    markWhole();",
    expected: "Video ganz laden"
  },
  {
    nr: '1673', name: "Abbrechen gibt die Adresse nicht zurueck",
    file: 'public/app.js',
    search: "    if (backToAddress) {\n      player.src = was.source;",
    replacement: "    if (false) {\n      player.src = was.source;",
    expected: "Video ganz laden"
  },
  {
    nr: '1674', name: "Dasselbe Video laedt nach dem Schliessen wieder aus dem Netz",
    file: 'public/app.js',
    search: "      videoPlayer.src = wholeCopy?.source === address ? wholeCopy.url : address;",
    replacement: "      videoPlayer.src = address;",
    expected: "Video ganz laden"
  },
  {
    nr: '1675', name: "Nach dem Laden spielt das Video nicht weiter",
    file: 'public/app.js',
    search: "      if (mine.playing) player.play()?.catch?.(() => {});\n      markWhole();",
    replacement: "      markWhole();",
    expected: "Video ganz laden"
  },
  {
    nr: '1676', name: "Der Abschnitt „Backup“ fehlt",
    file: 'public/app.js',
    search: "  { key: 'backup',       name: () => t('card.backupSection') },\n",
    replacement: "",
    expected: "Der Systembereich nach Rolle"
  },
  {
    nr: '1677', name: "„Zweiter Faktor“ fehlt in „Mein Account“",
    file: 'public/app.js',
    search: "        <h4 class=\"sys-sub\">${tH('card.twoFactorTitle')}</h4>\n        <div class=\"two-factor-block\" id=\"two-factor-block\"></div>\n",
    replacement: "",
    expected: "Die Karte „Zugang“: der zweite Faktor"
  },
  {
    nr: '1678', name: "Die Leiste der Abschnitte steht auch mit nur einem Abschnitt",
    file: 'public/app.js',
    search: "    ${visibleOnes.length > 1 ? `<button class=\"btn btn-sm sys-toggle\" id=\"sys-toggle\"",
    replacement: "    ${visibleOnes.length > 0 ? `<button class=\"btn btn-sm sys-toggle\" id=\"sys-toggle\"",
    expected: "Der Systembereich nach Rolle"
  },
  {
    nr: '1679', name: "In „Mein Account“ fehlt der Hinweis auf einen Admin",
    file: 'public/app.js',
    search: " ||\n          `<p class=\"desc\">${tH('card.passwordAskAdmin')}</p>`}</div>",
    replacement: "}</div>",
    expected: "Der Systembereich nach Rolle"
  },
  {
    nr: '1680', name: "Bei den Wiederherstellungscodes fehlt der Hinweis auf einen Admin",
    file: 'public/app.js',
    search: " ||\n        `<p class=\"desc\" style=\"margin:8px 0 0\">${tH('card.twoFactorAskAdmin')}</p>`}`;",
    replacement: "}`;",
    expected: "Der Systembereich nach Rolle"
  },
  {
    nr: '1681', name: "Admins sehen die Grenzen wieder als Felder",
    file: 'public/app.js',
    search: "          if (!OWNER) return `<div class=\"kv\"><span class=\"k\">${tH(label)}</span><span class=\"v\">${",
    replacement: "          if (false) return `<div class=\"kv\"><span class=\"k\">${tH(label)}</span><span class=\"v\">${",
    expected: "Die Bildablage in der Oberflaeche"
  },
  {
    nr: '1682', name: "Der Hinweis zum Schluessel steht wieder beim Admin",
    file: 'public/app.js',
    search: "              ${serverBox(t('card.restartHint'), 'docker compose up -d')}\n            </div>` : '')}",
    replacement: "              ${serverBox(t('card.restartHint'), 'docker compose up -d')}\n            </div>` : `<div class=\"warn-box\">${tH('card.keyBesideHint')}</div>`)}",
    expected: "Die Rollenweichen — 0.22.0"
  },
  {
    nr: '1683', name: "„Vokabular“ ist wieder eine schmale Karte",
    file: 'public/app.js',
    search: "function cardVocabulary() {\n  return `<div class=\"sys-card wide\" data-watch>",
    replacement: "function cardVocabulary() {\n  return `<div class=\"sys-card\" data-watch>",
    expected: "Der Systembereich nach Rolle"
  },
  {
    nr: '1684', name: "Ohne Mailversand steht der Schalter wieder da",
    file: 'public/app.js',
    search: "        ${requests.an || requests.deliveryReady ? `<div class=\"row-in\" style=\"margin-top:10px\">",
    replacement: "        ${true ? `<div class=\"row-in\" style=\"margin-top:10px\">",
    expected: "Die Karte „Anfragen“"
  },
  {
    nr: '1685', name: "Die Linkzeilen fehlen in „Darstellung“",
    file: 'public/app.js',
    search: "  drawStrip();\n  drawLinkRows();\n  drawSearchNames();\n",
    replacement: "  drawStrip();\n",
    expected: "Der Systembereich nach Rolle"
  },
  {
    nr: '1686', name: "Die Karte „Speicher und Wartung“ fehlt",
    file: 'public/app.js',
    search: "  { key: 'storage',      section: 'database', visible: () => ADMIN,\n    markup: cardStorage,  wireUp: setUpStorageOut },\n",
    replacement: "",
    expected: "Der Systembereich nach Rolle"
  },
  {
    nr: '1687', name: "Den Modus „Potenzial“ sieht der Admin wieder als gesperrtes Kaestchen",
    file: 'public/app.js',
    search: "          ${OWNER ? `<label class=\"ex-files\"><input type=\"checkbox\" id=\"pot-mode\">",
    replacement: "          ${ADMIN ? `<label class=\"ex-files\"><input type=\"checkbox\" id=\"pot-mode\" disabled>",
    expected: "Der Systembereich nach Rolle"
  },
  {
    nr: '1688', name: "Ein Benutzer holt die Kategorien wieder, ohne die Karte zu sehen",
    file: 'public/app.js',
    search: "      ADMIN ? api('GET', '/api/product-categories') : null, ADMIN ? api('GET', '/api/tags') : null,",
    replacement: "      api('GET', '/api/product-categories'), ADMIN ? api('GET', '/api/tags') : null,",
    expected: "Der Systembereich nach Rolle"
  },
  {
    nr: '1689', name: "Den Abgleich ruft jeder Admin",
    file: 'server.js',
    search: "app.get('/api/maintenance', ownerOnly, async (req, res, next) => {",
    replacement: "app.get('/api/maintenance', adminOnly, async (req, res, next) => {",
    expected: "Wartung: der Abgleich nennt jeden Eintrag ohne Verweis"
  },
  {
    nr: '1690', name: "Der Abgleich kennt wieder nur Namen aus 32 Hexzeichen",
    file: 'server.js',
    search: "    if (known.has(name)) continue;\n    const file = path.join(FILES_DIR, name);",
    replacement: "    if (known.has(name) || !DISK_NAME.test(name)) continue;\n    const file = path.join(FILES_DIR, name);",
    expected: "Wartung: der Abgleich nennt jeden Eintrag ohne Verweis"
  },
  {
    nr: '1691', name: "Ein Verzeichnis zaehlt seinen Inhalt nicht",
    file: 'server.js',
    search: "    if (kind === 'dir') try { tree = treeSize(file); } catch { tree = { files: 0, bytes: 0 }; }",
    replacement: "    if (kind === 'dir') tree = null;",
    expected: "Wartung: der Abgleich nennt jeden Eintrag ohne Verweis"
  },
  {
    nr: '1692', name: "Eine Datei, die kein Backup nennt, darf nicht weg",
    file: 'server.js',
    search: "const FREE_WHY = new Set(['foreign', 'copied', 'unnamed']);",
    replacement: "const FREE_WHY = new Set(['foreign', 'copied']);",
    expected: "Wartung: der Abgleich nennt jeden Eintrag ohne Verweis"
  },
  {
    nr: '1693', name: "Ein Backup ohne Dateiliste zaehlt nicht",
    file: 'server.js',
    search: "    if (!list) { unlisted++; continue; }",
    replacement: "    if (!list) continue;",
    expected: "Wartung: ohne Backup-Ordner und mit einem Backup ohne Liste"
  },
  {
    nr: '1694', name: "Ohne Backup-Ordner nennt kein Backup den Namen",
    file: 'server.js',
    search: "  const files = folder ? backup.backupList(folder) : null;\n  if (!files) return null;",
    replacement: "  const files = folder ? backup.backupList(folder) : [];\n  if (!files) return null;",
    expected: "Wartung: ohne Backup-Ordner und mit einem Backup ohne Liste"
  },
  {
    nr: '1695', name: "Ein Verzeichnis wird nur leer geloescht",
    file: 'server.js',
    search: "        if (f.kind === 'dir') fs.rmSync(f.file, { recursive: true, force: true });",
    replacement: "        if (f.kind === 'dir') fs.rmdirSync(f.file);",
    expected: "Wartung: Loeschen nach Namen"
  },
  {
    nr: '1696', name: "Geloescht wird das Ziel eines symbolischen Links",
    file: 'server.js',
    search: "        else fs.unlinkSync(f.file);",
    replacement: "        else fs.unlinkSync(f.kind === 'link' ? fs.realpathSync(f.file) : f.file);",
    expected: "Wartung: Loeschen nach Namen"
  },
  {
    nr: '1697', name: "Geloescht wird jeder freie Eintrag, auch ungewaehlt",
    file: 'server.js',
    search: "    for (const f of unknownScan().filter(z => z.free && wanted.has(z.name))) {",
    replacement: "    for (const f of unknownScan().filter(z => z.free)) {",
    expected: "Wartung: Loeschen nach Namen"
  },
  {
    nr: '1698', name: "Das Server-Log nennt die geloeschten Namen nicht",
    file: 'server.js',
    search: "  if (removed) logLine(`Disk files without a reference removed: ${removed} (${bytes} bytes): ${gone.join(', ')}.`);",
    replacement: "  if (removed) logLine(`Disk files without a reference removed: ${removed} (${bytes} bytes).`);",
    expected: "Wartung: Loeschen nach Namen"
  },
  {
    nr: '1699', name: "Der Abgleich prueft die Dateien nicht neu",
    file: 'server.js',
    search: "    findMissing();\n    if (!CHECK || CHECK.delivered) {",
    replacement: "    if (!CHECK || CHECK.delivered) {",
    expected: "Wartung: fehlende Dateien"
  },
  {
    nr: '1700', name: "Zurueckholen nimmt eine Kopie anderer Laenge",
    file: 'server.js',
    search: "      if (!r || !backup.copyPresent(folder, { name, length })) continue;",
    replacement: "      if (!r || !fs.existsSync(path.join(folder, COPY_DIR, name))) continue;",
    expected: "Wartung: fehlende Dateien"
  },
  {
    nr: '1701', name: "Zurueckholen laeuft auch waehrend eines Backups",
    file: 'server.js',
    search: "  let lock;\n  try { lock = takeBackupLock(folder); } catch (e) { return next(e); }\n  if (!lock) return res.status(409).json({ error: t(locale, 'server.backupRunning') });\n  const wanted = pickedNames(req.body);",
    replacement: "  const lock = takeBackupLock(folder) || path.join(folder, COPY_DIR, '.gestellt');\n  const wanted = pickedNames(req.body);",
    expected: "Wartung: waehrend eines Backups"
  },
  {
    nr: '1702', name: "Die Pruefung liest die Fremdschluessel nicht",
    file: 'batchrun.js',
    search: "  for (const z of db.pragma('foreign_key_check')) {",
    replacement: "  for (const z of []) {",
    expected: "Wartung: Pruefung der Datenbank"
  },
  {
    nr: '1703', name: "Ein verletzter Fremdschluessel gilt als in Ordnung",
    file: 'server.js',
    search: "      done({ ...r, ok: r.quick.length === 1 && r.quick[0] === 'ok' && !r.keys.length, ms: Date.now() - started });",
    replacement: "      done({ ...r, ok: r.quick[0] === 'ok', ms: Date.now() - started });",
    expected: "Wartung: Pruefung der Datenbank"
  },
  {
    nr: '1704', name: "Die Kennzahlen nennen die freien Seiten nicht",
    file: 'server.js',
    search: "    dbBytes, dbFree: dbFreeBytes(), photoCount: p.n, photoBytes: p.o,",
    replacement: "    dbBytes, dbFree: 0, photoCount: p.n, photoBytes: p.o,",
    expected: "Wartung: Pruefung der Datenbank"
  },
  {
    nr: '1705', name: "Den Knopf „Abgleich“ sieht jeder Admin",
    file: 'public/app.js',
    search: "        ${OWNER ? `<div class=\"sys-part\"></div>\n        ${setting(tH('card.setMaint'), tH('card.maintHint'), tH('card.maintHintMore'))}",
    replacement: "        ${ADMIN ? `<div class=\"sys-part\"></div>\n        ${setting(tH('card.setMaint'), tH('card.maintHint'), tH('card.maintHintMore'))}",
    expected: "Wartung: die Karte"
  },
  {
    nr: '1706', name: "Die Karte schickt alle Namen statt der gewaehlten",
    file: 'public/app.js',
    search: "    const names = chosen('maint-pick');",
    replacement: "    const names = unknown.map(f => f.name);",
    expected: "Wartung: die Karte"
  },
  {
    nr: '1707', name: "Eine Datei, die bleibt, ist in der Karte waehlbar",
    file: 'public/app.js',
    search: "          f.free ? '' : ' disabled'}>",
    replacement: "          ''}>",
    expected: "Wartung: die Karte"
  },
  {
    nr: '1708', name: "Eine fehlende Datei zeigt nichts an",
    file: 'public/app.js',
    search: "    const missing = a.missing ? t('entry.fileMissing') : '';",
    replacement: "    const missing = '';",
    expected: "Wartung: „fehlt“ an der Datei"
  },
  {
    nr: '1709', name: "Der Abgleich zeigt die Pruefung der Datenbank nicht",
    file: 'public/app.js',
    search: "      MAINT_CHECK = m.check;",
    replacement: "      MAINT_CHECK = null;",
    expected: "Wartung: die Karte"
  },
  {
    nr: '1710', name: "Die Route wartet auf die Pruefung, so lange sie dauert",
    file: 'server.js',
    search: "    await Promise.race([mine.done, new Promise(ok => { clock = setTimeout(ok, CHECK_WAIT_MS); })]);",
    replacement: "    await mine.done;",
    expected: "Wartung: Pruefung der Datenbank"
  },
  {
    nr: '1711', name: "Ein neuer Abgleich bekommt die alte Pruefung",
    file: 'server.js',
    search: "    if (mine.result) mine.delivered = true;\n",
    replacement: "",
    expected: "Wartung: Pruefung der Datenbank"
  },
  {
    nr: '1712', name: "Die Karte fragt nicht nach, solange die Pruefung laeuft",
    file: 'public/app.js',
    search: "        if (!m.check || !m.check.running || !out.isConnected) break;",
    replacement: "        break;",
    expected: "Wartung: die Karte"
  },
  {
    nr: '1713', name: "Ein Video ueber 1080 Pixel bekommt keinen Proxy",
    file: 'videoproxy.js',
    search: "  if (Math.min(v.width || 0, v.height || 0) > SHORT_SIDE) return true;\n",
    replacement: "",
    expected: "Proxy: Auswahl, Bitrate und Weg"
  },
  {
    nr: '1714', name: "Ton in PCM bekommt keinen Proxy",
    file: 'videoproxy.js',
    search: "  if ((info.audio || []).some(a => !PLAIN_AUDIO.includes(a.format))) return true;\n",
    replacement: "",
    expected: "Proxy: Auswahl, Bitrate und Weg"
  },
  {
    nr: '1715', name: "Ueber 12 Mbit/s bekommt keinen Proxy",
    file: 'videoproxy.js',
    search: "  return (v.bitRate || 0) > MAX_VIDEO_BPS;",
    replacement: "  return false;",
    expected: "Proxy: Auswahl, Bitrate und Weg"
  },
  {
    nr: '1716', name: "mkv, avi, wmv und flv bekommen keinen Proxy",
    file: 'videoproxy.js',
    search: "  if (proxyOnly(filename)) return true;\n",
    replacement: "",
    expected: "Proxy: Auswahl, Bitrate und Weg"
  },
  {
    nr: '1717', name: "Die Bitrate hat keine Obergrenze",
    file: 'videoproxy.js',
    search: "  return Math.round(Math.min(MAX_PROXY_BPS, base * frameRateOf(v) / 30 * pixels / (1920 * 1080)));",
    replacement: "  return Math.round(base * frameRateOf(v) / 30 * pixels / (1920 * 1080));",
    expected: "Proxy: Bitrate aus Basis, Bildrate und Pixeln"
  },
  {
    nr: '1718', name: "HEVC geht ueber Weg B",
    file: 'videoproxy.js',
    search: "  return plainH264(v) || HW_DECODE.includes(v.format) ? 'A' : 'B';",
    replacement: "  return plainH264(v) ? 'A' : 'B';",
    expected: "Proxy: Auswahl, Bitrate und Weg"
  },
  {
    nr: '1719', name: "ffmpeg dreht ein Hochkant-Video",
    file: 'videoproxy.js',
    search: "...decode, '-noautorotate',",
    replacement: "...decode,",
    expected: "Proxy: Auswahl, Bitrate und Weg"
  },
  {
    nr: '1720', name: "Der Puffer ist so gross wie die Bitrate",
    file: 'videoproxy.js',
    search: "'-bufsize', String(2 * bps)",
    replacement: "'-bufsize', String(bps)",
    expected: "Proxy: Auswahl, Bitrate und Weg"
  },
  {
    nr: '1721', name: "Eine ungerade Hoehe bleibt ungerade",
    file: 'videoproxy.js',
    search: "min(1080,trunc(ih/2)*2)",
    replacement: "min(1080,ih)",
    expected: "Proxy: Auswahl, Bitrate und Weg"
  },
  {
    nr: '1722', name: "Ein Keyframe nur alle 250 Bilder",
    file: 'videoproxy.js',
    search: "  const gop = Math.max(1, Math.round(2 * frameRateOf(v)));",
    replacement: "  const gop = 250;",
    expected: "Proxy: Auswahl, Bitrate und Weg"
  },
  {
    nr: '1723', name: "ffmpeg laeuft unter der Nummer von Kriterion",
    file: 'videoproxy.js',
    search: "ids: { uid: FFMPEG_UID, gid }",
    replacement: "ids: {}",
    expected: "Proxy: Auswahl, Bitrate und Weg"
  },
  {
    nr: '1724', name: "ffmpeg erbt die Umgebung von Kriterion",
    file: 'videoproxy.js',
    search: "{ cwd, env: {}, stdio:",
    replacement: "{ cwd, env: process.env, stdio:",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1725', name: "ffmpeg laeuft mit normaler Prioritaet",
    file: 'videoproxy.js',
    search: "if (bench) return { file: nice, prefix: ['-n', '19', process.execPath, ...bench], ids: {} };",
    replacement: "if (bench) return { file: process.execPath, prefix: bench, ids: {} };",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1726', name: "Das Arbeitsverzeichnis behaelt die Rechte von mkdtemp nicht",
    file: 'videoproxy.js',
    search: "  fs.chmodSync(dir, 0o700);",
    replacement: "  fs.chmodSync(dir, 0o755);",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1727', name: "Ohne HuC-Firmware nennt die Karte keinen Grund",
    file: 'videoproxy.js',
    search: "reason: free.code === 0 ? 'huc' : firmware ? 'firmware' : 'failed',",
    replacement: "reason: firmware ? 'firmware' : 'failed',",
    expected: "Proxy: ohne Quick Sync, ohne Firmware und Schalter aus"
  },
  {
    nr: '1728', name: "Die fehlende Firmware fuer i915 wird nicht erkannt",
    file: 'videoproxy.js',
    search: "  const firmware = /iHD_drv_video\\.so init failed/.test(fixed.log);",
    replacement: "  const firmware = false;",
    expected: "Proxy: ohne Quick Sync, ohne Firmware und Schalter aus"
  },
  {
    nr: '1729', name: "Proxys sind von Anfang an eingeschaltet",
    file: 'server.js',
    search: "const proxyOn = () => getSetting('proxyOn', false) === true;",
    replacement: "const proxyOn = () => getSetting('proxyOn', true) === true;",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1730', name: "Den Schalter setzt auch ein Admin",
    file: 'server.js',
    search: "                                'uploadLimits', 'proxyOn', 'proxyRate'];",
    replacement: "                                'uploadLimits', 'proxyRate'];",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1731', name: "GET /api/settings nennt den Schalter nicht",
    file: 'server.js',
    search: "  proxyOn: proxyOn(),\n",
    replacement: "",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1732', name: "Der Server des Originals fragt die Marke nicht ab",
    file: 'server.js',
    search: "    if (req.url !== `/${mark}` || (req.method !== 'GET' && req.method !== 'HEAD'))",
    replacement: "    if (req.method !== 'GET' && req.method !== 'HEAD')",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1733', name: "Das Arbeitsverzeichnis bleibt unter /tmp",
    file: 'server.js',
    search: "  } finally { fs.rmSync(dir, { recursive: true, force: true }); }",
    replacement: "  } finally { }",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1734', name: "Der Proxy liegt unverschluesselt auf der Platte",
    file: 'server.js',
    search: "      await attachments.sealInto(path.join(PROXY_DIR, p.name), p, first, block.subarray(0, bytesRead), { fresh: at === 0 });",
    replacement: "      await fs.promises.appendFile(path.join(PROXY_DIR, p.name), block.subarray(0, bytesRead));",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1735', name: "Die Tabelle nennt die Pixel des Originals",
    file: 'videoproxy.js',
    search: "  if (w > h) { const ph = Math.min(SHORT_SIDE, 2 * Math.floor(h / 2));",
    replacement: "  if (w > h) { const ph = 2 * Math.floor(h / 2);",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1736', name: "Die Liste nennt keinen Proxy",
    file: 'server.js',
    search: "      proxy: proxyReady ? { size: a2.proxy_size, width: a2.proxy_width, height: a2.proxy_height } : null,",
    replacement: "      proxy: null,",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1737', name: "Der Proxy kommt als Download",
    file: 'server.js',
    search: "{ inline: !!out.filename || shownInline(req) }",
    replacement: "{ inline: shownInline(req) }",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1738', name: "Erweiterte Infos nennen keinen Proxy",
    file: 'server.js',
    search: "    const proxy = await proxyInfo(a.id, facts, a.filename);",
    replacement: "    const proxy = null;",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1739', name: "?size=proxy liefert das Original",
    file: 'server.js',
    search: "    if (req.query.size === 'proxy') return await sendProxy(req, res);\n",
    replacement: "",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1740', name: "mkv wird nicht analysiert",
    file: 'attachments.js',
    search: "const mediaKind = (filename) => (proxyOnly(filename) ? 'video'",
    replacement: "const mediaKind = (filename) => (false ? 'video'",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1741', name: "Ein neues Video wartet bis zum naechsten Lauf",
    file: 'server.js',
    search: "  if (facts.video.length && !known) proxySoon([id], { front: true });\n",
    replacement: "",
    expected: "Proxy: die vier Endungen, Pixel und Auswahl im Server"
  },
  {
    nr: '1742', name: "mkv bleibt auch mit Proxy ohne Vorschau",
    file: 'server.js',
    search: "    const kind = proxyReady && attachments.proxyOnly(a2.filename) ? 'video' : attachments.previewKind(a2.filename);",
    replacement: "    const kind = attachments.previewKind(a2.filename);",
    expected: "Proxy: die vier Endungen, Pixel und Auswahl im Server"
  },
  {
    nr: '1743', name: "Fuer mkv nimmt der Server kein Standbild an",
    file: 'server.js',
    search: "  if (!playsAsVideo(req.params.id, a.filename)) return",
    replacement: "  if (!isVideoFile(a.filename)) return",
    expected: "Proxy: die vier Endungen, Pixel und Auswahl im Server"
  },
  {
    nr: '1744', name: "Nach Weg A folgt kein Weg B",
    file: 'server.js',
    search: "  for (const way of first === 'A' ? ['A', 'B'] : [first]) {",
    replacement: "  for (const way of [first]) {",
    expected: "Proxy: Fehler, Neustart und fehlende Datei"
  },
  {
    nr: '1745', name: "Der Start versucht einen Fehlschlag nicht neu",
    file: 'server.js',
    search: "    for (const id of [...b.missing, ...(start ? b.failed : []), ...b.stale.filter(z => !PROXY_KEPT.has(z))])",
    replacement: "    for (const id of [...b.missing, ...b.stale.filter(z => !PROXY_KEPT.has(z))])",
    expected: "Proxy: Fehler, Neustart und fehlende Datei"
  },
  {
    nr: '1746', name: "Nach dem Start fehlen Proxys ohne Datei weiter",
    file: 'server.js',
    search: "    .then(r => { PROXY_HW = r; proxyFilesThere(); proxySoon(null, { start: true }); });",
    replacement: "    .then(r => { PROXY_HW = r; proxySoon(null, { start: true }); });",
    expected: "Proxy: Fehler, Neustart und fehlende Datei"
  },
  {
    nr: '1747', name: "Ein verlorener Proxy entsteht nicht neu",
    file: 'server.js',
    search: "  if (d) dropProxy().run(d.id);\n  proxySoon([id], { front: true });",
    replacement: "  if (d) dropProxy().run(d.id);",
    expected: "Proxy: Fehler, Neustart und fehlende Datei"
  },
  {
    nr: '1748', name: "Dateien ohne Zeile bleiben in data/files/proxy/",
    file: 'server.js',
    search: "    sweepUploadDir();\n    sweepProxyDir();",
    replacement: "    sweepUploadDir();",
    expected: "Proxy: Fehler, Neustart und fehlende Datei"
  },
  {
    nr: '1749', name: "Der Abgleich nennt data/files/proxy/",
    file: 'server.js',
    search: "const OWN_DIRS = new Set(['upload', 'proxy']);",
    replacement: "const OWN_DIRS = new Set(['upload']);",
    expected: "Proxy: Fehler, Neustart und fehlende Datei"
  },
  {
    nr: '1750', name: "Die Zeile haengt nicht mehr an disk_files",
    file: 'schema.js',
    search: "  disk_file_id INTEGER PRIMARY KEY REFERENCES disk_files(id) ON DELETE CASCADE,",
    replacement: "  disk_file_id INTEGER PRIMARY KEY REFERENCES disk_files(id),",
    expected: "Proxy: Papierkorb, Backup und Export"
  },
  {
    nr: '1751', name: "Der Trigger meldet den Proxy nicht zum Loeschen",
    file: 'db.js',
    search: "  INSERT OR IGNORE INTO disk_files_gone (name) VALUES ('proxy/' || old.name);",
    replacement: "  SELECT 1;",
    expected: "Proxy: Papierkorb, Backup und Export"
  },
  {
    nr: '1752', name: "Der Lauf loescht keinen Proxy",
    file: 'server.js',
    search: "      : name.startsWith('proxy/') && DISK_NAME.test(name.slice(6)) ? path.join(PROXY_DIR, name.slice(6)) : null;",
    replacement: "      : null;",
    expected: "Proxy: Papierkorb, Backup und Export"
  },
  {
    nr: '1753', name: "Ausschalten haelt ffmpeg nicht an",
    file: 'server.js',
    search: "  PROXY_WAITING.clear();\n  if (proxyStop) proxyStop();",
    replacement: "  PROXY_WAITING.clear();",
    expected: "Proxy: ohne Quick Sync, ohne Firmware und Schalter aus"
  },
  {
    nr: '1754', name: "Ein abgebrochener Lauf gilt als fehlgeschlagen",
    file: 'server.js',
    search: "    if (!proxyOn()) return 'stopped';\n",
    replacement: "",
    expected: "Proxy: ohne Quick Sync, ohne Firmware und Schalter aus"
  },
  {
    nr: '1755', name: "Die laufende Umwandlung zaehlt nicht als wartend",
    file: 'server.js',
    search: "waiting: PROXY_WAITING.size + (proxyRunning ? 1 : 0),",
    replacement: "waiting: PROXY_WAITING.size,",
    expected: "Proxy: ohne Quick Sync, ohne Firmware und Schalter aus"
  },
  {
    nr: '1756', name: "Die Laufzeit ist kuerzer begrenzt",
    file: 'server.js',
    search: "(seconds * 4 + 600) * 1000",
    replacement: "(seconds * 2 + 600) * 1000",
    expected: "Proxy: ohne Quick Sync, ohne Firmware und Schalter aus"
  },
  {
    nr: '1757', name: "Der freie RAM unter /tmp zaehlt nicht",
    file: 'server.js',
    search: "  if (tmp.free != null && need > tmp.free) return failed('tmpSpace');\n",
    replacement: "",
    expected: "Proxy: ohne Quick Sync, ohne Firmware und Schalter aus"
  },
  {
    nr: '1758', name: "Der freie Platz auf der Platte zaehlt nicht",
    file: 'server.js',
    search: "  if (spaceShort(encLen(need))) return failed('space');\n",
    replacement: "",
    expected: "Proxy: ohne Quick Sync, ohne Firmware und Schalter aus"
  },
  {
    nr: '1759', name: "Ohne tmpfs wandelt Kriterion trotzdem um",
    file: 'server.js',
    search: " ||\n  (!PROXY_BENCH && !videoproxy.tmpState().tmpfs);",
    replacement: ";",
    expected: "Proxy: ohne Quick Sync, ohne Firmware und Schalter aus"
  },
  {
    nr: '1760', name: "Beim Beenden laeuft ffmpeg weiter",
    file: 'server.js',
    search: "    if (proxyStop) proxyStop();\n    if (HELD_LOCK) backup.dropLock(HELD_LOCK);\n    try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch {}",
    replacement: "    if (HELD_LOCK) backup.dropLock(HELD_LOCK);\n    try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch {}",
    expected: "Proxy: ohne Quick Sync, ohne Firmware und Schalter aus"
  },
  {
    nr: '1761', name: "Der Player spielt immer das Original",
    file: 'public/app.js',
    search: "  : p.proxy && !original ? proxySource(p) : `/api/attachments/${Number(p.id)}/raw?inline=1`);",
    replacement: "  : p.proxy && !original ? `/api/attachments/${Number(p.id)}/raw?inline=1` : `/api/attachments/${Number(p.id)}/raw?inline=1`);",
    expected: "Proxy: Abspielen und Umschalter"
  },
  {
    nr: '1762', name: "Der Proxy hat keine Adresse je Fassung",
    file: 'public/app.js',
    search: "raw?size=proxy&v=${Number(a.proxy.size)}`;",
    replacement: "raw?size=proxy`;",
    expected: "Proxy: Abspielen und Umschalter"
  },
  {
    nr: '1763', name: "Der Umschalter springt an den Anfang",
    file: 'public/app.js',
    search: "    player.currentTime = at;\n    if (playing) player.play()?.catch?.(() => {});\n    markOriginal();",
    replacement: "    if (playing) player.play()?.catch?.(() => {});\n    markOriginal();",
    expected: "Proxy: Abspielen und Umschalter"
  },
  {
    nr: '1764', name: "Das Original bleibt ueber das Abspielen hinaus",
    file: 'public/app.js',
    search: "    proxyFailed = false;\n    original = false;\n",
    replacement: "    proxyFailed = false;\n",
    expected: "Proxy: Abspielen und Umschalter"
  },
  {
    nr: '1765', name: "Ein kaputter Proxy zeigt die Meldung statt des Originals",
    file: 'public/app.js',
    search: "    if (withProxy && !original) { proxyFailed = true; return switchFile(true); }\n",
    replacement: "",
    expected: "Proxy: Abspielen und Umschalter"
  },
  {
    nr: '1766', name: "Ganz laden misst am Original",
    file: 'public/app.js',
    search: "    const p = photos[i], bytes = playBytes(p, original), source = player.getAttribute('src');",
    replacement: "    const p = photos[i], bytes = p.size, source = player.getAttribute('src');",
    expected: "Proxy: Abspielen und Umschalter"
  },
  {
    nr: '1767', name: "Das Standbild entsteht aus dem Original",
    file: 'public/app.js',
    search: "    source: a.proxy ? proxySource(a) : `/api/attachments/${Number(a.id)}/raw?inline=1` });",
    replacement: "    source: `/api/attachments/${Number(a.id)}/raw?inline=1` });",
    expected: "Proxy: Standbild, die vier Endungen und Erweiterte Infos"
  },
  {
    nr: '1768', name: "mkv und avi heissen nicht Video",
    file: 'public/app.js',
    search: "  mkv: 'video', avi: 'video', wmv: 'video', flv: 'video' };",
    replacement: "  };",
    expected: "Proxy: Standbild, die vier Endungen und Erweiterte Infos"
  },
  {
    nr: '1769', name: "avi ohne Proxy hat keine Infos",
    file: 'public/app.js',
    search: "    if (a.preview === 'image' || kindOf(a) === 'video' || ",
    replacement: "    if (a.preview === 'image' || a.preview === 'video' || ",
    expected: "Proxy: Standbild, die vier Endungen und Erweiterte Infos"
  },
  {
    nr: '1770', name: "Erweiterte Infos ohne Gruppe Proxy",
    file: 'public/app.js',
    search: "    imageGroup(f), shotGroup(shot), proxyGroup(f.proxy)",
    replacement: "    imageGroup(f), shotGroup(shot)",
    expected: "Proxy: Standbild, die vier Endungen und Erweiterte Infos"
  },
  {
    nr: '1771', name: "Die Karte Proxy fehlt",
    file: 'public/app.js',
    search: "  { key: 'proxy',        section: 'installation', visible: () => ADMIN,\n    markup: cardProxy,        wireUp: setUpProxyOut },\n",
    replacement: "",
    expected: "Proxy: die Karte"
  },
  {
    nr: '1772', name: "Den Schalter sieht jeder Admin",
    file: 'public/app.js',
    search: "        ${OWNER ? `<label class=\"ex-files\"><input type=\"checkbox\" id=\"proxy-on\">",
    replacement: "        ${ADMIN ? `<label class=\"ex-files\"><input type=\"checkbox\" id=\"proxy-on\">",
    expected: "Proxy: die Karte"
  },
  {
    nr: '1773', name: "Die Karte nennt keinen Grund",
    file: 'public/app.js',
    search: ": tH(PROXY_REASONS[p.reason] || 'card.proxyCpu')}",
    replacement: ": tH('card.proxyCpu')}",
    expected: "Proxy: die Karte"
  },
  {
    nr: '1774', name: "Im Container startet ffmpeg ohne nice, mit Prioritaet 0",
    file: 'videoproxy.js',
    search: "  return { file: nice, prefix: ['-n', '19', file], ids: { uid: FFMPEG_UID, gid } };",
    replacement: "  return { file, prefix: [], ids: { uid: FFMPEG_UID, gid } };",
    expected: "Proxy: Auswahl, Bitrate und Weg"
  },
  {
    nr: '1775', name: "Orange ist das Feld, das nicht spielt",
    file: 'public/app.js',
    search: "      const on = (b.dataset.source === 'original') === original;",
    replacement: "      const on = (b.dataset.source === 'original') !== original;",
    expected: "Vollbild: „Proxy · Original“ als verbundene Leiste"
  },
  {
    nr: '1776', name: "Die Felder melden nicht, welches gewaehlt ist",
    file: 'public/app.js',
    search: "      b.classList.toggle('on', on);\n      b.setAttribute('aria-pressed', String(on));\n    }",
    replacement: "      b.classList.toggle('on', on);\n    }",
    expected: "Vollbild: „Proxy · Original“ als verbundene Leiste"
  },
  {
    nr: '1777', name: "Das Stilblatt faerbt den Knopf Original wieder orange",
    file: 'public/style.css',
    search: '.lb-btn.whole[aria-pressed="true"], .lb-btn.zoom[aria-pressed="true"] { color: var(--accent); border-color: var(--accent); }',
    replacement: '.lb-btn.whole[aria-pressed="true"], .lb-btn.zoom[aria-pressed="true"], .lb-btn.original[aria-pressed="true"] { color: var(--accent); border-color: var(--accent); }',
    expected: "Proxy: Abspielen und Umschalter"
  },
  {
    nr: '1778', name: "Die Gruppe Proxy nennt keine Bitraten",
    file: 'public/app.js',
    search: ",\n    ['entry.proxyVideoRate', bitRateText(p.videoBitRate)], ['entry.proxyAudioRate', bitRateText(p.audioBitRate)]]);",
    replacement: "]);",
    expected: "Proxy: Standbild, die vier Endungen und Erweiterte Infos"
  },
  {
    nr: '1779', name: "Der Server misst die Bitraten am Proxy nicht",
    file: 'server.js',
    search: "  const rates = await inMediaTurn(() => proxyRates(p));",
    replacement: "  const rates = null;",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1780', name: "Die Bitraten von Video und Audio sind vertauscht",
    file: 'server.js',
    search: "    return { video: m.video[0]?.bitRate ?? null, audio: m.audio[0]?.bitRate ?? null };",
    replacement: "    return { video: m.audio[0]?.bitRate ?? null, audio: m.video[0]?.bitRate ?? null };",
    expected: "Proxy: Umwandlung mit dem Ersatz fuer ffmpeg"
  },
  {
    nr: '1781', name: "Die Bitrate kennt die Pixel des Proxys nicht",
    file: 'videoproxy.js',
    search: "  const pixels = width && height ? width * height : 1920 * 1080;",
    replacement: "  const pixels = 1920 * 1080;",
    expected: "Proxy: Bitrate aus Basis, Bildrate und Pixeln"
  },
  {
    nr: '1782', name: "Die Bitrate kennt die Bildrate nicht",
    file: 'videoproxy.js',
    search: "base * frameRateOf(v) / 30 * pixels / (1920 * 1080)",
    replacement: "base * pixels / (1920 * 1080)",
    expected: "Proxy: Bitrate aus Basis, Bildrate und Pixeln"
  },
  {
    nr: '1783', name: "ffmpeg bekommt immer die Vorgabe",
    file: 'videoproxy.js',
    search: "  const bps = videoBitRate(base, v);",
    replacement: "  const bps = videoBitRate(5e6, v);",
    expected: "Proxy: Bitrate aus Basis, Bildrate und Pixeln"
  },
  {
    nr: '1784', name: "Der Platz im RAM rechnet mit der Vorgabe",
    file: 'videoproxy.js',
    search: "videoBitRate(base, info.video[0]) + AUDIO_BPS",
    replacement: "videoBitRate(5e6, info.video[0]) + AUDIO_BPS",
    expected: "Proxy: Bitrate aus Basis, Bildrate und Pixeln"
  },
  {
    nr: '1785', name: "Die Bitrate setzt auch ein Admin",
    file: 'server.js',
    search: "                                'uploadLimits', 'proxyOn', 'proxyRate'];",
    replacement: "                                'uploadLimits', 'proxyOn'];",
    expected: "Proxy: die Bitrate in den Einstellungen"
  },
  {
    nr: '1786', name: "Zwei Stellen nach dem Komma gelten",
    file: 'server.js',
    search: "  Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;",
    replacement: "  true;",
    expected: "Proxy: die Bitrate in den Einstellungen"
  },
  {
    nr: '1787', name: "Die Bitrate wird nicht gespeichert",
    file: 'server.js',
    search: "      if (rateWanted !== null) putSetting.run('proxyRate', JSON.stringify(rateWanted));\n",
    replacement: "",
    expected: "Proxy: die Bitrate in den Einstellungen"
  },
  {
    nr: '1788', name: "GET /api/settings nennt die Bitrate nicht",
    file: 'server.js',
    search: "  proxyRate: proxyRate(),\n",
    replacement: "",
    expected: "Proxy: die Bitrate in den Einstellungen"
  },
  {
    nr: '1789', name: "Eine neue Bitrate stoesst den Ersatz nicht an",
    file: 'server.js',
    search: "  if (req.body.proxyOn !== undefined || req.body.proxyRate !== undefined) proxySwitched();",
    replacement: "  if (req.body.proxyOn !== undefined) proxySwitched();",
    expected: "Proxy: Ersatz im Hintergrund"
  },
  {
    nr: '1790', name: "Ein fertiger Proxy gilt nie als veraltet",
    file: 'server.js',
    search: "  r.state === 'ready' && r.video_bps !== videoproxy.videoBitRate(base, info.video[0]);",
    replacement: "  false;",
    expected: "Proxy: Ersatz im Hintergrund"
  },
  {
    nr: '1791', name: "Die Bitrate eines Proxys wird nicht gemerkt",
    file: 'server.js',
    search: "        putProxyRate().run(r.disk_id, videoproxy.videoBitRate(base, v));\n",
    replacement: "",
    expected: "Proxy: Ersatz im Hintergrund"
  },
  {
    nr: '1792', name: "Die Karte zaehlt die veralteten nicht",
    file: 'server.js',
    search: "    stale: proxyBacklog().stale.length };",
    replacement: "    stale: 0 };",
    expected: "Proxy: Ersatz im Hintergrund"
  },
  {
    nr: '1793', name: "Der laufende Ersatz kommt beim Abspielen noch einmal in die Warteschlange",
    file: 'server.js',
    search: "  if (PROXY_KEPT.has(id) || proxyNow === id || PROXY_WAITING.values().next().value === id) return;",
    replacement: "  if (PROXY_KEPT.has(id) || PROXY_WAITING.values().next().value === id) return;",
    expected: "Proxy: Ersatz im Hintergrund"
  },
  {
    nr: '1794', name: "Der stuendliche Lauf stellt den laufenden noch einmal an",
    file: 'server.js',
    search: "      if (id !== proxyNow) PROXY_WAITING.add(id);",
    replacement: "      PROXY_WAITING.add(id);",
    expected: "Proxy: Ersatz im Hintergrund"
  },
  {
    nr: '1795', name: "Der ersetzte Proxy wird nicht gehalten",
    file: 'server.js',
    search: "      if (replaced) holdFormer(r.id, old);\n",
    replacement: "",
    expected: "Proxy: Ersatz im Hintergrund"
  },
  {
    nr: '1796', name: "Das alte `v` bekommt den neuen Proxy",
    file: 'server.js',
    search: "  const f = former && former.size !== p.size && Number(req.query.v) === former.size ? former : p;",
    replacement: "  const f = p;",
    expected: "Proxy: Ersatz im Hintergrund"
  },
  {
    nr: '1797', name: "Der Lauf ueber data/files/proxy/ loescht den gehaltenen Proxy",
    file: 'server.js',
    search: "  const known = new Set([...qProxyNames().all(), ...PROXY_FORMER.values()].map(z => z.name));",
    replacement: "  const known = new Set(qProxyNames().all().map(z => z.name));",
    expected: "Proxy: Ersatz im Hintergrund"
  },
  {
    nr: '1798', name: "Das Log nennt den Ersatz nicht",
    file: 'server.js',
    search: "`Proxy for file ${r.id} ${replaced ? 'replaced' : 'made'} in",
    replacement: "`Proxy for file ${r.id} made in",
    expected: "Proxy: Ersatz im Hintergrund"
  },
  {
    nr: '1799', name: "Ein abgespieltes Video kommt nicht nach vorn",
    file: 'server.js',
    search: "  proxyPlayed(id);\n",
    replacement: "",
    expected: "Proxy: abgespielte zuerst, Fehlschlag und Neustart"
  },
  {
    nr: '1800', name: "Ein fehlgeschlagener Ersatz loescht den alten Proxy",
    file: 'server.js',
    search: "  const failed = (reason) => r.state === 'ready' ? proxyKept(r, reason) : proxyFailed(r, reason);",
    replacement: "  const failed = (reason) => proxyFailed(r, reason);",
    expected: "Proxy: abgespielte zuerst, Fehlschlag und Neustart"
  },
  {
    nr: '1801', name: "Nach einem Fehlschlag versucht es das Abspielen wieder",
    file: 'server.js',
    search: "  if (PROXY_KEPT.has(id) || proxyNow === id || PROXY_WAITING.values().next().value === id) return;",
    replacement: "  if (proxyNow === id || PROXY_WAITING.values().next().value === id) return;",
    expected: "Proxy: abgespielte zuerst, Fehlschlag und Neustart"
  },
  {
    nr: '1802', name: "Nach einem Fehlschlag versucht es der stuendliche Lauf wieder",
    file: 'server.js',
    search: "...b.stale.filter(z => !PROXY_KEPT.has(z))])",
    replacement: "...b.stale])",
    expected: "Proxy: abgespielte zuerst, Fehlschlag und Neustart"
  },
  {
    nr: '1803', name: "Eine neue Bitrate versucht einen Fehlschlag nicht wieder",
    file: 'server.js',
    search: "  if (req.body.proxyRate !== undefined) PROXY_KEPT.clear();\n",
    replacement: "",
    expected: "Proxy: abgespielte zuerst, Fehlschlag und Neustart"
  },
  {
    nr: '1804', name: "Ohne gemerkte Bitrate gilt ein Proxy als aktuell",
    file: 'server.js',
    search: "  r.state === 'ready' && r.video_bps !== videoproxy.videoBitRate(base, info.video[0]);",
    replacement: "  r.state === 'ready' && r.video_bps != null && r.video_bps !== videoproxy.videoBitRate(base, info.video[0]);",
    expected: "Proxy: Bestand ohne gemerkte Bitrate"
  },
  {
    nr: '1805', name: "Die gemerkte Bitrate haengt nicht am Proxy",
    file: 'schema.js',
    search: "  disk_file_id INTEGER PRIMARY KEY REFERENCES proxy_files(disk_file_id) ON DELETE CASCADE,\n  video_bps",
    replacement: "  disk_file_id INTEGER PRIMARY KEY,\n  video_bps",
    expected: "Proxy: Bestand ohne gemerkte Bitrate"
  },
  {
    nr: '1806', name: "Die Karte zeigt die veralteten nicht",
    file: 'public/app.js',
    search: "        ${p.stale ? row('card.proxyStale', number(p.stale)) : ''}\n",
    replacement: "",
    expected: "Proxy: Bitrate in der Karte"
  },
  {
    nr: '1807', name: "Das Feld schickt die Bitrate als Text",
    file: 'public/app.js',
    search: "{ proxyRate: Number(rateField.value) }",
    replacement: "{ proxyRate: rateField.value }",
    expected: "Proxy: Bitrate in der Karte"
  },
  {
    nr: '1808', name: "Nach einer Absage bleibt der falsche Wert im Feld",
    file: 'public/app.js',
    search: "    rateField.value = String(Number(SETTINGS.proxyRate) || 5);\n",
    replacement: "",
    expected: "Proxy: Bitrate in der Karte"
  },
  {
    nr: '1809', name: "Ein Admin bekommt das Feld",
    file: 'public/app.js',
    search: "          : `<p class=\"desc\">${tH(on ? 'card.proxyIsOn' : 'card.proxyIsOff')}</p>\n          ${row('card.proxyRate', number(rate, 0, 1))}`}",
    replacement: "          : `<p class=\"desc\">${tH(on ? 'card.proxyIsOn' : 'card.proxyIsOff')}</p>\n          <input id=\"proxy-rate\" type=\"number\" value=\"${rate}\">`}",
    expected: "Proxy: Bitrate in der Karte"
  },
  {
    nr: '1810', name: "Die Liste zeigt „Proxy“ auch ohne Proxy",
    file: 'public/app.js',
    search: "    mark.hidden = !a.proxy;",
    replacement: "    mark.hidden = false;",
    expected: "Proxy in der Liste"
  },
  {
    nr: '1811', name: "Die Liste bekommt keine Spalte fuer den Proxy",
    file: 'public/app.js',
    search: "    attsBox.classList.toggle('aproxy-on', list.some(a => a.proxy));\n",
    replacement: "",
    expected: "Proxy in der Liste"
  },
  {
    nr: '1812', name: "Der Titel nennt die Pixel des Proxys nicht",
    file: 'public/app.js',
    search: "    mark.title = a.proxy ? [t('entry.proxyMark'), a.proxy.width && a.proxy.height ? `${a.proxy.width} × ${a.proxy.height}` : '',",
    replacement: "    mark.title = a.proxy ? [t('entry.proxyMark'), '',",
    expected: "Proxy in der Liste"
  },
  {
    nr: '1813', name: "Die Spalte fuer den Proxy hat keine Breite",
    file: 'public/style.css',
    search: ".alist .aproxy-on .aacts { grid-template-columns: 44px 36px 36px; }",
    replacement: ".alist .aproxy-on .aacts { grid-template-columns: 36px 36px; }",
    expected: "Proxy in der Liste"
  },
  {
    nr: '1814', name: "Das Video behaelt die Groesse aus dem Stilblatt",
    file: 'public/app.js',
    search: "  videoPlayer.addEventListener('loadedmetadata', fitPlayer);\n",
    replacement: "",
    expected: "Vollbild: Groesse des Videos und Knopfleiste"
  },
  {
    nr: '1815', name: "Ein Wechsel der Abmessungen aendert die Groesse nicht",
    file: 'public/app.js',
    search: "  videoPlayer.addEventListener('resize', fitPlayer);\n",
    replacement: "",
    expected: "Vollbild: Groesse des Videos und Knopfleiste"
  },
  {
    nr: '1816', name: "Ein kleines Video wird vergroessert",
    file: 'public/app.js',
    search: "    const scale = Math.min(stage.clientWidth / w, stage.clientHeight / h, 1);",
    replacement: "    const scale = Math.min(stage.clientWidth / w, stage.clientHeight / h);",
    expected: "Vollbild: Groesse des Videos und Knopfleiste"
  },
  {
    nr: '1817', name: "Die Buehne wird nicht beobachtet",
    file: 'public/app.js',
    search: "  stageWatch?.observe(stage);\n",
    replacement: "",
    expected: "Vollbild: Groesse des Videos und Knopfleiste"
  },
  {
    nr: '1818', name: "Schliessen beendet die Beobachtung nicht",
    file: 'public/app.js',
    search: "    stageWatch?.disconnect();\n",
    replacement: "",
    expected: "Vollbild: Groesse des Videos und Knopfleiste"
  },
  {
    nr: '1819', name: "Die Knoepfe oben brechen nicht um",
    file: 'public/style.css',
    search: ".lb-tools { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; order: 1; }",
    replacement: ".lb-tools { display: flex; align-items: center; gap: 8px; flex-shrink: 0; order: 1; }",
    expected: "Vollbild: Groesse des Videos und Knopfleiste"
  },
  {
    nr: '1820', name: "Der Kopf von „Dateien“ bricht nicht um",
    file: 'public/style.css',
    search: ".ahead-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; min-width: 0; }",
    replacement: ".ahead-acts { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }",
    expected: "Vollbild: Groesse des Videos und Knopfleiste"
  },
  {
    nr: '1821', name: "Im Vollbild bleibt das Wurzelelement rollbar",
    file: 'public/style.css',
    search: "html:has(> body.lb-open) { overflow: hidden; overscroll-behavior-x: none; }\n",
    replacement: "",
    expected: "Vollbild: Groesse des Videos und Knopfleiste"
  },
  {
    nr: '1822', name: "Der Streifen rollt mit scrollIntoView() auch die Seite",
    file: 'public/app.js',
    search: "    const on = strip.children[i]?.getBoundingClientRect(), box = strip.getBoundingClientRect();\n    if (on) strip.scrollLeft += on.left + on.width / 2 - (box.left + box.width / 2);",
    replacement: "    strip.children[i]?.scrollIntoView?.({ block: 'nearest', inline: 'center' });",
    expected: "Vollbild: Groesse des Videos und Knopfleiste"
  },

  /* ---- Die roten Pruefungen am Ende des Laufs ---- */
  {
    nr: '1823', name: "Eine rote Pruefung kommt nicht in die Liste",
    file: 'test/frame.js',
    search: "    RED.push({ group: groupName, name });\n",
    replacement: "",
    expected: "Der Gruppenfilter"
  },
  {
    nr: '1824', name: "Der Schlussblock zeigt die Liste nicht",
    file: 'test/frame.js',
    search: "  if (RED.length) {",
    replacement: "  if (RED.length < 0) {",
    expected: "Der Gruppenfilter"
  },
  {
    nr: '1825', name: "Die Liste nennt die Gruppe nicht",
    file: 'test/frame.js',
    search: "timeName = groupName = name;",
    replacement: "timeName = name;",
    expected: "Der Gruppenfilter"
  },
  {
    nr: '1826', name: "Die Meldung eines Moduls traegt keine roten Pruefungen",
    file: 'test/frame.js',
    search: "times: TIMES, red: RED,",
    replacement: "times: TIMES,",
    expected: "Der Gruppenfilter"
  },
  {
    nr: '1827', name: "Der Treiber nimmt die gemeldeten roten Pruefungen nicht auf",
    file: 'test/frame.js',
    search: "  for (const r of z.red || []) RED.push(r);\n",
    replacement: "",
    expected: "Der Gruppenfilter"
  },
  {
    nr: '1828', name: "Ein uebergangener Fehlschlag steht in der Liste",
    file: 'test/frame.js',
    search: "if (silent) { if (condition) stillPassed++; else stillFailed++; return; }",
    replacement: "if (silent) { if (condition) stillPassed++; else { stillFailed++; RED.push({ group: groupName, name }); } return; }",
    expected: "Der Gruppenfilter"
  },
  {
    nr: '1829', name: "Ein Fehler des Treibers fehlt in der Liste",
    file: 'testbench.js',
    search: "times: [], red: [{ group: `Modul ${name}`, name: text }] });",
    replacement: "times: [] });",
    expected: 'Der Treiber sieht den Rueckgabewert — 0.34.4'
  },
  {
    nr: '1830', name: "Jeder Eintrag zaehlt mit dem Potenzial",
    file: 'public/app.js',
    search: "const sharePhase = (i) => (i.tested ? 'after' : 'before');",
    replacement: "const sharePhase = (i) => 'before';",
    expected: "Eigene Werte: eine Gruppe in der Statuszeile"
  },
  {
    nr: '1831', name: "Ein zweiter Klick schaltet nicht aus",
    file: 'public/app.js',
    search: "      b.onclick = () => { f.own = f.own === v ? 'all' : v; redraw(); };",
    replacement: "      b.onclick = () => { f.own = v; redraw(); };",
    expected: "Eigene Werte: eine Gruppe in der Statuszeile"
  },
  {
    nr: '1832', name: "Der Titel der Knoepfe nennt nicht, was zaehlt",
    file: 'public/app.js',
    search: "    const counted = POTENTIAL_MODE ? t('list.ownValuesHint') : t('list.ownRatingHint');",
    replacement: "    const counted = '';",
    expected: "Eigene Werte: eine Gruppe in der Statuszeile"
  },
  {
    nr: '1833', name: "„Eigene Werte“ steht in einer eigenen Zeile",
    file: 'public/app.js',
    search: "    const label = secondLabel(r1, POTENTIAL_MODE ? '◆ ★' : '★');",
    replacement: "    const label = row(POTENTIAL_MODE ? '◆ ★' : '★').firstChild;",
    expected: "Eigene Werte: eine Gruppe in der Statuszeile"
  },
  {
    nr: '1834', name: "Alte Werte bleiben in den Filtern",
    file: 'public/app.js',
    search: "  delete f.potential; delete f.rating;\n",
    replacement: "",
    expected: "Eigene Werte: alte Filter, ohne Potenzialmodus, ohne Kriterien"
  },
  {
    nr: '1835', name: "Ohne Phase zaehlt ein Eintrag als „Keine“",
    file: 'public/app.js',
    search: "  if (own !== 'all') out = out.filter(i => i.share?.[sharePhase(i)] === own);\n",
    replacement: "  if (own !== 'all') out = out.filter(i => (i.share?.[sharePhase(i)] ?? 'none') === own);\n",
    expected: "Eigene Werte: alte Filter, ohne Potenzialmodus, ohne Kriterien"
  },
  {
    nr: '1836', name: "Im Vollbild weicht der Titel wieder zuletzt",
    file: 'public/style.css',
    search: "white-space: nowrap; flex: 1 1 0; min-width: 0; }",
    replacement: "white-space: nowrap; flex-shrink: 100; }",
    expected: "Vollbild: Groesse des Videos und Knopfleiste"
  },
  {
    nr: '1837', name: "Quer bleibt der Streifen",
    file: 'public/style.css',
    search: "  .lb-strip { display: none; }\n",
    replacement: "",
    expected: "Vollbild: Kopfzeile, quer und deckend"
  },
  {
    nr: '1838', name: "Zurueck schliesst das Vollbild nicht",
    file: 'public/app.js',
    search: "  window.addEventListener('popstate', back);\n",
    replacement: "",
    expected: "Vollbild: Zurueck, Fokus und die Seite dahinter"
  },
  {
    nr: '1839', name: "✕ laesst den eigenen Eintrag im Verlauf stehen",
    file: 'public/app.js',
    search: "    if (!historyMoved && history.state?.lightbox === mark) history.back();\n",
    replacement: "",
    expected: "Vollbild: Zurueck, Fokus und die Seite dahinter"
  },
  {
    nr: '1840', name: "Das Vollbild legt keinen Eintrag im Verlauf an",
    file: 'public/app.js',
    search: "  history.pushState({ lightbox: mark }, '');\n",
    replacement: "",
    expected: "Vollbild: Zurueck, Fokus und die Seite dahinter"
  },
  {
    nr: '1841', name: "Wischen auf der Zeitleiste des Videos blaettert",
    file: 'public/app.js',
    search: "    return e.touches[0].clientY < videoPlayer.getBoundingClientRect().bottom - TIMELINE_STRIP;",
    replacement: "    return true;",
    expected: "Vollbild: Wischen auf dem Video, Pfeile nach einem Tipp"
  },
  {
    nr: '1842', name: "Zwei Finger blaettern",
    file: 'public/app.js',
    search: "    if (e.touches.length !== 1 || pinch || !swipeFree(e)) return;",
    replacement: "    if (pinch || !swipeFree(e)) return;",
    expected: "Vollbild: Wischen auf dem Video, Pfeile nach einem Tipp"
  },
  {
    nr: '1843', name: "Gezoomt blaettert ein Wisch auch in der Mitte des Ausschnitts",
    file: 'public/app.js',
    search: "      back: !zoom || stage.scrollLeft <= 1, ahead: !zoom || stage.scrollLeft >= end - 1, target: e.target };",
    replacement: "      back: true, ahead: true, target: e.target };",
    expected: "Vollbild: zwei Finger zoomen das Bild"
  },
  {
    nr: '1844', name: "Ein Tipp neben das Bild schliesst",
    file: 'public/app.js',
    search: " && pointer === 'mouse') close(); });",
    replacement: ") close(); });",
    expected: "Vollbild: Wischen und Tipp neben das Bild"
  },
  {
    nr: '1845', name: "✕ bleibt beim Umbruch nicht oben rechts",
    file: 'public/style.css',
    search: ".lb-top > .close { flex-shrink: 0; align-self: flex-start; order: 2; }\n",
    replacement: "",
    expected: "Vollbild: Kopfzeile, quer und deckend"
  },
  {
    nr: '1846', name: "Die Seite scheint durch das Vollbild",
    file: 'public/style.css',
    search: "  --lb-bg: rgb(var(--scrim-rgb));",
    replacement: "  --lb-bg: rgba(var(--scrim-rgb), .97);",
    expected: "Vollbild: Kopfzeile, quer und deckend"
  },
  {
    nr: '1847', name: "Die Seite dahinter bleibt fuer Tab und Vorleser offen",
    file: 'public/app.js',
    search: "  behind.forEach(el => el.setAttribute('inert', ''));\n",
    replacement: "",
    expected: "Vollbild: Zurueck, Fokus und die Seite dahinter"
  },
  {
    nr: '1848', name: "Das Vollbild bekommt beim Oeffnen keinen Fokus",
    file: 'public/app.js',
    search: "  lb.focus({ preventScroll: true });\n",
    replacement: "",
    expected: "Vollbild: Zurueck, Fokus und die Seite dahinter"
  },
  {
    nr: '1849', name: "Der Fokus kehrt nach dem Schliessen nicht zurueck",
    file: 'public/app.js',
    search: "    if (focusBefore?.isConnected) focusBefore.focus?.({ preventScroll: true });\n",
    replacement: "",
    expected: "Vollbild: Zurueck, Fokus und die Seite dahinter"
  },
  {
    nr: '1850', name: "Bilder und Videos heissen wieder „Erweiterte Infos“",
    file: 'public/languages/de.json',
    search: "  \"entry.mediaInfo\": \"Infos\",",
    replacement: "  \"entry.mediaInfo\": \"Erweiterte Infos\",",
    expected: "Infos: ein Name fuer Bilder, Videos und Dokumente"
  },
  /* ---- Titel in der Mail, ◆ ★, Fehler aus der Durchsicht ---- */
  {
    nr: '1851', name: "Die Einladung bekommt `title` statt `instanceTitle`",
    file: 'server.js',
    search: "    instanceTitle: getSetting('title_public', TITLE_DEFAULT),\n    username: target.username,",
    replacement: "    title: getSetting('title_public', TITLE_DEFAULT),\n    username: target.username,",
    expected: "Mail: der Titel der Installation in Betreff und Text"
  },
  {
    nr: '1852', name: "Die Bestaetigung bekommt `title` statt `instanceTitle`",
    file: 'server.js',
    search: "  const letter = mail.mailConfirm(locale, { instanceTitle, username: name,",
    replacement: "  const letter = mail.mailConfirm(locale, { title: instanceTitle, username: name,",
    expected: "Mail: der Titel der Installation in Betreff und Text"
  },
  {
    nr: '1853', name: "Die Testmail bekommt `title` statt `instanceTitle`",
    file: 'server.js',
    search: "  const letter = mail.mailTest(locale, { instanceTitle: getSetting('title_public', TITLE_DEFAULT),",
    replacement: "  const letter = mail.mailTest(locale, { title: getSetting('title_public', TITLE_DEFAULT),",
    expected: "Mail: der Titel der Installation in Betreff und Text"
  },
  {
    nr: '1854', name: "Das gespeicherte Mailpasswort gilt auch fuer einen anderen Server",
    file: 'mail.js',
    search: "    ? e.password : (sameAccount ? String(old.password || '') : '');",
    replacement: "    ? e.password : String(old.password || '');",
    expected: "Mail: das gespeicherte Passwort und der Grund eines Fehlers"
  },
  {
    nr: '1855', name: "Die Karte ueberschreibt den Grund des Versands beim Freischalten",
    file: 'server.js',
    search: "  res.json({ ...requestCard(localeOf(req), isOwner(req)), ...created, token: token.plain, purpose: token.purpose,\n             days: token.days, minutes: auth.TOKEN_DEADLINE_MINUTES, ...linkInfo(token.plain), ...v });",
    replacement: "  res.json({ ...created, token: token.plain, purpose: token.purpose,\n             days: token.days, minutes: auth.TOKEN_DEADLINE_MINUTES, ...linkInfo(token.plain), ...v, ...requestCard(localeOf(req), isOwner(req)) });",
    expected: "Mail: das gespeicherte Passwort und der Grund eines Fehlers"
  },
  {
    nr: '1856', name: "Parallele Anmeldungen einer Adresse laufen gleichzeitig",
    file: 'server.js',
    search: "app.post('/api/login', async (req, res) => {\n  const ip = auth.clientIp(req);\n  await brakeTurn(res, ip);\n",
    replacement: "app.post('/api/login', async (req, res) => {\n  const ip = auth.clientIp(req);\n",
    expected: "Anmeldebremse: parallele Versuche, Kopf nur aus dem eigenen Netz"
  },
  {
    nr: '1857', name: "X-Forwarded-For gilt von jeder Adresse",
    file: 'auth.js',
    search: "  if (BEHIND_PROXY && PRIVATE_PEER.test(peer.replace(/^::ffff:/i, ''))) {",
    replacement: "  if (BEHIND_PROXY) {",
    expected: "Anmeldebremse: parallele Versuche, Kopf nur aus dem eigenen Netz"
  },
  {
    nr: '1858', name: "Das alte Passwort am eigenen Account ist ungebremst",
    file: 'server.js',
    search: "  await brakeTurn(res, ip);\n  if (!await brakeFree(req, res, ip, req.user.username)) return;\n  const { oldPassword",
    replacement: "  await brakeTurn(res, ip);\n  const { oldPassword",
    expected: "Anmeldebremse: parallele Versuche, Kopf nur aus dem eigenen Netz"
  },
  {
    nr: '1859', name: "Das Passwort fuer den zweiten Faktor ist ungebremst",
    file: 'server.js',
    search: "  await brakeTurn(res, ip);\n  if (!await brakeFree(req, res, ip, req.user.username)) return false;\n  const row",
    replacement: "  await brakeTurn(res, ip);\n  const row",
    expected: "Anmeldebremse: parallele Versuche, Kopf nur aus dem eigenen Netz"
  },
  {
    nr: '1860', name: "Der Link der Registrierung setzt den Zaehler der Adresse zurueck",
    file: 'server.js',
    search: "      t(localeOf(req), 'server.confirmExpired')});\n  }\n  res.json({ ok: true });",
    replacement: "      t(localeOf(req), 'server.confirmExpired')});\n  }\n  auth.noteSuccess(ip, null);\n  res.json({ ok: true });",
    expected: "Anmeldebremse: parallele Versuche, Kopf nur aus dem eigenen Netz"
  },
  {
    nr: '1861', name: "Ein Testtag gilt nur bis zum Datum in UTC",
    file: 'server.js',
    search: "  const latest = new Date(Date.now() + 14 * 3600000).toISOString().slice(0, 10);",
    replacement: "  const latest = new Date(Date.now()).toISOString().slice(0, 10);",
    expected: "Server: Testtag, Vorschaubild, letzter Eigentuemer"
  },
  {
    nr: '1862', name: "Ohne Vorschaubild liest die Route qPhotoBytes.data",
    file: 'server.js',
    search: "    else blob = qPhotoBytes().data.get(req.params.id).bytes;",
    replacement: "    else blob = qPhotoBytes.data.get(req.params.id).bytes;",
    expected: "Server: Testtag, Vorschaubild, letzter Eigentuemer"
  },
  {
    nr: '1863', name: "Die Sperre letzter Eigentuemer zaehlt auch gesperrte",
    file: 'auth.js',
    search: "  if (u.role === 'owner' && u.status === 'active' && role !== 'owner' && ownerCount() <= 1)",
    replacement: "  if (u.role === 'owner' && role !== 'owner' && ownerCount() <= 1)",
    expected: "Server: Testtag, Vorschaubild, letzter Eigentuemer"
  },
  {
    nr: '1864', name: "takeBackupLock() wirft ausserhalb des try",
    file: 'server.js',
    search: "  try { lock = takeBackupLock(folder); } catch (e) { return next(e); }\n",
    replacement: "  lock = takeBackupLock(folder);\n",
    expected: "Server: Lockfile und Backup-Ordner"
  },
  {
    nr: '1865', name: "Der Start laesst das Lockfile eines abgebrochenen Backups stehen",
    file: 'server.js',
    search: "    backup.dropLock(path.join(target.filePath, COPY_DIR, '.lock'));\n",
    replacement: "",
    expected: "Server: Lockfile und Backup-Ordner"
  },
  {
    nr: '1866', name: "SIGTERM laesst das Lockfile stehen",
    file: 'server.js',
    search: "    if (HELD_LOCK) backup.dropLock(HELD_LOCK);\n",
    replacement: "",
    expected: "Server: Lockfile und Backup-Ordner"
  },
  {
    nr: '1867', name: "„Jetzt loeschen“ rechnet mit der gespeicherten Regel",
    file: 'server.js',
    search: "    const b = checkRuleValue(req.body?.keep ?? getSetting('backupKeep', CLEANUP_KEEP.fallback),",
    replacement: "    const b = checkRuleValue(getSetting('backupKeep', CLEANUP_KEEP.fallback),",
    expected: "Server: Lockfile und Backup-Ordner"
  },
  {
    nr: '1868', name: "untilDrained() wartet auch nach dem Schliessen",
    file: 'server.js',
    search: "  if (res.destroyed) return Promise.reject(new Error('the client closed the connection'));\n",
    replacement: "",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1869', name: "Die Kopie faellt auch, wenn das Umbenennen scheitert",
    file: 'server.js',
    search: "    if (fs.existsSync(diskPath(f.name))) fs.rmSync(diskPath(f.name, true), { force: true });",
    replacement: "    fs.rmSync(diskPath(f.name, true), { force: true });",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1870', name: "„Standardanordnung“ setzt wieder `zu`",
    file: 'public/app.js',
    search: "    BLOCKS = { side: [...BLOCK_DEFAULT.side], bottom: [...BLOCK_DEFAULT.bottom], closed: [] };",
    replacement: "    BLOCKS = { side: [...BLOCK_DEFAULT.side], bottom: [...BLOCK_DEFAULT.bottom], zu: [] };",
    expected: "Einstellungen: Schwelle in „Bewertung: Kriterien“, Standardanordnung"
  },
  {
    nr: '1871', name: "Die Rolle Eigentuemer-Admin heisst wieder `eigentuemer`",
    file: 'public/app.js',
    search: "             <option value=\"owner\"${z.role === 'owner' ? ' selected' : ''}>",
    replacement: "             <option value=\"eigentuemer\"${z.role === 'owner' ? ' selected' : ''}>",
    expected: "Mehrbenutzer-Anzeigen in der Oberflaeche"
  },
  {
    nr: '1872', name: "Die Gruppe heisst wieder „Eigene Werte“",
    file: 'public/app.js',
    search: "    const label = secondLabel(r1, POTENTIAL_MODE ? '◆ ★' : '★');",
    replacement: "    const label = secondLabel(r1, 'Eigene Werte');",
    expected: "Uebersicht: ◆ ★ statt „Eigene Werte“, Weiter, Sortierung ohne Potenzialmodus"
  },
  {
    nr: '1873', name: "Der Satz unter der Schwelle fehlt",
    file: 'public/app.js',
    search: "${setting(tH('card.setPartial'), tH('card.partialShareHint'), tH('card.partialShareMore'))}",
    replacement: "${setting(tH('card.setPartial'), tH('card.partialShareHint'))}",
    expected: "Einstellungen: Schwelle in „Bewertung: Kriterien“, Standardanordnung"
  },
  {
    nr: '1874', name: "Die Vorschau der Aufraeumregel baut die Felder neu",
    file: 'public/app.js',
    search: "      drawCleanup(fetched, true);",
    replacement: "      drawCleanup(fetched);",
    expected: "Die Karte „Alte Backups\" in der Oberflaeche"
  },
  {
    nr: '1875', name: "„Jetzt loeschen“ schickt die angezeigten Werte nicht mit",
    file: 'public/app.js',
    search: "      try { r = await api('POST', '/api/backup/cleanup', kind === 'rule' ? { kind, ...values() } : { kind }); }",
    replacement: "      try { r = await api('POST', '/api/backup/cleanup', { kind }); }",
    expected: "Die Karte „Alte Backups\" in der Oberflaeche"
  },
  {
    nr: '1876', name: "Die Detailansicht zeichnet nach einer spaeten Antwort",
    file: 'public/app.js',
    search: "  if (!here()) return;\n  let idx = 0;",
    replacement: "  let idx = 0;",
    expected: "Detailansicht: spaete Antworten, Kommentar, Anlegen, Dialog"
  },
  {
    nr: '1877', name: "Der Betrachter zeichnet in eine fremde Ansicht",
    file: 'public/app.js',
    search: "    if (!v || !here()) return;\n",
    replacement: "    if (!v) return;\n",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1878', name: "„›“ folgt dem Bestand in Serverreihenfolge",
    file: 'public/app.js',
    search: "  const shown = state.items ? visibleItems() : [];",
    replacement: "  const shown = state.items || [];",
    expected: "Uebersicht: ◆ ★ statt „Eigene Werte“, Weiter, Sortierung ohne Potenzialmodus"
  },
  {
    nr: '1879', name: "Ohne Potenzialmodus sortiert die Liste weiter nach Potenzial",
    file: 'public/app.js',
    search: "const sortOf = (sort) => (!POTENTIAL_MODE && /^potential_/.test(sort) ? 'updated_desc' : sort);",
    replacement: "const sortOf = (sort) => sort;",
    expected: "Uebersicht: ◆ ★ statt „Eigene Werte“, Weiter, Sortierung ohne Potenzialmodus"
  },
  {
    nr: '1880', name: "Der Editor geht nach dem Bild nicht wieder auf",
    file: 'public/app.js',
    search: "          again.click();\n",
    replacement: "",
    expected: "Detailansicht: spaete Antworten, Kommentar, Anlegen, Dialog"
  },
  {
    nr: '1881', name: "„Kommentieren“ bleibt waehrend der Anfrage frei",
    file: 'public/app.js',
    search: "    commentButton.disabled = true;\n",
    replacement: "",
    expected: "Detailansicht: spaete Antworten, Kommentar, Anlegen, Dialog"
  },
  {
    nr: '1882', name: "„Anlegen“ bleibt waehrend der Anfrage frei",
    file: 'public/app.js',
    search: "    createButton.disabled = true;\n",
    replacement: "",
    expected: "Detailansicht: spaete Antworten, Kommentar, Anlegen, Dialog"
  },
  {
    nr: '1883', name: "Der Hintergrund schliesst auch nach dem Markieren",
    file: 'public/app.js',
    search: "const fromBackdrop = (e, bd) => e.target === bd && (DOWN_AT === null || DOWN_AT === bd) && !typedIn(bd);",
    replacement: "const fromBackdrop = (e, bd) => e.target === bd && !typedIn(bd);",
    expected: "Detailansicht: spaete Antworten, Kommentar, Anlegen, Dialog"
  },
  {
    nr: '1884', name: "Jeder Ladefehler heisst „unbekannt“",
    file: 'public/app.js',
    search: "const loadFailed = (e) => (e.status === 404 ? tH('server.entryUnknown') : esc(e.message));",
    replacement: "const loadFailed = (e) => tH('server.entryUnknown');",
    expected: "Detailansicht: spaete Antworten, Kommentar, Anlegen, Dialog"
  },
  {
    nr: '1885', name: "Die Anmeldung laesst das Vollbild inert",
    file: 'public/app.js',
    search: "  LIGHTBOX_CLOSE?.(true);\n",
    replacement: "",
    expected: "Vollbild: Anmeldung, ein einzelnes Element; Infos aufklappbar"
  },
  {
    nr: '1886', name: "Die Pfeiltaste haelt bei einem Element das Video an",
    file: 'public/app.js',
    search: "  const step = (d) => { if (photos.length < 2) return; i += d; show(); };",
    replacement: "  const step = (d) => { i += d; show(); };",
    expected: "Vollbild: Anmeldung, ein einzelnes Element; Infos aufklappbar"
  },
  {
    nr: '1887', name: "„Erweiterte Infos“ steht beim Oeffnen offen",
    file: 'public/app.js',
    search: "const moreGroup = (html) => (html ? `<details class=\"minfo-group\">",
    replacement: "const moreGroup = (html) => (html ? `<details class=\"minfo-group\" open>",
    expected: "Vollbild: Anmeldung, ein einzelnes Element; Infos aufklappbar"
  },
  {
    nr: '1888', name: "Wieder „Farbunterabtastung“",
    file: 'public/languages/de.json',
    search: "  \"entry.mediaChroma\": \"Chroma Subsampling\",",
    replacement: "  \"entry.mediaChroma\": \"Farbunterabtastung\",",
    expected: "Vollbild: Anmeldung, ein einzelnes Element; Infos aufklappbar"
  },
  {
    nr: '1889', name: "Die Exportgroesse zaehlt Kommentarvideos nicht",
    file: 'public/app.js',
    search: " + (ex.commentImages || 0) + (ex.commentVideos || 0) : 0);",
    replacement: " + (ex.commentImages || 0) : 0);",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1890', name: "Die Vergleichsleiste bleibt ausserhalb der Uebersicht stehen",
    file: 'public/app.js',
    search: "  if (view !== 'list') document.querySelector('.cmp-bar')?.remove();\n",
    replacement: "",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1891', name: "Abgehakte Aufgaben zaehlen als offen",
    file: 'public/app.js',
    search: "    const stillOpen = visible.filter(z => !z.done).length;",
    replacement: "    const stillOpen = visible.length;",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1892', name: "„Links“ misst beim Aufklappen nicht neu",
    file: 'public/app.js',
    search: "  redrawLinks = limitLinks;\n",
    replacement: "",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1894', name: "Das Ende eines kurzen Laufs bleibt unbemerkt",
    file: 'public/app.js',
    search: "    followBatchRun(fetched.stats);",
    replacement: "    followBatchRun();",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1895', name: "Das Zitiermenue liegt unter der Kopfzeile",
    file: 'public/app.js',
    search: "above < mastheadHeight() + 4",
    replacement: "above < 4",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1896', name: "Die Benutzerzeile bricht nicht um",
    file: 'public/style.css',
    search: "  .mrow.user { flex-wrap: wrap; row-gap: 4px; }\n",
    replacement: "",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1897', name: "„Von vorn“ liegt unter den Werkzeugen",
    file: 'public/style.css',
    search: "  .vspot { top: 62px; }\n",
    replacement: "",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1898', name: "Die Upload-Anzeige liegt am Telefon oben",
    file: 'public/style.css',
    search: "  .upload-bar { top: auto; bottom: calc(16px + env(safe-area-inset-bottom)); }\n",
    replacement: "",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1899', name: "Die Reiter bleiben nach dem Drehen versteckt",
    file: 'public/style.css',
    search: "  .sys-tabs.closed { display: none; }\n",
    replacement: "}\n.sys-tabs.closed { display: none; }\n@media (max-width: 700px), (max-height: 500px) and (max-width: 960px) {\n",
    expected: "Quelltext: kleine Fehler aus der Durchsicht"
  },
  {
    nr: '1900', name: "keytool.sh: ein gescheitertes cp geht durch",
    file: 'keytool.sh',
    search: "    if ! find data -mindepth 1 -maxdepth 1 ! -name files -exec sh -c 'cp -a \"$@\" \"$0\"/' \"$ZIEL\" {} +; then",
    replacement: "    if ! find data -mindepth 1 -maxdepth 1 ! -name files -exec cp -a {} \"$ZIEL\"/ \\;; then",
    expected: "Werkzeuge, Image und Texte aus der Durchsicht"
  },
  {
    nr: '1901', name: "keytool.sh: der neue Schluessel steht in den Argumenten",
    file: 'keytool.sh',
    search: "    ${NEW_KEY:+-e NEW_KEY} \\",
    replacement: "    ${NEW_KEY:+-e \"NEW_KEY=$NEW_KEY\"} \\",
    expected: "Werkzeuge, Image und Texte aus der Durchsicht"
  },
  {
    nr: '1902', name: "keytool.sh: die Logzeile ist wieder deutsch",
    file: 'keytool.sh',
    search: "„Key loaded from ENCRYPTION_KEY.“",
    replacement: "„Schluessel aus ENCRYPTION_KEY geladen.“",
    expected: "Werkzeuge, Image und Texte aus der Durchsicht"
  },
  {
    nr: '1903', name: "backuptool nennt nach einem Abbruch die Nr.",
    file: 'backuptool.js',
    search: "  const again = `Zu Ende führen: ./backuptool.sh restore ${nameTime(chosen.d.name)}`;",
    replacement: "  const again = `Zu Ende führen: ./backuptool.sh restore ${chosen.nr}`;",
    expected: "Werkzeuge, Image und Texte aus der Durchsicht"
  },
  {
    nr: '1904', name: "Das Backup der .env kommt ins Image",
    file: '.dockerignore',
    search: ".env.before-key-change-*\n",
    replacement: "",
    expected: "Werkzeuge, Image und Texte aus der Durchsicht"
  },
  {
    nr: '1905', name: "Der Hinweis zur Suchmaschine nennt wieder „Bestand“",
    file: 'public/languages/de.json',
    search: "Keine Suchmaschine eingestellt — siehe Einstellungen › Installation.",
    replacement: "Keine Suchmaschine eingestellt — siehe Einstellungen › Bestand.",
    expected: "Werkzeuge, Image und Texte aus der Durchsicht"
  },
  {
    nr: '1906', name: "„(du)“ steht wieder fest im Code",
    file: 'public/app.js',
    search: "          self ? ` <span class=\"user-mine\">${tH('card.youMarker')}</span>` : ''}</span>",
    replacement: "          self ? ' <span class=\"user-mine\">(du)</span>' : ''}</span>",
    expected: "Werkzeuge, Image und Texte aus der Durchsicht"
  },
  {
    nr: '1907', name: "Die Meldung zur Regel nennt wieder „Löschen ab Alter“",
    file: 'public/languages/de.json',
    search: "„Löschen, wenn älter als“ muss eine ganze Zahl",
    replacement: "„Löschen ab Alter“ muss eine ganze Zahl",
    expected: "Werkzeuge, Image und Texte aus der Durchsicht"
  },
  {
    nr: '1908', name: "IPv6 zaehlt wieder je Adresse",
    file: 'auth.js',
    search: "const keyIp = (ip) => `ip:${addressBlock(ip)}`;",
    replacement: "const keyIp = (ip) => `ip:${ip}`;",
    expected: "Anmeldebremse: IPv6 je /64"
  },
  {
    nr: '1909', name: "Die Warteschlange der Passwortpruefung zaehlt je Adresse",
    file: 'server.js',
    search: "  const key = auth.addressBlock(ip);\n",
    replacement: "  const key = ip;\n",
    expected: "Anmeldebremse: IPv6 je /64"
  },
  {
    nr: '1910', name: "Die Schreibweise der IPv6-Adresse aendert den Zaehler",
    file: 'auth.js',
    search: "  return `${groups.slice(0, 4).map(g => parseInt(g, 16).toString(16)).join(':')}::/64`;",
    replacement: "  return `${groups.slice(0, 4).join(':')}::/64`;",
    expected: "Anmeldebremse: IPv6 je /64"
  },
  {
    nr: '1911', name: "Der Klick zoomt wieder auf die Mitte",
    file: 'public/app.js',
    search: "      if (zoom || wanted) zoomOff(); else zoomIn('actual', pointAt(e.clientX, e.clientY));",
    replacement: "      if (zoom || wanted) zoomOff(); else zoomIn('actual', null);",
    expected: "Vollbild: 100 % an der angetippten Stelle"
  },
  {
    nr: '1912', name: "Der Doppeltipp zoomt wieder auf die Mitte",
    file: 'public/app.js',
    search: "    if (zoom || wanted) zoomOff(); else zoomIn('tap', pointAt(e.clientX, e.clientY));",
    replacement: "    if (zoom || wanted) zoomOff(); else zoomIn('tap', null);",
    expected: "Vollbild: 100 % an der angetippten Stelle"
  },
  {
    nr: '1913', name: "Nach dem Laden rueckt der Punkt waagrecht weg",
    file: 'public/app.js',
    search: "    stage.scrollLeft += box.left + at.fx * box.width - at.x;\n",
    replacement: "",
    expected: "Vollbild: 100 % an der angetippten Stelle"
  },
  {
    nr: '1914', name: "Der Knopf heisst wieder ⊕",
    file: 'public/app.js',
    search: "aria-pressed=\"false\">${tH('list.zoomActual')}</button>",
    replacement: "aria-pressed=\"false\">⊕</button>",
    expected: "Vollbild: 100 % an der angetippten Stelle"
  },
  {
    nr: '1915', name: "Der Knopf zeigt nicht, dass gezoomt ist",
    file: 'public/app.js',
    search: "    lb.querySelector('.zoom').setAttribute('aria-pressed', 'true');\n",
    replacement: "",
    expected: "Vollbild: 100 % an der angetippten Stelle"
  },
  {
    nr: '1916', name: "Der Hinweis am Bild nennt wieder die Originalgroesse",
    file: 'public/languages/de.json',
    search: "\"list.clickZoomHint\": \"Ein Klick zeigt diese Stelle in 100 %\"",
    replacement: "\"list.clickZoomHint\": \"Klick zoomt auf Originalgröße\"",
    expected: "Vollbild: 100 % an der angetippten Stelle"
  },
  {
    nr: '1917', name: "Blaettern laesst den Knopf gedrueckt",
    file: 'public/app.js',
    search: "    lb.querySelector('.zoom').setAttribute('aria-pressed', 'false');\n",
    replacement: "",
    expected: "Vollbild: 100 % an der angetippten Stelle"
  },
  {
    nr: '1918', name: "Der Knopf zentriert nicht mehr",
    file: 'public/app.js',
    search: "    if (!at) { centerStage(stage); return; }",
    replacement: "    if (!at) return;",
    expected: "Vollbild: 100 % an der angetippten Stelle"
  },
  {
    nr: '1919', name: "Bei Dateien fehlt der Dateiname",
    file: 'public/app.js',
    search: "    lb.querySelector('.lb-name').textContent = p.filename || '';\n",
    replacement: "",
    expected: "Vollbild: Kopfzeile am Telefon und der Dateiname"
  },
  {
    nr: '1920', name: "Hochkant teilen sich Titel und Knoepfe wieder eine Zeile",
    file: 'public/style.css',
    search: "  .lb-tools { order: 3; flex: 1 1 100%; flex-wrap: nowrap;",
    replacement: "  .lb-tools { flex-wrap: nowrap;",
    expected: "Vollbild: Kopfzeile am Telefon und der Dateiname"
  },
  {
    nr: '1921', name: "Der Titel des Eintrags steht neben dem Dateinamen gleich gross",
    file: 'public/style.css',
    search: ".lb-name:not(:empty) + .lb-of { margin-left: 8px; font-size: .8rem; font-weight: 400; color: var(--muted); }\n",
    replacement: "",
    expected: "Vollbild: Kopfzeile am Telefon und der Dateiname"
  },
  {
    nr: '1922', name: "Die Pfeile liegen waehrend der Wiedergabe ueber dem Video",
    file: 'public/style.css',
    search: "  .lightbox.lb-playing .lb-nav, .lightbox.lb-idle .lb-nav { visibility: hidden; }\n",
    replacement: "  .lightbox.lb-idle .lb-nav { visibility: hidden; }\n",
    expected: "Vollbild: Pfeile waehrend der Wiedergabe, Raender, Rollbalken, Streifen"
  },
  {
    nr: '1923', name: "Pause und Ende nehmen `lb-playing` nicht weg",
    file: 'public/app.js',
    search: "  ['play', 'pause', 'ended', 'emptied'].forEach(type => videoPlayer.addEventListener(type, markPlaying));",
    replacement: "  ['play'].forEach(type => videoPlayer.addEventListener(type, markPlaying));",
    expected: "Vollbild: Pfeile waehrend der Wiedergabe, Raender, Rollbalken, Streifen"
  },
  {
    nr: '1924', name: "Die Ecke der Rollbalken ist wieder weiss",
    file: 'public/style.css',
    search: "::-webkit-scrollbar-corner { background: transparent; }\n",
    replacement: "",
    expected: "Vollbild: Pfeile waehrend der Wiedergabe, Raender, Rollbalken, Streifen"
  },
  {
    nr: '1925', name: "Am Telefon hat die gezoomte Buehne Rollbalken",
    file: 'public/style.css',
    search: "  .lb-stage { scrollbar-width: none; }\n",
    replacement: "",
    expected: "Vollbild: Pfeile waehrend der Wiedergabe, Raender, Rollbalken, Streifen"
  },
  {
    nr: '1926', name: "Der linke Pfeil liegt unter der Notch",
    file: 'public/style.css',
    search: ".lb-nav.prev { left: calc(16px + env(safe-area-inset-left)); }",
    replacement: ".lb-nav.prev { left: 16px; }",
    expected: "Vollbild: Pfeile waehrend der Wiedergabe, Raender, Rollbalken, Streifen"
  },
  {
    nr: '1927', name: "Ohne Streifen reicht die Buehne in die Gestenleiste",
    file: 'public/style.css',
    search: ".lightbox { padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }\n",
    replacement: "",
    expected: "Vollbild: Pfeile waehrend der Wiedergabe, Raender, Rollbalken, Streifen"
  },
  {
    nr: '1928', name: "Kacheln ohne Standbild sind wieder abgedunkelt",
    file: 'public/style.css',
    search: "justify-content: center; background: var(--surface-2); opacity: 1; }",
    replacement: "justify-content: center; background: var(--surface-2); }",
    expected: "Vollbild: Pfeile waehrend der Wiedergabe, Raender, Rollbalken, Streifen"
  },
  {
    nr: '1929', name: "Die Endung im Streifen steht wieder in --muted",
    file: 'public/style.css',
    search: "letter-spacing: .05em; color: var(--text-2); }",
    replacement: "letter-spacing: .05em; color: var(--muted); }",
    expected: "Vollbild: Pfeile waehrend der Wiedergabe, Raender, Rollbalken, Streifen"
  },
  {
    nr: '1930', name: "„Ganz laden“ waechst mit jeder Ziffer",
    file: 'public/app.js',
    search: "    if (width > 0) wholeButton.style.width = `${width}px`;\n",
    replacement: "",
    expected: "Vollbild: Pfeile waehrend der Wiedergabe, Raender, Rollbalken, Streifen"
  },
  {
    nr: '1931', name: "Der Knopf zeigt beim Laden keinen Fortschritt",
    file: 'public/app.js',
    search: "      if (loading) wholeButton.textContent = t('entry.loadWholeShare', { n: loading.percent });",
    replacement: "      if (loading) wholeButton.textContent = t('dialog.cancel');",
    expected: "Video ganz laden"
  },
  {
    nr: '1932', name: "Ein zweiter Finger blaettert in der Vorschau weiter",
    file: 'public/app.js',
    search: "    swipes = !cropMode && e.touches.length === 1 && item.photos.length > 1",
    replacement: "    if (e.touches.length !== 1) return;\n    swipes = !cropMode && item.photos.length > 1",
    expected: "Vorschau im Eintrag: Wischen mit einem Finger"
  },
  {
    nr: '1933', name: "Eine gezoomte Seite blaettert in der Vorschau",
    file: 'public/app.js',
    search: "&&\n      !(window.visualViewport?.scale > 1);\n    if (swipes)",
    replacement: "&&\n      true;\n    if (swipes)",
    expected: "Vorschau im Eintrag: Wischen mit einem Finger"
  },
  {
    nr: '1934', name: "Der Fokusrahmen ist wieder --accent",
    file: 'public/style.css',
    search: ":focus-visible { outline: 2px solid var(--accent-edge); outline-offset: 2px; border-radius: 4px; }",
    replacement: ":focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1935', name: "Der Feldfokus nimmt wieder --accent",
    file: 'public/style.css',
    search: ".input:focus { outline: none; border-color: var(--accent-edge);",
    replacement: ".input:focus { outline: none; border-color: var(--accent);",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1936', name: "Der Rand des Textfelds ist wieder --line",
    file: 'public/style.css',
    search: "  background: var(--bg); border: 1px solid var(--input-edge); border-radius: var(--r-sm);",
    replacement: "  background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-sm);",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1937', name: "Der helle Rand der Felder liegt unter 3 : 1",
    file: 'public/style.css',
    search: "  --input-edge: #8a939d;\n",
    replacement: "  --input-edge: #aab4bf;\n",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1938', name: "Die Pfeile im Bild sind im hellen Schema wieder dunkel",
    file: 'public/style.css',
    search: "color: var(--on-photo-strong); font-size: 1.27rem;",
    replacement: "color: var(--text); font-size: 1.27rem;",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1939', name: "▶ auf Karten steht wieder in --text-2",
    file: 'public/style.css',
    search: "font-size: .72rem; line-height: 1; color: var(--on-photo);",
    replacement: "font-size: .72rem; line-height: 1; color: var(--text-2);",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1940', name: "Der Favoritenstern ist im hellen Schema wieder dunkelgold",
    file: 'public/style.css',
    search: "font-size: 1.05rem; line-height: 1; color: var(--badge-gold);",
    replacement: "font-size: 1.05rem; line-height: 1; color: var(--gold);",
    expected: "Favoriten: Sortierung und Filter"
  },
  {
    nr: '1941', name: "Die Pfeile im Bild erscheinen nicht mit dem Tastaturfokus",
    file: 'public/style.css',
    search: ".viewer:hover .vnav, .vnav:focus-visible { opacity: 1; }",
    replacement: ".viewer:hover .vnav { opacity: 1; }",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1942', name: "Die Werkzeuge im Bild erscheinen nicht mit dem Tastaturfokus",
    file: 'public/style.css',
    search: ".viewer:hover .vtools, .vtools:has(:focus-visible) { opacity: 1; }",
    replacement: ".viewer:hover .vtools { opacity: 1; }",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1943', name: "Die Zeilenaktion erscheint nicht mit dem Tastaturfokus",
    file: 'public/style.css',
    search: ".mrow:hover .mact:where(:not(:disabled)), .mrow .mact:focus-visible { opacity: 1; }",
    replacement: ".mrow:hover .mact:where(:not(:disabled)) { opacity: 1; }",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1944', name: "Im Dateimenue hat der Fokus keinen Rahmen",
    file: 'public/style.css',
    search: ".fmenu-item:focus-visible { background: var(--surface-3); outline: 2px solid var(--accent-edge); outline-offset: -2px; }",
    replacement: ".fmenu-item:focus-visible { background: var(--surface-3); outline: none; }",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1945', name: "Ohne Zeiger springt der Pfeil im Bild auf .82",
    file: 'public/style.css',
    search: "    background: rgba(var(--tool-rgb), .86); border-color",
    replacement: "    background: rgba(var(--tool-rgb), .82); border-color",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1946', name: "Ohne Zeiger springt der Pfeil im Vollbild auf .86",
    file: 'public/style.css',
    search: "    background: rgba(var(--lb-surface-rgb), .9); border-color",
    replacement: "    background: rgba(var(--lb-surface-rgb), .86); border-color",
    expected: "Kontraste: Fokus, Eingabefelder, Zeichen auf Fotos, Tastatur"
  },
  {
    nr: '1947', name: "Das dritte Feld 👍 fehlt",
    file: 'public/app.js',
    search: "`],\n     ['full', '', `${t('list.shareFullHint', { share: PARTIAL_SHARE })}\\n${counted}`]].forEach",
    replacement: "`]].forEach",
    expected: "Uebersicht: Keine · Teilweise · 👍 als Leiste"
  },
  {
    nr: '1948', name: "Ein gespeicherter Filter 👍 gilt beim Laden als „Alle“",
    file: 'public/app.js',
    search: "const SHARE_VALUES = ['all', 'none', 'partial', 'full'];",
    replacement: "const SHARE_VALUES = ['all', 'none', 'partial'];",
    expected: "Uebersicht: Keine · Teilweise · 👍 als Leiste"
  },
  {
    nr: '1949', name: "Der Titel von 👍 nennt die Schwelle nicht",
    file: 'public/app.js',
    search: "['full', '', `${t('list.shareFullHint', { share: PARTIAL_SHARE })}",
    replacement: "['full', '', `${t('list.shareFullHint')}",
    expected: "Uebersicht: Keine · Teilweise · 👍 als Leiste"
  },
  {
    nr: '1950', name: "Die Leiste hat wieder Abstaende zwischen den Feldern",
    file: 'public/app.js',
    search: "g.className = 'pills seg'; g.id = 'f-own';",
    replacement: "g.className = 'pills'; g.id = 'f-own';",
    expected: "Uebersicht: Keine · Teilweise · 👍 als Leiste"
  },
  {
    nr: '1951', name: "Die Raender benachbarter Felder liegen doppelt",
    file: 'public/style.css',
    search: ".pills.seg .pill { border-radius: 0; margin-left: -1px; white-space: nowrap; flex-shrink: 0; }",
    replacement: ".pills.seg .pill { border-radius: 0; white-space: nowrap; flex-shrink: 0; }",
    expected: "Uebersicht: Keine · Teilweise · 👍 als Leiste"
  },
  {
    nr: '1952', name: "Der Titel von 👍 sagt „mehr als“ statt „mindestens“",
    file: 'public/languages/de.json',
    search: "\"list.shareFullHint\": \"Mindestens {share} % der Kriterien mit eigenen Sternen\"",
    replacement: "\"list.shareFullHint\": \"Mehr als {share} % der Kriterien mit eigenen Sternen\"",
    expected: "Uebersicht: Keine · Teilweise · 👍 als Leiste"
  },
  {
    nr: '1953', name: "Der Import prueft den Platz fuer den Inhalt nicht",
    file: 'server.js',
    search: "    const short = spaceShort(encLen(unpacked) + unpacked);\n",
    replacement: "    const short = null;\n",
    expected: "Import: Platz fuer den Inhalt, die Datei wird geschlossen"
  },
  {
    nr: '1954', name: "Eine zu alte Importdatei bleibt offen",
    file: 'server.js',
    search: "    file?.close();\n    try { fs.rmSync(req.file.path",
    replacement: "    try { fs.rmSync(req.file.path",
    expected: "Import: Platz fuer den Inhalt, die Datei wird geschlossen"
  },
  {
    nr: '1955', name: "Die Transaktionen beginnen wieder mit BEGIN",
    file: 'db.js',
    search: "  db.transaction = (fn) => transaction(fn).immediate;",
    replacement: "  db.transaction = (fn) => transaction(fn);",
    expected: "Umlagerung: eine zweite Verbindung haelt die Schreibsperre"
  },
  {
    nr: '1956', name: "Eine gescheiterte Datei wartet auf den stuendlichen Lauf",
    file: 'server.js',
    search: "      failed ? RELOCATE_AGAIN_MS : 0).unref();",
    replacement: "      failed ? HOUR_MS : 0).unref();",
    expected: "Umlagerung: eine zweite Verbindung haelt die Schreibsperre"
  },
  {
    nr: '1957', name: "Ein Fehler beendet die ganze Umlagerung",
    file: 'server.js',
    search: "      try { await relocateOne(id, true); }\n      catch (e) { failed++; logFail(`Relocation of file ${id}: ${e.code || e.message}`); }",
    replacement: "      await relocateOne(id, true);",
    expected: "Umlagerung: eine zweite Verbindung haelt die Schreibsperre"
  },
  {
    nr: '1958', name: "Gepackte Objektstroeme werden nicht gelesen",
    file: 'attachments.js',
    search: "  const packed = encrypted ? new Map() : pdfObjectStreams(text);",
    replacement: "  const packed = new Map();",
    expected: "Infos: PDF mit gepacktem Objektstrom, Office als ZIP64"
  },
  {
    nr: '1959', name: "Verschluesselte PDFs liefern Seiten aus dem Strom",
    file: 'attachments.js',
    search: "  const packed = encrypted ? new Map() : pdfObjectStreams(text);",
    replacement: "  const packed = pdfObjectStreams(text);",
    expected: "Infos: PDF mit gepacktem Objektstrom, Office als ZIP64"
  },
  {
    nr: '1960', name: "Die Seitenzahl aus dem Objektstrom fehlt",
    file: 'attachments.js',
    search: "  const counts = [...text.split('endobj'), ...packed.values()].filter",
    replacement: "  const counts = text.split('endobj').filter",
    expected: "Infos: PDF mit gepacktem Objektstrom, Office als ZIP64"
  },
  {
    nr: '1961', name: "Eine indirekte Laenge zerschneidet den Strom",
    file: 'attachments.js',
    search: "/\\/Length\\s+(\\d+)\\b(?!\\s+\\d+\\s+R)/",
    replacement: "/\\/Length\\s+(\\d+)(?!\\s+\\d+\\s+R)/",
    expected: "Infos: PDF mit gepacktem Objektstrom, Office als ZIP64"
  },
  {
    nr: '1962', name: "ZIP64: der Locator wird nicht erkannt",
    file: 'attachments.js',
    search: "tail.readUInt32LE(end - 20) === 0x07064b50",
    replacement: "tail.readUInt32LE(end - 20) === 0x06064b50",
    expected: "Infos: PDF mit gepacktem Objektstrom, Office als ZIP64"
  },
  {
    nr: '1963', name: "ZIP64: das Extrafeld wird uebersprungen",
    file: 'attachments.js',
    search: "    if (extra.readUInt16LE(e) !== 0x0001) continue;",
    replacement: "    if (extra.readUInt16LE(e) !== 0x0009) continue;",
    expected: "Infos: PDF mit gepacktem Objektstrom, Office als ZIP64"
  },
  {
    nr: '1964', name: "Ohne Recht steht der Titel als Feld",
    file: 'public/app.js',
    search: "            ${mayEdit() ? `<textarea class=\"title-in\"",
    replacement: "            ${true ? `<textarea class=\"title-in\"",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1965', name: "Ohne Recht stehen die Schalter da",
    file: 'public/app.js',
    search: "            ${mayEdit() ? `<button class=\"switch\" id=\"sw-test\">",
    replacement: "            ${true ? `<button class=\"switch\" id=\"sw-test\">",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1966', name: "Ohne Recht steht die Kategorie als Auswahl",
    file: 'public/app.js',
    search: "            ${mayEdit() ? '<select class=\"select\" id=\"cat\"",
    replacement: "            ${true ? '<select class=\"select\" id=\"cat\"",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1967', name: "Ohne Recht steht die Ablage fuer Fotos da",
    file: 'public/app.js',
    search: "        ${mayEdit() ? `<label class=\"drop\" id=\"drop\">",
    replacement: "        ${true ? `<label class=\"drop\" id=\"drop\">",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1968', name: "Ohne Recht gibt es den Ausschnitt im Bild",
    file: 'public/app.js',
    search: "        ${mayEdit() && !showsAudio ? `<button class=\"vfocus",
    replacement: "        ${!showsAudio ? `<button class=\"vfocus",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1969', name: "Ohne Recht hat das Vollbild einen Papierkorb",
    file: 'public/app.js',
    search: "  const photoRemove = () => (mayEdit() ? deletePhoto : null);",
    replacement: "  const photoRemove = () => deletePhoto;",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1970', name: "Ohne Recht steht das × an den Miniaturen",
    file: 'public/app.js',
    search: "        (mayEdit() ? `<span class=\"del\"",
    replacement: "        (true ? `<span class=\"del\"",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1971', name: "Ohne Recht ziehen die Links",
    file: 'public/app.js',
    search: "${mayEdit() ? `<span class=\"grip\"",
    replacement: "${true ? `<span class=\"grip\"",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1972', name: "Ohne Recht steht die Tag-Wolke da",
    file: 'public/app.js',
    search: "          ${mayEdit() ? `<div class=\"cloud-head\">",
    replacement: "          ${true ? `<div class=\"cloud-head\">",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1973', name: "Ohne Recht steht der Stift an der Beschreibung",
    file: 'public/app.js',
    search: "        ${mayEdit() ? `<button class=\"mact ed\" id=\"descedit\"",
    replacement: "        ${true ? `<button class=\"mact ed\" id=\"descedit\"",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1974', name: "Ein Klick auf die Beschreibung oeffnet ohne Recht das Feld",
    file: 'public/app.js',
    search: "    if (!mayEdit() || e.target.closest('.markup-viewer, a')) return;",
    replacement: "    if (e.target.closest('.markup-viewer, a')) return;",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1975', name: "Fremde Testtage: die Note ist anklickbar",
    file: 'public/app.js',
    search: "      const s = stars(d.rating, d.mine !== true ? null : v => enqueue(async () => {",
    replacement: "      const s = stars(d.rating, v => enqueue(async () => {",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1976', name: "Fremde Testtage: das × steht da",
    file: 'public/app.js',
    search: "      x.hidden = !(d.mine === true || ADMIN);\n",
    replacement: "",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1977', name: "Fremde Testtage: Tags lassen sich setzen",
    file: 'public/app.js',
    search: "      plus.hidden = d.mine !== true;\n",
    replacement: "",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1978', name: "Ungetestet: der Hinweis zum Einschalten erscheint fuer jeden",
    file: 'public/app.js',
    search: "${mayEdit() ? tH('entry.testedFirstHint') : tH('entry.none')}",
    replacement: "${tH('entry.testedFirstHint')}",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1979', name: "stars() ohne Auswahl reagiert auf die Maus",
    file: 'public/app.js',
    search: "  if (!onPick) { w.classList.add('read'); return w; }\n",
    replacement: "",
    expected: "Detailansicht ohne Recht: nur ansehen"
  },
  {
    nr: '1980', name: "Nach einer Absage bleibt der abgelehnte Titel stehen",
    file: 'public/app.js',
    search: "      catch (e) { toast(e.message, true); titleEl.value = item.title; titleFit(); }",
    replacement: "      catch (e) { toast(e.message, true); }",
    expected: "Detailansicht: nach einer Absage gilt der gespeicherte Stand"
  },
  {
    nr: '1981', name: "Nach einer Absage bleibt die gewaehlte Kategorie stehen",
    file: 'public/app.js',
    search: "      catch (e) { toast(e.message, true); drawCat(); }",
    replacement: "      catch (e) { toast(e.message, true); }",
    expected: "Detailansicht: nach einer Absage gilt der gespeicherte Stand"
  },
  {
    nr: '1982', name: "Der Worker nummeriert die Kriterien beim Laden wieder",
    file: 'db.js',
    search: "  renumberCriteria();\n}\n",
    replacement: "}\nrenumberCriteria();\n",
    expected: "Worker: ohne die Startschritte von db.js"
  },
  {
    nr: '1983', name: "Der Worker raeumt die Adressen geloeschter Zugaenge beim Laden wieder auf",
    file: 'db.js',
    search: "if (isMainThread) {\n  // Geloeschte Zugaenge",
    replacement: "{\n  // Geloeschte Zugaenge",
    expected: "Worker: ohne die Startschritte von db.js"
  },
  {
    nr: '1984', name: "Der Start gibt Links ohne Verfasser wieder dem Eigentuemer",
    file: 'db.js',
    search: "    'privileged account is the owner now (role=owner).');\n}",
    replacement: "    'privileged account is the owner now (role=owner).');\n  db.prepare(\"UPDATE links SET user_id = (SELECT MIN(id) FROM users WHERE role = 'owner') WHERE user_id IS NULL\").run();\n}",
    expected: "Verfasser: ohne Verfasser bleibt ohne Verfasser"
  },
  {
    nr: '1985', name: "Ein leerer Titel geht ueber die Schnittstelle wieder durch",
    file: 'server.js',
    search: "  if (b.title !== undefined && !(typeof b.title === 'string' && b.title.trim()))\n    return res.status(400).json({ error: t(localeOf(req), 'server.titleMissing')});\n",
    replacement: "",
    expected: "Eintrag: leerer Titel und „Getestet“ ueber die Schnittstelle"
  },
  {
    nr: '1986', name: "„Getestet“ faellt mit 0 und null wieder trotz Testtag",
    file: 'server.js',
    search: "  if (b.tested !== undefined && !b.tested) {",
    replacement: "  if (b.tested === false) {",
    expected: "Eintrag: leerer Titel und „Getestet“ ueber die Schnittstelle"
  },
  {
    nr: '1987', name: "Die Suche nach Kategorie kennt wieder nur den Grundnamen",
    file: 'server.js',
    search: "    value: `CASE WHEN instr(kkl(c.name), :q) > 0 THEN c.name\n             ELSE (SELECT n.name FROM category_names n",
    replacement: "    value: `CASE WHEN instr(kkl(c.name), :q) > 0 THEN c.name\n             WHEN 0 THEN (SELECT n.name FROM category_names n",
    expected: "Suche: Kategorie in jeder Sprache"
  },
  {
    nr: '1988', name: "Die Markierung zaehlt ein gefaltetes Zeichen wieder nur einmal",
    file: 'public/app.js',
    search: "    for (let k = 0; k < piece.length; k++) { starts.push(raw); ends.push(raw + c.length); }",
    replacement: "    starts.push(raw); ends.push(raw + c.length);",
    expected: "Suche: Markierung wie die Suche im Server"
  },
  {
    nr: '1989', name: "Die Markierung kennt das punktlose ı nicht mehr",
    file: 'public/app.js',
    search: "const searchFold = (s) => String(s).toLowerCase().replace(/\\u0307/g, '').replace(/\\u0131/g, 'i')\n  .replace(/\\u00df/g, 'ss');",
    replacement: "const searchFold = (s) => String(s).toLowerCase().replace(/\\u0307/g, '')\n  .replace(/\\u00df/g, 'ss');",
    expected: "Suche: Markierung wie die Suche im Server"
  },
  {
    nr: '1990', name: "Der Papierkorb merkt sich wieder nur den eigenen Favoriten",
    file: 'server.js',
    search: "withPhotos: true, withFiles: true, withVideos: true, everyPin: true, withIds: true, funnel: funnelStore(sources)",
    replacement: "withPhotos: true, withFiles: true, withVideos: true, withIds: true, funnel: funnelStore(sources)",
    expected: "Papierkorb: Favoriten gehen an ihre Besitzer zurueck"
  },
  {
    nr: '1991', name: "Ein Import vergibt fremde Favoriten",
    file: 'server.js',
    search: "      if (trashId != null && Array.isArray(it.favorites)) {",
    replacement: "      if (Array.isArray(it.favorites)) {",
    expected: "Papierkorb: Favoriten gehen an ihre Besitzer zurueck"
  },
  {
    nr: '1992', name: "Ein geloeschter Account bekommt seinen Favoriten zurueck",
    file: 'server.js',
    search: "const iPinOwner = db.prepare(\"SELECT id FROM users WHERE username = ? AND status != 'deleted'\");",
    replacement: "const iPinOwner = db.prepare(\"SELECT id FROM users WHERE username = ?\");",
    expected: "Papierkorb: Favoriten gehen an ihre Besitzer zurueck"
  },
  {
    nr: '1993', name: "Auch ein kleines Bild bekommt eine Fassung mit 1.600 px",
    file: 'server.js',
    search: "  if (Math.max(size.width, size.height) <= VARIANTS.medium.long) return null;\n",
    replacement: "",
    expected: "Vollbild: Bilddateien mit 1.600 px"
  },
  {
    nr: '1994', name: "Ein animiertes Bild steht im Vollbild still",
    file: 'server.js',
    search: "  if (!size.width || !size.height || (size.pages || 1) > 1) return null;",
    replacement: "  if (!size.width || !size.height) return null;",
    expected: "Vollbild: Bilddateien mit 1.600 px"
  },
  {
    nr: '1995', name: "Das Vollbild laedt bei Bilddateien wieder das Original",
    file: 'public/app.js',
    search: "    return filesize ? `/api/attachments/${p.id}/raw?size=medium` : `/api/attachments/${p.id}/raw`;",
    replacement: "    return filesize ? `/api/attachments/${p.id}/raw?inline=1` : `/api/attachments/${p.id}/raw`;",
    expected: "Vollbild: Bilddateien mit 1.600 px"
  },
  {
    nr: '1996', name: "Ohne Fassung kommt das Original als Download",
    file: 'server.js',
    search: "const shownInline = (req) => req.query.inline === '1' || req.query.size === 'medium';",
    replacement: "const shownInline = (req) => req.query.inline === '1';",
    expected: "Vollbild: Bilddateien mit 1.600 px"
  },
  {
    nr: '1997', name: "Hinweistext faellt im dunklen Schema auf --surface-2 unter 4,5 : 1",
    file: 'public/style.css',
    search: "  --faint: #808992;",
    replacement: "  --faint: #7b848d;",
    expected: "Einstellungen: je Einstellung ein Satz, der Rest unter „Mehr“"
  },
  {
    nr: '1998', name: "Kurze Reste stehen nie direkt",
    file: 'public/app.js',
    search: "    const short = lines > 0 && lines < MORE_LINES;",
    replacement: "    const short = false;",
    expected: "„Mehr“: ab drei Zeilen hinter dem Knopf, darunter direkt, neu gemessen bei anderer Breite"
  },
  {
    nr: '1999', name: "Ein Rest mit drei Zeilen steht direkt",
    file: 'public/app.js',
    search: "const MORE_LINES = 3;",
    replacement: "const MORE_LINES = 4;",
    expected: "„Mehr“: ab drei Zeilen hinter dem Knopf, darunter direkt, neu gemessen bei anderer Breite"
  },
  {
    nr: '2000', name: "Speichern ohne neues Passwort beendet wieder alle anderen Sitzungen",
    file: 'server.js',
    search: "  if (result.passwordChanged) auth.endOtherSessions(req.user.id, auth.sessionToken(req));",
    replacement: "  auth.endOtherSessions(req.user.id, auth.sessionToken(req));",
    expected: "Mein Account: Speichern ohne neues Passwort laesst die anderen Sitzungen stehen"
  },
  {
    nr: '2001', name: "Der Papierkorb speichert keine Nummern",
    file: 'server.js',
    search: "withPhotos: true, withFiles: true, withVideos: true, everyPin: true, withIds: true, funnel: funnelStore(sources)",
    replacement: "withPhotos: true, withFiles: true, withVideos: true, everyPin: true, funnel: funnelStore(sources)",
    expected: "Papierkorb: Zuordnung ueber die Nummer, Geloeschtes faellt weg"
  },
  {
    nr: '2002', name: "Kriterien ordnet das Wiederherstellen wieder ueber den Namen zu",
    file: 'server.js',
    search: "        const criterion = byIds ? kept(iCritThere, r.criterion_id, r.name, gone.criteria) : critByName(r.name);",
    replacement: "        const criterion = critByName(r.name);",
    expected: "Papierkorb: Zuordnung ueber die Nummer, Geloeschtes faellt weg"
  },
  {
    nr: '2003', name: "Der Papierkorb legt alle Kriterien der Datei wieder an",
    file: 'server.js',
    search: "    for (const name of byIds ? [] : Array.isArray(payload.criteria) ? payload.criteria : []) {",
    replacement: "    for (const name of Array.isArray(payload.criteria) ? payload.criteria : []) {",
    expected: "Papierkorb: Zuordnung ueber die Nummer, Geloeschtes faellt weg"
  },
  {
    nr: '2004', name: "Die Leiste zum Formatieren verschwindet schon beim mousedown",
    file: 'public/app.js',
    search: "const afterClick = (fn) => (CLICK_PENDING ? CLICK_PENDING.push(fn) : fn());",
    replacement: "const afterClick = (fn) => fn();",
    expected: "Leiste zum Formatieren: erst nach dem Klick weg"
  },
  {
    nr: '2005', name: "Der Entwurf kommt beim Zurueckkommen nicht wieder",
    file: 'public/app.js',
    search: "  ctextField.value = draftRead(`comment-${id}`);",
    replacement: "  ctextField.value = '';",
    expected: "Entwurf: ungesendeter Kommentar bleibt im Tab"
  },
  {
    nr: '2006', name: "Nach dem Senden bleibt der Entwurf gespeichert",
    file: 'public/app.js',
    search: "      draftWrite(`comment-${id}`, '');\n",
    replacement: "",
    expected: "Entwurf: ungesendeter Kommentar bleibt im Tab"
  },
  {
    nr: '2007', name: "Ein angefangenes Bearbeiten oeffnet den Editor nicht wieder",
    file: 'public/app.js',
    search: "      if (mine && draftRead(`edit-${c.id}`)) openEdit(false);",
    replacement: "      if (false) openEdit(false);",
    expected: "Entwurf: ungesendeter Kommentar bleibt im Tab"
  },
  {
    nr: '2008', name: "Klick neben einen Dialog mit Text schliesst ihn wieder",
    file: 'public/app.js',
    search: "const fromBackdrop = (e, bd) => e.target === bd && (DOWN_AT === null || DOWN_AT === bd) && !typedIn(bd);",
    replacement: "const fromBackdrop = (e, bd) => e.target === bd && (DOWN_AT === null || DOWN_AT === bd);",
    expected: "Dialoge: Klick daneben und Zurueck"
  },
  {
    nr: '2009', name: "Ein Dialog legt keinen Eintrag im Verlauf an",
    file: 'public/app.js',
    search: "      DIALOG_MARK.set(bd, { mark, url: location.href });\n      pushDialog(mark);",
    replacement: "      DIALOG_MARK.set(bd, { mark, url: location.href });",
    expected: "Dialoge: Klick daneben und Zurueck"
  },
  {
    nr: '2010', name: "Ein per Knopf geschlossener Dialog laesst seinen Eintrag im Verlauf",
    file: 'public/app.js',
    search: "        DIALOG_POP_SKIP++;\n        history.back();",
    replacement: "        DIALOG_POP_SKIP++;",
    expected: "Dialoge: Klick daneben und Zurueck"
  },
  {
    nr: '2011', name: "Nach dem Loeschen fuehrt Zurueck wieder auf den geloeschten Eintrag",
    file: 'public/app.js',
    search: "      await dialogSettled();\n      history.replaceState(null, '', '#/');\n      route();",
    replacement: "      location.hash = '#/';",
    expected: "Navigation: Loeschen, Vergleich, Adresse vor der Anmeldung"
  },
  {
    nr: '2012', name: "Der Vergleich ohne Auswahl legt wieder einen Eintrag im Verlauf an",
    file: 'public/app.js',
    search: "    history.replaceState(null, '', '#/');\n    route();\n    toast(t('list.compareNone'));",
    replacement: "    location.hash = '#/';",
    expected: "Navigation: Loeschen, Vergleich, Adresse vor der Anmeldung"
  },
  {
    nr: '2013', name: "Die Auswahl fuer den Vergleich steht nicht in sessionStorage",
    file: 'public/app.js',
    search: "  keep() { tabStore.set(this.key, JSON.stringify([...this])); }",
    replacement: "  keep() { }",
    expected: "Navigation: Loeschen, Vergleich, Adresse vor der Anmeldung"
  },
  {
    nr: '2014', name: "Nach der Anmeldung geht es wieder in die Uebersicht",
    file: 'public/app.js',
    search: "      if (j.twoFactor) return showSecondFactor(j.ticket);\n      location.hash = afterLogin();",
    replacement: "      if (j.twoFactor) return showSecondFactor(j.ticket);\n      location.hash = '#/';",
    expected: "Navigation: Loeschen, Vergleich, Adresse vor der Anmeldung"
  },
  {
    nr: '2015', name: "Ein falsches Passwort leert wieder den Benutzernamen",
    file: 'public/app.js',
    search: "        showLogin(j.error || t('login.failed'), u.value, res.status === 429 ? Number(j.retryIn) || 0 : 0);",
    replacement: "        showLogin(j.error || t('login.failed'));",
    expected: "Anmeldung: Benutzername bleibt, Netzfehler, Ende der Sitzung"
  },
  {
    nr: '2016', name: "Ein Netzfehler zeigt wieder den Text des Browsers",
    file: 'public/app.js',
    search: "  const res = await fetch(url, opts).catch(() => { throw offline(); });",
    replacement: "  const res = await fetch(url, opts);",
    expected: "Anmeldung: Benutzername bleibt, Netzfehler, Ende der Sitzung"
  },
  {
    nr: '2017', name: "Die Uebersicht zeigt bei einem Fehler wieder nur den Text",
    file: 'public/app.js',
    search: "  catch (e) { if (run === VIEW_RUN && e.message !== SESSION_GONE) viewFailed(esc(e.message)); return; }",
    replacement: "  catch (e) { if (run === VIEW_RUN && e.message !== SESSION_GONE) app.innerHTML = `<div class=\"shell\"><p class=\"hint\">${esc(e.message)}</p></div>`; return; }",
    expected: "Anmeldung: Benutzername bleibt, Netzfehler, Ende der Sitzung"
  },
  {
    nr: '2018', name: "Der interne Text des Sitzungsendes erscheint wieder als Meldung",
    file: 'public/app.js',
    search: "  if (msg === SESSION_GONE) return;\n",
    replacement: "",
    expected: "Anmeldung: Benutzername bleibt, Netzfehler, Ende der Sitzung"
  },
  {
    nr: '2019', name: "Die Anmeldeseite nennt den Grund des Sitzungsendes nicht",
    file: 'public/app.js',
    search: "  if (res.status === 401) { showLogin(await sessionEndText(res)); throw new Error(SESSION_GONE); }",
    replacement: "  if (res.status === 401) { showLogin(); throw new Error(SESSION_GONE); }",
    expected: "Anmeldung: Benutzername bleibt, Netzfehler, Ende der Sitzung"
  },
  {
    nr: '2020', name: "Eine geaenderte Karte zeigt nicht „nicht gespeichert“",
    file: 'public/app.js',
    search: "  card.classList.toggle('unsaved', changed);",
    replacement: "  card.classList.toggle('unsaved', false);",
    expected: "Einstellungen: „nicht gespeichert\" und Rueckfrage beim Verlassen"
  },
  {
    nr: '2021', name: "Ungespeicherte Karten fragen beim Verlassen nicht nach",
    file: 'public/app.js',
    search: "  if (SYS_HERE && location.hash !== SYS_HERE && unsavedCards().length) {",
    replacement: "  if (false) {",
    expected: "Einstellungen: „nicht gespeichert\" und Rueckfrage beim Verlassen"
  },
  {
    nr: '2022', name: "Die Kachel einer fehlenden Bilddatei laedt ihr Bild",
    file: 'public/app.js',
    search: "      picture: a.missing ? '' : a.preview === 'image' || ((video || audio) && a.still) || a.thumb ? fileTileSource(a) : coming,",
    replacement: "      picture: a.preview === 'image' || ((video || audio) && a.still) || a.thumb ? fileTileSource(a) : coming,",
    expected: "Dateien: fehlende Datei, Upload abbrechen, PDF ohne sandbox"
  },
  {
    nr: '2023', name: "Das Menue einer fehlenden Datei bietet „Herunterladen“",
    file: 'public/app.js',
    search: "    if (!a.missing) pass.push({ label: t('entry.download')",
    replacement: "    pass.push({ label: t('entry.download')",
    expected: "Dateien: fehlende Datei, Upload abbrechen, PDF ohne sandbox"
  },
  {
    nr: '2024', name: "Die Vorschau einer fehlenden Datei sagt es nicht",
    file: 'public/app.js',
    search: "  if (a.missing) {\n    boxId.innerHTML = `<p class=\"hint\">${tH('server.fileMissing')}</p>`;\n  } else if (a.preview === 'audio') {",
    replacement: "  if (a.preview === 'audio') {",
    expected: "Dateien: fehlende Datei, Upload abbrechen, PDF ohne sandbox"
  },
  {
    nr: '2025', name: "Der Menuepunkt einer laufenden Upload-Kachel heisst wieder „Abbrechen“",
    file: 'public/app.js',
    search: "      : [{ label: t('entry.uploadStop'), run: () => uploadCancel(u) }];",
    replacement: "      : [{ label: t('dialog.cancel'), run: () => uploadCancel(u) }];",
    expected: "Dateien: fehlende Datei, Upload abbrechen, PDF ohne sandbox"
  },
  {
    nr: '2026', name: "Das PDF steht wieder in einem iframe mit sandbox",
    file: 'public/app.js',
    search: "    boxId.innerHTML = `<iframe src=\"/api/attachments/${Number(a.id)}/raw?inline=1\"\n        referrerpolicy=",
    replacement: "    boxId.innerHTML = `<iframe src=\"/api/attachments/${Number(a.id)}/raw?inline=1\"\n        sandbox=\"allow-scripts\" referrerpolicy=",
    expected: "Dateien in der Oberflaeche"
  },
  {
    nr: '2027', name: "Die Leertaste spielt bei Fokus auf dem Vollbild nicht",
    file: 'public/app.js',
    search: "    else if (e.key === ' ' && document.activeElement === lb && playerShown() && player.getAttribute('src')) {",
    replacement: "    else if (false && e.key === ' ' && document.activeElement === lb) {",
    expected: "Vollbild: Leertaste beim Oeffnen eines Videos, Rueckkehr zum Proxy"
  },
  {
    nr: '2028', name: "Scheitert das gewaehlte Original, bleibt die Meldung stehen",
    file: 'public/app.js',
    search: "    if (withProxy && !proxyFailed) {",
    replacement: "    if (false) {",
    expected: "Vollbild: Leertaste beim Oeffnen eines Videos, Rueckkehr zum Proxy"
  },
  {
    nr: '2029', name: "Videos zaehlen im Satz zum Export auch ohne Fotos",
    file: 'public/app.js',
    search: "[photos && videos, 'card.contentVideos']",
    replacement: "[videos, 'card.contentVideos']",
    expected: "Export und Import: Saetze aus der Wahl, Verlust vor „Ersetzen\", Sprachen"
  },
  {
    nr: '2030', name: "„Sprachen“ zaehlt Vokabelwoerter mit Vorgabe der Sprachdatei",
    file: 'public/app.js',
    search: " &&\n        !(((VOCABULARY_DEFAULTS || {})[code] || {})[key])).length };",
    replacement: ").length };",
    expected: "Die Karte sagt, wo Arbeit liegt — 0.25.0"
  },
  {
    nr: '2031', name: "„ist jetzt Vorgabesprache“ steht bei jedem Besuch",
    file: 'public/app.js',
    search: "    return LANGUAGE_SWITCHED === code ? t('card.languageDefaultNow'",
    replacement: "    return true ? t('card.languageDefaultNow'",
    expected: "Die Karte sagt, wo Arbeit liegt — 0.25.0"
  },
  {
    nr: '2032', name: "Das Ergebnis des Imports steht ohne eigene Klasse",
    file: 'public/app.js',
    search: "openModal(`<div class=\"modal import-result\">",
    replacement: "openModal(`<div class=\"modal\">",
    expected: "Was Export, Import und Backup enthalten"
  },
  {
    nr: '2033', name: "„Sperren“ ist wieder rot",
    file: 'public/app.js',
    search: "t('card.lock'), 'accent')) return;",
    replacement: "t('card.lock'), 'danger')) return;",
    expected: "Knopfarten: Rueckfragen, „Schliessen“ und „Speichern“"
  },
  {
    nr: '2034', name: "confirmBox() faellt ohne Farbe auf Rot zurueck",
    file: 'public/app.js',
    search: "function confirmBox(title, text, confirmLabel, kind, cancelLabel",
    replacement: "function confirmBox(title, text, confirmLabel, kind = 'danger', cancelLabel",
    expected: "Knopfarten: Rueckfragen, „Schliessen“ und „Speichern“"
  },
  {
    nr: '2035', name: "Bei Datenverlust steht der Fokus auf dem Ja-Knopf",
    file: 'public/app.js',
    search: "bd.querySelector(kind === 'danger' ? '[data-no]' : '[data-yes]').focus();",
    replacement: "bd.querySelector('[data-yes]').focus();",
    expected: "Knopfarten: Rueckfragen, „Schliessen“ und „Speichern“"
  },
  {
    nr: '2036', name: "„Schliessen“ in „Infos“ ist wieder orange",
    file: 'public/app.js',
    search: "\n      <div class=\"modal-acts\"><button class=\"btn btn-ghost\" data-yes>${tH('list.close')}</button></div></div>`,",
    replacement: "\n      <div class=\"modal-acts\"><button class=\"btn btn-accent\" data-yes>${tH('list.close')}</button></div></div>`,",
    expected: "Knopfarten: Rueckfragen, „Schliessen“ und „Speichern“"
  },
  {
    nr: '2038', name: "„Speichern“ in „Suchmaschinen“ ist grau",
    file: 'public/app.js',
    search: "<button class=\"btn btn-accent btn-sm\" id=\"se-save\"",
    replacement: "<button class=\"btn btn-sm\" id=\"se-save\"",
    expected: "Knopfarten: Rueckfragen, „Schliessen“ und „Speichern“"
  },
  {
    nr: '2039', name: "„+ Bild/Video“ im Editor ohne Flaeche",
    file: 'public/app.js',
    search: "<div class=\"acts\"><button class=\"btn btn-sm addimg\">",
    replacement: "<div class=\"acts\"><button class=\"btn btn-ghost btn-sm addimg\">",
    expected: "Knopfarten: Rueckfragen, „Schliessen“ und „Speichern“"
  },
  {
    nr: '2040', name: "„Jetzt loeschen“ ist wieder orange",
    file: 'public/app.js',
    search: "<button class=\"btn btn-danger btn-sm\" id=\"cleanup-run\"",
    replacement: "<button class=\"btn btn-accent btn-sm\" id=\"cleanup-run\"",
    expected: "Knopfarten: Rueckfragen, „Schliessen“ und „Speichern“"
  },
  {
    nr: '2041', name: "Benutzer loeschen mit ✕",
    file: 'public/app.js',
    search: "title=\"${esc(t('dialog.deleteUser'))}\">${ICON_DELETE}</button>",
    replacement: "title=\"${esc(t('dialog.deleteUser'))}\">${ICON_X}</button>",
    expected: "Knopfarten: ✕ zum Schliessen, Papierkorb zum Loeschen"
  },
  {
    nr: '2042', name: "„Endgueltig loeschen“ wieder als ✕",
    file: 'public/app.js',
    search: "<button class=\"mact rm trash-remove\">${tH('card.deleteForGood')}</button>",
    replacement: "<button class=\"mact rm trash-remove\">${ICON_X}</button>",
    expected: "Knopfarten: ✕ zum Schliessen, Papierkorb zum Loeschen"
  },
  {
    nr: '2043', name: "Der Papierkorb am Testtag erscheint erst beim Ueberfahren",
    file: 'public/style.css',
    search: ".rvote .mact { padding: 0 3px; }",
    replacement: ".rvote .mact { padding: 0 3px; }\n.trow .mact { opacity: 0; }",
    expected: "Knopfarten: ✕ zum Schliessen, Papierkorb zum Loeschen"
  },
  {
    nr: '2044', name: "Zeilenaktionen der Einstellungen wieder unsichtbar",
    file: 'public/style.css',
    search: ".mrow .mact:where(:not(:disabled)) { opacity: .5; }",
    replacement: ".mrow .mact:where(:not(:disabled)) { opacity: 0; }",
    expected: "Knopfarten: ✕ zum Schliessen, Papierkorb zum Loeschen"
  },
  {
    nr: '2045', name: "„Benutzer“ zeigt nur die Zahl",
    file: 'public/app.js',
    search: "        ${countCell(`${z.entries} ${vThing(z.entries)}`, `${z.entries} ${vThing(z.entries)}`)}`;\n      if (may) {",
    replacement: "        ${countCell(String(z.entries), `${z.entries} ${vThing(z.entries)}`)}`;\n      if (may) {",
    expected: "Knopfarten: ✕ zum Schliessen, Papierkorb zum Loeschen"
  },
  {
    nr: '2046', name: "Der Hinweis zur Groesse des Exports ist wieder rot",
    file: 'public/app.js',
    search: "<div class=\"plain-box\" style=\"margin:12px 0 0\">",
    replacement: "<div class=\"warn-box\" style=\"margin:12px 0 0\">",
    expected: "Knopfarten: Kaesten, Hover, Haekchen, deaktiviert"
  },
  {
    nr: '2047', name: "Karten mit Luecken wieder rot",
    file: 'public/style.css',
    search: ".sys-card.gaps { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-dim); }",
    replacement: ".sys-card.gaps { border-color: rgba(var(--red-rgb), .55); box-shadow: 0 0 0 3px var(--red-dim); }",
    expected: "Knopfarten: Kaesten, Hover, Haekchen, deaktiviert"
  },
  {
    nr: '2048', name: "„nicht eingerichtet“ wieder rot",
    file: 'public/style.css',
    search: ".mail-off { color: var(--muted); }",
    replacement: ".mail-off { color: var(--red); }",
    expected: "Knopfarten: Kaesten, Hover, Haekchen, deaktiviert"
  },
  {
    nr: '2049', name: "Hover an `.btn` gilt auch fuer Touch",
    file: 'public/style.css',
    search: "@media (hover: hover) { .btn:hover:where(:not(:disabled)) { background: var(--surface-3); border-color: var(--line-hover); color: var(--text); } }",
    replacement: ".btn:hover { background: var(--surface-3); border-color: var(--line-hover); color: var(--text); }",
    expected: "Knopfarten: Kaesten, Hover, Haekchen, deaktiviert"
  },
  {
    nr: '2050', name: "Haekchen nur unter „Export“ orange",
    file: 'public/style.css',
    search: "input[type=checkbox] { accent-color: var(--accent); }",
    replacement: ".ex-files input { accent-color: var(--accent); }",
    expected: "Knopfarten: Kaesten, Hover, Haekchen, deaktiviert"
  },
  {
    nr: '2051', name: "Deaktiviert nur fuer `.btn`",
    file: 'public/style.css',
    search: ":is(.btn, .mact, .link-btn, .pill, .icon-btn, .sdefault):disabled { opacity: .42; cursor: not-allowed; }",
    replacement: ".btn:disabled { opacity: .42; cursor: not-allowed; }",
    expected: "Knopfarten: Kaesten, Hover, Haekchen, deaktiviert"
  },
  {
    nr: '2052', name: "„Loeschen“ in der Auswahlleiste nur beim Ueberfahren rot",
    file: 'public/style.css',
    search: ".apick .apick-del:not(:disabled) { color: var(--red); }",
    replacement: ".apick .apick-del:not(:disabled):hover { color: var(--red); }",
    expected: "Knopfarten: Kaesten, Hover, Haekchen, deaktiviert"
  },
  {
    nr: '2053', name: "„Zusammenfuehren“ ist grau",
    file: 'public/app.js',
    search: "<button class=\"btn btn-accent\" data-merge>",
    replacement: "<button class=\"btn\" data-merge>",
    expected: "Dialoge: Escape, Import, Felder und „Kacheln · Liste“"
  },
  {
    nr: '2054', name: "Escape schliesst keinen Dialog",
    file: 'public/app.js',
    search: "    if (e.key === 'Escape') done(cancel);",
    replacement: "    if (false) done(cancel);",
    expected: "Dialoge: Escape, Import, Felder und „Kacheln · Liste“"
  },
  {
    nr: '2055', name: "Escape schliesst auch den Dialog darunter",
    file: 'public/app.js',
    search: "    if (bd !== [...document.querySelectorAll('body > .backdrop')].pop()) return;\n",
    replacement: "",
    expected: "Dialoge: Escape, Import, Felder und „Kacheln · Liste“"
  },
  {
    nr: '2056', name: "„Kacheln · Liste“ markiert das gewaehlte Feld nicht",
    file: 'public/app.js',
    search: "      b.classList.toggle('on', b.dataset.view === FILES_VIEW);\n",
    replacement: "",
    expected: "Dialoge: Escape, Import, Felder und „Kacheln · Liste“"
  },
  {
    nr: '2057', name: "Das Datumsfeld am Testtag ohne `.input`",
    file: 'public/app.js',
    search: "<input type=\"date\" class=\"input input-sm\" id=\"tdate\"",
    replacement: "<input type=\"date\" id=\"tdate\"",
    expected: "Dialoge: Escape, Import, Felder und „Kacheln · Liste“"
  },
  {
    nr: '2058', name: "„Kacheln · Liste“ ohne Touch-Masse auf dem Tablet",
    file: 'public/style.css',
    search: "  .aview-btn { min-height: 44px; padding: 0 14px; }\n",
    replacement: "",
    expected: "Dialoge: Escape, Import, Felder und „Kacheln · Liste“"
  },
  {
    nr: '2059', name: "Der Daumen ist wieder ein Emoji",
    file: 'public/app.js',
    search: "['full', '', `${t('list.shareFullHint'",
    replacement: "['full', '👍', `${t('list.shareFullHint'",
    expected: "Symbole und Ordner-Marke: Daumen und Ordner in der Farbe der Schrift"
  },
  {
    nr: '2060', name: "Der Ordner am Testtag ist wieder ein Emoji",
    file: 'public/app.js',
    search: "        open.innerHTML = ICON_FOLDER;",
    replacement: "        open.textContent = '📁';",
    expected: "Symbole und Ordner-Marke: Daumen und Ordner in der Farbe der Schrift"
  },
  {
    nr: '2061', name: "Ein Link auf einen Ordner bleibt eine rohe Adresse",
    file: 'public/app.js',
    search: "  if (folder) return `o${Number(folder[2])}`;\n",
    replacement: "",
    expected: "Symbole und Ordner-Marke: Daumen und Ordner in der Farbe der Schrift"
  },
  {
    nr: '2062', name: "Der Server liefert keine Ordner zu Verweisen",
    file: 'server.js',
    search: "    if (row) out.push({ key: 'o' + row.id, ...row });",
    replacement: "    if (false) out.push({ key: 'o' + row.id, ...row });",
    expected: "Kommentare: Link auf einen Ordner wird zur Marke"
  },
  {
    nr: '2063', name: "Ein abgebrochenes Modul zaehlt wieder nicht",
    file: 'testbench.js',
    search: "  if (report.abort) driverRed(name, `ist abgebrochen: ${report.abort}`);\n",
    replacement: "  if (report.abort) console.log(`\\n  ✗ Das Modul ${name} ist abgebrochen: ${report.abort}`);\n",
    expected: "Der Treiber sieht den Rueckgabewert — 0.34.4"
  }
,
  {
    nr: '2064', name: "Video, Audio und Proxy stehen wieder offen",
    file: 'public/app.js',
    search: ") + (video.length ? moreGroup(tracks) : tracks);",
    replacement: ") + tracks;",
    expected: "Infos: „Erweiterte Infos“ und die Aufloesung unter „Allgemein“"
  },
  {
    nr: '2065', name: "Die Aufloesung fehlt unter „Allgemein“",
    file: 'public/app.js',
    search: "    ['entry.mediaResolution', video.length ? area(video[0].width, video[0].height) : ''],\n",
    replacement: "",
    expected: "Infos: „Erweiterte Infos“ und die Aufloesung unter „Allgemein“"
  },
  {
    nr: '2066', name: "Bei Bildern steht „Format“ zweimal",
    file: 'public/app.js',
    search: "  return mediaGroup(t('entry.kindImage'), [\n",
    replacement: "  return mediaGroup(t('entry.kindImage'), [['entry.mediaFormat', main.format],\n",
    expected: "Infos: „Erweiterte Infos“ und die Aufloesung unter „Allgemein“"
  },
  {
    nr: '2067', name: "Der Zaehler fehlt in der Leiste",
    file: 'public/app.js',
    search: "      <div class=\"lb-tools\">\n        <span class=\"lb-count\"></span>\n",
    replacement: "      <div class=\"lb-tools\">\n",
    expected: "Vollbild: Reihenfolge der Knopfleiste"
  },
  {
    nr: '2068', name: "Am Telefon steht wieder der Text statt des Zylinders",
    file: 'public/style.css',
    search: "  .lb-btn.whole .lb-phone { display: flex; }\n",
    replacement: "",
    expected: "Vollbild: „Ganz laden“ als Symbol, mit Groesse und Haken"
  },
  {
    nr: '2069', name: "Ein ganz gepuffertes Video bekommt keinen Haken",
    file: 'public/app.js',
    search: "((!!wholeCopy && source === wholeCopy.url) || bufferedAll());",
    replacement: "(!!wholeCopy && source === wholeCopy.url);",
    expected: "Vollbild: „Ganz laden“ als Symbol, mit Groesse und Haken"
  },
  {
    nr: '2070', name: "Der Titel von „Ganz laden“ nennt die Groesse nicht",
    file: 'public/app.js',
    search: ": done ? t('entry.loadWholeDone') : t('entry.loadWholeTitle', { size: fmtBytes(bytes) });",
    replacement: ": done ? t('entry.loadWholeDone') : t('entry.loadWhole');",
    expected: "Vollbild: „Ganz laden“ als Symbol, mit Groesse und Haken"
  },
  {
    nr: '2071', name: "Beim Laden steht auf der Buehne nichts",
    file: 'public/app.js',
    search: "    loadingBox.hidden = !loading;\n",
    replacement: "    loadingBox.hidden = true;\n",
    expected: "Video ganz laden"
  },
  {
    nr: '2072', name: "Ein Klick auf das gewaehlte Feld schaltet um",
    file: 'public/app.js',
    search: "    if (b && (b.dataset.source === 'original') !== original) switchFile(!original);",
    replacement: "    if (b) switchFile(!original);",
    expected: "Vollbild: „Proxy · Original“ als verbundene Leiste"
  },
  {
    nr: '2073', name: "Das freie Feld hat im hellen Schema zu wenig Kontrast",
    file: 'public/style.css',
    search: ".lb-source .pill:not(.on) { color: var(--text-2); }\n",
    replacement: "",
    expected: "Vollbild: „Proxy · Original“ als verbundene Leiste"
  },
  {
    nr: '2074', name: "Am Telefon blendet kein Rand aus",
    file: 'public/style.css',
    search: "\n.more-after { mask-image",
    replacement: "\n.more-none { mask-image",
    expected: "Vollbild: die Leiste am Telefon laesst sich wischen"
  },
  {
    nr: '2075', name: "Die Leiste merkt nicht, dass rechts Knoepfe folgen",
    file: 'public/app.js',
    search: "  row.classList.toggle('more-after', end > 1 && row.scrollLeft < end - 1);\n",
    replacement: "",
    expected: "Vollbild: die Leiste am Telefon laesst sich wischen"
  },
  {
    nr: '2076', name: "Der Doppeltipp fuehrt wieder auf das Original",
    file: 'public/app.js',
    search: "    const scale = kind === 'actual' ? natural / width : Math.min(ZOOM_TAP, most);",
    replacement: "    const scale = natural / width;",
    expected: "Vollbild: Zoom mit Maus und Doppeltipp"
  },
  {
    nr: '2077', name: "Der Doppeltipp zaehlt CSS-Pixel statt Geraetepixel",
    file: 'public/app.js',
    search: "    const most = Math.max(1, natural / (width * dpr()));",
    replacement: "    const most = Math.max(1, natural / width);",
    expected: "Vollbild: Zoom mit Maus und Doppeltipp"
  },
  {
    nr: '2078', name: "Zwei Finger zoomen wieder die Seite",
    file: 'public/style.css',
    search: ".lightbox { touch-action: pan-x pan-y; }\n",
    replacement: "",
    expected: "Vollbild: zwei Finger zoomen das Bild"
  },
  {
    nr: '2079', name: "Spreizen laedt das Original nicht",
    file: 'public/app.js',
    search: "        pinch.width * pinch.r * dpr() > (img.naturalWidth || Infinity)) zoomIn('keep', null);",
    replacement: "        false) zoomIn('keep', null);",
    expected: "Vollbild: zwei Finger zoomen das Bild"
  },
  {
    nr: '2080', name: "Ziehen verschiebt den Ausschnitt nicht",
    file: 'public/app.js',
    search: "    stage.scrollLeft = press.left - (e.clientX - press.x);\n",
    replacement: "",
    expected: "Vollbild: Zoom mit Maus und Doppeltipp"
  },
  {
    nr: '2081', name: "Jedes Loslassen schaltet den Zoom aus",
    file: 'public/app.js',
    search: "      if (moved >= DRAG_MOVE || !hasOriginal(photos[i])) return;",
    replacement: "      if (!hasOriginal(photos[i])) return;",
    expected: "Vollbild: Zoom mit Maus und Doppeltipp"
  },
  {
    nr: '2082', name: "Gezoomt sagt der Titel nicht, wie es zurueckgeht",
    file: 'public/app.js',
    search: "    img.title = t('list.zoomedHint');\n",
    replacement: "",
    expected: "Vollbild: Zoom mit Maus und Doppeltipp"
  },
  {
    nr: '2083', name: "Ohne Original zeigt der Zeiger die Lupe",
    file: 'public/style.css',
    search: ".lb-stage img.lb-plain { cursor: default; }\n",
    replacement: "",
    expected: "Vollbild: Zoom mit Maus und Doppeltipp"
  },
  {
    nr: '2084', name: "Der Zoom tauscht die Quelle sofort",
    file: 'public/app.js',
    search: "    if (preload.getAttribute('src') === address && preload.complete && preload.naturalWidth) zoomReady(preload.naturalWidth);\n    else preload.src = address;",
    replacement: "    img.src = address;\n    preload.src = address;",
    expected: "Vollbild: Zoom mit Maus und Doppeltipp"
  },
  {
    nr: '2085', name: "Beim Zoom erscheint keine Ladeanzeige",
    file: 'public/app.js',
    search: "    if (on) waitTimer = setTimeout(() => { waitSign.hidden = false; }, WAIT_MS);",
    replacement: "",
    expected: "Vollbild: Zoom mit Maus und Doppeltipp"
  },
  {
    nr: '2086', name: "Beim Blaettern bleibt das alte Bild stehen",
    file: 'public/app.js',
    search: "        img.classList.add('lb-coming');\n",
    replacement: "",
    expected: "Vollbild: Zoom mit Maus und Doppeltipp"
  },
  {
    nr: '2087', name: "Wischen nach rechts wird wieder zu „Zurueck“",
    file: 'public/style.css',
    search: "html:has(> body.lb-open) { overflow: hidden; overscroll-behavior-x: none; }",
    replacement: "html:has(> body.lb-open) { overflow: hidden; }",
    expected: "Vollbild: Zurueck, Meldung und das letzte Bild"
  },
  {
    nr: '2088', name: "↓ ist wieder ein Schriftzeichen",
    file: 'public/app.js',
    search: ">${ICON_DOWNLOAD}</a>",
    replacement: ">↓</a>",
    expected: "Vollbild: Reihenfolge der Knopfleiste"
  },
  {
    nr: '2089', name: "Die Pfeile verdecken die Meldung",
    file: 'public/style.css',
    search: "gap: 14px; padding: 0 70px;",
    replacement: "gap: 14px; padding: 0 24px;",
    expected: "Vollbild: Zurueck, Meldung und das letzte Bild"
  },
  {
    nr: '2090', name: "„Vorschaubild wählen …“ oeffnet ohne Hinweis",
    file: 'public/app.js',
    search: "    if (a.mine && a.preview === 'video') sort.push({ label: t('entry.chooseStill'), run: () => showFile(a.id, true) });",
    replacement: "    if (a.mine && a.preview === 'video') sort.push({ label: t('entry.chooseStill'), run: () => showFile(a.id) });",
    expected: "Vollbild: „Vorschaubild wählen …“ sagt, was zu tun ist"
  },
  {
    nr: '2091', name: "Die Leiste rollt nicht bis zum Bildsymbol",
    file: 'public/app.js',
    search: "      if (at.right > box.right - 24) tools.scrollLeft += at.right - box.right + 24;\n",
    replacement: "",
    expected: "Vollbild: „Vorschaubild wählen …“ sagt, was zu tun ist"
  },
  {
    nr: '2092', name: "Nach dem letzten Bild kommt das erste",
    file: 'public/app.js',
    search: "    if (i >= photos.length) i = photos.length - 1;\n    buildStrip();",
    replacement: "    buildStrip();",
    expected: "Vollbild: Zurueck, Meldung und das letzte Bild"
  },
  {
    nr: '2093', name: "Ein Tipp auf das laufende Video zeigt die Pfeile nicht",
    file: 'public/app.js',
    search: "    if (s.target === videoPlayer && Math.hypot(dx, dy) <= TAP_MOVE && !videoPlayer.paused) arrowsOverVideo();",
    replacement: "",
    expected: "Vollbild: Wischen auf dem Video, Pfeile nach einem Tipp"
  },
  {
    nr: '2094', name: "Die Pfeile bleiben ueber dem laufenden Video verborgen",
    file: 'public/style.css',
    search: "  .lightbox.lb-arrows .lb-nav { visibility: visible; }\n",
    replacement: "",
    expected: "Vollbild: Wischen auf dem Video, Pfeile nach einem Tipp"
  },
  {
    nr: '2095', name: "Die Pfeile ueber Fotos bleiben stehen",
    file: 'public/app.js',
    search: "    idleTimer = setTimeout(() => { if (!img.hidden) lb.classList.add('lb-idle'); }, ARROWS_MS);",
    replacement: "",
    expected: "Vollbild: Wischen auf dem Video, Pfeile nach einem Tipp"
  },
  {
    nr: '2096', name: "Der Doppeltipp zeigt die Pfeile wieder",
    file: 'public/app.js',
    search: "    lastTap = 0;\n    clearTimeout(tapTimer);",
    replacement: "    lastTap = 0;",
    expected: "Vollbild: Wischen auf dem Video, Pfeile nach einem Tipp"
  },
  {
    nr: '2097', name: "Audiodateien sind keine eigene Art",
    file: 'attachments.js',
    search: "  if (AUDIO_TYPES[e]) return 'audio';\n",
    replacement: "",
    expected: "Audio: Endungen, Typen und Art"
  },
  {
    nr: '2098', name: "Audio geht nur als Download hinaus",
    file: 'attachments.js',
    search: "                                ...Object.values(VIDEO_TYPES), ...Object.values(AUDIO_TYPES), 'application/pdf']);",
    replacement: "                                ...Object.values(VIDEO_TYPES), 'application/pdf']);",
    expected: "Audio: Endungen, Typen und Art"
  },
  {
    nr: '2099', name: "Das Cover wird kein Standbild",
    file: 'server.js',
    search: "    if (still && !qStillSize.get(id)) {",
    replacement: "    if (false) {",
    expected: "Audio: das Cover wird Standbild und Kachel"
  },
  {
    nr: '2100', name: "Ein Cover in WebP bleibt WebP",
    file: 'server.js',
    search: "  if (['image/jpeg', 'image/png'].includes(attachments.typeFromBytes(cover)) && cover.length <= limitBytes('photo')) return cover;",
    replacement: "  return cover;",
    expected: "Audio: das Cover wird Standbild und Kachel"
  },
  {
    nr: '2101', name: "Die Bytes des Covers landen in den Infos",
    file: 'server.js',
    search: "    const { cover, ...read } = await readMediaOf(a, kind === 'audio');\n    facts = read;",
    replacement: "    const read = await readMediaOf(a, kind === 'audio'), cover = read.cover;\n    facts = read;",
    expected: "Audio: das Cover wird Standbild und Kachel"
  },
  {
    nr: '2102', name: "Eine Audiodatei bekommt keine Kachel aus dem Cover",
    file: 'server.js',
    search: "  const fromStill = kind === 'video' || kind === 'audio';",
    replacement: "  const fromStill = kind === 'video';",
    expected: "Audio: das Cover wird Standbild und Kachel"
  },
  {
    nr: '2103', name: "Jeder darf die Wellenform setzen",
    file: 'server.js',
    search: "  if (!selfOnly(req, a.user_id)) return res.status(403).json({ error: t(localeOf(req), DENIED_SELF)});\n  if (!isAudioFile(a.filename))",
    replacement: "  if (!isAudioFile(a.filename))",
    expected: "Audio: die Wellenform"
  },
  {
    nr: '2104', name: "Die Wellenform darf jede Laenge haben",
    file: 'server.js',
    search: "  return bytes.length === WAVEFORM_PEAKS ? bytes : null;",
    replacement: "  return bytes.length ? bytes : null;",
    expected: "Audio: die Wellenform"
  },
  {
    nr: '2105', name: "Die Antwort nennt die Wellenform nicht",
    file: 'server.js',
    search: "                               peaks: wavePeaksOut(a2.peaks),",
    replacement: "                               peaks: null,",
    expected: "Audio: die Wellenform"
  },
  {
    nr: '2106', name: "Audio nimmt keine Stelle an",
    file: 'server.js',
    search: "!playsAsVideo(id, target.filename) && !isAudioFile(target.filename)))",
    replacement: "!playsAsVideo(id, target.filename)))",
    expected: "Audio: die Stelle wird gemerkt"
  },
  {
    nr: '2107', name: "Eine einzeln geloeschte Datei verliert ihre Wellenform",
    file: 'server.js',
    search: "    peaks: wavePeaksOut(a.peaks),\n",
    replacement: "",
    expected: "Audio: Papierkorb, Export und Import"
  },
  {
    nr: '2108', name: "Export und Papierkorb des Eintrags verlieren die Wellenform",
    file: 'server.js',
    search: "                    ...(wavePeaksOut(a2.peaks) ? { peaks: wavePeaksOut(a2.peaks) } : {}) }));",
    replacement: "                    }));",
    expected: "Audio: Papierkorb, Export und Import"
  },
  {
    nr: '2109', name: "Der Import schreibt keine Wellenform",
    file: 'server.js',
    search: "        if (a2.peaks) putWaveform.run(added.lastInsertRowid, a2.peaks);\n",
    replacement: "",
    expected: "Audio: Papierkorb, Export und Import"
  },
  {
    nr: '2110', name: "Die Kachel zeigt keine Wellenform",
    file: 'public/app.js',
    search: "      wave: audio && !a.missing ? wavePeaksOf(a) : undefined,",
    replacement: "      wave: undefined,",
    expected: "Dateien: Audio an Kachel, in der Vorschau und im Vollbild"
  },
  {
    nr: '2111', name: "Am Rechner oeffnet Audio gleich das Vollbild",
    file: 'public/app.js',
    search: "    if (a.preview === 'audio' && isNarrow()) return showFile(a.id);",
    replacement: "    if (a.preview === 'audio') return showFile(a.id);",
    expected: "Dateien: Audio an Kachel, in der Vorschau und im Vollbild"
  },
  {
    nr: '2112', name: "Ein Tipp auf die Wellenform spult nicht",
    file: 'public/app.js',
    search: "    player.currentTime = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * d;",
    replacement: "",
    expected: "Dateien: Audio an Kachel, in der Vorschau und im Vollbild"
  },
  {
    nr: '2113', name: "Auf der Wellenform blaettert ein Wisch",
    file: 'public/app.js',
    search: "    if (e.target.closest?.('.sdeck')) return false;",
    replacement: "",
    expected: "Dateien: Audio an Kachel, in der Vorschau und im Vollbild"
  },
  {
    nr: '2114', name: "Ohne Cover bleibt die Wellenform klein",
    file: 'public/app.js',
    search: "    const peaks = wavePeaksOf(p), picture = imageSource(p, 'medium'), big = !picture && !!peaks;",
    replacement: "    const peaks = wavePeaksOf(p), picture = imageSource(p, 'medium'), big = false;",
    expected: "Dateien: Audio an Kachel, in der Vorschau und im Vollbild"
  },
  {
    nr: '2115', name: "Eine fehlende Wellenform wird nicht nachgeholt",
    file: 'public/app.js',
    search: "    if (audio && !a.peaks && !a.missing && a.mine === true && shown) catchUpWave(id, a);",
    replacement: "",
    expected: "Dateien: die Wellenform entsteht im Browser"
  },
  {
    nr: '2116', name: "Die Wellenform vom Hochladen wird nicht geschickt",
    file: 'public/app.js',
    search: "  u.wave.then(peaks => (peaks ? sendWave(u.itemId, fresh.id, peaks) : null));",
    replacement: "",
    expected: "Dateien: die Wellenform entsteht im Browser"
  },
  {
    nr: '2117', name: "Nur der letzte Kanal geht in die Wellenform ein",
    file: 'public/app.js',
    search: "  for (let c = 0; c < sound.numberOfChannels; c++) {\n    const data = sound.getChannelData(c);",
    replacement: "  for (let c = sound.numberOfChannels - 1; c < sound.numberOfChannels; c++) {\n    const data = sound.getChannelData(c);",
    expected: "Dateien: die Wellenform entsteht im Browser"
  },
  {
    nr: '2118', name: "Ein zweiter Klick auf „Getestet“ schaltet nicht aus",
    file: 'public/app.js',
    search: "      b.onclick = () => { f[key] = f[key] === v ? 'all' : v; redraw(); };",
    replacement: "      b.onclick = () => { f[key] = v; redraw(); };",
    expected: "Uebersicht: „Status“ und „Ablehnung“ als Leisten ohne „Alle“"
  },
  {
    nr: '2119', name: "„★ Favoriten“ steht in der Leiste",
    file: 'public/app.js',
    search: "  r1.appendChild(bFav);",
    replacement: "  r1.querySelector('#f-tested').appendChild(bFav);",
    expected: "Uebersicht: „Status“ und „Ablehnung“ als Leisten ohne „Alle“"
  },
  {
    nr: '2120', name: "Die Zahlen der Kategorien zaehlen den ganzen Bestand",
    file: 'public/app.js',
    search: "  const besideCategory = visibleItems({ ...f, categoryIds: [] });",
    replacement: "  const besideCategory = state.all;",
    expected: "Uebersicht: Kategorie ohne „Alle“, Zahlen gegen die uebrigen Filter"
  },
  {
    nr: '2121', name: "Tags werden nur bei gewaehltem Tag gedaempft",
    file: 'public/app.js',
    search: "      if (f.tagIds.includes(tag.id)) return;\n",
    replacement: "      if (f.tagIds.includes(tag.id) || !f.tagIds.length) return;\n",
    expected: "Uebersicht: Kategorie ohne „Alle“, Zahlen gegen die uebrigen Filter"
  },
  {
    nr: '2122', name: "„Und · Oder“ hat wieder runde Pillen",
    file: 'public/style.css',
    search: ".tagmode .pill:first-child { border-radius: 999px 0 0 999px; margin-left: 0; }",
    replacement: ".tagmode .pill:first-child { margin-left: 0; }",
    expected: "Uebersicht: „Und · Oder“, Sortieren und „Meine · Alle“ als Leisten"
  },
  {
    nr: '2123', name: "Die Leiste der Richtung schrumpft",
    file: 'public/style.css',
    search: ".sort-way { flex-shrink: 0; }",
    replacement: ".sort-way { flex-shrink: 1; }",
    expected: "Uebersicht: „Und · Oder“, Sortieren und „Meine · Alle“ als Leisten"
  },
  {
    nr: '2124', name: "„Meine · Alle“ in „Offene Aufgaben“ ist keine Leiste",
    file: 'public/app.js',
    search: "<div class=\"pills seg\" id=\"open-view\"",
    replacement: "<div class=\"pills\" id=\"open-view\"",
    expected: "Uebersicht: „Und · Oder“, Sortieren und „Meine · Alle“ als Leisten"
  },
  {
    nr: '2125', name: "Die zweite Gruppe steht ohne Behaelter in der Zeile",
    file: 'public/app.js',
    search: "    group.className = 'fgroup';",
    replacement: "    group.className = 'fgroup-off';",
    expected: "Uebersicht: am Telefon rollbar mit ausgeblendetem Rand, Gruppen brechen nur ganz um"
  },
  {
    nr: '2126', name: "Der linke Rand blendet nicht aus",
    file: 'public/app.js',
    search: "  row.classList.toggle('more-before', end > 1 && row.scrollLeft > 1);\n",
    replacement: "",
    expected: "Uebersicht: am Telefon rollbar mit ausgeblendetem Rand, Gruppen brechen nur ganz um"
  },
  {
    nr: '2127', name: "Unter der Zeitleiste stehen wieder zwei Linien",
    file: 'public/style.css',
    search: ".timeline-years { position: relative; height: 18px; margin-top: 4px; }",
    replacement: ".timeline-years { position: relative; height: 18px; margin-top: 4px; border-top: 1px solid var(--timeline-line); }",
    expected: "Zeitleiste: eine Linie unten, Legende, Zoom und die gespeicherte Spanne"
  },
  {
    nr: '2128', name: "„Alles zeigen“ fehlt",
    file: 'public/app.js',
    search: "      view.full ? '' : `<button type=\"button\" class=\"link-btn tl-all\">${tH('list.timelineShowAll')}</button>`}</div>`;",
    replacement: "      ''}</div>`;",
    expected: "Zeitleiste: Beschriftung ueber dem Rahmen, „Alles zeigen“, Notenskala"
  },
  {
    nr: '2129', name: "Die Zeitleiste zeigt ohne Spanne den ganzen Bestand",
    file: 'public/app.js',
    search: "const TIMELINE_DEFAULT_DAYS = 1096;",
    replacement: "const TIMELINE_DEFAULT_DAYS = 36600;",
    expected: "Zeitleiste: eine Linie unten, Legende, Zoom und die gespeicherte Spanne"
  },
  {
    nr: '2130', name: "Der Zoom geht bis einen Monat",
    file: 'public/app.js',
    search: "const TIMELINE_MIN_DAYS = 91;",
    replacement: "const TIMELINE_MIN_DAYS = 30;",
    expected: "Zeitleiste: eine Linie unten, Legende, Zoom und die gespeicherte Spanne"
  },
  {
    nr: '2131', name: "Esc beendet die Zeitleiste nicht",
    file: 'public/app.js',
    search: "  e.stopPropagation();\n  setTimelineActive(false);\n}",
    replacement: "  e.stopPropagation();\n}",
    expected: "Zeitleiste: eine Linie unten, Legende, Zoom und die gespeicherte Spanne"
  },
  {
    nr: '2132', name: "Am Touchgeraet oeffnet schon der erste Tipp",
    file: 'public/app.js',
    search: "  if (pointerType !== 'mouse' && tl.tapped !== dot.dataset.key) {",
    replacement: "  if (false) {",
    expected: "Zeitleiste: am Touchgeraet zeigt der erste Tipp den Punkt, der zweite oeffnet"
  },
  {
    nr: '2133', name: "Das Menuezeichen traegt keinen Punkt",
    file: 'public/app.js',
    search: "  atElement('menu-dot', el => { el.hidden = !fresh; });",
    replacement: "  atElement('menu-dot', el => { el.hidden = true; });",
    expected: "Kopfzeile: Punkt am Menue, Neuigkeiten bleiben bis zum Neuladen"
  },
  {
    nr: '2134', name: "Neuigkeiten fuehren nicht zum Kommentar",
    file: 'public/app.js',
    search: "      a.href = entryAddress(it.id, '', it.first);",
    replacement: "      a.href = entryAddress(it.id, '', 0);",
    expected: "Kopfzeile: Punkt am Menue, Neuigkeiten bleiben bis zum Neuladen"
  },
  {
    nr: '2135', name: "Geoeffnete Neuigkeiten sind nicht gedaempft",
    file: 'public/app.js',
    search: "        BELL_READ.add(it.id);\n",
    replacement: "",
    expected: "Kopfzeile: Punkt am Menue, Neuigkeiten bleiben bis zum Neuladen"
  },
  {
    nr: '2136', name: "Der Text einer Aufgabe fuehrt nur zum Eintrag",
    file: 'public/app.js',
    search: "        text.href = entryAddress(g.id, '', z.id);",
    replacement: "        text.href = entryAddress(g.id, '', 0);",
    expected: "Offene Aufgaben und Vergleich: Sprung zur Aufgabe, ← fuehrt zurueck"
  },
  {
    nr: '2137', name: "← fuehrt immer zur Uebersicht",
    file: 'public/app.js',
    search: "  const back = entry && ENTRY_FROM ? BACK_WORDS[ENTRY_FROM.view] : 'list.backToList';",
    replacement: "  const back = 'list.backToList';",
    expected: "Offene Aufgaben und Vergleich: Sprung zur Aufgabe, ← fuehrt zurueck"
  },
  {
    nr: '2138', name: "Das Suchfeld ist ein Textfeld",
    file: 'public/app.js',
    search: "type=\"search\" enterkeyhint=\"search\"",
    replacement: "type=\"text\"",
    expected: "Suche: Feld fuer das Telefon und der Ablehnungsgrund"
  },
  {
    nr: '2139', name: "Der Ablehnungsgrund ist keine Quelle der Suche",
    file: 'server.js',
    search: "  { key: 'rejection',\n    value: 'CASE WHEN i.rejected AND instr(kkl(i.rejected_reason), :q) > 0 THEN i.rejected_reason END' },\n",
    replacement: "",
    expected: "Server: Spanne der Zeitleiste, erster neuer Kommentar, Suche im Ablehnungsgrund"
  },
  {
    nr: '2140', name: "Eine Ansicht mit gleichem Namen kommt hinten dazu",
    file: 'public/app.js',
    search: "  const next = old ? VIEWS.map(a => (a === old ? { name: old.name, ...viewOutState() } : a))",
    replacement: "  const next = old ? [...VIEWS.filter(a => a !== old), { name: old.name, ...viewOutState() }]",
    expected: "Ansichten: gleicher Name ersetzt nach Rueckfrage"
  },
  {
    nr: '2141', name: "Die Karte nennt die Note nicht",
    file: 'public/app.js',
    search: "⌀ ${esc(V.grade)} ",
    replacement: "⌀ ",
    expected: "Karten: Note am Durchschnitt, Titel hoechstens vier Zeilen, Zeichen fuer den Vergleich"
  },
  {
    nr: '2142', name: "Der Titel der Karte endet nach drei Zeilen",
    file: 'public/style.css',
    search: "-webkit-line-clamp: 4; line-clamp: 4;",
    replacement: "-webkit-line-clamp: 3; line-clamp: 3;",
    expected: "Karten: Note am Durchschnitt, Titel hoechstens vier Zeilen, Zeichen fuer den Vergleich"
  },
  {
    nr: '2143', name: "Das Kaestchen zeigt ein Plus",
    file: 'public/app.js',
    search: "${state.compare.has(it.id) ? ICON_CHECK : ICON_COMPARE}",
    replacement: "${state.compare.has(it.id) ? ICON_CHECK : '+'}",
    expected: "Karten: Note am Durchschnitt, Titel hoechstens vier Zeilen, Zeichen fuer den Vergleich"
  },
  {
    nr: '2144', name: "Die Uebersicht beginnt nach dem Eintrag oben",
    file: 'public/app.js',
    search: "  if (LIST_SCROLL) window.scrollTo(0, LIST_SCROLL);",
    replacement: "",
    expected: "Uebersicht: nach der Rueckkehr aus einem Eintrag dieselbe Stelle"
  },
  {
    nr: '2145', name: "Am Telefon bleiben die Spalten",
    file: 'public/app.js',
    search: "  if (isNarrow()) return drawTable(bestOf, bestTest);",
    replacement: "",
    expected: "Vergleich: Tabelle am Telefon, drei Spalten am Tablet hochkant"
  },
  {
    nr: '2146', name: "Woerter werden nur an Leerzeichen getrennt",
    file: 'public/app.js',
    search: "  .split(/[^\\p{L}\\p{N}]+/u).filter(w => w.length >= SIMILAR_WORD);",
    replacement: "  .split(/\\s+/u).filter(w => w.length >= SIMILAR_WORD);",
    expected: "Anlegen: aehnliche Titel ueber ganze Woerter"
  },
  {
    nr: '2147', name: "Direkt aufgerufen bleibt das Blaettern gesperrt",
    file: 'public/app.js',
    search: "  if (!state.all.length) loadAll().then(() => {",
    replacement: "  if (false) loadAll().then(() => {",
    expected: "Direktaufruf eines Eintrags: Titel und Blaettern"
  },
  {
    nr: '2148', name: "Am Tablet hochkant steht der Titel unter dem Bild",
    file: 'public/style.css',
    search: "  .meta-col { display: contents; }\n  .title-head { order: -1; }\n}\n\n.viewer",
    replacement: "  .meta-col { display: contents; }\n}\n\n.viewer",
    expected: "Eintrag: Titel zuerst bis 860 px, leerer Titel, Schalter mit Schloss"
  },
  {
    nr: '2149', name: "Ein leerer Titel setzt still den alten",
    file: 'public/app.js',
    search: "      if (!v) return toast(t('entry.titleEmpty'));",
    replacement: "      if (!v) { titleEl.value = item.title; return; }",
    expected: "Eintrag: Titel zuerst bis 860 px, leerer Titel, Schalter mit Schloss"
  },
  {
    nr: '2150', name: "Der gesperrte Schalter traegt kein Schloss",
    file: 'public/app.js',
    search: "      toggle.querySelector('.sw-lock').hidden = !locked;",
    replacement: "      toggle.querySelector('.sw-lock').hidden = true;",
    expected: "Eintrag: Titel zuerst bis 860 px, leerer Titel, Schalter mit Schloss"
  },
  {
    nr: '2151', name: "Bei Videos steht der Zaehler ueber der Zeitleiste",
    file: 'public/style.css',
    search: ".vcount.on-video { top: 10px; bottom: auto; }",
    replacement: ".vcount.on-video { }",
    expected: "Eintrag: Zaehler, Hinweis bei Touch, Auswahlmodus, Platzhalter"
  },
  {
    nr: '2152', name: "Bei Touch heisst es weiter „per Ziehen“",
    file: 'public/app.js',
    search: "isTouch() ? tH('entry.photoOrderTouch'",
    replacement: "false ? tH('entry.photoOrderTouch'",
    expected: "Eintrag: Zaehler, Hinweis bei Touch, Auswahlmodus, Platzhalter"
  },
  {
    nr: '2153', name: "Im Auswahlmodus traegt das angezeigte Foto den orangen Rahmen",
    file: 'public/style.css',
    search: ".thumbs.picking .thumb.current:not(.picked) { border-color: var(--line); }",
    replacement: "",
    expected: "Eintrag: Zaehler, Hinweis bei Touch, Auswahlmodus, Platzhalter"
  },
  {
    nr: '2154', name: "Der Platzhalter fuer Tags nennt die Taste",
    file: 'public/languages/de.json',
    search: "  \"entry.tagInputHint\": \"Neuer Tag\",",
    replacement: "  \"entry.tagInputHint\": \"Tag eingeben, Enter bestätigt\",",
    expected: "Eintrag: Zaehler, Hinweis bei Touch, Auswahlmodus, Platzhalter"
  },
  {
    nr: '2155', name: "Die fruehere Vorgabe gilt als verschoben",
    file: 'public/app.js',
    search: "  const sideSaved = raw && Array.isArray(raw.side) && raw.side.join() === BLOCK_SIDE_BEFORE.join() ? null : raw && raw.side;",
    replacement: "  const sideSaved = raw && raw.side;",
    expected: "Eintrag: Bloecke in neuer Reihenfolge, Felder zum Anlegen erst nach Klick"
  },
  {
    nr: '2156', name: "Der Server liefert die fruehere Vorgabe weiter",
    file: 'server.js',
    search: "  const side = Array.isArray(g.side) && g.side.join() === BLOCK_SIDE_BEFORE.join() ? null : g.side;",
    replacement: "  const side = g.side;",
    expected: "Server: Spanne der Zeitleiste, erster neuer Kommentar, Suche im Ablehnungsgrund"
  },
  {
    nr: '2157', name: "Nach „+ Neue Kategorie“ bleibt der Fokus am Knopf",
    file: 'public/app.js',
    search: "    (first?.matches('input') ? first : first?.querySelector('input'))?.focus();\n",
    replacement: "",
    expected: "Eintrag: Bloecke in neuer Reihenfolge, Felder zum Anlegen erst nach Klick"
  },
  {
    nr: '2158', name: "Am Testtag heisst der Knopf wieder „+“",
    file: 'public/app.js',
    search: "plus.textContent = t('entry.dayTagsOpen');",
    replacement: "plus.textContent = '+';",
    expected: "Eintrag: Tags am Testtag mit „+ Tags“, Sterne und ✕ zusammen"
  },
  {
    nr: '2159', name: "Sterne und ✕ brechen getrennt um",
    file: 'public/style.css',
    search: ".tend { display: inline-flex; align-items: center; gap: 12px; flex-shrink: 0; white-space: nowrap; }",
    replacement: ".tend { display: inline-flex; align-items: center; gap: 12px; }",
    expected: "Eintrag: Tags am Testtag mit „+ Tags“, Sterne und ✕ zusammen"
  },
  {
    nr: '2160', name: "Ein Name bricht nur nach „_“ um",
    file: 'public/app.js',
    search: "  String(name).split(/(?<=[_.-])/).forEach((part, i) => {",
    replacement: "  String(name).split(/(?<=[_])/).forEach((part, i) => {",
    expected: "Dateien: Namen ohne Trennung mitten im Wort, in der Mitte gekuerzt"
  },
  {
    nr: '2161', name: "Ein zu langer Name wird nicht gekuerzt",
    file: 'public/app.js',
    search: "    .filter(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);",
    replacement: "    .filter(() => false);",
    expected: "Dateien: Namen ohne Trennung mitten im Wort, in der Mitte gekuerzt"
  },
  {
    nr: '2162', name: "Die Angabe des Ordners steht am Telefon neben dem Namen",
    file: 'public/style.css',
    search: "  .afolder-meta { flex: 1 0 100%; margin-left: 46px; }",
    replacement: "",
    expected: "Dateien: Namen ohne Trennung mitten im Wort, in der Mitte gekuerzt"
  },
  {
    nr: '2163', name: "Die Spalte „Typ“ ist wieder 6rem breit",
    file: 'public/style.css',
    search: ".alist { --acols: 32px minmax(0, 1fr) 10.7rem 4.6rem 5.8rem; }",
    replacement: ".alist { --acols: 32px minmax(0, 1fr) 6rem 4.6rem 5.8rem; }",
    expected: "Dateien: Namen ohne Trennung mitten im Wort, in der Mitte gekuerzt"
  },
  {
    nr: '2164', name: "Die Vorschau bleibt ausserhalb des Bilds",
    file: 'public/app.js',
    search: "    previewBox.scrollIntoView?.({ block: 'nearest' });\n",
    replacement: "",
    expected: "Dateien: Vorschau im Bild, zu grosse Datei, Restzeit, Hinweis am Ort, Ruecknahme"
  },
  {
    nr: '2165', name: "Die Grenze steht in MB statt wie an „+“",
    file: 'public/app.js',
    search: "{ name: big.name, size: fmtMb(fileLimit()) })",
    replacement: "{ name: big.name, size: fileLimit() + ' MB' })",
    expected: "Dateien: Vorschau im Bild, zu grosse Datei, Restzeit, Hinweis am Ort, Ruecknahme"
  },
  {
    nr: '2166', name: "Die Upload-Kachel nennt keine Restzeit",
    file: 'public/app.js',
    search: "  if (took < UPLOAD_PACE_MS || moved <= 0) return line;",
    replacement: "  return line;",
    expected: "Dateien: Vorschau im Bild, zu grosse Datei, Restzeit, Hinweis am Ort, Ruecknahme"
  },
  {
    nr: '2167', name: "Der Hinweis zum Bildschirm bleibt unter allen Gruppen",
    file: 'public/app.js',
    search: "      if (home && awake.parentNode !== home) home.appendChild(awake);\n",
    replacement: "",
    expected: "Dateien: Vorschau im Bild, zu grosse Datei, Restzeit, Hinweis am Ort, Ruecknahme"
  },
  {
    nr: '2168', name: "Die Rueckfrage nennt nicht, wer zurueckholt",
    file: 'public/app.js',
    search: "        + (OWNER ? '' : ` ${t('entry.fileRestoreOwner')}`), t('dialog.delete'), 'danger')) return false;",
    replacement: ", t('dialog.delete'), 'danger')) return false;",
    expected: "Dateien: Vorschau im Bild, zu grosse Datei, Restzeit, Hinweis am Ort, Ruecknahme"
  },
  {
    nr: '2169', name: "Die Vorschau zeichnet keinen Abspielkopf",
    file: 'public/app.js',
    search: "    soundWire(boxId.querySelector('.sdeck'), player);\n",
    replacement: "",
    expected: "Audio: Abspielkopf auch in der Vorschau, Vollbild ohne Cover ueber die Breite"
  },
  {
    nr: '2170', name: "Der Abspieler im Vollbild ist wieder 640 px schmal",
    file: 'public/style.css',
    search: "width: calc(100% - 140px); height: 100%; padding: 16px 0; }",
    replacement: "width: calc(100% - 140px); max-width: 640px; height: 100%; padding: 16px 0; }",
    expected: "Audio: Abspielkopf auch in der Vorschau, Vollbild ohne Cover ueber die Breite"
  },
  {
    nr: '2171', name: "Die Meldung steht wieder mit translateX in der Mitte",
    file: 'public/style.css',
    search: ".toast { position: fixed; bottom: calc(22px + env(safe-area-inset-bottom)); left: 16px; right: 16px; margin: 0 auto; width: fit-content;",
    replacement: ".toast { position: fixed; bottom: calc(22px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%);",
    expected: "Meldungen: ueber die Breite, oben ueber einem Dialog, Fehler bis ✕"
  },
  {
    nr: '2172', name: "Ueber einem Dialog steht die Meldung unten",
    file: 'public/app.js',
    search: "    + (document.querySelector('.backdrop') ? ' top' : '');",
    replacement: "    + '';",
    expected: "Meldungen: ueber die Breite, oben ueber einem Dialog, Fehler bis ✕"
  },
  {
    nr: '2173', name: "Meldungen bleiben beim Wechsel der Ansicht stehen",
    file: 'public/app.js',
    search: "  document.querySelectorAll('.toast').forEach(el => { if (el.dataset.view !== viewKey(h)) el.remove(); });\n",
    replacement: "",
    expected: "Meldungen: ueber die Breite, oben ueber einem Dialog, Fehler bis ✕"
  },
  {
    nr: '2174', name: "Jede Meldung steht 2,6 s",
    file: 'public/app.js',
    search: "    : Math.min(TOAST_MS.max, Math.max(TOAST_MS.min, String(msg).length * TOAST_MS.perSign));",
    replacement: "    : TOAST_MS.min;",
    expected: "Meldungen: ueber die Breite, oben ueber einem Dialog, Fehler bis ✕"
  },
  {
    nr: '2175', name: "Ein Fehler verschwindet nach Ablauf und traegt kein ✕",
    file: 'public/app.js',
    search: "  if (isErr) {\n    const x = document.createElement('button');",
    replacement: "  if (false) {\n    const x = document.createElement('button');",
    expected: "Meldungen: ueber die Breite, oben ueber einem Dialog, Fehler bis ✕"
  },
  {
    nr: '2176', name: "Der Hinweis zum Bildausschnitt ist wieder eine Meldung",
    file: 'public/app.js',
    search: "      v.insertAdjacentHTML('afterend', `<p class=\"hint hint-sm\" id=\"crop-hint\">${tH('entry.cropHint')}</p>`);",
    replacement: "      toast(t('entry.cropHint'));",
    expected: "Meldungen: ueber die Breite, oben ueber einem Dialog, Fehler bis ✕"
  },
  {
    nr: '2177', name: "Ein fehlender Titel ist eine Meldung statt einer Zeile am Feld",
    file: 'public/app.js',
    search: "    if (!title) return fieldError(nt, t('list.titleMissing'));",
    replacement: "    if (!title) return toast(t('list.titleMissing'), true);",
    expected: "Dialoge: Fehler stehen am Feld"
  },
  {
    nr: '2178', name: "Das Feld mit Fehler ist nicht rot umrandet",
    file: 'public/style.css',
    search: ".input.bad, .input.bad:focus { border-color: var(--red); box-shadow: 0 0 0 3px var(--red-dim); }",
    replacement: "",
    expected: "Dialoge: Fehler stehen am Feld"
  },
  {
    nr: '2179', name: "Ein Fehler beim Speichern schliesst den Dialog",
    file: 'public/app.js',
    search: "      else if (error) fieldError(field, error);",
    replacement: "      else if (error) { toast(error, true); done(null); }",
    expected: "Dialoge: Fehler stehen am Feld"
  },
  {
    nr: '2180', name: "Der Ordner meldet seinen Fehler als Meldung",
    file: 'public/app.js',
    search: "        else fieldError(field, result);",
    replacement: "        else toast(result, true);",
    expected: "Dialoge: Fehler stehen am Feld"
  },
  {
    nr: '2181', name: "Auf der Anmeldeseite fehlt „Passwort vergessen?“",
    file: 'public/app.js',
    search: "    <p class=\"sub login-forgot\">${tH('login.forgotHint')}</p>\n",
    replacement: "",
    expected: "Anmeldung: Hinweis, Sperre mit Zaehler, Einladung, Abmelden in der Vorgabesprache"
  },
  {
    nr: '2182', name: "Die Sperre zaehlt nicht herunter",
    file: 'public/app.js',
    search: "      if (box) box.textContent = t('login.throttledWait', { wait: waitText(left) });",
    replacement: "",
    expected: "Anmeldung: Hinweis, Sperre mit Zaehler, Einladung, Abmelden in der Vorgabesprache"
  },
  {
    nr: '2183', name: "„Anmelden“ bleibt waehrend der Sperre frei",
    file: 'public/app.js',
    search: "    b.disabled = true;\n    const tick = () => {",
    replacement: "    const tick = () => {",
    expected: "Anmeldung: Hinweis, Sperre mit Zaehler, Einladung, Abmelden in der Vorgabesprache"
  },
  {
    nr: '2184', name: "Die Meldung der Sperre nennt das Netz nicht",
    file: 'public/languages/de.json',
    search: "  \"server.throttled\": \"Zu viele Fehlversuche aus diesem Netz; die Sperre gilt für alle Geräte darin. Bitte in {wait} erneut versuchen.\",",
    replacement: "  \"server.throttled\": \"Zu viele Fehlversuche. Bitte in {wait} erneut versuchen.\",",
    expected: "Einrichtung: Sprache wird Vorgabe und Sprache des Accounts, Kriterien in ihr; Sperre je Netz"
  },
  {
    nr: '2185', name: "Die Antwort der Sperre traegt keine Sekunden",
    file: 'server.js',
    search: "  error: t(localeOf(req), 'server.throttled', { wait: waitWords(localeOf(req), throttle.retryInSec) }),\n  retryIn: throttle.retryInSec });",
    replacement: "  error: t(localeOf(req), 'server.throttled', { wait: waitWords(localeOf(req), throttle.retryInSec) }) });",
    expected: "Einrichtung: Sprache wird Vorgabe und Sprache des Accounts, Kriterien in ihr; Sperre je Netz"
  },
  {
    nr: '2186', name: "Die Einladung nennt Abmelden und „Passwort vergessen?“",
    file: 'public/app.js',
    search: "        ${status.withoutPassword ? '' : `<br>${tH('login.logoutHint')}<br>${tH('login.forgotHint')}`}</p>",
    replacement: "        <br>${tH('login.logoutHint')}<br>${tH('login.forgotHint')}</p>",
    expected: "Anmeldung: Hinweis, Sperre mit Zaehler, Einladung, Abmelden in der Vorgabesprache"
  },
  {
    nr: '2187', name: "Der Name in der Einladung ist beschreibbar",
    file: 'public/app.js',
    search: "autocomplete=\"username\" value=\"${esc(status.username || '')}\" readonly>",
    replacement: "autocomplete=\"username\" value=\"${esc(status.username || '')}\">",
    expected: "Anmeldung: Hinweis, Sperre mit Zaehler, Einladung, Abmelden in der Vorgabesprache"
  },
  {
    nr: '2188', name: "Nach dem Abmelden bleibt das Vokabular des Accounts",
    file: 'public/app.js',
    search: "    V = {};\n    await loadLanguages(LANGUAGE_DEFAULT);",
    replacement: "    await loadLanguages(LANGUAGE_DEFAULT);",
    expected: "Anmeldung: Hinweis, Sperre mit Zaehler, Einladung, Abmelden in der Vorgabesprache"
  },
  {
    nr: '2189', name: "Ein schon benutzter Code heisst wieder „stimmt nicht“",
    file: 'auth.js',
    search: "    ? 'login.codeUsed' : TWO_FACTOR_DENIAL;",
    replacement: "    ? TWO_FACTOR_DENIAL : TWO_FACTOR_DENIAL;",
    expected: "Server: Titel „Kriterion“, schon verwendeter Code, Englisch klein mitten im Satz"
  },
  {
    nr: '2190', name: "Eine neue Installation heisst wieder „Bewertungskatalog“",
    file: 'db.js',
    search: "const TITLE_DEFAULT = 'Kriterion';",
    replacement: "const TITLE_DEFAULT = 'Bewertungskatalog';",
    expected: "Server: Titel „Kriterion“, schon verwendeter Code, Englisch klein mitten im Satz"
  },
  {
    nr: '2191', name: "/api/config nennt vor der Einrichtung keine Sprachen",
    file: 'server.js',
    search: "    language: languageDefault(),\n    ...(setupRequired ? { languages: LANGUAGE_CODES.map(code => ({ code, name: languageName(code) })) } : {})",
    replacement: "    language: languageDefault()",
    expected: "Einrichtung: Sprache wird Vorgabe und Sprache des Accounts, Kriterien in ihr; Sperre je Netz"
  },
  {
    nr: '2192', name: "Die Sprache der Einrichtung wird nicht Vorgabesprache",
    file: 'server.js',
    search: "    writeLanguages(language, null);\n",
    replacement: "",
    expected: "Einrichtung: Sprache wird Vorgabe und Sprache des Accounts, Kriterien in ihr; Sperre je Netz"
  },
  {
    nr: '2193', name: "Der erste Account bekommt die Sprache der Einrichtung nicht",
    file: 'server.js',
    search: "    putUserSetting(created.id, 'language', JSON.stringify(language));\n",
    replacement: "",
    expected: "Einrichtung: Sprache wird Vorgabe und Sprache des Accounts, Kriterien in ihr; Sperre je Netz"
  },
  {
    nr: '2194', name: "Die mitgelieferten Kriterien bleiben englisch",
    file: 'server.js',
    search: "    seedCriteriaIn(language);\n",
    replacement: "",
    expected: "Einrichtung: Sprache wird Vorgabe und Sprache des Accounts, Kriterien in ihr; Sperre je Netz"
  },
  {
    nr: '2195', name: "Die Einrichtung waehlt die Sprache des Browsers nicht vor",
    file: 'public/app.js',
    search: "  if (setupNeeded) SETUP_LANGUAGE = browserLanguage(SETUP_LANGUAGES.map(l => l.code)) || LANGUAGE_DEFAULT;",
    replacement: "  if (setupNeeded) SETUP_LANGUAGE = LANGUAGE_DEFAULT;",
    expected: "Einrichtung: Sprache aus dem Browser, Leiste oder Auswahlliste"
  },
  {
    nr: '2196', name: "Die Wahl geht nicht an den Server",
    file: 'public/app.js',
    search: "body: JSON.stringify({ user: u.value, password: p1.value, ...(SETUP_LANGUAGE ? { language: SETUP_LANGUAGE } : {}) })",
    replacement: "body: JSON.stringify({ user: u.value, password: p1.value })",
    expected: "Einrichtung: Sprache aus dem Browser, Leiste oder Auswahlliste"
  },
  {
    nr: '2197', name: "Beim Laden verschwindet auch die Kopfzeile",
    file: 'public/app.js',
    search: "    [...shell.children].forEach(el => { if (!el.matches('.masthead')) el.remove(); });",
    replacement: "    [...shell.children].forEach(el => el.remove());",
    expected: "Laden: alter Inhalt bleibt stehen, „Lädt …“ erst nach 300 ms unter der Kopfzeile"
  },
  {
    nr: '2198', name: "„Lädt …“ ersetzt sofort den alten Inhalt",
    file: 'public/app.js',
    search: "  if (!app.firstElementChild) { app.innerHTML = `<div class=\"shell\">${loading}</div>`; return; }",
    replacement: "  app.innerHTML = `<div class=\"shell\">${loading}</div>`; return;",
    expected: "Laden: alter Inhalt bleibt stehen, „Lädt …“ erst nach 300 ms unter der Kopfzeile"
  },
  {
    nr: '2199', name: "Englisch heisst es wieder „Searching …“",
    file: 'public/languages/en.json',
    search: "  \"list.searching\": \"Search …\",",
    replacement: "  \"list.searching\": \"Searching …\",",
    expected: "Sprachen: Englisch klein mitten im Satz, Beschriftungen, Suchen, Hinweise"
  },
  {
    nr: '2200', name: "Englisch steht die Vokabel mitten im Satz gross",
    file: 'public/app.js',
    search: "    if (lower && V && V[name] === value && vocabularyInside(all, at))",
    replacement: "    if (false)",
    expected: "Sprachen: Englisch klein mitten im Satz, Beschriftungen, Suchen, Hinweise"
  },
  {
    nr: '2201', name: "Der Server setzt die Vokabel mitten im Satz gross",
    file: 'server.js',
    search: "    return localeTag(locale).startsWith('en') && ",
    replacement: "    return false && ",
    expected: "Server: Titel „Kriterion“, schon verwendeter Code, Englisch klein mitten im Satz"
  },
  {
    nr: '2202', name: "Die Kennzahlen leihen sich die Woerter des Dialogs",
    file: 'public/app.js',
    search: "tH('card.statComments')",
    replacement: "tH('dialog.comments')",
    expected: "Sprachen: Englisch klein mitten im Satz, Beschriftungen, Suchen, Hinweise"
  },
  {
    nr: '2203', name: "Der leere Bestand nennt die Bewertung ohne „Getestet“",
    file: 'public/languages/de.json',
    search: "  \"list.emptyHint\": \"Mit „+ {entryOne}“ anlegen. Fotos und Kategorie lassen sich danach ergänzen, {ratingOne} und {dayMany} nach „{testedYes}“.\",",
    replacement: "  \"list.emptyHint\": \"Mit „+ {entryOne}“ anlegen. Fotos, Kategorie, {ratingOne} und {dayMany} lassen sich danach ergänzen.\",",
    expected: "Sprachen: Englisch klein mitten im Satz, Beschriftungen, Suchen, Hinweise"
  },
  {
    nr: '2204', name: "„Lädt …“ ersetzt auch einen schon gezeichneten Eintrag",
    file: 'public/app.js',
    search: "    if (run !== VIEW_RUN || !shell || app.firstElementChild !== old) return;",
    replacement: "    if (run !== VIEW_RUN || !shell) return;",
    expected: "Laden: alter Inhalt bleibt stehen, „Lädt …“ erst nach 300 ms unter der Kopfzeile"
  },
  {
    nr: '2205', name: "Nach Ablauf der Sperre bleibt „Anmelden“ gesperrt",
    file: 'public/app.js',
    search: "      if (rest <= 0) { box?.remove(); b.disabled = false; return; }",
    replacement: "      if (rest <= 0) { box?.remove(); return; }",
    expected: "Anmeldung: Hinweis, Sperre mit Zaehler, Einladung, Abmelden in der Vorgabesprache"
  },
  {
    nr: '2206', name: "Die Reiter der Einstellungen klappen auch am Tablett ein",
    file: 'public/style.css',
    search: "  .filter-toggle { display: inline-flex; }\n  .filters.closed { display: none; }\n}",
    replacement: "  .filter-toggle { display: inline-flex; }\n  .sys-toggle { display: inline-flex; }\n  .filters.closed, .sys-tabs.closed { display: none; }\n}",
    expected: "Einstellungen: Reiter am Tablett offen, „Abschnitte“ nur am Telefon"
  },
  {
    nr: '2207', name: "Der Satz zur Adresse fehlt unter dem Feld E-Mail",
    file: 'public/app.js',
    search: "            placeholder=\"${esc(t('card.noneStoredYet'))}\"></div>\n        ${setting('', tH('card.resetMailHint'), SIGNUP ? tH('card.addressRequiredHint') : '')}\n",
    replacement: "            placeholder=\"${esc(t('card.noneStoredYet'))}\"></div>\n",
    expected: "Mein Account: Satz zur Adresse am Feld, „Speichern“ unter den Passwortfeldern"
  },
  {
    nr: '2208', name: "„Speichern“ steht wieder unter dem Kasten „Auf dem Server“",
    file: 'public/app.js',
    search: "        <button class=\"btn btn-accent btn-sm\" id=\"pw-save\">${tH('dialog.save')}</button>\n        <div class=\"acc-after\">${serverBox(t('card.forgotPasswordHint'), 'docker compose exec kriterion node usertool.js password <name>') ||\n          `<p class=\"desc\">${tH('card.passwordAskAdmin')}</p>`}</div>\n",
    replacement: "        <div class=\"acc-after\">${serverBox(t('card.forgotPasswordHint'), 'docker compose exec kriterion node usertool.js password <name>') ||\n          `<p class=\"desc\">${tH('card.passwordAskAdmin')}</p>`}</div>\n        <button class=\"btn btn-accent btn-sm\" id=\"pw-save\">${tH('dialog.save')}</button>\n",
    expected: "Mein Account: Satz zur Adresse am Feld, „Speichern“ unter den Passwortfeldern"
  },
  {
    nr: '2209', name: "Unter den Wiederherstellungscodes fehlt „Alle kopieren“",
    file: 'public/app.js',
    search: "      <button type=\"button\" class=\"btn btn-sm codes-copy\" data-copy=\"${esc(codes.join('\\n'))}\">${tH('card.copyAll')}</button>\n",
    replacement: "",
    expected: "Zweiter Faktor: „Alle kopieren“ unter den Codes"
  },
  {
    nr: '2210', name: "Die Reihen der Karte „Darstellung“ bleiben lose Pillen",
    file: 'public/app.js',
    search: "    fitBar(box);\n  };\n  draw();\n}",
    replacement: "  };\n  draw();\n}",
    expected: "Darstellung: alle Reihen als Leisten, Zahlen ohne Einheit"
  },
  {
    nr: '2211', name: "„Bildstreifen“ nennt „px“ wieder in jedem Feld",
    file: 'public/app.js',
    search: "get: () => STRIP, set: v => { STRIP = v; }, label: v => String(v),",
    replacement: "get: () => STRIP, set: v => { STRIP = v; }, label: v => v + ' px',",
    expected: "Darstellung: alle Reihen als Leisten, Zahlen ohne Einheit"
  },
  {
    nr: '2212', name: "„Suchmaschinen“ nennt wieder „Namen“ im Feld",
    file: 'public/app.js',
    search: "get: () => SEARCH_NAMES, set: v => { SEARCH_NAMES = v; }, label: v => String(v),",
    replacement: "get: () => SEARCH_NAMES, set: v => { SEARCH_NAMES = v; }, label: v => v + ' Namen',",
    expected: "Darstellung: alle Reihen als Leisten, Zahlen ohne Einheit"
  },
  {
    nr: '2213', name: "Eine zu breite Leiste bleibt eine Leiste",
    file: 'public/app.js',
    search: "  if (list) { box.hidden = true; list.hidden = false; }\n  else box.classList.remove('seg');\n}",
    replacement: "  if (list) { box.hidden = true; list.hidden = false; }\n}",
    expected: "Darstellung: passt eine Leiste nicht, umbrechende Pillen; die Sprache als Auswahlliste"
  },
  {
    nr: '2214', name: "Die Sprache faellt nicht auf die Auswahlliste zurueck",
    file: 'public/app.js',
    search: "  if (list) { box.hidden = true; list.hidden = false; }\n  else box.classList.remove('seg');\n}",
    replacement: "  box.classList.remove('seg');\n}",
    expected: "Darstellung: passt eine Leiste nicht, umbrechende Pillen; die Sprache als Auswahlliste"
  },
  {
    nr: '2215', name: "Nach der Schriftgröße werden die Leisten nicht neu geprueft",
    file: 'public/app.js',
    search: "apply: () => { applyFont(); refitBars(); }, key: 'font'",
    replacement: "apply: applyFont, key: 'font'",
    expected: "Darstellung: passt eine Leiste nicht, umbrechende Pillen; die Sprache als Auswahlliste"
  },
  {
    nr: '2216', name: "Der Wechsel der Sprache springt wieder nach oben",
    file: 'public/app.js',
    search: "        await renderSystem({ keepScroll: true });\n        // Die Karten davor aendern mit der Sprache ihre Hoehe.\n",
    replacement: "        await renderSystem();\n        // Die Karten davor aendern mit der Sprache ihre Hoehe.\n",
    expected: "Darstellung: nach dem Wechsel der Sprache bleibt die Karte an ihrer Stelle"
  },
  {
    nr: '2217', name: "Die Karte „Darstellung“ wird nach dem Wechsel nicht an ihre Stelle gerollt",
    file: 'public/app.js',
    search: "        if (card && again) window.scrollBy(0, again.getBoundingClientRect().top - top);\n",
    replacement: "",
    expected: "Darstellung: nach dem Wechsel der Sprache bleibt die Karte an ihrer Stelle"
  },
  {
    nr: '2218', name: "„Farbschema“ unter „Dokumente“ hat wieder die langen Texte",
    file: 'public/languages/de.json',
    search: "\"card.documentsThemeLight\": \"Hell\",",
    replacement: "\"card.documentsThemeLight\": \"Modern Hell\",",
    expected: "Dokumente: „Kriterion · Hell · Dunkel“ und „Nur ich · Alle“"
  },
  {
    nr: '2219', name: "„Nur ich · Alle“ steht vertauscht",
    file: 'public/app.js',
    search: "label: v => t(v ? 'card.editEveryone' : 'card.editOnlyMe'),\n    key: 'filesEditAll'",
    replacement: "label: v => t(v ? 'card.editOnlyMe' : 'card.editEveryone'),\n    key: 'filesEditAll'",
    expected: "Dokumente: „Kriterion · Hell · Dunkel“ und „Nur ich · Alle“"
  },
  {
    nr: '2220', name: "Die Leiste unter „Installation“ schreibt die eigene Vorgabe",
    file: 'public/app.js',
    search: "key: 'documentEditAll', mark: true });",
    replacement: "key: 'filesEditAll', mark: true });",
    expected: "Dokumente: „Kriterion · Hell · Dunkel“ und „Nur ich · Alle“"
  },
  {
    nr: '2221', name: "Ein offener Aufklapper schliesst sich beim Messen",
    file: 'public/app.js',
    search: "    else box.open = wasOpen;",
    replacement: "    else box.open = false;",
    expected: "„Mehr“: ab drei Zeilen hinter dem Knopf, darunter direkt, neu gemessen bei anderer Breite"
  },
  {
    nr: '2222', name: "„★ Favoriten“ steht wieder vor „Ablehnung“",
    file: 'public/app.js',
    search: "  bFav.onclick = () => { f.favorite = !f.favorite; redraw(); };\n  r1.appendChild(bFav);",
    replacement: "  bFav.onclick = () => { f.favorite = !f.favorite; redraw(); };\n  r1.insertBefore(bFav, r1.querySelector('.fgroup'));",
    expected: "Filterleiste: „★ Favoriten“ am Ende der Statuszeile"
  },
  {
    nr: '2223', name: "Am Telefon rutscht „★ Favoriten“ unter die letzte Leiste",
    file: 'public/style.css',
    search: "  .fgroup:has(+ .pill-fav) > .pills { grid-column: 2; }\n",
    replacement: "",
    expected: "Filterleiste: „★ Favoriten“ am Ende der Statuszeile"
  },
  {
    nr: '2224', name: "Die beiden Worte stehen nebeneinander statt übereinander",
    file: 'public/style.css',
    search: ".sort-flip > span { grid-area: 1 / 1; text-align: center; }\n",
    replacement: "",
    expected: "Sortieren: Richtung als ein Knopf in der Übersicht und unter „Dateien“"
  },
  {
    nr: '2225', name: "Der Knopf zeigt das Wort der anderen Richtung",
    file: 'public/app.js',
    search: "[[false, downText], [true, upText]]",
    replacement: "[[true, downText], [false, upText]]",
    expected: "Sortieren: Richtung als ein Knopf in der Übersicht und unter „Dateien“"
  },
  {
    nr: '2226', name: "Ein Klick kehrt die Richtung nicht um",
    file: 'public/app.js',
    search: "  b.onclick = () => pick(!asc);",
    replacement: "  b.onclick = () => pick(asc);",
    expected: "Sortieren: Richtung als ein Knopf in der Übersicht und unter „Dateien“"
  },
  {
    nr: '2227', name: "Unter „Dateien“ fehlt der Knopf",
    file: 'public/app.js',
    search: "    fillSortWay(sortDir, t(s.down), t(s.up), FILES_SORT.asc, (asc) => takeFilesSort(FILES_SORT.key, asc));",
    replacement: "    sortDir.textContent = way;",
    expected: "Sortieren: Richtung als ein Knopf in der Übersicht und unter „Dateien“"
  },
  {
    nr: '2228', name: "Auswahlliste und Richtung kleben wieder aneinander",
    file: 'public/style.css',
    search: ".sort-pair { display: flex; align-items: center; gap: 8px; min-width: 0; }",
    replacement: ".sort-pair { display: flex; align-items: stretch; min-width: 0; }",
    expected: "Sortieren: Richtung als ein Knopf in der Übersicht und unter „Dateien“"
  },
  {
    nr: '2229', name: "Vor der Leiste der Sprachen fehlt „Namen in:“",
    file: 'public/app.js',
    search: "<span class=\"eyebrow\">${tH(words ? 'card.wordsIn' : 'card.namesIn')}</span>",
    replacement: "",
    expected: "Bestand: „Namen in:“ vor der Leiste, die Zahl erklaert; die Sprache gilt nur in den Einstellungen"
  },
  {
    nr: '2230', name: "Die Sprachen der Namen bleiben lose Pillen",
    file: 'public/app.js',
    search: "function languageBar(box) {\n  if (box.children.length > BAR_MAX) return;\n  box.dataset.bar = '';\n  fitBar(box);\n}",
    replacement: "function languageBar(box) {\n  if (box.children.length > BAR_MAX) return;\n}",
    expected: "Bestand: „Namen in:“ vor der Leiste, die Zahl erklaert; die Sprache gilt nur in den Einstellungen"
  },
  {
    nr: '2231', name: "Umbenennen in einer anderen Sprache nennt die Sprache nicht",
    file: 'public/app.js',
    search: "toast(other ? t('card.renamedIn', { language: other.name }) : t('card.renamed'));",
    replacement: "toast(t('card.renamed'));",
    expected: "Bestand: „Namen in:“ vor der Leiste, die Zahl erklaert; die Sprache gilt nur in den Einstellungen"
  },
  {
    nr: '2232', name: "Die Sprache der Namen gilt auch ausserhalb der Einstellungen",
    file: 'public/app.js',
    search: "  if (!h.startsWith('#/system')) NAMES_SHOWN = null;\n",
    replacement: "",
    expected: "Bestand: „Namen in:“ vor der Leiste, die Zahl erklaert; die Sprache gilt nur in den Einstellungen"
  },
  {
    nr: '2233', name: "Die Zahlen in den Listen stehen wieder ohne Wort",
    file: 'public/app.js',
    search: "        ${countCell(spec.counter ? spec.counter(entry) : `${entry.usage_count} ${vThing(entry.usage_count)}`)}",
    replacement: "        ${countCell(String(entry.usage_count))}",
    expected: "Bestand: Zahlen mit Wort, „Gewicht“ ueber der Spalte, zwei Zeilen bei Platzmangel"
  },
  {
    nr: '2234', name: "Vor dem Gewichtsfeld steht wieder „×“",
    file: 'public/app.js',
    search: "? `<span class=\"mweight\" title=\"${esc(t('list.weightedAvg'))}\"><input class=\"mweight-field\"",
    replacement: "? `<span class=\"mweight\" title=\"${esc(t('list.weightedAvg'))}\">×<input class=\"mweight-field\"",
    expected: "Bestand: Zahlen mit Wort, „Gewicht“ ueber der Spalte, zwei Zeilen bei Platzmangel"
  },
  {
    nr: '2235', name: "Ueber den Gewichten fehlt „Gewicht“",
    file: 'public/app.js',
    search: "    if (spec.weight) box.insertAdjacentHTML('beforeend', `<div class=\"mhead\"",
    replacement: "    if (spec.none) box.insertAdjacentHTML('beforeend', `<div class=\"mhead\"",
    expected: "Bestand: Zahlen mit Wort, „Gewicht“ ueber der Spalte, zwei Zeilen bei Platzmangel"
  },
  {
    nr: '2236', name: "Lange Kriteriennamen werden wieder gekuerzt statt umgebrochen",
    file: 'public/style.css',
    search: ".mrow.mline { flex-wrap: wrap; row-gap: 3px; }",
    replacement: ".mrow.mline { flex-wrap: nowrap; row-gap: 3px; }",
    expected: "Bestand: Zahlen mit Wort, „Gewicht“ ueber der Spalte, zwei Zeilen bei Platzmangel"
  },
  {
    nr: '2237', name: "Ein vorhandener Name gilt als neu angelegt",
    file: 'public/app.js',
    search: "        if (made?.existed) return nameTaken(field, made, kind === 'cat' ? 'mcats' : 'mtags');\n",
    replacement: "",
    expected: "Bestand: ein vorhandener Name und ein leeres Feld melden sich am Feld"
  },
  {
    nr: '2238', name: "Ein leeres Feld schweigt",
    file: 'public/app.js',
    search: "      if (!name) return fieldError(field, t('server.nameMissing'));\n      /* Ohne Sprache:",
    replacement: "      if (!name) return;\n      /* Ohne Sprache:",
    expected: "Bestand: ein vorhandener Name und ein leeres Feld melden sich am Feld"
  },
  {
    nr: '2239', name: "Der Server meldet eine vorhandene Kategorie nicht",
    file: 'server.js',
    search: "  if (found) return res.json({ ...found, existed: true });\n  // Erst nach dem Nachschlagen",
    replacement: "  if (found) return res.json(found);\n  // Erst nach dem Nachschlagen",
    expected: "Server: ein vorhandener Name kommt mit `existed` zurueck"
  },
  {
    nr: '2240', name: "Der Server meldet einen vorhandenen Tag nicht",
    file: 'server.js',
    search: "  const found = findTag(name);\n  if (found) return res.json({ ...found, existed: true });",
    replacement: "  const found = findTag(name);\n  if (found) return res.json(found);",
    expected: "Server: ein vorhandener Name kommt mit `existed` zurueck"
  },
  {
    nr: '2241', name: "Der Satz unter der Schwelle nennt nicht beide",
    file: 'public/languages/de.json',
    search: "\"card.partialShareMore\": \"Gilt für {ratingOne} und {potential}.\",",
    replacement: "\"card.partialShareMore\": \"Ein Wert für {potential} und {ratingOne}.\",",
    expected: "Kriterien: die Schwelle steht nur unter „Bewertung“, „Gewicht“ unter „Potenzial“ verweist darauf"
  },
  {
    nr: '2242', name: "„Gewicht“ unter „Potenzial“ erklaert alles noch einmal",
    file: 'public/app.js',
    search: "tH('card.weightSeeRating', { card: t('card.criteriaLabel', { label: V.ratingOne }) })",
    replacement: "tH('card.weightExplainHint')",
    expected: "Kriterien: die Schwelle steht nur unter „Bewertung“, „Gewicht“ unter „Potenzial“ verweist darauf"
  },
  {
    nr: '2243', name: "Der Satz zum Modus sagt wieder „Schätzung“",
    file: 'public/languages/de.json',
    search: "\"card.potentialModeHint\": \"Ist der Modus aus, verschwindet „{potential}“ überall",
    replacement: "\"card.potentialModeHint\": \"Ist der Modus aus, verschwindet die Schätzung überall",
    expected: "Kriterien: die Schwelle steht nur unter „Bewertung“, „Gewicht“ unter „Potenzial“ verweist darauf"
  },
  {
    nr: '2244', name: "„Nur Admins · Jeder“ steht vertauscht",
    file: 'public/app.js',
    search: "label: v => t(v ? 'card.everyone' : 'card.onlyAdmins'), key, mark: true });",
    replacement: "label: v => t(v ? 'card.onlyAdmins' : 'card.everyone'), key, mark: true });",
    expected: "Neue Kategorien und Tags: Leiste „Nur Admins · Jeder“"
  },
  {
    nr: '2245', name: "Der Satz zu neuen Kategorien erklaert wieder das Haekchen",
    file: 'public/languages/de.json',
    search: "\"card.adminOnlyCategory\": \"Wer neue Kategorien anlegen darf.\",",
    replacement: "\"card.adminOnlyCategory\": \"Mit Häkchen legt jeder neue Kategorien an; ohne Häkchen nur Admins.\",",
    expected: "Neue Kategorien und Tags: Leiste „Nur Admins · Jeder“"
  },
  {
    nr: '2246', name: "Nach dem Anlegen bleibt die Rolle stehen",
    file: 'public/app.js',
    search: "      if (roleField) roleField.value = 'user';\n",
    replacement: "",
    expected: "Neuer Benutzer: „Erstes Passwort“ als Leiste, danach wieder die Vorgabe"
  },
  {
    nr: '2247', name: "Nach dem Anlegen bleibt die Art des Passworts stehen",
    file: 'public/app.js',
    search: "      userKindSet('link');\n",
    replacement: "",
    expected: "Neuer Benutzer: „Erstes Passwort“ als Leiste, danach wieder die Vorgabe"
  },
  {
    nr: '2248', name: "Der Linkkasten des vorigen Benutzers bleibt stehen",
    file: 'public/app.js',
    search: "    document.getElementById('user-link')?.replaceChildren();\n",
    replacement: "",
    expected: "Neuer Benutzer: „Erstes Passwort“ als Leiste, danach wieder die Vorgabe"
  },
  {
    nr: '2249', name: "Die Leiste traegt wieder den langen Satz",
    file: 'public/languages/de.json',
    search: "\"card.kindPassword\": \"Passwort vergeben\",",
    replacement: "\"card.kindPassword\": \"Ich vergebe das erste Passwort\",",
    expected: "Neuer Benutzer: „Erstes Passwort“ als Leiste, danach wieder die Vorgabe"
  },
  {
    nr: '2250', name: "Nach dem Sperren meldet das Statuswort „gesperrt“",
    file: 'public/app.js',
    search: "t('card.lockedToast')",
    replacement: "t('card.locked')",
    expected: "Neuer Benutzer: „Erstes Passwort“ als Leiste, danach wieder die Vorgabe"
  },
  {
    nr: '2251', name: "Der Eigentuemer-Admin liest, dass der Eigentuemer-Admin den Mailzugang einrichtet",
    file: 'server.js',
    search: "if (!mail.configured(raw)) return { ok: false, key: self ? 'server.noAccountSelf' : 'server.noAccountOwner' };",
    replacement: "if (!mail.configured(raw)) return { ok: false, key: 'server.noAccountOwner' };",
    expected: "Server: Saetze fuer den Eigentuemer-Admin, neue eigene Suchmaschine zur Wahl, Backup in Ortszeit"
  },
  {
    nr: '2252', name: "„Anfragen“ fragt nicht, wer liest",
    file: 'server.js',
    search: "  res.json(requestCard(localeOf(req), isOwner(req)));\n});\n\napp.put('/api/signup/toggle'",
    replacement: "  res.json(requestCard(localeOf(req)));\n});\n\napp.put('/api/signup/toggle'",
    expected: "Server: Saetze fuer den Eigentuemer-Admin, neue eigene Suchmaschine zur Wahl, Backup in Ortszeit"
  },
  {
    nr: '2253', name: "Eine neue eigene Suchmaschine steht nicht zur Wahl",
    file: 'server.js',
    search: "        writePool(pool[0], [...pool, ...fresh]);",
    replacement: "        writePool(pool[0], pool);",
    expected: "Server: Saetze fuer den Eigentuemer-Admin, neue eigene Suchmaschine zur Wahl, Backup in Ortszeit"
  },
  {
    nr: '2254', name: "Backups heissen wieder nach UTC",
    file: 'backup.js',
    search: "  const file = path.join(folder, `kriterion-${backupMark()}.sqlite`);",
    replacement: "  const file = path.join(folder, `kriterion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.sqlite`);",
    expected: "Server: Saetze fuer den Eigentuemer-Admin, neue eigene Suchmaschine zur Wahl, Backup in Ortszeit"
  },
  {
    nr: '2255', name: "Eine abgelehnte Verbindung bleibt ohne Satz",
    file: 'mail.js',
    search: "  [/ECONNREFUSED/, 'mail.errRefused'],",
    replacement: "  [/ECONNREFUSED_NIE/, 'mail.errRefused'],",
    expected: "Mailversand: bekannte Fehler als Satz, die Meldung des Servers bleibt dabei"
  },
  {
    nr: '2256', name: "Mit dem Satz faellt die Meldung des Servers weg",
    file: 'mail.js',
    search: "  return { reasonKey: known ? known[1] : '', reason: raw.length > 120 ? raw.slice(0, 117) + '…' : raw };",
    replacement: "  return known ? { reasonKey: known[1], reason: '' } : { reasonKey: '', reason: raw.length > 120 ? raw.slice(0, 117) + '…' : raw };",
    expected: "Mailversand: bekannte Fehler als Satz, die Meldung des Servers bleibt dabei"
  },
  {
    nr: '2257', name: "Unter dem Satz fehlt die Meldung des Servers",
    file: 'public/app.js',
    search: "${detail ? `<small class=\"mail-detail\">${esc(detail)}</small>` : ''}",
    replacement: "",
    expected: "Mailversand: unter dem Satz zum Fehlschlag steht die Meldung des Servers"
  },
  {
    nr: '2258', name: "Ohne PNG steht kein Grund unter dem gesperrten Knopf",
    file: 'public/app.js',
    search: "!png ? tH('card.pngNone') :",
    replacement: "!png ? '' :",
    expected: "Bildformate: der gesperrte Knopf nennt den Grund; „Standard“ als Auswahlpunkt"
  },
  {
    nr: '2259', name: "Die Ablage zeigt wieder „Standard“ in jeder Zeile",
    file: 'public/app.js',
    search: "${attrs}><span class=\"sdot\"></span></button>`;",
    replacement: "${attrs}>${tH('card.standard')}</button>`;",
    expected: "Bildformate: der gesperrte Knopf nennt den Grund; „Standard“ als Auswahlpunkt"
  },
  {
    nr: '2260', name: "Ueber den Ablagen fehlt der Kopf „Standard“",
    file: 'public/app.js',
    search: "${defaultHead(false)}${IMAGE_STORES.map(k => {",
    replacement: "${IMAGE_STORES.map(k => {",
    expected: "Bildformate: der gesperrte Knopf nennt den Grund; „Standard“ als Auswahlpunkt"
  },
  {
    nr: '2261', name: "„WebP verlustfrei“ heisst wieder „Vorgabe“",
    file: 'public/languages/de.json',
    search: "\"card.storeLosslessHint\": \"verlustfrei, gemessen rund zwei Drittel kleiner\",",
    replacement: "\"card.storeLosslessHint\": \"Vorgabe — verlustfrei, gemessen rund zwei Drittel kleiner\",",
    expected: "Bildformate: der gesperrte Knopf nennt den Grund; „Standard“ als Auswahlpunkt"
  },
  {
    nr: '2262', name: "Ueber den Sprachen fehlt der Kopf „Standard“",
    file: 'public/app.js',
    search: "    box.innerHTML = defaultHead(true);\n    LANGUAGES.forEach(a => {",
    replacement: "    box.innerHTML = '';\n    LANGUAGES.forEach(a => {",
    expected: "Sprachen und Suchmaschinen: „Standard“ als Spalte mit Auswahlpunkten; leere Plaetze ohne Punkt"
  },
  {
    nr: '2263', name: "Ein leerer Platz zeigt einen Punkt",
    file: 'public/app.js',
    search: "      st.classList.toggle('none', !a.present);\n",
    replacement: "",
    expected: "Sprachen und Suchmaschinen: „Standard“ als Spalte mit Auswahlpunkten; leere Plaetze ohne Punkt"
  },
  {
    nr: '2264', name: "Der Verweis nennt wieder die Karte „Links“",
    file: 'public/languages/de.json',
    search: "stellt jeder für sich unter „Darstellung“ ein.",
    replacement: "stellt jeder für sich in der Karte „Links“ ein.",
    expected: "Sprachen und Suchmaschinen: „Standard“ als Spalte mit Auswahlpunkten; leere Plaetze ohne Punkt"
  },
  {
    nr: '2265', name: "Das Feld fuer die Adresse ist wieder schmal",
    file: 'public/style.css',
    search: ".engine-slot input[id^=\"se-vorlage\"] { flex: 1 1 100%; min-width: 0; }",
    replacement: ".engine-slot input[id^=\"se-vorlage\"] { flex: 1; min-width: 0; }",
    expected: "Sprachen und Suchmaschinen: „Standard“ als Spalte mit Auswahlpunkten; leere Plaetze ohne Punkt"
  },
  {
    nr: '2266', name: "„Vorschau und Export bis“ steht vor der Grenze fuer Dateien",
    file: 'public/app.js',
    search: "  ['file', 'card.limitFile'], ['attachment', 'card.limitAttachment']];",
    replacement: "  ['attachment', 'card.limitAttachment'], ['file', 'card.limitFile']];",
    expected: "Grenzen beim Hochladen: „Vorschau und Export bis“ unter der Grenze fuer Dateien"
  },
  {
    nr: '2267', name: "„Vorschau und Export bis“ ist wieder eingerueckt",
    file: 'public/app.js',
    search: "return `<div class=\"field numfield\"><div class=\"numfield-text\">",
    replacement: "return `<div class=\"field numfield${kind === 'attachment' ? ' limit-sub' : ''}\"><div class=\"numfield-text\">",
    expected: "Grenzen beim Hochladen: „Vorschau und Export bis“ buendig, mit und ohne Recht"
  },
  {
    nr: '2268', name: "Ein Backup von heute ist „vor 0 Tagen“",
    file: 'public/app.js',
    search: "const ageWords = (n) => (n === 0 ? t('card.today') : n < 2 ? t('card.yesterday') : t('card.daysAgo', { n }));",
    replacement: "const ageWords = (n) => t('card.daysAgo', { n });",
    expected: "Backup: „heute“ und „gestern“, die Einzahl, „nur in diesem Backup“; die Zeile bricht um"
  },
  {
    nr: '2269', name: "Die Dauer des Backups steht immer in der Mehrzahl",
    file: 'public/app.js',
    search: "tH('card.duringBackupHint', { dbBytes: fmtBytes(d.dbBytes), n: d.durationSeconds })",
    replacement: "tH('card.duringBackupHint', { dbBytes: fmtBytes(d.dbBytes), n: 2 })",
    expected: "Backup: „heute“ und „gestern“, die Einzahl, „nur in diesem Backup“; die Zeile bricht um"
  },
  {
    nr: '2270', name: "Die Zeile der Dateien wird wieder gekuerzt",
    file: 'public/style.css',
    search: "  color: var(--faint); }\n#cleanup-list .mrow .mbefore",
    replacement: "  color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n#cleanup-list .mrow .mbefore",
    expected: "Backup: „heute“ und „gestern“, die Einzahl, „nur in diesem Backup“; die Zeile bricht um"
  },
  {
    nr: '2271', name: "Der fette Satz zur Registrierung kommt zurueck",
    file: 'public/app.js',
    search: "        ${setting('', tH('card.signupHint'),\n          `${tH('card.signupHintMore')}",
    replacement: "        ${setting('', `${tH('card.signupHint')}${requests.an ? '' : ` <strong>${tH('card.signupOffNow')}</strong>`}`,\n          `${tH('card.signupHintMore')}",
    expected: "Anfragen: die Registrierung steht nicht dreimal da"
  },
  {
    nr: '2272', name: "Die Wellenform speichert wieder den hoechsten Ausschlag",
    file: 'public/app.js',
    search: "j < end; j++) squares[k] += data[j] * data[j];",
    replacement: "j < end; j++) squares[k] = Math.max(squares[k], data[j] * data[j]);",
    expected: "Wellenform: mittlere Lautstaerke je Abschnitt, Balken aus dem Mittel, Hoehe hoch 1,5"
  },
  {
    nr: '2273', name: "Ein Balken zeigt den hoechsten seiner Abschnitte",
    file: 'public/app.js',
    search: "{ sum += peaks[j]; count++; }",
    replacement: "{ sum = Math.max(sum, peaks[j]); count = 1; }",
    expected: "Wellenform: mittlere Lautstaerke je Abschnitt, Balken aus dem Mittel, Hoehe hoch 1,5"
  },
  {
    nr: '2274', name: "Die Hoehe ist linear",
    file: 'public/app.js',
    search: "const WAVE_CONTRAST = 1.5;",
    replacement: "const WAVE_CONTRAST = 1;",
    expected: "Wellenform: mittlere Lautstaerke je Abschnitt, Balken aus dem Mittel, Hoehe hoch 1,5"
  },
  {
    nr: '2275', name: "Der Browser rechnet wieder 1.000 Werte",
    file: 'public/app.js',
    search: "const WAVE_PEAKS = 1024;",
    replacement: "const WAVE_PEAKS = 1000;",
    expected: "Wellenform: mittlere Lautstaerke je Abschnitt, Balken aus dem Mittel, Hoehe hoch 1,5"
  },
  {
    nr: '2276', name: "Gespeicherte Spitzenwerte mit 1.000 Byte gehen wieder hinaus",
    file: 'server.js',
    search: "const wavePeaksOut = (buf) => (buf && buf.length === WAVEFORM_PEAKS ? buf.toString('base64') : null);",
    replacement: "const wavePeaksOut = (buf) => (buf ? buf.toString('base64') : null);",
    expected: "Audio: die Wellenform"
  },
  {
    nr: '2277', name: "Feste Namen wie image.jpg werden gespeichert",
    file: 'server.js',
    search: "const PLACEHOLDER_STEM = /^(image|video|audio|blob|file)$/i;",
    replacement: "const PLACEHOLDER_STEM = /^$/;",
    expected: "Originalnamen: Fotos und Videos behalten den Namen vom Hochladen"
  },
  {
    nr: '2278', name: "Das Foto vergisst seinen Namen beim Hochladen",
    file: 'server.js',
    search: "        if (p.name) putPhotoName.run(id, p.name);\n",
    replacement: "",
    expected: "Originalnamen: Fotos und Videos behalten den Namen vom Hochladen"
  },
  {
    nr: '2279', name: "Das Video vergisst seinen Namen beim Hochladen",
    file: 'server.js',
    search: "      if (name) putPhotoName.run(added, name);\n",
    replacement: "",
    expected: "Originalnamen: Fotos und Videos behalten den Namen vom Hochladen"
  },
  {
    nr: '2280', name: "Das Original laedt wieder als photo-<Nummer>",
    file: 'server.js',
    search: "    name: named ? photoStem(named, named.title, localeOf(req)) : `photo-${p.id}` });",
    replacement: "    name: `photo-${p.id}` });",
    expected: "Originalnamen: Fotos und Videos behalten den Namen vom Hochladen"
  },
  {
    nr: '2281', name: "Auch Kachel und Mittelgroesse tragen den Namen",
    file: 'server.js',
    search: "  const named = want === 'data' ? qPhotoNaming().get(p.id) : null;",
    replacement: "  const named = qPhotoNaming().get(p.id);",
    expected: "Originalnamen: Fotos und Videos behalten den Namen vom Hochladen"
  },
  {
    nr: '2282', name: "Die alte Endung bleibt vor der neuen stehen",
    file: 'server.js',
    search: "  if (p.filename) return nameStem(p.filename);",
    replacement: "  if (p.filename) return p.filename;",
    expected: "Originalnamen: Fotos und Videos behalten den Namen vom Hochladen"
  },
  {
    nr: '2283', name: "detail() nennt die Endung vom Hochladen",
    file: 'server.js',
    search: "    p.filename = ext === 'bin' && photoNames.has(p.id) ? photoNames.get(p.id) : `${stem}.${ext}`;",
    replacement: "    p.filename = photoNames.get(p.id) || `${stem}.${ext}`;",
    expected: "Originalnamen: Fotos und Videos behalten den Namen vom Hochladen"
  },
  {
    nr: '2284', name: "Der Ersatzname kommt ohne Titel",
    file: 'server.js',
    search: "const withTitle = (title, rest) => (titleForName(title) ? `${titleForName(title)}_${rest}` : rest);",
    replacement: "const withTitle = (title, rest) => rest;",
    expected: "Originalnamen: Ersatzname mit Titel und Nummern, im Vokabular und in der Sprache des Accounts"
  },
  {
    nr: '2285', name: "Der Ersatzname ist immer deutsch",
    file: 'server.js',
    search: "    : t(locale, 'server.namePhoto', { item: p.item_id, photo: p.id }));",
    replacement: "    : t('de', 'server.namePhoto', { item: p.item_id, photo: p.id }));",
    expected: "Originalnamen: Ersatzname mit Titel und Nummern, im Vokabular und in der Sprache des Accounts"
  },
  {
    nr: '2286', name: "Doppelte Leerzeichen im Titel bleiben stehen",
    file: 'server.js',
    search: "  .replace(/\\s+/g, ' ').trim().slice(0, 40).replace(/[ .]+$/, '');",
    replacement: "  .trim().slice(0, 40);",
    expected: "Originalnamen: Ersatzname mit Titel und Nummern, im Vokabular und in der Sprache des Accounts"
  },
  {
    nr: '2287', name: "Im Kommentar zaehlt auch image.png als Name",
    file: 'server.js',
    search: "  const own = uploadName(m.filename);",
    replacement: "  const own = m.filename;",
    expected: "Originalnamen: Bilder und Videos in Kommentaren"
  },
  {
    nr: '2288', name: "Kommentarbilder laden wieder als image-<Nummer>",
    file: 'server.js',
    search: "    name: named ? commentMediaStem(named, false, named.title, localeOf(req)) : `image-${b.id}` });",
    replacement: "    name: `image-${b.id}` });",
    expected: "Originalnamen: Bilder und Videos in Kommentaren"
  },
  {
    nr: '2289', name: "Kommentarvideos laden wieder als video-<Nummer>",
    file: 'server.js',
    search: "    name: named ? commentMediaStem(named, true, named.title, localeOf(req)) : `video-${v.id}` });",
    replacement: "    name: `video-${v.id}` });",
    expected: "Originalnamen: Bilder und Videos in Kommentaren"
  },
  {
    nr: '2290', name: "Der Export laesst den Namen weg",
    file: 'server.js',
    search: "        if (p.filename) z.filename = p.filename;\n",
    replacement: "",
    expected: "Originalnamen: Export 23, Import und Papierkorb tragen den Namen"
  },
  {
    nr: '2291', name: "Der Import nimmt auch image.jpg als Namen",
    file: 'server.js',
    search: "duration: isVideo || isAudio ? durationValue(p.duration) : null, name: uploadName(p.filename),",
    replacement: "duration: isVideo || isAudio ? durationValue(p.duration) : null, name: p.filename || null,",
    expected: "Originalnamen: Export 23, Import und Papierkorb tragen den Namen"
  },
  {
    nr: '2292', name: "Import und Papierkorb vergessen den Namen",
    file: 'server.js',
    search: "        if (p.name) putPhotoName.run(photoId, p.name);\n",
    replacement: "",
    expected: "Originalnamen: Export 23, Import und Papierkorb tragen den Namen"
  },
  {
    nr: '2293', name: "Der Name bleibt nach dem Loeschen des Fotos stehen",
    file: 'schema.js',
    search: "CREATE TABLE IF NOT EXISTS photo_names (\n  photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,",
    replacement: "CREATE TABLE IF NOT EXISTS photo_names (\n  photo_id INTEGER PRIMARY KEY,",
    expected: "Originalnamen: Export 23, Import und Papierkorb tragen den Namen"
  },
  {
    nr: '2294', name: "„Infos“ nennt wieder nur die Stelle",
    file: 'public/app.js',
    search: "  const photoInfo = (p, back) => showMediaInfo(`/api/photos/${Number(p.id)}/info`, p.filename || '', back,",
    replacement: "  const photoInfo = (p, back) => showMediaInfo(`/api/photos/${Number(p.id)}/info`, '', back,",
    expected: "Originalnamen: der Name steht im Vollbild und in „Infos“"
  },
  {
    nr: '2295', name: "Die Stelle faellt unter dem Namen weg",
    file: 'public/app.js',
    search: "${place ? `<p class=\"minfo-place\">${esc(place)}</p>` : ''}",
    replacement: "",
    expected: "Originalnamen: der Name steht im Vollbild und in „Infos“"
  },
  {
    nr: '2296', name: "Kommentarbilder kommen ohne Namen ins Vollbild",
    file: 'public/app.js',
    search: "      const media = [...(c.images || []).map(x => ({ id: x.id, source: 'comment', filename: x.filename })),",
    replacement: "      const media = [...(c.images || []).map(x => ({ id: x.id, source: 'comment' })),",
    expected: "Originalnamen: der Name steht im Vollbild und in „Infos“"
  },
  {
    nr: '2297', name: "Jeder Inhalt gilt als Audio",
    file: 'server.js',
    search: "  if (/^audio\\//.test(type || '')) return type;",
    replacement: "  if (/^audio\\//.test(type || '')) return type;\n  if (!type) return 'audio/mpeg';",
    expected: "Audio bei den Fotos: Hochladen, Inhalt und Grenze"
  },
  {
    nr: '2298', name: "MP4 gilt mit jeder Endung als Audio",
    file: 'server.js',
    search: "  return AUDIO_IN_CONTAINER[attachments.extension(name)] === type ? type : null;",
    replacement: "  return type;",
    expected: "Audio bei den Fotos: Hochladen, Inhalt und Grenze"
  },
  {
    nr: '2299', name: "Audio laeuft unter der Grenze fuer Dateien",
    file: 'server.js',
    search: "             () => ({ count: 1, bytes: limitBytes('audio'), key: 'server.audioOne' })),",
    replacement: "             () => ({ count: 1, bytes: limitBytes('file'), key: 'server.audioOne' })),",
    expected: "Audio bei den Fotos: Hochladen, Inhalt und Grenze"
  },
  {
    nr: '2300', name: "Das Cover wird keine Kachel",
    file: 'server.js',
    search: "    if (!known) v = await coverVariants(cover);\n",
    replacement: "",
    expected: "Audio bei den Fotos: Hochladen, Inhalt und Grenze"
  },
  {
    nr: '2301', name: "MediaInfo liest das Cover nicht",
    file: 'server.js',
    search: "      (length, offset) => data.subarray(offset, offset + length), { audio: p.kind === 'audio' });",
    replacement: "      (length, offset) => data.subarray(offset, offset + length));",
    expected: "Audio bei den Fotos: Hochladen, Inhalt und Grenze"
  },
  {
    nr: '2302', name: "Audio bleibt ohne Dauer",
    file: 'server.js',
    search: "    if (p.kind === 'audio') putPhotoDuration().run(durationValue(facts.general.duration), id);\n",
    replacement: "",
    expected: "Audio bei den Fotos: Hochladen, Inhalt und Grenze"
  },
  {
    nr: '2303', name: "Audio ohne Namen heisst „Foto“",
    file: 'server.js',
    search: "  if (p.kind === 'audio') return withTitle(title, t(locale, 'server.nameAudio', { item: p.item_id, photo: p.id }));\n",
    replacement: "",
    expected: "Audio bei den Fotos: Hochladen, Inhalt und Grenze"
  },
  {
    nr: '2304', name: "typeFromBytes() kennt kein Audio",
    file: 'attachments.js',
    search: "  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';\n  return audioType(b);",
    replacement: "  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';\n  return null;",
    expected: "Audio bei den Fotos: Hochladen, Inhalt und Grenze"
  },
  {
    nr: '2305', name: "M4A gilt als Video",
    file: 'attachments.js',
    search: "    if (ISO_BRANDS_AUDIO.has(brand)) return 'audio/mp4';\n",
    replacement: "",
    expected: "Audio bei den Fotos: Hochladen, Inhalt und Grenze"
  },
  {
    nr: '2306', name: "Jede Ogg-Datei gilt als Audio",
    file: 'attachments.js',
    search: "  return head === 'OpusHead' || head.slice(0, 7) === '\\x01vorbis';",
    replacement: "  return true;",
    expected: "Audio bei den Fotos: Hochladen, Inhalt und Grenze"
  },
  {
    nr: '2307', name: "Eine FLAC hinter einem ID3-Tag gilt als MP3",
    file: 'attachments.js',
    search: "    if (b.length >= tag + 4 && b.slice(tag, tag + 4).toString('latin1') === 'fLaC') return 'audio/flac';\n",
    replacement: "",
    expected: "Audio bei den Fotos: Hochladen, Inhalt und Grenze"
  },
  {
    nr: '2308', name: "Audio ohne Range",
    file: 'server.js',
    search: "  let rangeable = p.kind === 'video' || p.kind === 'audio';",
    replacement: "  let rangeable = p.kind === 'video';",
    expected: "Audio bei den Fotos: Auslieferung, FLAC mit ID3-Tag"
  },
  {
    nr: '2309', name: "Ohne Cover liefert die Kachel die Audiodatei",
    file: 'server.js',
    search: "    else if (p.kind === 'audio') return res.status(404).end();\n",
    replacement: "",
    expected: "Audio bei den Fotos: Auslieferung, FLAC mit ID3-Tag"
  },
  {
    nr: '2310', name: "Die FLAC bei den Fotos beginnt mit dem ID3-Tag",
    file: 'server.js',
    search: "  if (p.kind === 'audio' && want === 'data' && req.query.inline === '1')",
    replacement: "  if (false)",
    expected: "Audio bei den Fotos: Auslieferung, FLAC mit ID3-Tag"
  },
  {
    nr: '2311', name: "Die FLAC unter Dateien beginnt mit dem ID3-Tag",
    file: 'server.js',
    search: "    const skip = inline && !out.filename && isFlacName(filename) ? await attachments.flacSkip(f.size, sealedReader(handle, f)) : 0;",
    replacement: "    const skip = 0;",
    expected: "Audio bei den Fotos: Auslieferung, FLAC mit ID3-Tag"
  },
  {
    nr: '2312', name: "Content-Range zaehlt das Tag mit",
    file: 'server.js',
    search: "      if (b) res.set('Content-Range', `bytes ${from - skip}-${to - skip}/${size}`);",
    replacement: "      if (b) res.set('Content-Range', `bytes ${from}-${to}/${size}`);",
    expected: "Audio bei den Fotos: Auslieferung, FLAC mit ID3-Tag"
  },
  {
    nr: '2313', name: "flacSkip() findet nichts",
    file: 'attachments.js',
    search: "  return at && at + 4 <= size && (await read(4, at)).toString('latin1') === 'fLaC' ? at : 0;",
    replacement: "  return 0;",
    expected: "Audio bei den Fotos: Auslieferung, FLAC mit ID3-Tag"
  },
  {
    nr: '2314', name: "Audio und Video ohne media-src",
    file: 'attachments.js',
    search: "  return /^(audio|video)\\//.test(type) ? \"default-src 'none'; media-src 'self'; sandbox\" : \"default-src 'none'; sandbox\";",
    replacement: "  return \"default-src 'none'; sandbox\";",
    expected: "Audio bei den Fotos: Auslieferung, FLAC mit ID3-Tag"
  },
  {
    nr: '2315', name: "Die Wellenform nimmt auch ein Bild",
    file: 'server.js',
    search: "  if (p.kind !== 'audio') return res.status(400).json({ error: t(localeOf(req), 'server.audioOnly')});",
    replacement: "",
    expected: "Audio bei den Fotos: Wellenform, Stelle, Bittiefe"
  },
  {
    nr: '2316', name: "Jeder setzt die Wellenform",
    file: 'server.js',
    search: "  if (!entryFree(req, res, p.item_id)) return;\n  if (p.kind !== 'audio')",
    replacement: "  if (p.kind !== 'audio')",
    expected: "Audio bei den Fotos: Wellenform, Stelle, Bittiefe"
  },
  {
    nr: '2317', name: "Bei Audio wird keine Stelle gemerkt",
    file: 'server.js',
    search: "  photo: lateStatement(\"SELECT 1 FROM photos WHERE id = ? AND kind IN ('video', 'audio')\"),",
    replacement: "  photo: lateStatement(\"SELECT 1 FROM photos WHERE id = ? AND kind = 'video'\"),",
    expected: "Audio bei den Fotos: Wellenform, Stelle, Bittiefe"
  },
  {
    nr: '2318', name: "Audio bekommt einen Ausschnitt",
    file: 'server.js',
    search: "  if (p.kind === 'audio') return res.status(400).json({ error: t(localeOf(req), 'server.cropInvalid')});\n",
    replacement: "",
    expected: "Audio bei den Fotos: Wellenform, Stelle, Bittiefe"
  },
  {
    nr: '2319', name: "MediaInfo liefert keine Bittiefe der Audiospur",
    file: 'attachments.js',
    search: "bitRate: mediaNumber(tr.BitRate), bitDepth: mediaNumber(tr.BitDepth),\n      language: mediaText(tr.Language) })),",
    replacement: "bitRate: mediaNumber(tr.BitRate),\n      language: mediaText(tr.Language) })),",
    expected: "Audio bei den Fotos: Wellenform, Stelle, Bittiefe"
  },
  {
    nr: '2320', name: "Aeltere Zeilen ohne Bittiefe bleiben",
    file: 'server.js',
    search: "  OR (${SOUND_STALE})`;",
    replacement: "`;",
    expected: "Audio bei den Fotos: Wellenform, Stelle, Bittiefe"
  },
  {
    nr: '2321', name: "Ohne Zeile in photo_media fehlt die Bittiefe",
    file: 'server.js',
    search: "    p.bitDepth = sound?.bits ?? (p.mime_type === 'audio/flac' ? photoFlacBits(p.id) : null);",
    replacement: "    p.bitDepth = sound?.bits ?? null;",
    expected: "Audio bei den Fotos: Wellenform, Stelle, Bittiefe"
  },
  {
    nr: '2322', name: "Die Bittiefe aus STREAMINFO ist immer 16",
    file: 'attachments.js',
    search: "  return (((b[20] & 1) << 4) | (b[21] >> 4)) + 1;",
    replacement: "  return 16;",
    expected: "Audio bei den Fotos: Wellenform, Stelle, Bittiefe"
  },
  {
    nr: '2323', name: "Die Kachel zaehlt Audio nicht",
    file: 'server.js',
    search: "    it.audioCount = ph.filter(p2 => p2.kind === 'audio').length;\n",
    replacement: "",
    expected: "Audio bei den Fotos: Zaehlung"
  },
  {
    nr: '2324', name: "Audio zaehlt als Foto",
    file: 'server.js',
    search: "    it.photoCount = ph.filter(p2 => p2.kind === 'image').length;",
    replacement: "    it.photoCount = ph.filter(p2 => p2.kind !== 'video').length;",
    expected: "Audio bei den Fotos: Zaehlung"
  },
  {
    nr: '2325', name: "Das Hauptbild der Kachel kommt ohne Wellenform",
    file: 'server.js',
    search: "    if (it.mainPhoto?.kind === 'audio' && !it.mainPhoto.thumbLength)",
    replacement: "    if (false)",
    expected: "Audio bei den Fotos: Zaehlung"
  },
  {
    nr: '2326', name: "Der Loeschdialog zaehlt Audio nicht",
    file: 'server.js',
    search: "    audios: one(\"SELECT COUNT(*) n FROM photos WHERE item_id = ? AND kind = 'audio'\", id),\n",
    replacement: "",
    expected: "Audio bei den Fotos: Zaehlung"
  },
  {
    nr: '2327', name: "„Kennzahlen“ zaehlen Audio als Video",
    file: 'server.js',
    search: "      const into = kind === 'video' ? vi : au;",
    replacement: "      const into = vi;",
    expected: "Audio bei den Fotos: Zaehlung"
  },
  {
    nr: '2328', name: "Der Export laesst die Wellenform weg",
    file: 'server.js',
    search: "          if (wavePeaksOut(p.peaks)) z.peaks = wavePeaksOut(p.peaks);\n",
    replacement: "",
    expected: "Audio bei den Fotos: Export, Import und Papierkorb"
  },
  {
    nr: '2329', name: "Audio geht mit den Fotos statt mit den Videos",
    file: 'server.js',
    search: "        if (p.kind !== 'video' && p.kind !== 'audio') {",
    replacement: "        if (p.kind !== 'video') {",
    expected: "Audio bei den Fotos: Export, Import und Papierkorb"
  },
  {
    nr: '2330', name: "Der Import macht Audio zum Bild",
    file: 'server.js',
    search: "                    kind: isVideo ? 'video' : isAudio ? 'audio' : 'image',",
    replacement: "                    kind: isVideo ? 'video' : 'image',",
    expected: "Audio bei den Fotos: Export, Import und Papierkorb"
  },
  {
    nr: '2331', name: "Fehlendes Audio wird nicht gemeldet",
    file: 'server.js',
    search: "        if (isAudio) audiosMissing++;\n",
    replacement: "",
    expected: "Audio bei den Fotos: Export, Import und Papierkorb"
  },
  {
    nr: '2332', name: "Import und Papierkorb verlieren die Wellenform",
    file: 'server.js',
    search: "        if (p.peaks) putPhotoWaveform.run(photoId, p.peaks);\n",
    replacement: "",
    expected: "Audio bei den Fotos: Export, Import und Papierkorb"
  },
  {
    nr: '2333', name: "Der Import nimmt die Audiodatei als Cover",
    file: 'server.js',
    search: "      const template = isVideo || isAudio ? bytesOf(p, 'standbild', bytesSource, spilled) : buf;",
    replacement: "      const template = isVideo ? bytesOf(p, 'standbild', bytesSource, spilled) : buf;",
    expected: "Audio bei den Fotos: Export, Import und Papierkorb"
  },
  {
    nr: '2334', name: "Die Umwandlung liest auch Audio",
    file: 'server.js',
    search: "  \"SELECT id FROM photos WHERE kind = 'image'\");",
    replacement: "  \"SELECT id FROM photos WHERE kind != 'video'\");",
    expected: "Audio bei den Fotos: Bildlaeufe lassen Audio aus"
  },
  {
    nr: '2335', name: "Das Nachtragen der Kacheln liest auch Audio",
    file: 'server.js',
    search: "    \"SELECT id FROM photos WHERE (thumb IS NULL OR medium IS NULL) AND kind = 'image'\").all();",
    replacement: "    \"SELECT id FROM photos WHERE (thumb IS NULL OR medium IS NULL) AND kind != 'video'\").all();",
    expected: "Audio bei den Fotos: Bildlaeufe lassen Audio aus"
  },
  {
    nr: '2336', name: "Der Kachellauf liest bei Audio die Audiodatei",
    file: 'batchrun.js',
    search: "const isPlayedRow = (z) => z && (z.kind === 'video' || z.kind === 'audio');",
    replacement: "const isPlayedRow = (z) => z && z.kind === 'video';",
    expected: "Audio bei den Fotos: Bildlaeufe lassen Audio aus"
  },
  {
    nr: '2337', name: "Ohne Cover steht kein Zeichen da",
    file: 'public/app.js',
    search: "    : `<span class=\"awave\">${peaks ? waveSvg(peaks, bars) : ICON_WAVE}</span>`;\n}",
    replacement: "    : '';\n}",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2338', name: "Audio ohne Cover fragt nach einer Kachel",
    file: 'public/app.js',
    search: "  if (isAudio(p) && !Number(p.thumbLength)) return '';\n",
    replacement: "",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2339', name: "Die Kachel zeigt bei Audio kein ♪",
    file: 'public/app.js',
    search: "      ${isAudio(it.mainPhoto) ? `<div class=\"card-play card-sound\"",
    replacement: "      ${false ? `<div class=\"card-play card-sound\"",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2340', name: "Die Zahl auf der Kachel nennt Audio nicht",
    file: 'public/app.js',
    search: "  if (a) parts.push(t('list.audioCount', { n: a }));\n",
    replacement: "",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2341', name: "Die Bildleiste zeigt bei Audio kein ♪",
    file: 'public/app.js',
    search: "        (isVideo(p) ? `<span class=\"play-badge\">▶</span>` : isAudio(p) ? `<span class=\"play-badge\">♪</span>` : '') +",
    replacement: "        (isVideo(p) ? `<span class=\"play-badge\">▶</span>` : '') +",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2342', name: "Die Bildleiste nennt bei Audio keine Dauer",
    file: 'public/app.js',
    search: "      const length = isVideo(p) || isAudio(p) ? durationText(p.duration) : '';",
    replacement: "      const length = isVideo(p) ? durationText(p.duration) : '';",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2343', name: "Das Hauptbild zeigt Audio als Bild",
    file: 'public/app.js',
    search: "        : showsAudio ? soundViewer(ps[idx])",
    replacement: "        : false ? soundViewer(ps[idx])",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2344', name: "Audio spielt ohne inline=1",
    file: 'public/app.js',
    search: "  ? (isAudio(p) ? `/api/photos/${Number(p.id)}/raw?inline=1` : imageSource(p, ''))",
    replacement: "  ? imageSource(p, '')",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2345', name: "Audio hat einen Knopf fuer den Ausschnitt",
    file: 'public/app.js',
    search: "        ${mayEdit() && !showsAudio ? `<button class=\"vfocus",
    replacement: "        ${mayEdit() ? `<button class=\"vfocus",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2346', name: "Das Hauptbild nennt den Grund bei 32 Bit nicht",
    file: 'public/app.js',
    search: "        flac32(p) ? `<p class=\"lb-why\">${tH('entry.flac32Hint')}</p>` : ''}\n        <a href=\"${esc(imageSource(p, ''))}\" download>",
    replacement: "        ''}\n        <a href=\"${esc(imageSource(p, ''))}\" download>",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2347', name: "Bei den Fotos gilt keine Datei als FLAC",
    file: 'public/app.js',
    search: "  && (p.source === 'file' ? fileKind(p.filename).toLowerCase() === 'flac' : /\\/flac$/.test(p.mime_type || ''));",
    replacement: "  && p.source === 'file' && fileKind(p.filename).toLowerCase() === 'flac';",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2348', name: "Das Vollbild nennt den Grund nicht",
    file: 'public/app.js',
    search: "    why.hidden = !(audio && flac32(photos[i]));",
    replacement: "    why.hidden = true;",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2349', name: "Im Vollbild fehlt bei Audio der Download",
    file: 'public/app.js',
    search: "    link.hidden = photos[i].source !== 'file' && !audio;",
    replacement: "    link.hidden = photos[i].source !== 'file';",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2350', name: "Der Streifen im Vollbild zeigt bei Audio ▶",
    file: 'public/app.js',
    search: "        + (isVideo(p) ? `<span class=\"play-badge\">▶</span>` : isAudio(p) ? `<span class=\"play-badge\">♪</span>` : '');\n      tile.onclick",
    replacement: "        + (isVideo(p) || isAudio(p) ? `<span class=\"play-badge\">▶</span>` : '');\n      tile.onclick",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2351', name: "Hochladen trennt Audio nicht ab",
    file: 'public/app.js',
    search: "    const sounds = files.filter(f => /^audio\\//.test(f.type) || isAudioName(f.name));",
    replacement: "    const sounds = [];",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2352', name: "Die Wellenform liest das ID3-Tag mit",
    file: 'public/app.js',
    search: "  return String.fromCharCode(...b.subarray(at, at + 4)) === 'fLaC' ? bytes.slice(at) : bytes;",
    replacement: "  return bytes;",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2353', name: "„Infos“ nennt die Bittiefe nur beim Video",
    file: 'public/app.js',
    search: "      ['entry.mediaBitDepth', bits(s.bitDepth)],\n",
    replacement: "",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2354', name: "Fehlende Wellenformen bleiben fehlend",
    file: 'public/app.js',
    search: "  catchUpPhotoWaves();\n",
    replacement: "",
    expected: "Audio bei den Fotos: Kachel, Bildleiste, Hauptbild und Vollbild"
  },
  {
    nr: '2355', name: "Die Zahlenfelder stehen wieder unter dem Text",
    file: 'public/style.css',
    search: ".numfield { display: grid; grid-template-columns: minmax(0, 1fr) 96px; column-gap: 14px; align-items: center; }",
    replacement: ".numfield { display: block; }",
    expected: "Zahlenfelder: rechts neben Name und Spanne, buendig"
  },
  {
    nr: '2356', name: "„Vorschau und Export bis“ ohne Erklaerung unter dem Feld",
    file: 'public/app.js',
    search: "          ${kind === 'attachment' ? `<p class=\"desc numfield-hint\">${tH('card.limitAttachmentHint')}</p>` : ''}</div>`;",
    replacement: "          </div>`;",
    expected: "Zahlenfelder: rechts neben Name und Spanne, buendig"
  },
  {
    nr: '2357', name: "„Mindestens behalten“ steht wieder unter dem Text",
    file: 'public/app.js',
    search: "      <div class=\"field numfield\"><div class=\"numfield-text\"><label for=\"cleanup-keep\">",
    replacement: "      <div class=\"field\"><div class=\"numfield-text\"><label for=\"cleanup-keep\">",
    expected: "Zahlenfelder: rechts neben Name und Spanne, buendig"
  },
  {
    nr: '2358', name: "Ohne Recht ist „Vorschau und Export bis“ eingerueckt",
    file: 'public/app.js',
    search: "          if (!OWNER) return `<div class=\"kv\"><span class=\"k\">",
    replacement: "          if (!OWNER) return `<div class=\"kv${kind === 'attachment' ? ' limit-sub' : ''}\"><span class=\"k\">",
    expected: "Grenzen beim Hochladen: „Vorschau und Export bis“ buendig, mit und ohne Recht"
  },
  {
    nr: '2359', name: "Ein kurzer Rest zeigt den Knopf „Mehr“ weiter",
    file: 'public/style.css',
    search: ".more.more-plain > summary { display: none; }\n",
    replacement: "",
    expected: "„Mehr“: ab drei Zeilen hinter dem Knopf, darunter direkt, neu gemessen bei anderer Breite"
  },
  {
    nr: '2360', name: "„Mehr“ vergisst, dass der Text offen war",
    file: 'public/app.js',
    search: "    if (short) box.dataset.wasOpen = wasOpen ? '1' : '';\n",
    replacement: "    if (short) box.dataset.wasOpen = '';\n",
    expected: "„Mehr“: ab drei Zeilen hinter dem Knopf, darunter direkt, neu gemessen bei anderer Breite"
  },
  {
    nr: '2361', name: "Die Notenskala fehlt",
    file: 'public/app.js',
    search: "    g.textContent = String(score);\n    axis.appendChild(g);\n",
    replacement: "    g.textContent = String(score);\n",
    expected: "Zeitleiste: Beschriftung ueber dem Rahmen, „Alles zeigen“, Notenskala"
  },
  {
    nr: '2362', name: "Die Beschriftung klebt am Rahmen",
    file: 'public/style.css',
    search: "gap: 4px 14px; margin: 0 0 18px;",
    replacement: "gap: 4px 14px; margin: 0 0 2px;",
    expected: "Zeitleiste: Beschriftung ueber dem Rahmen, „Alles zeigen“, Notenskala"
  },
  {
    nr: '2363', name: "„Alles zeigen“ speichert die Spanne nicht",
    file: 'public/app.js',
    search: "    TIMELINE_SPAN = 0;\n    tl.end = null;\n    saveTimelineSpan();\n",
    replacement: "    TIMELINE_SPAN = 0;\n    tl.end = null;\n",
    expected: "Zeitleiste: Beschriftung ueber dem Rahmen, „Alles zeigen“, Notenskala"
  },
  {
    nr: '2364', name: "Die Notenskala steht links ausserhalb des Rahmens",
    file: 'public/style.css',
    search: "position: relative; margin: 0; padding: 14px 0 4px 16px;",
    replacement: "position: relative; margin: 0; padding: 14px 0 4px;",
    expected: "Zeitleiste: Beschriftung ueber dem Rahmen, „Alles zeigen“, Notenskala"
  },
  {
    nr: '2365', name: "Das Werkzeug rechnet ohne videoproxy.js",
    file: 'tools/publish.js',
    search: "  'videoproxy.js'];",
    replacement: "  ];",
    expected: "Veroeffentlichen: dieselben Dateien und derselbe Fingerprint wie der Server"
  },
  {
    nr: '2366', name: "tools/ux geht mit hinaus",
    file: 'tools/publish.js',
    search: "  'tools/ux'                  // Testumgebung fuer den Browser\n",
    replacement: "",
    expected: "Veroeffentlichen: dieselben Dateien und derselbe Fingerprint wie der Server"
  },
  {
    nr: '2367', name: "Der zweite Commit hat keinen Elternteil",
    file: 'tools/publish.js',
    search: "  if (oben) args.push('-p', oben);\n",
    replacement: "",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2368', name: "Dieselbe Version geht noch einmal hinaus",
    file: 'tools/publish.js',
    search: "  if (oeffentlich && !hoeher(version, oeffentlich))",
    replacement: "  if (false)",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2369', name: "Ein falscher Fingerprint im CHANGELOG faellt nicht auf",
    file: 'tools/publish.js',
    search: "  if (oberster.fingerprint !== fp.value)",
    replacement: "  if (false)",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2370', name: "Ein abweichender Zweig publish faellt nicht auf",
    file: 'tools/publish.js',
    search: "  if (lokal && lokal !== oben)",
    replacement: "  if (false)",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2371', name: "Der Commit bekommt keinen Tag",
    file: 'tools/publish.js',
    search: "  git('tag', '-a', version, '-m', version, commit);\n",
    replacement: "",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2372', name: "Die Notizen lassen die Kaesten weg",
    file: 'tools/publish.js',
    search: "    '## Before you update', kaesten.length ? kaesten.join('\\n\\n') : 'Nothing to do.',",
    replacement: "    '## Before you update', 'Nothing to do.',",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2373', name: "Die Notizen nehmen die oeffentliche Version mit",
    file: 'tools/publish.js',
    search: "  const neu = alle.slice(0, bis);",
    replacement: "  const neu = alle.slice(0, bis + 1);",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2374', name: "Ohne Gegenstelle laeuft das Werkzeug weiter",
    file: 'tools/publish.js',
    search: "  catch { abbruch(`keine Gegenstelle \"${GEGENSTELLE}\". Eintragen mit: git remote add ${GEGENSTELLE} <adresse>`); }",
    replacement: "  catch { return null; }",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2375', name: "Der eigene Index bleibt unter TMPDIR liegen",
    file: 'tools/publish.js',
    search: "  } finally { fs.rmSync(ordner, { recursive: true, force: true }); }",
    replacement: "  } finally { }",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2376', name: "Der Pfad fuer NPMplus laesst Audio aus",
    file: 'README-de.md',
    search: "/(photos|videos|audio|comments|images))$`",
    replacement: "/(photos|videos|comments|images))$`",
    expected: "Reverse Proxy: die Pfade fuer NPMplus in der README"
  },
  {
    nr: '2377', name: "detail() nennt bei Dateien keine Kanaele",
    file: 'server.js',
    search: "channels: a2.audio_channels ?? null,",
    replacement: "channels: null,",
    expected: "Abspieler: Kanaele der ersten Audiospur in detail()"
  },
  {
    nr: '2378', name: "Fotos nennen keine Kanaele",
    file: 'server.js',
    search: "    p.channels = sound?.channels ?? null;",
    replacement: "    p.channels = null;",
    expected: "Abspieler: Kanaele der ersten Audiospur in detail()"
  },
  {
    nr: '2379', name: "Das Hauptbild zeigt die Leiste des Browsers",
    file: 'public/app.js',
    search: "      <audio preload=\"metadata\" src=\"${esc(playSource(p))}\"></audio></div>`;",
    replacement: "      <audio controls preload=\"metadata\" src=\"${esc(playSource(p))}\"></audio></div>`;",
    expected: "Abspieler: eigene Bedienung an vier Stellen"
  },
  {
    nr: '2380', name: "Die Vorschau zeigt die Leiste des Browsers",
    file: 'public/app.js',
    search: "<audio preload=\"metadata\" src=\"/api/attachments/${Number(a.id)}/raw?inline=1\">",
    replacement: "<audio controls preload=\"metadata\" src=\"/api/attachments/${Number(a.id)}/raw?inline=1\">",
    expected: "Abspieler: eigene Bedienung an vier Stellen"
  },
  {
    nr: '2381', name: "Pegel und Regler auch ohne Maus",
    file: 'public/app.js',
    search: "const fineSound = () => !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;",
    replacement: "const fineSound = () => true;",
    expected: "Abspieler: eigene Bedienung an vier Stellen"
  },
  {
    nr: '2382', name: "Mono zeigt zwei Balken",
    file: 'public/app.js',
    search: "mono = Number(p.channels) === 1;",
    replacement: "mono = false;",
    expected: "Abspieler: eigene Bedienung an vier Stellen"
  },
  {
    nr: '2383', name: "Die Wellenform ist kein Regler",
    file: 'public/app.js',
    search: "role=\"slider\" tabindex=\"0\"",
    replacement: "aria-hidden=\"true\"",
    expected: "Abspieler: eigene Bedienung an vier Stellen"
  },
  {
    nr: '2384', name: "Ohne Wellenform fehlt die Mittellinie",
    file: 'public/app.js',
    search: "${peaks ? waveDraw(peaks, bars) : line}",
    replacement: "${peaks ? waveDraw(peaks, bars) : ''}",
    expected: "Abspieler: eigene Bedienung an vier Stellen"
  },
  {
    nr: '2385', name: "Die linke Spalte steht nicht mittig",
    file: 'public/style.css',
    search: ".sdeck.fine { padding-left: max(0px, calc(30px - var(--sd-edge, 30px))); }",
    replacement: ".sdeck.fine { padding-left: max(0px, calc(28px - var(--sd-edge, 28px))); }",
    expected: "Abspieler: eigene Bedienung an vier Stellen"
  },
  {
    nr: '2386', name: "Die Wellenform spult nicht mit den Pfeilen",
    file: 'public/app.js',
    search: "v = el instanceof HTMLMediaElement ? el : el?.mediaPlayer;",
    replacement: "v = el;",
    expected: "Abspieler: Tasten, ▷/⏸ und Zeit"
  },
  {
    nr: '2387', name: "Pos1 und Ende spulen nicht",
    file: 'public/app.js',
    search: "  else if ((e.key === 'Home' || e.key === 'End') && el !== v) v.currentTime = e.key === 'Home' ? 0 : Number.isFinite(end) ? end : v.currentTime;\n",
    replacement: "",
    expected: "Abspieler: Tasten, ▷/⏸ und Zeit"
  },
  {
    nr: '2388', name: "Vorleser hoeren keine Zeit",
    file: 'public/app.js',
    search: "    wave.setAttribute('aria-valuetext', all ? t('entry.soundSpotText', { at: now, of: all }) : now);\n",
    replacement: "",
    expected: "Abspieler: Tasten, ▷/⏸ und Zeit"
  },
  {
    nr: '2389', name: "Waehrend der Wiedergabe bleibt das Dreieck",
    file: 'public/app.js',
    search: "play.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;",
    replacement: "play.innerHTML = ICON_PLAY;",
    expected: "Abspieler: Tasten, ▷/⏸ und Zeit"
  },
  {
    nr: '2390', name: "Die Leertaste spielt nicht",
    file: 'public/app.js',
    search: "    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); toggle(); }\n",
    replacement: "",
    expected: "Abspieler: Tasten, ▷/⏸ und Zeit"
  },
  {
    nr: '2391', name: "Im Vollbild ist der Abspieler nicht verdrahtet",
    file: 'public/app.js',
    search: "    deckOff = soundWire(deckBox.firstElementChild, audioPlayer);\n",
    replacement: "",
    expected: "Abspieler: Tasten, ▷/⏸ und Zeit"
  },
  {
    nr: '2392', name: "Die Lautstaerke wird nicht gemerkt",
    file: 'public/app.js',
    search: "slider.oninput = () => { keepVolume({ level: Number(slider.value), muted: false }); showVolume(); soundVolume(player); };",
    replacement: "slider.oninput = () => { soundVolume(player); };",
    expected: "Abspieler: Lautstaerke je Browser"
  },
  {
    nr: '2393', name: "Ohne Maus gilt die gemerkte Lautstaerke",
    file: 'public/app.js',
    search: "  mark();\n  markPlay();\n  paint();\n  return () =>",
    replacement: "  soundVolume(player);\n  mark();\n  markPlay();\n  paint();\n  return () =>",
    expected: "Abspieler: Lautstaerke je Browser"
  },
  {
    nr: '2394', name: "Die Skala reicht bis -60 dBFS",
    file: 'public/app.js',
    search: "const METER_FLOOR = -48,",
    replacement: "const METER_FLOOR = -60,",
    expected: "Pegel: Rechnung in dBFS"
  },
  {
    nr: '2395', name: "Der Balken faellt nicht",
    file: 'public/app.js',
    search: "  const decay = METER_DECAY * ms / 1000;",
    replacement: "  const decay = 0;",
    expected: "Pegel: Rechnung in dBFS"
  },
  {
    nr: '2396', name: "Die Spitze haelt nicht",
    file: 'public/app.js',
    search: "  else if (now - holdAt > METER_HOLD_MS) hold",
    replacement: "  else hold",
    expected: "Pegel: Rechnung in dBFS"
  },
  {
    nr: '2397', name: "Die Marke verschwindet mit dem naechsten Bild",
    file: 'public/app.js',
    search: "clip: state.clip || peak >= 1 }",
    replacement: "clip: peak >= 1 }",
    expected: "Pegel: Rechnung in dBFS"
  },
  {
    nr: '2398', name: "Rot beginnt bei -12 dBFS",
    file: 'public/style.css',
    search: "rgb(var(--gold-rgb)) 62.5% 87.5%, rgb(var(--red-rgb)) 87.5% 100%",
    replacement: "rgb(var(--gold-rgb)) 62.5% 75%, rgb(var(--red-rgb)) 75% 100%",
    expected: "Pegel: Rechnung in dBFS"
  },
  {
    nr: '2399', name: "Pause laesst die Balken stehen",
    file: 'public/app.js',
    search: "  ['pause', 'ended', 'emptied'].forEach(type => player.addEventListener(type, quiet, on));\n",
    replacement: "",
    expected: "Pegel: Balken, Pause, Marke und Lautstaerke hinter dem Abgriff"
  },
  {
    nr: '2400', name: "Pause nimmt die Marke weg",
    file: 'public/app.js',
    search: "states = states.map(s => ({ ...METER_QUIET, clip: s.clip }));",
    replacement: "states = states.map(() => ({ ...METER_QUIET }));",
    expected: "Pegel: Balken, Pause, Marke und Lautstaerke hinter dem Abgriff"
  },
  {
    nr: '2401', name: "Klick nimmt die Marke nicht weg",
    file: 'public/app.js',
    search: "  if (meter) meter.onclick = () => { states = states.map(s => ({ ...s, clip: false })); paint(); };\n",
    replacement: "",
    expected: "Pegel: Balken, Pause, Marke und Lautstaerke hinter dem Abgriff"
  },
  {
    nr: '2402', name: "Die Lautstaerke regelt das <audio> vor dem Pegel",
    file: 'public/app.js',
    search: "  if (route) route.gain.gain.value = level; else player.volume = level;",
    replacement: "  player.volume = level;",
    expected: "Pegel: Balken, Pause, Marke und Lautstaerke hinter dem Abgriff"
  },
  {
    nr: '2403', name: "Umgeleitet auch ohne laufenden AudioContext",
    file: 'public/app.js',
    search: "    if (SOUND_CONTEXT.state !== 'running') return null;\n",
    replacement: "",
    expected: "Pegel: nur bei laufendem AudioContext umgeleitet"
  },
  {
    nr: '2404', name: "Mehrkanal wird nicht auf L und R gemischt",
    file: 'public/app.js',
    search: "    mix.channelCountMode = 'explicit';\n",
    replacement: "",
    expected: "Pegel: nur bei laufendem AudioContext umgeleitet"
  },
  {
    nr: '2405', name: "Die Einrueckung steht wieder im Stilblatt",
    file: 'public/style.css',
    search: ".numfield .numfield-hint { grid-column: 1 / -1; margin-top: 6px; }\n",
    replacement: ".numfield .numfield-hint { grid-column: 1 / -1; margin-top: 6px; }\n.limit-sub { margin-left: 18px; }\n",
    expected: "Grenzen beim Hochladen: „Vorschau und Export bis“ buendig, mit und ohne Recht"
  },
  {
    nr: '2406', name: "„Mehr“ bleibt neben einer hoeheren Karte zu",
    file: 'public/app.js',
    search: "  roomMore(root);\n",
    replacement: "",
    expected: "„Mehr“ neben einer hoeheren Karte offen, sonst hinter dem Knopf"
  },
  {
    nr: '2407', name: "Der Rest bleibt offen, auch wenn die Karte hoeher wird",
    file: 'public/app.js',
    search: "      if (card.getBoundingClientRect().height <= height + 0.5) continue;\n",
    replacement: "      continue;\n",
    expected: "„Mehr“ neben einer hoeheren Karte offen, sonst hinter dem Knopf"
  },
  {
    nr: '2408', name: "Ohne Layout stehen alle Reste offen",
    file: 'public/app.js',
    search: "    if (!(height > 0)) continue;\n",
    replacement: "",
    expected: "Einstellungen: je Einstellung ein Satz, der Rest unter „Mehr“"
  },
  {
    nr: '2409', name: "Nach der Sprachliste klebt der Rest am Hinweis",
    file: 'public/style.css',
    search: ".engine-list + .more { margin-top: 10px; }\n",
    replacement: "",
    expected: "„Mehr“ neben einer hoeheren Karte offen, sonst hinter dem Knopf"
  },
  {
    nr: '2410', name: "Das Backup raeumt wieder nach der Regel auf",
    file: 'server.js',
    search: "    try { cleanBackupFiles(target.filePath); } catch (e) { logFail('Clearing up after the backup failed:', e.message); }",
    replacement: "    { const r = cleanupStatus(); if (r.an) removeBackups(target.filePath, ruleHit(backupList(target.filePath) || [], r.keep, r.days, Date.now(), null).map(d => d.name)); }\n    try { cleanBackupFiles(target.filePath); } catch (e) { logFail('Clearing up after the backup failed:', e.message); }",
    expected: "Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup"
  },
  {
    nr: '2411', name: "Der Start holt die verpasste Mitternacht nicht nach",
    file: 'server.js',
    search: "  if (!DATABASE_INCOMPLETE) planCleanup(0);",
    replacement: "  if (!DATABASE_INCOMPLETE) planCleanup(BENCH.midnight || backup.nextMidnight(nowMs()) - nowMs());",
    expected: "Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup"
  },
  {
    nr: '2412', name: "Am selben Tag ein zweites Mal",
    file: 'server.js',
    search: "  if (!cleanupStatus().an || getSetting('backupCleanupAt', null)?.day === day) return next;",
    replacement: "  if (!cleanupStatus().an) return next;",
    expected: "Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup"
  },
  {
    nr: '2413', name: "Ohne Schalter wird aufgeraeumt",
    file: 'server.js',
    search: "  if (!cleanupStatus().an || getSetting('backupCleanupAt', null)?.day === day) return next;",
    replacement: "  if (getSetting('backupCleanupAt', null)?.day === day) return next;",
    expected: "Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup"
  },
  {
    nr: '2414', name: "Der Zeitgeber stellt sich nicht neu",
    file: 'server.js',
    search: "  CLEANUP_TIMER = setTimeout(() => planCleanup(dailyCleanup()), delay);",
    replacement: "  CLEANUP_TIMER = setTimeout(dailyCleanup, delay);",
    expected: "Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup"
  },
  {
    nr: '2415', name: "Bei laufendem Backup erst am naechsten Tag",
    file: 'server.js',
    search: "const CLEANUP_RETRY_MS = HOUR_MS;",
    replacement: "const CLEANUP_RETRY_MS = DAY_MS;",
    expected: "Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup"
  },
  {
    nr: '2416', name: "Das Aufraeumen achtet nicht auf die Sperre",
    file: 'server.js',
    search: "  if (!lock) {\n    logLine(`Old backups: a backup is running",
    replacement: "  if (false) {\n    logLine(`Old backups: a backup is running",
    expected: "Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup"
  },
  {
    nr: '2417', name: "Das Sicherheitsprotokoll nennt den Server nicht",
    file: 'server.js',
    search: "auth.log('backup.delete', { detail: 'daily' });",
    replacement: "auth.log('backup.delete', {});",
    expected: "Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup"
  },
  {
    nr: '2418', name: "`backupCleanupAt` nennt nur den Tag",
    file: 'server.js',
    search: "  putSetting.run('backupCleanupAt', JSON.stringify({ day, at: sqlTime(now), removed, failed }));",
    replacement: "  putSetting.run('backupCleanupAt', JSON.stringify({ day }));",
    expected: "Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup"
  },
  {
    nr: '2419', name: "Das Merkmal fuer den Server fehlt",
    file: 'auth.js',
    search: "'both', 'part', 'daily'];",
    replacement: "'both', 'part'];",
    expected: "Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup"
  },
  {
    nr: '2420', name: "Das Server-Log nennt die Dateien",
    file: 'server.js',
    search: "      logLine(`Old backups removed at midnight: ${removed} (${out2.bytes} bytes freed)` +",
    replacement: "      logLine(`Old backups removed at midnight: ${matched.map(d => d.name).join(', ')} (${out2.bytes} bytes freed)` +",
    expected: "Alte Backups: einmal am Tag um Mitternacht, nicht nach dem Backup"
  },
  {
    nr: '2421', name: "Der Schalter heisst wie der Hinweis",
    file: 'public/app.js',
    search: "        ${tH('card.cleanupAtMidnight')}</label>",
    replacement: "        ${tH('card.cleanupHint')}</label>",
    expected: "Alte Backups: der Schalter um Mitternacht und das letzte Aufräumen"
  },
  {
    nr: '2422', name: "Die Karte nennt das letzte Aufraeumen nicht",
    file: 'public/app.js',
    search: "${tH('card.onlyOnButton')}</p>${lastCleanup(a.last)}",
    replacement: "${tH('card.onlyOnButton')}</p>",
    expected: "Alte Backups: der Schalter um Mitternacht und das letzte Aufräumen"
  },
  {
    nr: '2423', name: "Ohne geloeschte Backups bleibt die Zeile leer",
    file: 'public/app.js',
    search: "      : tH('card.cleanupLastNone', { at: fmtDate(last.at) })}</p>`);",
    replacement: "      : ''}</p>`);",
    expected: "Alte Backups: der Schalter um Mitternacht und das letzte Aufräumen"
  },
  {
    nr: '2424', name: "Das Protokoll nennt die Kommandozeile als Urheber",
    file: 'public/app.js',
    search: "    if (z.detail === 'daily') return t('card.atMidnight');\n",
    replacement: "",
    expected: "Alte Backups: der Schalter um Mitternacht und das letzte Aufräumen"
  },
  {
    nr: '2425', name: "Die Meldung nach dem Backup fragt wieder nach `cleaned`",
    file: 'public/app.js',
    search: "        toast(t('card.backupWrittenFile', { file: r.file, bytes: fmtBytes(r.bytes) }));",
    replacement: "        toast(t('card.backupWrittenFile', { file: r.file, bytes: fmtBytes(r.bytes) }) + (r.cleaned ? ' ·' : ''));",
    expected: "Alte Backups: der Schalter um Mitternacht und das letzte Aufräumen"
  },
  {
    nr: '2426', name: "Die Detailansicht fehlt in den Einstellungen",
    file: 'public/app.js',
    search: "  { key: 'detailview',   section: 'personal', visible: () => true,\n    markup: cardDetailView,  wireUp: setUpDetailViewOut },\n",
    replacement: "",
    expected: "„Darstellung“ und „Detailansicht“"
  },
  {
    nr: '2427', name: "Die Pillen der Detailansicht bleiben leer",
    file: 'public/app.js',
    search: "function setUpDetailViewOut() {\n  drawStrip();\n  drawLinkRows();\n  drawSearchNames();\n",
    replacement: "function setUpDetailViewOut() {\n",
    expected: "„Darstellung“ und „Detailansicht“"
  },
  {
    nr: '2428', name: "Die zweite Karte heisst anders",
    file: 'public/languages/de.json',
    search: "  \"card.detailView\": \"Detailansicht\",",
    replacement: "  \"card.detailView\": \"Ansicht\",",
    expected: "„Darstellung“ und „Detailansicht“"
  },
  {
    nr: '2429', name: "„Links“ nennt die Zahl zweimal",
    file: 'public/app.js',
    search: "    case 'kommentare': case 'links': return '';",
    replacement: "    case 'kommentare': return '';\n    case 'links': return String(item.links.length);",
    expected: "Eintrag: „Links“ nennt die Zahl einmal; ↓ ↑ unter „Dateien“ so hoch wie die Felder"
  },
  {
    nr: '2430', name: "↓ ↑ unter „Dateien“ bleiben 31 px hoch",
    file: 'public/style.css',
    search: ".asort-box .sort-way .pill { padding: 3px 9px; font-size: .7rem; }\n",
    replacement: "",
    expected: "Eintrag: „Links“ nennt die Zahl einmal; ↓ ↑ unter „Dateien“ so hoch wie die Felder"
  },
  {
    nr: '2431', name: "Die Zeile nennt immer 50 MB",
    file: 'public/app.js',
    search: "size: `${UPLOAD_LIMITS.attachment} MB` }",
    replacement: "size: '50 MB' }",
    expected: "„Speicher und Wartung“: die Zeile nennt Einstellung und Wert"
  },
  {
    nr: '2432', name: "Der Wert der Zeile bricht wieder um",
    file: 'public/app.js',
    search: "<span class=\"v kv-num\">${value}</span>",
    replacement: "<span class=\"v\">${value}</span>",
    expected: "„Speicher und Wartung“: die Zeile nennt Einstellung und Wert"
  },
  {
    nr: '2433', name: "Der Zurück-Knopf zeigt nur den Pfeil",
    file: 'public/app.js',
    search: "${ICON_BACK_OUT}<span class=\"back-word\">${tH('entry.menuBack')}</span></a>",
    replacement: "${ICON_BACK_OUT}</a>",
    expected: "Zurück-Knopf: mit Wort, wo die Kopfzeile kein Menü hat"
  },
  {
    nr: '2434', name: "Am Telefon steht das Wort neben dem Pfeil",
    file: 'public/style.css',
    search: "  .sub-back .back-word { display: none; }\n",
    replacement: "",
    expected: "Zurück-Knopf: mit Wort, wo die Kopfzeile kein Menü hat"
  },
  {
    nr: '2435', name: "Die Sperre beginnt wieder gleich nach dem Start",
    file: 'test/release_050.js',
    search: "    const longWaited = await lockFor(long, 12000);",
    replacement: "    const longWaited = await lockFor(long, 9500);",
    expected: "Prüfung zur Umlagerung: die Sperre ab der Datei unter upload/"
  },
  {
    nr: '2436', name: "Das Cover ist nicht mehr begrenzt",
    file: 'public/style.css',
    search: "width: 100%; max-width: 640px; display: flex; align-items: center; justify-content: center; }",
    replacement: "width: 100%; display: flex; align-items: center; justify-content: center; }",
    expected: "Vollbild mit Cover: die Wellenform über die Breite, das Cover bis 640 px"
  },
  {
    nr: '2437', name: "Der Regler setzt `--vol` nicht",
    file: 'public/app.js',
    search: "      slider.style.setProperty('--vol', `${v.level}%`);\n",
    replacement: "",
    expected: "Vollbild mit Cover: die Wellenform über die Breite, das Cover bis 640 px"
  },
  {
    nr: '2438', name: "Der Knopf des Reglers ist wieder 16 px",
    file: 'public/style.css',
    search: "width: 12px; height: 12px; margin-left: -4px;",
    replacement: "width: 16px; height: 16px; margin-left: -6px;",
    expected: "Vollbild mit Cover: die Wellenform über die Breite, das Cover bis 640 px"
  },
  {
    nr: '2439', name: "Der Knopf bleibt beim Darüberfahren grau",
    file: 'public/style.css',
    search: ".sd-volume:hover::-webkit-slider-thumb, .sd-volume:focus-visible::-webkit-slider-thumb { background: var(--accent-edge); }\n",
    replacement: "",
    expected: "Vollbild mit Cover: die Wellenform über die Breite, das Cover bis 640 px"
  },
  {
    nr: '2440', name: "Zwei Finger zoomen nicht",
    file: 'public/app.js',
    search: "      zoomTimeline(pinch.gap / now, share((a.x + b.x) / 2));\n",
    replacement: "",
    expected: "Zeitleiste: zoomen mit zwei Fingern über Pointer-Ereignisse"
  },
  {
    nr: '2441', name: "Der erste Finger auf der inaktiven Leiste zählt nicht mit",
    file: 'public/app.js',
    search: "    if (e.pointerType === 'touch') {\n      TL_FINGERS.set(",
    replacement: "    if (e.pointerType === 'touch' && tl.active) {\n      TL_FINGERS.set(",
    expected: "Zeitleiste: zoomen mit zwei Fingern über Pointer-Ereignisse"
  },
  {
    nr: '2442', name: "Das Ende eines Fingers beendet das Ziehen nicht",
    file: 'public/app.js',
    search: "    drag = null; downs.delete(e.pointerId);",
    replacement: "    downs.delete(e.pointerId);",
    expected: "Zeitleiste: zoomen mit zwei Fingern über Pointer-Ereignisse"
  },
  {
    nr: '2443', name: "Ein Finger ausserhalb der Leiste bleibt gezählt",
    file: 'public/app.js',
    search: "for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, (e) => { TL_FINGERS.delete(e.pointerId); }, true);\n",
    replacement: "",
    expected: "Zeitleiste: zoomen mit zwei Fingern über Pointer-Ereignisse"
  },
  {
    nr: '2444', name: "Die inaktive Leiste überlässt die Geste dem Browser",
    file: 'public/style.css',
    search: "  touch-action: pan-y;\n  /* Ein Doppelklick schaltet die Leiste um und markiert sonst die Jahreszahlen. */\n  user-select: none;\n}\n.timeline.active { outline-color: var(--accent-edge); cursor: grab; }",
    replacement: "  user-select: none;\n}\n.timeline.active { outline-color: var(--accent-edge); cursor: grab; touch-action: pan-y; }",
    expected: "Zeitleiste: zoomen mit zwei Fingern über Pointer-Ereignisse"
  },
  {
    nr: '2445', name: "Zwei Finger zoomen wieder über touchmove",
    file: 'public/app.js',
    search: "  box.addEventListener('pointercancel', end);\n}\n/* In px: Bewegung,",
    replacement: "  box.addEventListener('pointercancel', end);\n  box.addEventListener('touchmove', () => {}, { passive: true });\n}\n/* In px: Bewegung,",
    expected: "Zeitleiste: zoomen mit zwei Fingern über Pointer-Ereignisse"
  },
  {
    nr: '2446', name: "„Mein Account“ speichert ohne Rückfrage",
    file: 'public/app.js',
    search: "    const e = await confirmFieldFree(t('card.myAccount'), t('card.passwordNeeded'), false);\n    if (e === null) return;\n",
    replacement: "    const e = { password: '' };\n",
    expected: "„Persönlich“: Karte „Passwort“, „Zweiter Faktor“ unter „Mein Account“"
  },
  {
    nr: '2447', name: "Die Rückfrage verlangt auch den Code",
    file: 'public/app.js',
    search: "confirmFieldFree(t('card.myAccount'), t('card.passwordNeeded'), false)",
    replacement: "confirmFieldFree(t('card.myAccount'), t('card.passwordNeeded'), true)",
    expected: "„Persönlich“: Karte „Passwort“, „Zweiter Faktor“ unter „Mein Account“"
  },
  {
    nr: '2448', name: "„Passwort“ schickt den Namen mit",
    file: 'public/app.js',
    search: "{ oldPassword: old, newPassword: new1 }",
    replacement: "{ oldPassword: old, newPassword: new1, username: NAME }",
    expected: "„Persönlich“: Karte „Passwort“, „Zweiter Faktor“ unter „Mein Account“"
  },
  {
    nr: '2449', name: "„Passwort“ meldet ein fehlendes neues Passwort nicht",
    file: 'public/app.js',
    search: "    if (!new1) return toast(t('card.newPasswordMissing'), true);\n",
    replacement: "",
    expected: "„Persönlich“: Karte „Passwort“, „Zweiter Faktor“ unter „Mein Account“"
  },
  {
    nr: '2450', name: "Unter dem Titel des zweiten Faktors steht wieder eine Linie",
    file: 'public/style.css',
    search: ".two-factor-state { font-size: .87rem; line-height: 1.55; color: var(--text-2); }\n",
    replacement: ".two-factor-block { margin-top: 18px; border-top: 1px solid var(--line); padding-top: 14px; }\n.two-factor-state { font-size: .87rem; line-height: 1.55; color: var(--text-2); }\n",
    expected: "„Persönlich“: Karte „Passwort“, „Zweiter Faktor“ unter „Mein Account“"
  },
  {
    nr: '2451', name: "Die Karte „Passwort“ fehlt",
    file: 'public/app.js',
    search: "  { key: 'password',     section: 'personal', visible: () => true,\n    markup: cardPassword,   wireUp: setUpPasswordOut },\n",
    replacement: "",
    expected: "„Persönlich“: Karte „Passwort“, „Zweiter Faktor“ unter „Mein Account“"
  },
  {
    nr: '2452', name: "„Mein Account“ zeichnet den zweiten Faktor nicht",
    file: 'public/app.js',
    search: "  drawTwoFactor(fetched.account.twoFactor);\n}\n\n/* ---- Karte „Passwort",
    replacement: "}\n\n/* ---- Karte „Passwort",
    expected: "„Persönlich“: Karte „Passwort“, „Zweiter Faktor“ unter „Mein Account“"
  },
  {
    nr: '2453', name: "Am Telefon ist der Knopf der Richtung unter „Dateien“ 24 px hoch",
    file: 'public/style.css',
    search: "  .asort-box .sort-flip { min-height: 44px; }\n",
    replacement: "",
    expected: "Sortierrichtung: am Telefon so hoch wie „Kacheln · Liste“"
  },
  {
    nr: '2454', name: "Ohne Namen im Rumpf scheitert ein Passwortwechsel",
    file: 'auth.js',
    search: "  const name = String(newName || '').trim() || u.username;",
    replacement: "  const name = String(newName || '').trim();",
    expected: "PUT /api/account nimmt Teile des Rumpfs"
  },
  {
    nr: '2455', name: "Im Container gilt wieder der Pfad im Container",
    file: 'backup.js',
    search: "  if (b.id === a.id) return { inWorkDir: liesIn(root, appDir), sameDisk };",
    replacement: "  return { inWorkDir: liesIn(root, appDir), sameDisk };",
    expected: "Backup-Ordner: Lage auf dem Host aus /proc/self/mountinfo"
  },
  {
    nr: '2456', name: "Jeder Ordner gilt als derselbe Datenträger",
    file: 'backup.js',
    search: "  const sameDisk = b.dev === d.dev;",
    replacement: "  const sameDisk = true;",
    expected: "Backup-Ordner: Lage auf dem Host aus /proc/self/mountinfo"
  },
  {
    nr: '2457', name: "Leerzeichen als \\040 werden nicht gelesen",
    file: 'backup.js',
    search: "source: plain(f[3]), point: plain(f[4])",
    replacement: "source: f[3], point: f[4]",
    expected: "Backup-Ordner: Lage auf dem Host aus /proc/self/mountinfo"
  },
  {
    nr: '2458', name: "`data/` an der Wurzel seines Dateisystems gilt als Projektordner",
    file: 'backup.js',
    search: "inWorkDir: project === '/' ? null : liesIn(b.host, project)",
    replacement: "inWorkDir: liesIn(b.host, project)",
    expected: "Backup-Ordner: Lage auf dem Host aus /proc/self/mountinfo"
  },
  {
    nr: '2459', name: "Der Server liest /proc/self/mountinfo nicht",
    file: 'server.js',
    search: "  return backup.backupState(BACKUP_DIR, DATA_DIR, APP_DIR, mounts);",
    replacement: "  return backup.backupState(BACKUP_DIR, DATA_DIR, APP_DIR);",
    expected: "Backup-Ordner: die Antwort der Karte und kein Unterordner mehr"
  },
  {
    nr: '2460', name: "backuptool.js überspringt `--ort` still",
    file: 'backuptool.js',
    search: "    else if (args[i] === '--yes') options.yes = true;\n",
    replacement: "    else if (args[i] === '--yes') options.yes = true;\n    else if (args[i] === '--ort') i++;\n",
    expected: "Backup-Ordner: die Antwort der Karte und kein Unterordner mehr"
  },
  {
    nr: '2461', name: "Der Satz zum Datenträger fehlt",
    file: 'public/app.js',
    search: "      : d.sameDisk === true\n        ? `<p class=\"desc\" id=\"backup-place\" style=\"margin:0 0 12px\">${tMarks('card.backupSameDisk', { word: '<code>data/</code>' })}</p>` : '';",
    replacement: "      : '';",
    expected: "Die Sicherung in der Oberflaeche"
  },
  {
    nr: '2462', name: "Ohne Vergleich warnt die Karte trotzdem",
    file: 'public/app.js',
    search: "    const situation = d.inWorkDir === true\n",
    replacement: "    const situation = d.inWorkDir !== false\n",
    expected: "Die Sicherung in der Oberflaeche"
  },
  {
    nr: '2463', name: "Ein einzelner Tipp schaltet die Leiste um",
    file: 'public/app.js',
    search: "    if (lastTap && time - lastTap.time <= TL_DOUBLE_MS",
    replacement: "    if (true || lastTap && time - lastTap.time <= TL_DOUBLE_MS",
    expected: "Zeitleiste: Doppeltipp und Doppelklick schalten ein und aus"
  },
  {
    nr: '2464', name: "Der Doppeltipp kennt keine Zeitgrenze",
    file: 'public/app.js',
    search: "    if (lastTap && time - lastTap.time <= TL_DOUBLE_MS && ",
    replacement: "    if (lastTap && ",
    expected: "Zeitleiste: Doppeltipp und Doppelklick schalten ein und aus"
  },
  {
    nr: '2465', name: "Der Doppeltipp kennt keinen Abstand",
    file: 'public/app.js',
    search: " && Math.hypot(down.x - lastTap.x, down.y - lastTap.y) <= TL_DOUBLE_PX) {",
    replacement: ") {",
    expected: "Zeitleiste: Doppeltipp und Doppelklick schalten ein und aus"
  },
  {
    nr: '2466', name: "Ein Doppelklick schaltet nicht aus",
    file: 'public/app.js',
    search: "      setTimelineActive(!tl.active);\n",
    replacement: "      setTimelineActive(true);\n",
    expected: "Zeitleiste: Doppeltipp und Doppelklick schalten ein und aus"
  },
  {
    nr: '2467', name: "Das Abheben nach zwei Fingern zaehlt als Tipp",
    file: 'public/app.js',
    search: "        for (const d of downs.values()) d.moved = true;\n",
    replacement: "",
    expected: "Zeitleiste: Doppeltipp und Doppelklick schalten ein und aus"
  },
  {
    nr: '2468', name: "Die Zeile nennt nicht, wie man einschaltet",
    file: 'public/app.js',
    search: "    <div class=\"tl-below\"><span class=\"tl-how\">${tH(how)}</span>${",
    replacement: "    <div class=\"tl-below\">${tl.active ? `<span class=\"tl-how\">${tH(how)}</span>` : ''}${",
    expected: "Zeitleiste: Doppeltipp und Doppelklick schalten ein und aus"
  },
  {
    nr: '2469', name: "Ein Tipp auf einen Punkt schaltet die Leiste ein",
    file: 'public/app.js',
    search: "    tl.tapped = dot.dataset.key;\n    showHint(box, dot, p);\n",
    replacement: "    setTimelineActive(true);\n    tl.tapped = dot.dataset.key;\n    showHint(box, dot, p);\n",
    expected: "Zeitleiste: Tipp auf einen Punkt zeigt den Hinweis, ohne die Leiste einzuschalten"
  },
  {
    nr: '2470', name: "Der Finger muss den Punkt genau treffen",
    file: 'public/app.js',
    search: "pointerType === 'mouse' ? 0 : TL_TAP_REACH)",
    replacement: "0)",
    expected: "Zeitleiste: Tipp auf einen Punkt zeigt den Hinweis, ohne die Leiste einzuschalten"
  },
  {
    nr: '2471', name: "Die Maus trifft auch neben dem Punkt",
    file: 'public/app.js',
    search: "pointerType === 'mouse' ? 0 : TL_TAP_REACH)",
    replacement: "TL_TAP_REACH)",
    expected: "Zeitleiste: Tipp auf einen Punkt zeigt den Hinweis, ohne die Leiste einzuschalten"
  },
  {
    nr: '2472', name: "Die Tastatur oeffnet keinen Punkt",
    file: 'public/app.js',
    search: "    d.onclick = (e) => { if (!e.detail) location.hash = `#/item/${p.itemId}`; };",
    replacement: "    d.onclick = () => {};",
    expected: "Zeitleiste: Tipp auf einen Punkt zeigt den Hinweis, ohne die Leiste einzuschalten"
  },
  {
    nr: '2473', name: "Ziehen beginnt nicht auf einem Punkt",
    file: 'public/app.js',
    search: "    if (!tl.active) return;\n    drag = { x: e.clientX,",
    replacement: "    if (!tl.active || e.target.closest('.timeline-dot')) return;\n    drag = { x: e.clientX,",
    expected: "Zeitleiste: Ziehen beginnt auch auf einem Punkt"
  },
  {
    nr: '2474', name: "Kurzes Ziehen gilt danach als Tipp",
    file: 'public/app.js',
    search: "    drag.moved = true;\n    if (down) down.moved = true;\n",
    replacement: "    drag.moved = true;\n",
    expected: "Zeitleiste: Ziehen beginnt auch auf einem Punkt"
  },
  {
    nr: '2475', name: "Die Hinweiszeile bricht um",
    file: 'public/style.css',
    search: ".tl-below { display: flex; justify-content: flex-end; align-items: center; gap: 14px; margin: 12px 0 18px;\n  font-size: .8rem; color: var(--muted); white-space: nowrap; }",
    replacement: ".tl-below { display: flex; justify-content: flex-end; align-items: center; gap: 14px; margin: 12px 0 18px;\n  font-size: .8rem; color: var(--muted); }",
    expected: "Zeitleiste: der Hinweis steht immer in einer Zeile"
  },
  {
    nr: '2476', name: "„Alles zeigen“ aendert die Hoehe der Legende",
    file: 'public/style.css',
    search: ".tl-all { flex-shrink: 0; }",
    replacement: ".tl-all { min-width: 0; overflow: hidden; }",
    expected: "Zeitleiste: der Hinweis steht immer in einer Zeile"
  },
  {
    nr: '2477', name: "Ein Doppelklick markiert die Jahreszahlen",
    file: 'public/style.css',
    search: "  user-select: none;\n}\n.timeline.active",
    replacement: "}\n.timeline.active",
    expected: "Zeitleiste: der Hinweis steht immer in einer Zeile"
  },
  {
    nr: '2478', name: "Der Satz nennt den Wert nicht",
    file: 'public/app.js',
    search: "tMarks('card.partialSeeRating', { word: `<span id=\"pot-share\">${Number(PARTIAL_SHARE)}</span>` },",
    replacement: "tMarks('card.partialSeeRating', { word: '<span id=\"pot-share\"></span>' },",
    expected: "„Potenzial: Kriterien“: „Teilweise“ verweist auf die Schwelle unter „Bewertung“"
  },
  {
    nr: '2479', name: "Der Satz folgt der Schwelle nicht",
    file: 'public/app.js',
    search: "    atElement('pot-share', el => { el.textContent = String(PARTIAL_SHARE); });\n",
    replacement: "",
    expected: "„Potenzial: Kriterien“: „Teilweise“ verweist auf die Schwelle unter „Bewertung“"
  },
  {
    nr: '2480', name: "„Teilweise“ fehlt als Abschnitt in „Potenzial: Kriterien“",
    file: 'public/app.js',
    search: "${setting(tH('card.setPartial'), tMarks('card.partialSeeRating',",
    replacement: "${setting('', tMarks('card.partialSeeRating',",
    expected: "„Potenzial: Kriterien“: „Teilweise“ verweist auf die Schwelle unter „Bewertung“"
  },
  {
    nr: '2481', name: "Der Export schreibt nur das erste Stueck einer Datei",
    file: 'server.js',
    search: "for (let k = 0; bytes && k < bytes.length; k += EXPORT_PIECE)",
    replacement: "for (let k = 0; bytes && k < Math.min(bytes.length, EXPORT_PIECE); k += EXPORT_PIECE)",
    expected: "Export: jede Datei in Stuecken, die Datei bleibt dieselbe"
  },
  {
    nr: '2482', name: "Die Stuecke sind kein Vielfaches von 3 Bytes",
    file: 'server.js',
    search: "const EXPORT_PIECE = 3 * 1024 * 1024;",
    replacement: "const EXPORT_PIECE = 3 * 1024 * 1024 + 1;",
    expected: "Export: jede Datei in Stuecken, die Datei bleibt dieselbe"
  },
  {
    nr: '2483', name: "Der Platzhalter bleibt hinter der Datei stehen",
    file: 'server.js',
    search: "      at = m.index + m[0].length - 1;",
    replacement: "      at = m.index + 1;",
    expected: "Export: jede Datei in Stuecken, die Datei bleibt dieselbe"
  },
  {
    nr: '2484', name: "Eine Datei auf der Platte fehlt im Export",
    file: 'server.js',
    search: "  if (funnel.stream) return { ['data' + extension]: funnel.take(null, ['disk', a2.id]) };",
    replacement: "  if (funnel.stream) return {};",
    expected: "Export: jede Datei in Stuecken, die Datei bleibt dieselbe"
  },
  {
    nr: '2485', name: "Der Export liest Fotos aus der falschen Spalte",
    file: 'server.js',
    search: "  photo: db.prepare('SELECT data FROM photos WHERE id = ?'),",
    replacement: "  photo: db.prepare('SELECT thumb AS data FROM photos WHERE id = ?'),",
    expected: "Export: jede Datei in Stuecken, die Datei bleibt dieselbe"
  },
  {
    nr: '2486', name: "Der Import lagert nie aus",
    file: 'server.js',
    search: "        if (kept.length < SPILL_FROM) continue;",
    replacement: "        if (kept.length >= 0) continue;",
    expected: "Import: lange Base64-Strings gehen in Dateien, die Bytes kommen gleich an"
  },
  {
    nr: '2487', name: "Die ausgelagerten Dateien bleiben liegen",
    file: 'server.js',
    search: "    if (spillDir) fs.rmSync(spillDir, { recursive: true, force: true });\n",
    replacement: "",
    expected: "Import: lange Base64-Strings gehen in Dateien, die Bytes kommen gleich an"
  },
  {
    nr: '2488', name: "Die Transaktion haelt die Bytes im Speicher",
    file: 'server.js',
    search: "                    buf: laterOf(p, 'data', spilled) || buf,",
    replacement: "                    buf,",
    expected: "Import: lange Base64-Strings gehen in Dateien, die Bytes kommen gleich an"
  },
  {
    nr: '2489', name: "Ein Rest von weniger als vier Zeichen geht verloren",
    file: 'server.js',
    search: "      const cut = last ? all.length : all.length - all.length % 4;",
    replacement: "      const cut = all.length - all.length % 4;",
    expected: "Import: lange Base64-Strings gehen in Dateien, die Bytes kommen gleich an"
  },
  {
    nr: '2490', name: "Escapes im Base64-String werden nicht gelesen",
    file: 'server.js',
    search: "        else piece = JSON_ESCAPES[e] ?? e;",
    replacement: "        else piece = '';",
    expected: "Import: lange Base64-Strings gehen in Dateien, die Bytes kommen gleich an"
  },
  {
    nr: '2491', name: "Der Import dekodiert auch Strings ohne `_base64` im Schluessel",
    file: 'server.js',
    search: "      if (z === '\"' && inObject && key.endsWith('_base64\"')) {",
    replacement: "      if (z === '\"' && inObject && !wantKey) {",
    expected: "Import: lange Base64-Strings gehen in Dateien, die Bytes kommen gleich an"
  },
  {
    nr: '2492', name: "Die Upload-Pruefung je Eintrag kommt zurueck",
    file: 'server.js',
    search: "  if (size > most * MB) return res.status(413).json({ error: t(locale, 'server.uploadSize', { mb: most }) });\n",
    replacement: "  if (size > most * MB) return res.status(413).json({ error: t(locale, 'server.uploadSize', { mb: most }) });\n  if (!large && size > 1024 * 1024) return res.status(413).json({ error: 'voll' });\n",
    expected: "Keine Grenze je Eintrag: Hochladen, Plan und Meldungen"
  },
  {
    nr: '2493', name: "Der Plan nennt wieder eine Grenze",
    file: 'server.js',
    search: "           targetSize, fallback: EXCHANGE_WARN, smallest: EXCHANGE_PART_MIN };",
    replacement: "           targetSize, fallback: EXCHANGE_WARN, smallest: EXCHANGE_PART_MIN, tooBig: [] };",
    expected: "Keine Grenze je Eintrag: Hochladen, Plan und Meldungen"
  },
  {
    nr: '2494', name: "Der Dialog zaehlt Eintraege auch in tieferen Ebenen",
    file: 'public/app.js',
    search: "      if (stack.length === 2 && f.key === 'items' && t === '{') info.count++;",
    replacement: "      if (f.key === 'items' && t === '{') info.count++;",
    expected: "Dialog beim Import: die Datei wird stueckweise gelesen"
  },
  {
    nr: '2495', name: "Der Dialog zaehlt ein Video als Foto",
    file: 'public/app.js',
    search: "      if (f.kind !== 'video') info.withPhotos = true;",
    replacement: "      info.withPhotos = true;",
    expected: "Dialog beim Import: die Datei wird stueckweise gelesen"
  },
  {
    nr: '2496', name: "Der Dialog liest Escapes im Titel nicht",
    file: 'public/app.js',
    search: "          str.text += ({ n: '\\n', t: '\\t', r: '\\r', b: '\\b', f: '\\f' })[c] ?? c;",
    replacement: "          str.text += '';",
    expected: "Dialog beim Import: die Datei wird stueckweise gelesen"
  },
  {
    nr: '2497', name: "Der Dialog nimmt eine abgebrochene Datei an",
    file: 'public/app.js',
    search: "  return started && !stack.length && !str ? info : null;",
    replacement: "  return started ? info : null;",
    expected: "Dialog beim Import: die Datei wird stueckweise gelesen"
  },
  {
    nr: '2498', name: "Der Dialog liest die ganze Datei als Text",
    file: 'public/app.js',
    search: "  scanExport(file).catch(() => null).then(found => { info = found; show(); });",
    replacement: "  const reader = new FileReader();\n  reader.onload = () => { try { info = JSON.parse(reader.result); } catch { info = null; } show(); };\n  reader.readAsText(file);",
    expected: "Dialog beim Import: die Datei wird stueckweise gelesen"
  },
  {
    nr: '2499', name: "Leerraum zaehlt bei den Vierergruppen mit",
    file: 'server.js',
    search: "      piece = piece.replace(/\\s+/g, '');\n",
    replacement: "",
    expected: "Import: lange Base64-Strings gehen in Dateien, die Bytes kommen gleich an"
  },
  {
    nr: '2500', name: "Der Import navigiert wieder ueber location.hash",
    file: 'public/app.js',
    search: "        await dialogSettled();\n        history.replaceState(null, '', '#/');\n        route();\n        // Ergebnis und Hinweise",
    replacement: "        location.hash = '#/';\n        if (location.hash === '#/') renderList();\n        // Ergebnis und Hinweise",
    expected: "Was Export, Import und Backup enthalten"
  },
  {
    nr: '2501', name: "Die Pause-Taste hat wieder duenne Striche",
    file: 'public/app.js',
    search: "const ICON_PAUSE = char('<path d=\"M8.5 7v10\"/><path d=\"M15.5 7v10\"/>', 3);",
    replacement: "const ICON_PAUSE = char('<path d=\"M8.5 7v10\"/><path d=\"M15.5 7v10\"/>', 1.7);",
    expected: "Audio: die Pause-Taste mit kurzen, kraeftigen Strichen"
  },
  {
    nr: '2502', name: "Ein Punkt im CHANGELOG ist wieder ein Absatz",
    file: 'CHANGELOG.md',
    search: "- The pause button of the audio player has shorter, thicker bars.\n",
    replacement: "- The pause button of the audio player has shorter, thicker bars: they are 10 instead of 14 units long and 3 instead of 1.7 wide, so the button no longer looks stretched next to the play button.\n",
    expected: "Das CHANGELOG ist englisch und kurz"
  },
  {
    nr: '2503', name: "0.41.0 steht wieder als eigener Abschnitt im CHANGELOG",
    file: 'CHANGELOG.md',
    search: "\n- 0.41.0: Comments take videos;",
    replacement: "\n## [0.41.0] - 2026-09-24\n\n- Comments take videos;",
    expected: "Das CHANGELOG ist englisch und kurz"
  },
  {
    nr: '2504', name: "MediaInfo liest Audio bei den Fotos wieder je Stueck mit substr()",
    file: 'server.js',
    search: "    const data = qPhotoData.get(id)?.data;\n    if (!data) throw unreadable('gone');\n    const { cover, ...read } = await attachments.mediaFacts(data.length,\n      (length, offset) => data.subarray(offset, offset + length), { audio: p.kind === 'audio' });\n",
    replacement: "    const { cover, ...read } = await attachments.mediaFacts(p.size, (length, offset) => {\n      const bytes = qPhotoPart.get(offset + 1, length, id)?.part;\n      if (!bytes || bytes.length < Math.min(length, p.size - offset)) throw unreadable('gone');\n      return bytes;\n    }, { audio: p.kind === 'audio' });\n",
    expected: "Audio bei den Fotos: MediaInfo liest die Datei einmal ganz"
  },
  {
    nr: '2505', name: "makePhotoMedia() gibt auf, obwohl die Bytes da sind",
    file: 'server.js',
    search: "    if (!data) throw unreadable('gone');\n    const { cover, ...read }",
    replacement: "    if (data) throw unreadable('gone');\n    const { cover, ...read }",
    expected: "Audio bei den Fotos: MediaInfo liest die Datei einmal ganz"
  },
  {
    nr: '2506', name: "Ohne fremde Eintraege steht trotzdem eine Legende ueber der Leiste",
    file: 'public/app.js',
    search: "  box.innerHTML = `${foreign ? `<div class=\"timeline-legend\">",
    replacement: "  box.innerHTML = `${true ? `<div class=\"timeline-legend\">",
    expected: "Zeitleiste: Hinweis und „Alles zeigen“ unter der Leiste, darueber nur eigene und andere"
  },
  {
    nr: '2507', name: "Die aktive Leiste bekommt eine Zeile darueber",
    file: 'public/app.js',
    search: "  box.innerHTML = `${foreign ? `<div class=\"timeline-legend\">",
    replacement: "  box.innerHTML = `${foreign || tl.active ? `<div class=\"timeline-legend\">",
    expected: "Zeitleiste: ueber der Leiste aendert sich beim Bedienen nichts"
  },
  {
    nr: '2508', name: "Die Zeile unter der Leiste steht links",
    file: 'public/style.css',
    search: ".tl-below { display: flex; justify-content: flex-end;",
    replacement: ".tl-below { display: flex;",
    expected: "Zeitleiste: eine Zeile, rechtsbuendig, der aktive Hinweis am Telefon kurz"
  },
  {
    nr: '2509', name: "Der aktive Hinweis am Telefon nennt wieder das Wischen",
    file: 'public/languages/de.json',
    search: "\"list.timelineZoomTouch\": \"Zwei Finger zoomen · Doppeltipp beendet\"",
    replacement: "\"list.timelineZoomTouch\": \"Zwei Finger zoomen · Wischen verschiebt · Doppeltipp beendet\"",
    expected: "Zeitleiste: eine Zeile, rechtsbuendig, der aktive Hinweis am Telefon kurz"
  },
  {
    nr: '2510', name: "Die Liste am Telefon nennt keine Dauer",
    file: 'public/app.js',
    search: "    li.querySelector('.adur').textContent = shown || '';\n",
    replacement: "",
    expected: "„Dateien“ am Telefon: die Dauer zwischen Groesse und Datum"
  },
  {
    nr: '2511', name: "Die Dauer steht hinter dem Datum",
    file: 'public/style.css',
    search: "  .alist .adur { display: block; grid-column: 3; grid-row: 2;",
    replacement: "  .alist .adur { display: block; grid-column: 5; grid-row: 2;",
    expected: "„Dateien“ am Telefon: die Dauer zwischen Groesse und Datum"
  },
  {
    nr: '2512', name: "Zwischen Groesse und Dauer fehlt der Punkt",
    file: 'public/style.css',
    search: "  .alist .asize:not(:empty) + .adur:not(:empty)::before,\n",
    replacement: "",
    expected: "„Dateien“ am Telefon: die Dauer zwischen Groesse und Datum"
  },
  {
    nr: '2513', name: "Ab einer Stunde wieder nur Minuten",
    file: 'public/app.js',
    search: "  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;",
    replacement: "  return `${h * 60 + m}:${s}`;",
    expected: "„Dateien“ am Telefon: die Dauer zwischen Groesse und Datum"
  },
  {
    nr: '2514', name: "Am Desktop steht die Dauer zweimal",
    file: 'public/style.css',
    search: ".akind, .asize, .adur, .adate, .afrom, .anote, .aadd .aname { display: none; }",
    replacement: ".akind, .asize, .adate, .afrom, .anote, .aadd .aname { display: none; }",
    expected: "„Dateien“ am Telefon: die Dauer zwischen Groesse und Datum"
  },
  {
    nr: '2515', name: "Die Infos speichern die Abtastart nicht",
    file: 'attachments.js',
    search: "      scanType: mediaText(tr.ScanType),\n",
    replacement: "",
    expected: "Videos: die Abtastart steht in den Infos, alte Zeilen werden einmal neu gelesen"
  },
  {
    nr: '2516', name: "Eine Zeile ohne Abtastart wird beim Abruf nicht neu gelesen",
    file: 'server.js',
    search: "  if (known && !(kind === 'image' && a.stale) && !a.soundless && !a.unscanned) return known;",
    replacement: "  if (known && !(kind === 'image' && a.stale) && !a.soundless) return known;",
    expected: "Videos: die Abtastart steht in den Infos, alte Zeilen werden einmal neu gelesen"
  },
  {
    nr: '2517', name: "Beim Start sucht der Server Zeilen ohne Abtastart nicht",
    file: 'server.js',
    search: " OR (${SOUND_STALE}) OR (${SCAN_STALE})\n  ORDER BY a.id DESC`);",
    replacement: " OR (${SOUND_STALE})\n  ORDER BY a.id DESC`);",
    expected: "Videos: die Abtastart steht in den Infos, alte Zeilen werden einmal neu gelesen"
  },
  {
    nr: '2518', name: "Zeilen ohne Abtastart kommen nicht in die Reihe",
    file: 'server.js',
    search: "|| r.soundless || r.unscanned) &&",
    replacement: "|| r.soundless) &&",
    expected: "Videos: die Abtastart steht in den Infos, alte Zeilen werden einmal neu gelesen"
  },
  {
    nr: '2519', name: "Die Liste nennt Breite und Hoehe eines Videos nicht",
    file: 'server.js',
    search: "{ codec: a2.codec, width: a2.video_width, height: a2.video_height, frameRate: a2.frame_rate,",
    replacement: "{ codec: a2.codec, frameRate: a2.frame_rate,",
    expected: "Videos: die Abtastart steht in den Infos, alte Zeilen werden einmal neu gelesen"
  },
  {
    nr: '2520', name: "Halbbilder zaehlen als Vollbilder",
    file: 'public/app.js',
    search: "Math.round((Number(a.frameRate) || 0) * (fields ? 2 : 1)) || '';",
    replacement: "Math.round(Number(a.frameRate) || 0) || '';",
    expected: "Spalte „Art“: Aufloesung und Bildrate, etwa „H.264 · 1080p30 · 2:41“"
  },
  {
    nr: '2521', name: "Ab 2160 Zeilen steht wieder „4K“",
    file: 'public/app.js',
    search: "  return `${lines}${fields ? 'i' : 'p'}${rate}`;",
    replacement: "  return `${lines >= 2160 ? '4K' : lines + (fields ? 'i' : 'p')}${rate}`;",
    expected: "Spalte „Art“: Aufloesung und Bildrate, etwa „H.264 · 1080p30 · 2:41“"
  },
  {
    nr: '2522', name: "Hochformat zaehlt die laengere Seite",
    file: 'public/app.js',
    search: "const lines = Math.min(Number(a.width) || 0, Number(a.height) || 0);",
    replacement: "const lines = Math.max(Number(a.width) || 0, Number(a.height) || 0);",
    expected: "Spalte „Art“: Aufloesung und Bildrate, etwa „H.264 · 1080p30 · 2:41“"
  },
  {
    nr: '2523', name: "Die Spalte „Art“ bleibt 150 px breit",
    file: 'public/style.css',
    search: ".alist { --acols: 32px minmax(0, 1fr) 10.7rem 4.6rem 5.8rem; }",
    replacement: ".alist { --acols: 32px minmax(0, 1fr) 10rem 4.6rem 5.8rem; }",
    expected: "Spalte „Art“: Aufloesung und Bildrate, etwa „H.264 · 1080p30 · 2:41“"
  },
  {
    nr: '2524', name: "Screenreader hoeren die Aufloesung nicht",
    file: 'public/app.js',
    search: "video ? videoFormat(a) : '', length,",
    replacement: "length,",
    expected: "Spalte „Art“: Aufloesung und Bildrate, etwa „H.264 · 1080p30 · 2:41“"
  },
  {
    nr: '2525', name: "Audio bekommt eine Aufloesung",
    file: 'public/app.js',
    search: "kind === 'video' ? videoFormat(a) : ''",
    replacement: "videoFormat(a)",
    expected: "Spalte „Art“: Aufloesung und Bildrate, etwa „H.264 · 1080p30 · 2:41“"
  },
  {
    nr: '2526', name: "Eine Bildrate unter 0,5 wird „1080p0“",
    file: 'public/app.js',
    search: "  const rate = Math.round((Number(a.frameRate) || 0) * (fields ? 2 : 1)) || '';",
    replacement: "  const rate = Number(a.frameRate) > 0 ? Math.round(a.frameRate * (fields ? 2 : 1)) : '';",
    expected: "Spalte „Art“: Aufloesung und Bildrate, etwa „H.264 · 1080p30 · 2:41“"
  },
  {
    nr: '2527', name: "Im veroeffentlichten Stand melden die Gegenproben die fehlenden Ziele",
    file: 'test/selfcheck.js',
    search: "if (!published) fail.push(",
    replacement: "fail.push(",
    expected: "Die Gegenproben greifen"
  },
  {
    nr: '2528', name: "Vor dem Commit laeuft kein npm test im Export",
    file: 'tools/publish.js',
    search: "    rot = pruefstand(index, path.join(ordner, 'export'));\n",
    replacement: "",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2529', name: "Ein roter npm test im Export bricht nicht ab",
    file: 'tools/publish.js',
    search: "  if (rot) abbruch(rot);",
    replacement: "  if (false) abbruch(rot);",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2530', name: "Der Export hat kein node_modules",
    file: 'tools/publish.js',
    search: "  if (fs.existsSync(module)) fs.symlinkSync(module, path.join(ziel, 'node_modules'), 'dir');\n",
    replacement: "",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2531', name: "Der Tag traegt wieder ein v vor der Version",
    file: 'tools/publish.js',
    search: "  git('tag', '-a', version, '-m', version, commit);",
    replacement: "  git('tag', '-a', `v${version}`, '-m', version, commit);",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2532', name: "Nach npm test im Export stehen die letzten 12 Zeilen statt der Summe",
    file: 'tools/publish.js',
    search: "  const schluss = (ab < 0 ? zeilen.slice(-12) : zeilen.slice(ab, ab + 12)).join('\\n');",
    replacement: "  const schluss = zeilen.slice(-12).join('\\n');",
    expected: "Veroeffentlichen: Gegenstelle, Version, CHANGELOG, Tag und Notizen"
  },
  {
    nr: '2533', name: "Freischalten schreibt ohne Transaktion",
    file: 'auth.js',
    search: "  return db.transaction(() => {\n    const a = getRequest(id);",
    replacement: "  return (() => {\n    const a = getRequest(id);",
    expected: "Freischalten: Zugang, Link und Anfrage in einer Transaktion"
  },
  {
    nr: '2534', name: "Eine halbe Freischaltung wird nicht fortgesetzt",
    file: 'auth.js',
    search: "    const half = qHalfApproved.get(a.username, a.email, a.created_at);",
    replacement: "    const half = null;",
    expected: "Freischalten: eine halbe Freischaltung wird fortgesetzt, ein fremder Name abgewiesen"
  },
  {
    nr: '2535', name: "Ein fremder Name meldet nur, dass es ihn gibt",
    file: 'auth.js',
    search: "        throw new Message('server.requestNameTaken');",
    replacement: "        throw new Message('login.usernameTaken');",
    expected: "Freischalten: eine halbe Freischaltung wird fortgesetzt, ein fremder Name abgewiesen"
  },
  {
    nr: '2536', name: "Ein Zugang mit Passwort gilt als halbe Freischaltung",
    file: 'auth.js',
    search: "    WHERE username = ? COLLATE NOCASE AND email = ? COLLATE NOCASE AND password_hash = ''",
    replacement: "    WHERE username = ? COLLATE NOCASE AND (email = ? COLLATE NOCASE OR 1)",
    expected: "Freischalten: eine halbe Freischaltung wird fortgesetzt, ein fremder Name abgewiesen"
  },
  {
    nr: '2537', name: "Codec und Aufloesung stehen ohne eigene Huelle",
    file: 'public/app.js',
    search: "          ? Object.assign(document.createElement('span'), { className: `ak${at + 1}`, textContent: part }) : part;",
    replacement: "          ? part : part;",
    expected: "Spalte „Typ“: 2160p30 statt 4K30, Codec und Aufloesung mit fester Breite je Ordner"
  },
  {
    nr: '2538', name: "Die Breite wird nicht je Ordner gesetzt",
    file: 'public/app.js',
    search: "      alignKinds(grid);\n    };",
    replacement: "    };",
    expected: "Spalte „Typ“: 2160p30 statt 4K30, Codec und Aufloesung mit fester Breite je Ordner"
  },
  {
    nr: '2539', name: "Die Huelle des Codecs hat keine Mindestbreite",
    file: 'public/style.css',
    search: ".alist .ak1 { display: inline-block; min-width: calc(var(--ak1, 0) * 1ch); }",
    replacement: ".alist .ak1 { display: inline-block; }",
    expected: "Spalte „Typ“: 2160p30 statt 4K30, Codec und Aufloesung mit fester Breite je Ordner"
  },
  {
    nr: '2540', name: "Die englische README nennt die GPL von ffmpeg nicht",
    file: 'README.md',
    search: "GPL** (`--enable-gpl` in the `Dockerfile`).",
    replacement: "GPL**.",
    expected: "Die Lizenz geht mit hinaus"
  }
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
