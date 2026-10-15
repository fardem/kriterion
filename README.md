# Kriterion

English · [Deutsch](README-de.md) · [Türkçe](README-tr.md)

![Node](https://img.shields.io/badge/Node-22-informational)
![Docker](https://img.shields.io/badge/Docker-Compose-informational)
![Licence](https://img.shields.io/badge/Licence-MIT-informational)

A self-hosted archive for things you collect and assess: devices, materials,
models, prototypes, suppliers.

Each entry holds photos, short videos and audio files, a rating based on your
own criteria, comments, test days, links and files. Entries can be compared, filtered and
searched.

Everything stays on your own server: no account with third parties, no
telemetry, no external fonts, no CDN. The database is encrypted as a whole
(SQLCipher, AES-256); photos, videos and audio are stored in it. Each file under
“Files” is encrypted individually (AES-256-GCM) in `data/files/`, with its key
in the database. With a [Document Server](#document-server), every Office file
and every PDF is also stored unencrypted in its cache.

Built with Node.js, Express, SQLCipher (`better-sqlite3-multiple-ciphers`),
`sharp`, `nodemailer`, `mediainfo.js` and `exif-reader`. The frontend uses no
framework.

This file covers installing and running Kriterion. Using it is covered in the
[manual](manual.md).

---

**Contents**

- [Features](#features)
- [Who it is for](#who-it-is-for)
- [Initial installation](#initial-installation)
- [Configuration](#configuration)
- [The key](#the-key)
- [Backup](#backup)
- [Update](#update)
- [Behind a reverse proxy](#behind-a-reverse-proxy)
- [Document Server](#document-server)
- [Commands on the server](#commands-on-the-server)
- [Troubleshooting](#troubleshooting)
- [Custom scripts against the API](#custom-scripts-against-the-api)
- [How this code was written](#how-this-code-was-written)
- [Licence](#licence)

---

## Features

| | |
|---|---|
| Entries | title, description, category, tags, photos, short videos and audio files with their names, files, links |
| Files | up to 2 GB per file, uploaded in chunks, resumable; as tiles or list, sorted by name, date, size or type, grouped by type, with a thumbnail also for text, Office and PDF; in folders; delete or move several at once; deleted files stay 30 days in the trash and can be fetched back one by one from backups; “Info” on images, videos and audio files as in MediaInfo, also for the photos, videos and audio files of the entry; videos and audio files resume where they were last played, videos load in full at the push of a button; on request they play through a smaller proxy in H.264, also `mkv`, `avi`, `wmv` and `flv`; audio files with cover, the waveform as a slider and a stereo level meter |
| Rate | your own criteria with 1 to 5 stars, a weight per criterion, from these a weighted average |
| Comments | note, report or task with a due date, plus images and videos |
| Test days | dated entries with score and tags |
| Compare | several entries side by side, criterion by criterion |
| Search and filter | full text across title, description, category, tags, links and comments; filters can be saved as a view |
| Multiple users | three roles, every contribution with its author |
| Backup | encrypted backup at the press of a button, including the files in `data/files/`, restored with one command on the server; plus a JSON export without the key |

## Who it is for

For one person or a small group who know each other, with a server or NAS
that runs Docker. Not for many unknown users.

Before deciding:

- Criteria apply to all entries of an installation. Anyone collecting in
  several subject areas runs several installations.
- The encryption protects the file, not the users from each other. The
  operator can read everything.
- Without the key the data is lost. There is no recovery.
- Email is optional. Without a mail account, invitation links and reset links
  are passed on by hand.

## Initial installation

Requirement: Docker and Docker Compose. Node.js and everything else is part of
the image.

**1. Get the project**

```bash
git clone https://github.com/fardem/kriterion.git
cd kriterion
```

Without `git`: on <https://github.com/fardem/kriterion> under “Code” →
“Download ZIP”, then:

```bash
python3 -m zipfile -e kriterion-main.zip .
mv kriterion-main kriterion
cd kriterion
chmod +x keytool.sh backuptool.sh
```

`python3 -m zipfile -e` does not set the execute permission; `chmod` adds it.
`unzip` and `git clone` do not need this line.

**2. Create `.env`**

```bash
cp .env.example .env
```

The file must exist, even if all values stay empty. Otherwise
`docker compose` aborts.

**3. Create `docker-compose.yml`**

```bash
cp docker-compose.example.yml docker-compose.yml
```

**The step `cp docker-compose.example.yml docker-compose.yml` is required.**
Without it, `docker compose up` aborts with “no configuration file provided:
not found”. The working copy is not in the repository, so changes to it are
kept during an update.

**4. Start**

```bash
docker compose up -d --build
```

`--build` is needed because the source code is part of the image. Kriterion is
then reachable at `http://<server-ip>:3100`.

On the first visit in the browser, the language, a user name and a password
(at least ten characters) are set. The language is preselected from the
browser and becomes the default language. This account is the owner admin. Criteria, further users
and mail delivery are set up in the interface; see the [manual](manual.md).

## Configuration

| File | Setting | if empty or unchanged |
|---|---|---|
| `.env` | `ENCRYPTION_KEY`: key of the database | the key is in `data/encryption.key`, see [The key](#the-key) |
| `.env` | `BEHIND_PROXY=1`: reverse proxy with HTTPS in front | direct access, see [Behind a reverse proxy](#behind-a-reverse-proxy) |
| `.env` | `PUBLIC_ADDRESS`: URL from outside, such as `https://kriterion.beispiel.de` | the browser builds links from its own URL; no links by email, no registration |
| `.env` | `DOCUMENT_SERVER_ADDRESS`: Euro-Office or OnlyOffice, as the browser reaches it | no display through a Document Server, see [Document Server](#document-server) |
| `.env` | `DOCUMENT_SERVER_SECRET`: the same value as `JWT_SECRET` on the Document Server | no display through a Document Server |
| `.env` | `DOCUMENT_SERVER_INTERNAL_ADDRESS`: the Document Server as Kriterion reaches it | `DOCUMENT_SERVER_ADDRESS` |
| `.env` | `INTERNAL_ADDRESS`: Kriterion as the Document Server reaches it | `PUBLIC_ADDRESS` |
| `docker-compose.yml` | port, the left one in `"3100:3000"` | 3100 |
| `docker-compose.yml` | backup folder: mount and `BACKUP_DIR` | `./kriterion-backup`, see [Backup](#backup) |
| `docker-compose.yml` | `TZ`: time zone of the log and of the names of new backups | `Europe/Berlin` |
| `docker-compose.yml` | `devices: /dev/dri`: Quick Sync for the proxies | the CPU converts, see [Proxies for videos](#proxies-for-videos) |
| `docker-compose.yml` | `tmpfs: /tmp`: RAM in which a proxy is created | 2 GB; without `tmpfs` no proxies |

`PUBLIC_ADDRESS` needs a scheme and a host name; a path is allowed, `?` and
`#` are not. An invalid value appears as a warning in the log; the start
continues.

Everything else, including the mail account, is set in the interface and
stored in the database.

Docker rotates the container log. For this, in `docker-compose.yml`:

```yaml
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
```

## The key

Without `ENCRYPTION_KEY`, the first start creates a key and stores it as
`data/encryption.key` next to the database. Anyone who copies `data/` then has
the data and the key together.

**Moving the key into `.env`:**

1. In the interface, copy the value from the “Version and encryption” card
   (visible only to the owner admin).
2. Enter `ENCRYPTION_KEY=<Wert>` in `.env`.
3. `docker compose up -d`
4. Check the log: `Key loaded from ENCRYPTION_KEY.`
5. Only then delete `data/encryption.key`.

As long as data exists, do not create a new key: the data can no longer be
read after that. Only for an empty installation may the key be made by hand:
`openssl rand -hex 32`.

`.env` is read at every start and must stay in place. **`.env` and `data/` do
not belong in the same backup.** Also keep the key in a password manager.

### Changing the key

Needed if someone else may have obtained the key, for example because `data/`
was copied while `data/encryption.key` was next to it. Deleting the key file
only protects against later copies.

Files on disk keep their key. Anyone with an old copy of the database and the
old key can still read them, even from later backups. Protection: delete the
file and upload it again.

```bash
./keytool.sh show
./keytool.sh change
```

`keytool.sh show` shows the current state and changes nothing.
`keytool.sh change` creates a backup of `.env` (`.env.before-key-change-…`)
and of `data/` without `data/files/` (`../kriterion-data-before-key-change-…`),
stops the installation, changes the key in a temporary container, writes the
new value only after success and starts again.

An interruption halfway through (power failure, `kill -9`) has no
consequences: the rollback journal restores the old state. If there is not
enough space for the journal, the script aborts beforehand.

After the change:

- Older backups open only with the old key. It stays in `.env` as a comment
  and belongs in the password manager.
- Create a new backup right away.
- Passwords and sessions stay valid.

**Try the change on a copy first.** A mistake can cost all data. The copy
needs the real entries and the real `.env`, but not `data/files/`, and it needs
its own backup folder. The first command moves from the project folder to the
folder above it:

```bash
cd ..
docker compose -f kriterion/docker-compose.yml stop
mkdir -p kriterion-check/data
find kriterion -mindepth 1 -maxdepth 1 ! -name data ! -name kriterion-backup ! -name .git \
  -exec cp -a {} kriterion-check/ \;
find kriterion/data -mindepth 1 -maxdepth 1 ! -name files -exec cp -a {} kriterion-check/data/ \;
docker compose -f kriterion/docker-compose.yml start

cd kriterion-check
rm -rf .env.before-*
sed -i 's/^    container_name: kriterion$/    container_name: kriterion-check/' docker-compose.yml
sed -i 's/"3100:3000"/"3199:3000"/' docker-compose.yml
sed -i 's#kriterion-backup:#kriterion-check-backup:#' docker-compose.yml
docker compose up -d --build
./keytool.sh change
docker compose logs --tail 30 kriterion
```

The test run is valid if the notice before the change states the real size,
`integrity_check: ok` appears afterwards, the log reports `owner: <Name>` and
all entries are present at `http://<server>:3199`. Files on disk are missing
in the copy; their tiles show ⚠. Then remove the copy:

```bash
cd .. && docker compose -f kriterion-check/docker-compose.yml down
rm -rf kriterion-check kriterion-check-backup
```

Never copy the `.env` of the test run into the real installation.

## Backup

| | Backup (button) | Copy of `data/` | JSON export |
|---|---|---|---|
| purpose | emergency, while running | emergency, with the server stopped | moving, archive, passing on |
| complete | yes | yes | no, entries only |
| needs the key | yes | yes | no |
| readable by later versions | no | no | yes |

Backup and JSON export are started in the interface; see the manual,
“Settings”. While the backup of the database is being written, the
installation pauses (about 10 to 20 ms per MB).

The backup copies files from `data/files/` to `kriterion-files/` in the backup
folder, each only once: they never change. Next to each backup is a list
`kriterion-<zeitpunkt>.files`: the first line holds the version that wrote the
backup, then come the files it names. **The backup folder needs space for the
database and all files on disk.**

**Backup folder.** `docker-compose.yml` mounts it and passes it to the server.
Both lines belong together; without `BACKUP_DIR` the “Backup” card is missing.

```yaml
    volumes:
      - ./kriterion-backup:/app/backup
    environment:
      - BACKUP_DIR=/app/backup
```

The folder is better placed outside the project folder. The project folder is
renamed during an update, and otherwise a mistake with the project folder hits
data and backups at the same time. Only the left side changes:

```yaml
      - ../kriterion-backup:/app/backup
```

Relative paths start from the location of `docker-compose.yml`. The “Backup”
card warns as long as the folder lies next to `data/` on the server; it reads
the mount from `/proc/self/mountinfo`.

**Copy of `data/`.** First `docker compose down`, then copy, including
`data/files/`. Keep `.env` separately.

### Restoring a backup

Backups are restored in the project folder with `backuptool.sh`. It starts a
throwaway container with the image of the installation.

```bash
./backuptool.sh list
./backuptool.sh show 2
./backuptool.sh restore 2
```

`list` shows all backups with time, version, files, key and schema. `show`
shows the content and the difference from the running state. `restore` checks,
stops, creates a backup beforehand, restores and starts again.

The selection is the number from `list` (1 is the newest), the time from the
name (`JJJJ-MM-TT-hh-mm-ss`, shortened down to the date) or the time as in the
“Old backups” card (`TT.MM.JJJJ` or `TT.MM.JJJJ hh:mm`). Both are the local
time from `TZ` in `docker-compose.yml`.

`restore` checks while the installation is running: the key, the schema of the
installed version, every file of the list in the backup folder, the space. Only
then does it ask, stop the installation, create a backup of the current state
and restore the chosen one. Afterwards `data/files/` contains exactly the files
of the chosen state; only files that a backup in the backup folder contains
are deleted there. The output ends with the command to go back:

```
Rückweg:        ./backuptool.sh restore 2026-10-30-07-15-40
```

### Fetching back individual files

The owner admin fetches back a deleted file under “Files” in the entry with
“Deleted files …”: from the trash for 30 days, or from any backup that opens
with the current key. The installation keeps running; nothing else changes. A
copy in the backup folder is placed in `data/files/` unchanged. If a file is
still in the database of an older backup, it is encrypted again when it is
fetched back.

If `restore` aborts, the installation stays stopped and the message states how
far it got and the call that completes it. That call names the backup by the
time in its name, because step 3 creates a new backup and the numbers shift.
The first start afterwards applies the retention period and the deletion list
of the restored state.

A backup opens only with the key it was created with. If it dates from before
a key change, first enter the old value as `ENCRYPTION_KEY`.

**By hand**, if no image can be built. First create a backup in the interface:
it is the way back.

```bash
docker compose down
mkdir data-before-restore
mv data/katalog.sqlite* data-before-restore/
cp kriterion-backup/kriterion-<zeitpunkt>.sqlite data/katalog.sqlite
mkdir -p data/files
while read -r n len rest; do
  case "$n" in *[!0-9a-f]*|'') continue ;; esac; [ ${#n} -eq 32 ] || continue
  [ "$rest" = fehlt ] && continue
  [ -f "data/files/$n" ] && [ "$(wc -c < "data/files/$n")" -eq "$len" ] && continue
  cp "kriterion-backup/kriterion-files/$n" "data/files/$n.part" &&
    mv "data/files/$n.part" "data/files/$n"
done < kriterion-backup/kriterion-<zeitpunkt>.files
docker compose up -d
```

The loop fetches the files that the backup's list names and skips its header
lines. It deletes none; files of the newer state stay in place, and “Storage
and maintenance” lists them as files without a reference. “Reconcile” in the
same card shows which of them can be deleted (manual, “Reconcile”).

## Update

Create a backup first. What changes in each version is listed in
`CHANGELOG.md` (format following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), version numbers
following [Semantic Versioning](https://semver.org/)).

With `git`:

```bash
git pull
docker compose up -d --build
```

With the ZIP, the project folder is replaced. `data/`, `.env`,
`docker-compose.yml` and a backup folder inside the project are carried over.
The safety copy leaves out `data/files/`: these files never change and are in
the backup.

```bash
cd .../kriterion && docker compose down
cd .. && mkdir data-before-update-$(date +%F)
find kriterion/data -mindepth 1 -maxdepth 1 ! -name files -exec cp -a {} data-before-update-$(date +%F)/ \;
mv kriterion kriterion-old
python3 -m zipfile -e kriterion-main.zip .
mv kriterion-main kriterion
mv kriterion-old/data kriterion/data
cp kriterion-old/.env kriterion/.env
cp kriterion-old/docker-compose.yml kriterion/
mv kriterion-old/kriterion-backup kriterion/ 2>/dev/null
chmod +x kriterion/keytool.sh kriterion/backuptool.sh
cd kriterion && docker compose up -d --build
```

Then check in the log (`docker compose logs kriterion`) that the key was
loaded. If it shows a warning about a key file next to the data although
`ENCRYPTION_KEY` was set, `.env` was not read: stop at once.

If files are still stored in the database, Kriterion moves them to
`data/files/` in the background after the start; “Storage and maintenance”
shows how many are still waiting. **If the free space is not enough for these files plus 1 GB of
reserve, Kriterion does not start.** The log states the space needed and the
free space.

If `docker-compose.example.yml` has changed, compare your own file with it:
`diff docker-compose.example.yml docker-compose.yml`.

### Checking that the new version is running

The version number (`curl -s http://localhost:3100/api/config`) only tells
which `package.json` is running. Whether all files match it is shown by the
fingerprint: a checksum over everything the server loads and delivers. It
appears in the “Version and encryption” card; the expected value is in
`CHANGELOG.md` at the entry for the version.

If it differs, this loop finds the file, in the project folder or in the
container (`docker compose exec kriterion sh`):

```bash
for f in attachments.js auth.js backup.js batchrun.js docserver.js images.js db.js keys.js \
         log.js mail.js package.json schema.js server.js twofactor.js videoproxy.js public/*; do
  printf "%-26s %s\n" "$f" "$(sha256sum "$f" | cut -c1-8)"
done
```

The “Version and encryption” card shows the same list under “Show files”. Replace a differing
file or delete a surplus one, then `docker compose up -d --build`.

## Behind a reverse proxy

Expose Kriterion to the outside only over HTTPS, and then set `BEHIND_PROXY=1`
in `.env`.

| | `BEHIND_PROXY` empty | `BEHIND_PROXY=1` |
|---|---|---|
| `X-Forwarded-For`, `X-Forwarded-Proto` | are ignored | are read |
| Caller's address | the connection | last entry of `X-Forwarded-For` if the connection comes from the own network; otherwise the connection |
| `http://` in `PUBLIC_ADDRESS` | allowed | warning at start |

At start, the log states the setting: `Behind proxy: on` or `off`.

- Direct access via `http://<server-ip>:3100` stays usable, alongside the
  proxy. If the proxy fails, access continues that way.
- The own network is loopback, private networks (10.x, 172.16–31.x,
  192.168.x), 100.64.0.0/10, IPv6 `fc00::/7` and `fe80::/10`.
- **Anyone who reaches the container's port from the own network can set
  `X-Forwarded-For` and get around the sign-in rate limit.** To rule this out,
  open the port to the proxy only.
- Changing `BEHIND_PROXY` signs out everyone who is signed in over HTTPS,
  once.
- Kriterion does the compression itself. Switch off compression in the proxy:
  `gzip off;` for nginx, leave out `encode` for Caddy.
- The proxy must let through requests as large as the highest upload limit
  (up to 100 MB). nginx: `client_max_body_size 100m;` (default 1 MB).
  Cloudflare lets 100 MB through on Free and Pro.
- The CrowdSec WAF (AppSec) reads at most 10 MB of a request by default and
  rejects larger ones with 403. In NPMplus, under “Custom Locations”, create a
  location with `~` and the path
  `^/api/(import|uploads/[0-9a-f]+|(items|comments)/[0-9]+/(photos|videos|audio|comments|images))$`,
  with the same target as the host, and switch on “Disable Crowdsec Appsec”
  and “Disable Request Buffering” there. No curly braces in the path: NPMplus
  writes it without quotation marks, nginx reads `{` as the start of a block,
  and the host goes offline.
- A second location with `~` and the path `^/api/attachments/[0-9]+/raw$`,
  with the same target as the host, gets “Disable Response Buffering”; AppSec
  stays on there. Otherwise nginx stores files and videos as plain text in
  temporary files. For nginx without NPMplus: `proxy_request_buffering off;`
  for `/api/uploads/` and `proxy_buffering off;` for `/api/attachments/`.

For CrowdSec or fail2ban, `POST /api/login` answers with distinct codes: 401
(wrong name or password), 429 (too many attempts), 403 (account locked).

## Document Server

With Euro-Office or OnlyOffice, Kriterion shows and edits these files:
`docx`, `doc`, `odt`, `rtf`, `xlsx`, `xls`, `ods`, `pptx`, `ppt`, `odp`, up to
the “Attachment” limit; larger files can only be downloaded. Kriterion itself
continues to show images, PDF and text. For these files and for PDF, the
Document Server renders the thumbnail of the first page. Who may edit is
described in the manual under “Tags, files, links”. Setting up the Document
Server itself:
[Euro-Office documentation](https://github.com/Euro-Office/documentation).

**On the Document Server:**

- `JWT_SECRET` with at least 32 characters. The same value goes into
  Kriterion's `.env` as `DOCUMENT_SERVER_SECRET`.
- `JWT_ENABLED` and `JWT_HEADER` stay at their defaults `true` and
  `Authorization`.
- In the same Docker network as Kriterion: `ALLOW_PRIVATE_IP_ADDRESS=true`.
  Without this line the Document Server fetches no file from the Docker
  network.

**In Kriterion's `.env`**, example for both containers in the same Docker
network:

```sh
DOCUMENT_SERVER_ADDRESS=https://office.beispiel.de
DOCUMENT_SERVER_SECRET=<derselbe Wert wie JWT_SECRET>
DOCUMENT_SERVER_INTERNAL_ADDRESS=http://euro-office:80
INTERNAL_ADDRESS=http://kriterion:3000
```

- If both containers are in one `docker-compose.yml`, they share the network.
  With two Compose files, both need a shared network (`networks:` with
  `external: true`).
- After the restart, open the “Documents” card under Settings → Installation.
  It checks both directions and names what is missing. The display is switched
  on there.
- When editing, the Document Server calls Kriterion via `INTERNAL_ADDRESS` and
  reports the saved version; Kriterion fetches it via
  `DOCUMENT_SERVER_INTERNAL_ADDRESS`. No further settings are needed.

**Every Office file and every PDF is stored unencrypted in the cache of the
Document Server** until it clears the cache, even if nobody views them: it
fetches each of these files once for the thumbnail. The encryption of the
database does not apply to this copy.

## Proxies for videos

For videos under “Files”, Kriterion creates a smaller version, the proxy: H.264
with AAC, at most 1080 pixels on the shorter side, with the frame rate of the
original. On the computer and on the phone the proxy plays as soon as it is
ready; “Download” delivers the original. The owner admin switches it on under
Settings › Installation › “Proxy”; the default is off.

The owner admin sets the bit rate there as well: 1 to 8 Mbit/s for 1920 × 1080
at 30 frames per second, default 5. Other sizes and frame rates get a bit rate
in proportion, at most 10 Mbit/s: with the default, 4K at 60 frames per second
becomes 1080 pixels at 10 Mbit/s. After a change, Kriterion replaces the
existing proxies in the background, videos being played first; until then the
old proxy plays.

A video gets a proxy if one of these applies: the shorter side has more than
1080 pixels, the video is not H.264 with 8 bit and 4:2:0, the audio is not AAC,
MP3 or Opus, the video has more than 12 Mbit/s, or the extension is `mkv`,
`avi`, `wmv` or `flv`. In the container, ffmpeg runs under the number 65534,
without access to `data/`. Neither the original nor the proxy ever lies
unencrypted on disk. Backup and export do not take the proxy along; after a
restore, Kriterion creates it again.

### Memory for ffmpeg

ffmpeg writes the proxy to `/tmp`. `docker-compose.example.yml` puts a `tmpfs`
of 2 GB there:

```yaml
    tmpfs:
      - /tmp:size=2g
```

Without `tmpfs`, Kriterion does not convert. A proxy that does not fit into the
free space is not created; 2 GB last for about 50 minutes at 5 Mbit/s and for
about 25 minutes at 10 Mbit/s. The `tmpfs` uses RAM only while a proxy is being
created. If the host swaps memory
to disk, part of the proxy can end up there. From kernel 6.4 on, the option
`noswap` prevents this: `- /tmp:size=2g,noswap`. With an older kernel the
container does not start with this option.

### Quick Sync

With an Intel graphics unit, Quick Sync encodes. On the N100, the proxy of one
hour of 4K with 60 frames per second took about 30 minutes. Without Quick Sync
the CPU converts, the same hour in two to two and a half hours; it runs at the
lowest priority.

Add the graphics unit in `docker-compose.yml`:

```yaml
    devices:
      - /dev/dri:/dev/dri
```

No group is needed in the container. On the host, the kernel driver `i915`
needs its firmware:

| System | Package with the firmware for `i915` |
|---|---|
| Debian 12 | `firmware-misc-nonfree` |
| Debian 12 with firmware from `bookworm-backports` | `firmware-intel-graphics` |
| Debian 13 | `firmware-intel-graphics` |
| Ubuntu | `linux-firmware` (not checked) |

Restart the host after the installation. If the “Proxy” card still names no
driver, three commands on the host show the cause:

```sh
grep -E 'DRIVER|PCI_ID' /sys/class/drm/renderD128/device/uevent
ls /lib/firmware/i915/ | grep -E 'adlp_guc|tgl_huc'
dmesg | grep -i -E 'i915|guc|huc|wedged'
```

`DRIVER=i915` with a `PCI_ID` starting with `8086:` shows the Intel graphics
unit on the driver. If `/lib/firmware/i915/` is missing, the firmware is
missing. On arm64 the image has no Intel driver; there the CPU always converts.

## Commands on the server

These commands run in the project folder. They ask before every change and
appear in the security log as “on the command line at the server”.

| Command | Effect |
|---|---|
| `docker compose exec kriterion node usertool.js list` | users, role, second factor |
| `docker compose exec kriterion node usertool.js password <name>` | set a new password; all sessions of the user end |
| `docker compose exec kriterion node usertool.js twofactor <name>` | switch off the second factor (switching it on works only in the interface) |
| `docker compose exec kriterion node usertool.js remove <name>` | retire the account |
| `docker compose exec kriterion node usertool.js owner <name>` | make a user the owner admin if the previous one can no longer get in |
| `./keytool.sh show`, `./keytool.sh change` | show or change the key |
| `./backuptool.sh list`, `show`, `check`, `restore` | view and restore backups, see [Restoring a backup](#restoring-a-backup) |

If the container is not running, the same works with
`docker compose run --rm kriterion node usertool.js …`.

Users and passwords cannot be set through environment variables.

## Troubleshooting

| Situation | Solution |
|---|---|
| Nobody can get in any more | `usertool.js password <name>`, see [Commands on the server](#commands-on-the-server) |
| Phone and recovery codes lost | `usertool.js twofactor <name>` |
| `./keytool.sh` or `./backuptool.sh` reports “Permission denied” | `chmod +x keytool.sh backuptool.sh` or `bash keytool.sh show` |
| Warning about a key file although `ENCRYPTION_KEY` is set | `.env` was not read; stop and check |
| The start reports a missing column | the application starts, pages that use this column fail; restore a backup or install the matching version |
| Fingerprint differs | install all files again, see [Update](#update) |
| Upload fails with “larger than the reverse proxy in front lets through” | raise the limit in the proxy |
| Upload fails with “The reverse proxy in front refused the request (403)” | look in the proxy's log for the module that refuses; for CrowdSec see [Behind a reverse proxy](#behind-a-reverse-proxy) |
| The log shows `TEST SWITCH ACTIVE` | remove `KRITERION_TESTBENCH` from `.env` |
| After an update the browser still shows the old icon | Ctrl+Shift+R |

## Custom scripts against the API

Write requests need a CSRF token. The server sets it at sign-in as the cookie
`kriterion_csrf` (over HTTPS behind a proxy: `__Host-kriterion_csrf`). Its
value goes into the header `x-csrf-token`:

```bash
curl -c cookies.txt -X POST http://<server>:3100/api/login \
  -H 'content-type: application/json' \
  -d '{"user":"anna","password":"…"}'

TOKEN=$(awk '/kriterion_csrf/ { print $7 }' cookies.txt)

curl -b cookies.txt -X POST http://<server>:3100/api/items \
  -H 'content-type: application/json' -H "x-csrf-token: $TOKEN" \
  -d '{"title":"Ein Eintrag"}'
```

Without the header, every write route answers with 403. Read requests and the
routes before sign-in do not need it.

Files are uploaded in chunks. `POST /api/items/<id>/uploads` with `filename`,
`size`, `modified` and `folderId` (or `null`) returns `id` and `received`.
Then one `PUT /api/uploads/<id>` per 8 MB with `content-type:
application/octet-stream` and `upload-offset: <received>`; the response to the
last chunk is the entry.

`GET /api/attachments/<id>/info` and `GET /api/photos/<id>/info` return the
“Info” on an image, video or audio file as JSON with `general`, `video`,
`audio`, `image`, `orientation` and `exif`. The server reads it with `mediainfo.js`,
`sharp` and `exif-reader` and stores it in the tables `attachment_media` and
`photo_media`; it is not in the JSON export. For Office, OpenDocument and PDF
files the same route returns the “Info” with `document: true`, `kriterion` and
`file`, read again on every call. The time and account of the last save in the
Document Server and the modification time of the file at upload are stored in
the table `attachment_changes`, also not in the JSON export.

`PUT /api/attachments/<id>` with `filename` renames a file; the extension
stays. Only the person who uploaded the file may rename it (otherwise 403). If
the same folder already has a file with that name, the server answers 409.

`GET /api/items/<id>/deleted-files` lists the deleted files of an entry from
the trash and backups for the owner admin. `POST` to the same URL with `trash`
(numbers from the trash) and `backup` (`name` of the backup and `file` from the
list) fetches them back.

## How this code was written

Written with [Claude Code](https://claude.com/claude-code), August to
October 2026. Idea, concept and design:
[Faruk Demirtaş](https://github.com/fardem).

## Licence

MIT. The text is in `LICENSE`.

Kriterion may be used, modified, passed on and sold, also as part of a larger
project. Condition: the licence text and the copyright notice go with it. No
warranty, no liability.

### Licences of the dependencies

Measured on the 173 packages that `npm install` creates: 137 MIT, 12 ISC,
6 Apache-2.0, 4 BSD-3-Clause, 3 MIT-0, 3 BSD-2-Clause, 2 LGPL-3.0-or-later,
the rest CC0, 0BSD, BlueOak and packages with a choice of licences.

**The two LGPL packages are `@img/sharp-libvips-linux-x64` and
`@img/sharp-libvips-linuxmusl-x64`**, the precompiled libvips of `sharp`.
Anyone who passes on a built image also passes on libvips: the LGPL text must
then go with it, and the library must stay replaceable. Anyone who builds from
the repository downloads `sharp` via npm themselves.

**The image also contains ffmpeg, built with `libx264` and therefore under the
GPL** (`--enable-gpl` in the `Dockerfile`). Kriterion starts it as a separate
program and stays under MIT. Anyone who passes on a built image also passes on
ffmpeg: the GPL text must then go with it, together with the source code of
ffmpeg from ffmpeg.org in the version from `ARG FFMPEG`. Anyone who builds from
the repository builds ffmpeg themselves.
