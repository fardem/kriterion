/* Das Schema der Datenbank. db.js legt es an; backuptool.js vergleicht ein Backup
   damit, ohne die laufende Datenbank zu oeffnen. */
const Database = require('better-sqlite3-multiple-ciphers');

/* Kein Backtick im Schema, auch nicht in SQL-Kommentaren: er beendet den
   Template-String. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS product_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- IN WELCHER SPRACHE DIESER NAME GESCHRIEBEN IST. NULL IST ERLAUBT UND
  -- BEDEUTET „weiss niemand"; die Karte bietet einen Knopf zum Zuordnen an.
  -- Eine neue Zeile entsteht nie mehr ohne Sprachvermerk.
  language TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rejected INTEGER NOT NULL DEFAULT 0,
  -- WANN, WARUM UND VON WEM abgelehnt wurde. Die drei gehoeren zu rejected und
  -- ersetzen es NICHT. ALLE DREI SIND NULLBAR -- eine alte Ablehnung kennt
  -- weder Datum noch Verfasser --, und beim Ausschalten bleiben sie stehen.
  rejected_at TEXT,
  rejected_reason TEXT,
  -- ON DELETE SET NULL wie an jedem Traeger: ein entfernter
  -- Zugang nimmt die Entscheidung nicht mit, nur seinen Namen davon.
  rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tested INTEGER NOT NULL DEFAULT 0,
  -- favorite wird nicht mehr beschrieben. Der Favorit gehoert einem Benutzer
  -- und steht in item_pins; die Spalte bleibt nur stehen, damit eine bestehende
  -- und eine frische Instanz dasselbe Schema tragen.
  favorite INTEGER NOT NULL DEFAULT 0,
  product_category_id INTEGER REFERENCES product_categories(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- ON DELETE SET NULL, nicht CASCADE: ein entfernter Benutzer darf nicht den
  -- halben Bestand mitnehmen. Gilt fuer jede user_id an Inhalten.
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- photos traegt ZWEI Arten in EINER Tabelle: zwei Tabellen hiessen zwei
-- sortierte Listen und damit zwei Quellen fuer die Frage nach dem Hauptbild.
-- Was die Spalten bei einem Video bedeuten:
--
--   Spalte           bei kind = 'image'      bei kind = 'video'
--   ---------------  --------------------  ----------------------------
--   data             das Originalbild      die VIDEODATEI
--   thumb            Kachel 400 px         STANDBILD 400 px
--   medium           1600 px               STANDBILD 1600 px
--   focus_x/focus_y  Ausschnitt der Kachel dasselbe, am Standbild
--   zoom             wie eng der Ausschn. dasselbe, am Standbild
--   duration            NULL                  Sekunden
--
-- Das Standbild erzeugt der Browser des Hochladenden und nicht der Server:
-- es ist eine Vorschau und kein Beleg.
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  thumb BLOB,
  medium BLOB,
  -- Kein CHECK auf die beiden erlaubten Werte, obwohl SQLite einen annaehme:
  -- die Menge stuende dann zweimal -- hier und dort, wo der Server sie prueft.
  -- Zwei Stellen fuer dieselbe Liste laufen auseinander.
  kind TEXT NOT NULL DEFAULT 'image',   -- 'image' | 'video' | 'audio'
  duration INTEGER,                      -- Sekunden, bei Video und Audio
  -- Fokuspunkt in Prozent. DAS ORIGINAL BLEIBT UNANGETASTET; geschnitten wird
  -- ausschliesslich die Ableitung thumb, und zwar am Server. DIE DREI WERTE
  -- SIND DAS REZEPT der Kachel -- der Ausschnitt ist jederzeit aenderbar.
  focus_x REAL NOT NULL DEFAULT 50,
  focus_y REAL NOT NULL DEFAULT 50,
  -- Der dritte Wert dieser Art heisst zoom und steht weiter unten.
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- WIE ENG DAS FENSTER SITZT, in Prozent: 100 heisst „so weit wie das Bild
  -- hergibt", 400 viermal so nah; die Spanne steht im Server, nicht als CHECK.
  zoom REAL NOT NULL DEFAULT 100,
  -- data am Ende: was dahinter steht, ist nur ueber die Overflow-Kette zu lesen.
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_item ON photos(item_id, sort_order);

-- Ein Link gehoert dem, der ihn eintraegt, nicht dem Verfasser des Eintrags.
-- ON DELETE SET NULL und ausdruecklich NICHT NOT NULL: die Spalte muss den
-- Fall aushalten, in dem eine Zeile in users doch verschwindet.
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_links_item ON links(item_id, sort_order);

-- UNIQUE(item_id, day, user_id): zwei Leute am selben Datum sind kein
-- Konflikt, sondern zwei Testtage.
CREATE TABLE IF NOT EXISTS test_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(item_id, day, user_id)
);
CREATE INDEX IF NOT EXISTS idx_testdays_item ON test_days(item_id, day);

CREATE TABLE IF NOT EXISTS rating_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- DAS GEWICHT im Gesamtschnitt; 1 heisst „zaehlt wie jedes andere", erlaubt
  -- ist 0,2 bis 2. KEIN CHECK hier: die Spanne stuende sonst zweimal, hier und
  -- als GEWICHT_MIN/GEWICHT_MAX im Server. REAL und nicht Hundertstel.
  weight REAL NOT NULL DEFAULT 1.0,
  -- ZU WELCHEM KASTEN DIESES KRITERIUM GEHOERT: 'before' ist die Einschaetzung
  -- vor dem Test, 'after' das Urteil danach. KEIN CHECK hier -- die Menge der
  -- Werte steht als PHASEN genau einmal, in server.js. UNIQUE(name) bleibt global.
  phase TEXT NOT NULL DEFAULT 'after',
  -- IN WELCHER SPRACHE DIESER NAME GESCHRIEBEN IST -- dieselbe Spalte mit
  -- derselben Bedeutung wie an product_categories. NULL heisst „unbekannt"
  -- und nicht „keine".
  language TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* DIE NAMEN JE SPRACHE: zwei Tabellen daneben und keine Spalte an den
   vorhandenen -- eine zweite Zeile je Sprache traefe sonst jede Bewertung im
   Bestand. Ohne Zeile gilt der Name der Grundtabelle. */
CREATE TABLE IF NOT EXISTS criterion_names (
  criterion_id INTEGER NOT NULL REFERENCES rating_criteria(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(criterion_id, language)
);
CREATE TABLE IF NOT EXISTS category_names (
  category_id INTEGER NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(category_id, language)
);

-- Jeder Benutzer hat seine eigene Zeile je Kriterium.
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  criterion_id INTEGER NOT NULL REFERENCES rating_criteria(id) ON DELETE CASCADE,
  value INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- WANN DIESER WERT ZULETZT GESETZT WURDE -- die Zeile entsteht beim ersten
  -- Stern und wird danach ueberschrieben. OHNE VORGABEWERT: eine Zeile ohne
  -- Zeitpunkt heisst „unbekannt", und die Glocke uebergeht sie.
  set_at TEXT,
  UNIQUE(item_id, criterion_id, user_id)
);
-- Im UNIQUE darueber steht criterion_id an zweiter Stelle und ist von links
-- nicht greifbar; die Kriterienkarte zaehlt je Kriterium ueber alle
-- Bewertungen. Gemessen an 12.000 Bewertungen: 1,4 ms statt 6,8.
CREATE INDEX IF NOT EXISTS idx_ratings_criterion ON ratings(criterion_id, value, item_id);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  -- Zwei unabhaengige Merkmale, frei kombinierbar wie "getestet"/"abgelehnt"
  -- beim Eintrag: die Art (note/report) und das Anpinnen.
  kind TEXT NOT NULL DEFAULT 'note',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- DER EINGRIFFSVERMERK, Ausnahme von „kein Aenderungsverlauf": eine Aussage
  -- ueber den JETZIGEN Zustand, kein Wer, kein Wann. Hochgezaehlt nur, wenn ein
  -- ANDERER als der Verfasser ein Bild entfernt; nicht zuruecksetzbar.
  images_removed INTEGER NOT NULL DEFAULT 0,
  -- DAS FAELLIGKEITSDATUM EINER AUFGABE: EIN DATUM, KEINE UHRZEIT, als Text
  -- 'JJJJ-MM-TT' wie test_days.day -- so ordnet der Zeichenvergleich wie der
  -- Kalender. NULL heisst „ohne Datum", und es haengt nicht an kind.
  due_date TEXT
);

-- Bilder in Kommentaren. Eigene Tabelle statt einer Spalte an attachments:
-- ein Anhang gehoert dem Eintrag, ein Kommentarbild dem Kommentar und geht mit
-- ihm. Gespeichert wird nur das umkodierte Bild, nie das Original.
CREATE TABLE IF NOT EXISTS comment_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT 'image.jpg',
  thumb BLOB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- data am Ende: was dahinter steht, ist nur ueber die Overflow-Kette zu lesen.
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comment_images_comment ON comment_images(comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_id);

-- Videos in Kommentaren, ohne Umkodieren gespeichert. thumb ist die Kachel aus
-- dem Standbild und zugleich das Poster im Abspieler.
CREATE TABLE IF NOT EXISTS comment_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT 'video.mp4',
  duration INTEGER,
  thumb BLOB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comment_videos_comment ON comment_videos(comment_id);

-- WEN EIN KOMMENTAR MARKIERT: DIE ZUGANGSNUMMER UND NICHT DER NAME -- ein
-- freigegebener Name zeigte sonst auf den Falschen. handle sagt nur, WIE die
-- Markierung im Text steht; angezeigt wird immer aus der Nummer.
CREATE TABLE IF NOT EXISTS comment_mentions (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
-- Die Glocke fragt „was ist neu und markiert MICH" -- also nach user_id.
CREATE INDEX IF NOT EXISTS idx_comment_mentions_user ON comment_mentions(user_id);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);

-- Tags an Testtagen. Derselbe Tagvorrat wie am Eintrag, aber eine eigene
-- Verknuepfung: der Filter der Uebersicht greift nur auf Tags am Eintrag zu.
CREATE TABLE IF NOT EXISTS test_day_tags (
  test_day_id INTEGER NOT NULL REFERENCES test_days(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (test_day_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_test_day_tags_tag ON test_day_tags(tag_id);

-- Anhaenge am Eintrag. mime_type ist der vom Browser gemeldete Typ und dient
-- NUR der Anzeige -- ausgeliefert wird nie mit diesem Wert. Eine Datei gehoert
-- dem, der sie hochlaedt, nicht dem Verfasser des Eintrags.
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- data am Ende: was dahinter steht, ist nur ueber die Overflow-Kette zu lesen.
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(item_id);

-- Bearbeiten ueber den Document Server. Ohne Zeile: kein Haken, nichts gespeichert.
CREATE TABLE IF NOT EXISTS attachment_editing (
  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  edit_all INTEGER NOT NULL DEFAULT 0,
  -- Teil des Schluessels im Editor; steigt, wenn eine Sitzung endet.
  revision INTEGER NOT NULL DEFAULT 0,
  -- Teil des Schluessels im Betrachter; steigt mit jeder gespeicherten Fassung.
  saves INTEGER NOT NULL DEFAULT 0
);

-- Eigene Tabelle: eine neue Spalte meldete schemaDifferences() in bestehenden Datenbanken als fehlend,
-- eine fehlende Tabelle legt der Start an.
CREATE TABLE IF NOT EXISTS attachment_changes (
  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  -- File.lastModified beim Hochladen, als UTC wie created_at.
  file_modified TEXT,
  -- Die letzte Speicherung im Document Server.
  saved_at TEXT,
  saved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Die Fassung vor der letzten Bearbeitung, eine je Datei.
CREATE TABLE IF NOT EXISTS attachment_previous (
  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  -- Die Sitzung, deren erste Speicherung diese Fassung abgelegt hat.
  session_key TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  data BLOB NOT NULL
);

-- Kachel einer Bilddatei; thumb NULL: sharp konnte die Datei nicht lesen.
CREATE TABLE IF NOT EXISTS attachment_thumbs (
  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  thumb BLOB
);

-- Bilddatei mit 1.600 px fuer Vollbild und Vorschau; medium NULL: das Original zeigen.
CREATE TABLE IF NOT EXISTS attachment_mediums (
  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  medium BLOB
);

-- Standbild eines Videos, im Browser erzeugt; duration in Sekunden, NULL unbekannt.
CREATE TABLE IF NOT EXISTS attachment_stills (
  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  duration REAL,
  still BLOB NOT NULL
);

-- Wellenform einer Audiodatei, im Browser berechnet: 1.024 Werte der mittleren Lautstaerke zu je 1 Byte.
CREATE TABLE IF NOT EXISTS attachment_waveforms (
  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  peaks BLOB NOT NULL
);

-- Angaben von MediaInfo zu einem Bild oder Video als JSON, gelesen in einer Warteschlange.
CREATE TABLE IF NOT EXISTS attachment_media (
  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  info TEXT NOT NULL
);

-- Dasselbe fuer Fotos und Videos des Eintrags.
CREATE TABLE IF NOT EXISTS photo_media (
  photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  info TEXT NOT NULL
);

-- Wellenform einer Audiodatei der Bildleiste, wie attachment_waveforms.
CREATE TABLE IF NOT EXISTS photo_waveforms (
  photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  peaks BLOB NOT NULL
);

-- Name beim Hochladen. Eigene Tabelle: eine neue Spalte in photos kaeme in einer
-- bestehenden Datenbank nicht an. Ohne Zeile gilt ein Ersatzname.
CREATE TABLE IF NOT EXISTS photo_names (
  photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  filename TEXT NOT NULL
);

-- Ordner unter „Dateien“. AUTOINCREMENT: ein Upload, der auf einen geloeschten
-- Ordner wartet, landet nie in einem neuen mit derselben Nummer.
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Noch von keiner Route gesetzt; steht hier, weil Kriterion keine Spalte nachruestet.
  test_day_id INTEGER UNIQUE REFERENCES test_days(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_item ON folders(item_id);

-- Ohne Zeile steht eine Datei ohne Ordner.
CREATE TABLE IF NOT EXISTS attachment_folders (
  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attachment_folders_folder ON attachment_folders(folder_id);

-- Offene Ordner je Account; ohne Zeile ist der Ordner zu.
CREATE TABLE IF NOT EXISTS folder_open (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, folder_id)
);
CREATE INDEX IF NOT EXISTS idx_folder_open_folder ON folder_open(folder_id);

-- Zuletzt abgespielte Stelle je Account in Sekunden; genau eines der drei Ziele.
CREATE TABLE IF NOT EXISTS video_positions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attachment_id INTEGER REFERENCES attachments(id) ON DELETE CASCADE,
  photo_id INTEGER REFERENCES photos(id) ON DELETE CASCADE,
  comment_video_id INTEGER REFERENCES comment_videos(id) ON DELETE CASCADE,
  seconds REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((attachment_id IS NOT NULL) + (photo_id IS NOT NULL) + (comment_video_id IS NOT NULL) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_positions_file
  ON video_positions(attachment_id, user_id) WHERE attachment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_positions_photo
  ON video_positions(photo_id, user_id) WHERE photo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_positions_comment
  ON video_positions(comment_video_id, user_id) WHERE comment_video_id IS NOT NULL;

-- Offener Upload in Stuecken; file_key lesen nur qUploadFile und qDiskFile in server.js.
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  modified INTEGER NOT NULL,          -- File.lastModified, ms
  large INTEGER NOT NULL DEFAULT 0,   -- 1: beim Beginn ueber der Grenze „Anhang"
  name TEXT NOT NULL UNIQUE,
  received INTEGER NOT NULL DEFAULT 0,
  touched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  file_key BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_item ON uploads(item_id);

-- Datei unter data/files/; attachments.data traegt dann x''. size ist der Klartext.
CREATE TABLE IF NOT EXISTS disk_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  chunk INTEGER NOT NULL,
  large INTEGER NOT NULL DEFAULT 0,
  attachment_id INTEGER UNIQUE REFERENCES attachments(id) ON DELETE SET NULL,
  -- Ohne UNIQUE: Wiederherstellen tauscht zwei Zeilen ueber einen Zwischenstand.
  previous_of INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  trash_id INTEGER REFERENCES trash(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  file_key BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_disk_files_previous ON disk_files(previous_of);
CREATE INDEX IF NOT EXISTS idx_disk_files_trash ON disk_files(trash_id);

-- Namen, deren Datei nach dem Commit geloescht wird; nur ein Trigger schreibt.
CREATE TABLE IF NOT EXISTS disk_files_gone (
  name TEXT PRIMARY KEY
);

-- Proxy eines Videos unter „Dateien“. Haengt an disk_files und geht so mit in den Papierkorb und zurueck.
CREATE TABLE IF NOT EXISTS proxy_files (
  disk_file_id INTEGER PRIMARY KEY REFERENCES disk_files(id) ON DELETE CASCADE,
  -- Datei unter data/files/proxy/; bei failed NULL.
  name TEXT UNIQUE,
  size INTEGER,
  file_key BLOB,
  width INTEGER,
  height INTEGER,
  -- ready oder failed
  state TEXT NOT NULL,
  reason TEXT,
  made_at TEXT
);

-- -b:v, mit dem ein Proxy entstand. Weicht er von videoBitRate() in videoproxy.js ab oder fehlt
-- die Zeile, wird der Proxy ersetzt.
CREATE TABLE IF NOT EXISTS proxy_rates (
  disk_file_id INTEGER PRIMARY KEY REFERENCES proxy_files(disk_file_id) ON DELETE CASCADE,
  video_bps INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Zugang. role ist eine Leiter: user < admin < owner -- ein Wert, kein
-- zweites Feld, damit "ein Eigentuemer ist immer auch Admin" baulich wahr ist.
--   user        -- schreibt eigene Beitraege, sonst nichts
--   admin       -- verwaltet den Bestand, sperrt und loescht BENUTZER
--   owner       -- dazu: Rollen vergeben, an Admins ran, Export, Import,
--                  Schluesselwert
-- status: active | locked | deleted.
--   locked      -- Anmeldung abgewiesen, laufende Sitzung faellt, Inhalte bleiben
--   deleted     -- der GRABSTEIN: die Zeile bleibt mit ihrer id stehen, der Name
--                  ist mit deleted-<id> ueberschrieben und damit freigegeben.
--                  Ein Zugang wird NIE aus der Tabelle entfernt.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- user_id ist die Wurzel des Mehrbenutzerbetriebs: erst wenn eine Sitzung
-- sagen kann, WER da ist, laesst sich ueberhaupt etwas zuordnen.
-- ON DELETE CASCADE: mit dem Benutzer gehen seine Sitzungen.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Der Primaerschluessel liegt auf token; jede Frage nach den Sitzungen EINES
-- Benutzers laese sonst die ganze Tabelle. Ein Index fasst die Zeilenform
-- nicht an und legt sich bei jedem Start selbst nach.
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Die Bremse gegen Durchprobieren. Eine eigene Tabelle und keine Spalte an
-- users: gezaehlt wird je IP und je Name, und eine IP hat keinen Zugang.
-- who traegt seine Art mit, 'ip:…' oder 'name:…'; until nur bei der IP.
CREATE TABLE IF NOT EXISTS login_attempts (
  who TEXT PRIMARY KEY,
  tries INTEGER NOT NULL DEFAULT 0,
  until TEXT,
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- seen_at traegt den letzten Versuch; daran raeumt cleanupAttempts() auf.
CREATE INDEX IF NOT EXISTS idx_login_attempts_seen ON login_attempts(seen_at);

/* EIN MECHANISMUS, ZWEI ANLAESSE -- Einladung und Ruecksetzung. GESPEICHERT
   WIRD NUR DER HASH, SHA-256 ohne Salz: die Zeile wird ueber den
   Primaerschluessel gefunden und nicht gesucht. used_at bleibt stehen. */
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Gefragt wird ueber den Hash ODER nach allen Token EINES Benutzers -- beim
-- Einloesen fallen die uebrigen, beim Sperren und Entfernen ebenso. Dieselbe
-- Ueberlegung wie bei idx_sessions_user.
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);

/* DIE WARTESCHLANGE DER SELBSTANMELDUNG -- EINE ANFRAGE IST NOCH KEIN ZUGANG:
   kein Passwort, keine Rolle. hash ist nicht der Primaerschluessel -- die
   Adminrouten sprechen eine Zeile ueber eine NUMMER an. */
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* DER ZWEITE FAKTOR, freiwillig je Zugang; user_id ist der Primaerschluessel.
   secret liegt im Klartext -- ein TOTP-Geheimnis wird nachgerechnet, nicht
   geprueft. last_counter nimmt nur einen ECHT GROESSEREN Zeitschritt an. */
CREATE TABLE IF NOT EXISTS two_factor (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  confirmed_at TEXT,
  last_counter INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* DIE WIEDERHERSTELLUNGSCODES -- eine Zeile je Code, weil „jeder genau einmal"
   eine Eigenschaft der ZEILE ist. hash ist SHA-256 ohne Salz, der Klartext
   steht nirgends. Geraeumt wird nicht nach einer Frist. */
CREATE TABLE IF NOT EXISTS two_factor_codes (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Gefragt wird ueber den Hash ODER nach allen Codes EINES Zugangs -- die Zahl
-- fuer die Karte, das Ersetzen, das Abschalten. Dieselbe Ueberlegung wie bei
-- idx_tokens_user.
CREATE INDEX IF NOT EXISTS idx_two_factor_codes_user ON two_factor_codes(user_id);

/* DAS SICHERHEITSPROTOKOLL: wer Zugang hatte und wer die Instanz als Ganzes
   angefasst hat -- KEIN AENDERUNGSVERLAUF und keine Namensspalte, gespeichert
   werden Nummern. Freitext von aussen kommt nicht hinein. */
CREATE TABLE IF NOT EXISTS security_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL,
  actor INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target INTEGER REFERENCES users(id) ON DELETE SET NULL,
  detail TEXT
);
-- Gefragt wird immer nach den JUENGSTEN Zeilen und geraeumt nach dem Alter --
-- beides ueber at. Wie bei idx_trash_at ist ein Index keine Migration.
CREATE INDEX IF NOT EXISTS idx_log_at ON security_log(at);

-- Der Favorit: eine Aussage eines Benutzers ueber einen Eintrag, keine
-- Eigenschaft des Eintrags -- deshalb eine eigene Tabelle. ON DELETE CASCADE an
-- BEIDEN Spalten; SET NULL verbietet der Primaerschluessel.
CREATE TABLE IF NOT EXISTS item_pins (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
);
-- Der Index ist keine Zierde: beim Loeschen eines Eintrags sucht die Kaskade
-- ueber item_id, und der Primaerschluessel greift nur von links. item_tags hat
-- aus genau demselben Grund idx_item_tags_tag.
CREATE INDEX IF NOT EXISTS idx_item_pins_item ON item_pins(item_id);

-- Die persoenliche Haelfte von settings. ON DELETE CASCADE: eine persoenliche
-- Einstellung ohne Benutzer bedeutet nichts. Kein zusaetzlicher Index --
-- user_id steht an erster Stelle des Primaerschluessels.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- DER PAPIERKORB FASST KEINE BESTEHENDE ABFRAGE AN: kein Zustand 'deleted' an
-- items. content traegt den Exportumschlag ohne die Bytes -- zwanzig 20-MB-
-- Videos waeren als Base64 533 MB, und Node haelt keinen String ueber 512 MB.
CREATE TABLE IF NOT EXISTS trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trash_at ON trash(deleted_at);

-- Eine Zeile je Blob; die Nummer part ist die aus dem Paket. WARUM EINE ZEILE
-- JE BLOB: eine BLOB-Zeile wird ganz in den Arbeitsspeicher gelesen, hier
-- hoechstens 50 MB. SQLite traegt in einer Zelle rund 950 MB.
CREATE TABLE IF NOT EXISTS trash_bytes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trash_id INTEGER NOT NULL REFERENCES trash(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  data BLOB NOT NULL,
  UNIQUE(trash_id, part)
);
`;

function columnsOf(db) {
  const out = new Map();
  for (const { name } of db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all())
    out.set(name, db.prepare(`PRAGMA table_info("${name}")`).all().map(c => c.name));
  return out;
}

/* `differences`: unbekannte Tabellen und Spalten, fehlende Spalten. `missingTables` legt
   der Start mit db.exec(SCHEMA) an. */
function schemaDifferences(db) {
  const reference = new Database(':memory:');
  let wanted;
  try { reference.exec(SCHEMA); wanted = columnsOf(reference); } finally { reference.close(); }
  const present = columnsOf(db);
  const differences = [];
  for (const [table, columns] of present) {
    if (!wanted.has(table)) { differences.push(`${table} unbekannt`); continue; }
    for (const c of columns) if (!wanted.get(table).includes(c)) differences.push(`${table}.${c} unbekannt`);
    for (const c of wanted.get(table)) if (!columns.includes(c)) differences.push(`${table}.${c} fehlt`);
  }
  return { differences, missingTables: [...wanted.keys()].filter(t => !present.has(t)) };
}

// Nur Texte: Zahlen und Ausdruecke wie datetime('now') weichen oft nur in der Schreibweise ab.
const isText = (v) => typeof v === 'string' && /^'.*'$/s.test(v);
const unquote = (v) => v.slice(1, -1).replace(/''/g, "'");

/* Tabellen, deren Vorgabewert fuer eine Spalte vom Schema abweicht, etwa 'aktiv' statt 'active':
   die Umbenennung ins Englische hat Spalten und Werte umgestellt, die Vorgabewerte nicht. */
function defaultDifferences(db) {
  const reference = new Database(':memory:');
  const out = [];
  try {
    reference.exec(SCHEMA);
    const tables = reference.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    for (const { name, sql } of tables) {
      const wanted = new Map(reference.prepare(`PRAGMA table_info("${name}")`).all().map(c => [c.name, c.dflt_value]));
      const present = db.prepare(`PRAGMA table_info("${name}")`).all();
      const changed = present.filter(c => wanted.has(c.name) && isText(c.dflt_value) && isText(wanted.get(c.name)) &&
        c.dflt_value !== wanted.get(c.name))
        .map(c => ({ column: c.name, had: unquote(c.dflt_value), wanted: unquote(wanted.get(c.name)) }));
      if (changed.length) out.push({ table: name, sql, columns: present.map(c => c.name), changed,
        extra: present.filter(c => !wanted.has(c.name)).map(c => `"${c.name}" ${c.type}`) });
    }
  } finally { reference.close(); }
  return out;
}

module.exports = { SCHEMA, schemaDifferences, defaultDifferences };
