# Changelog

All notable changes to Kriterion, kept short for the people who run it.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

> A box above the changes of a version means there is something to do when updating.
> Yanked versions are marked `[YANKED]`.

## [0.62.0] - 2026-10-09

Fingerprint `9c61c2fd` — previously `158d91ee`.

### Added

- In the file list on a phone, videos and audio show their length between size and date.
- The "Type" column names resolution and frame rate of videos, such as "H.264 · 1080p30 · 2:41"; "4K" from 2160 lines, "i" for interlaced video.

### Changed

- The timeline names its controls and "Show all" in a line below it; above it only "mine" and "others" remain, so it starts right below "Filter".
- The touch hint of the active timeline is shorter: "Two fingers zoom · double-tap ends".
- Durations from one hour on show hours, such as "1:02:33" instead of "62:33".
- The details of existing videos are read once more in the background to learn their scan type.

## [0.61.0] - 2026-10-09

Fingerprint `158d91ee` — previously `ff6bab6f`.

### Added

- "Potential: criteria" names the "Partial" threshold with its value and where it is set.

### Changed

- The timeline switches on and off with a double click or a double tap; a single click or tap changes nothing.
- On a phone, the first tap on a dot shows title and score, the second opens the entry; the timeline no longer moves under the finger.
- On the active timeline, one finger also moves it when it starts on a dot; two fingers zoom at once.
- Export and import write and read every file in pieces; an entry may hold any amount of files.
- In "Export in parts", an entry larger than the part size gets a part of its own.
- The import dialog reads a large file in pieces and names its contents; the question above 300 MB is gone.
- The pause button of the audio player has shorter, thicker bars.
- This changelog is shorter: one point per change, versions 0.20.0 to 0.41.0 in one line each.

### Removed

- The limit of about 345 MB of files per entry, with its messages when uploading and exporting.

### Fixed

- After an import, the dialog with the result could close at once.
- A large WAV among the photos no longer blocks the server for minutes while its details are read.

## [0.60.0] - 2026-10-08

Fingerprint `ff6bab6f` — previously `25a79457`.

> The "Backup" card no longer has a subfolder; `PUT /api/backup/dir` and the option `--ort` of `backuptool.sh` are removed. Backups in a subfolder are no longer listed or cleaned up: move them into the mounted folder.

### Added

- New card "Password" in "Personal" for changing the password.
- "Second factor" is a section of "My account"; saving name or email address asks for the password.

### Changed

- The "Backup" card judges the backup folder by its location on the host (`/proc/self/mountinfo`): a warning only inside the project folder, a note on the same disk.
- To keep backups outside, change only the left side of the mount: `../kriterion-backup:/app/backup`.
- The sort direction is one button with its words, for example "new → old"; a click reverses it.
- "Storage and maintenance" names "Preview and export up to" with its value.
- The back button shows "Back" where the header has no menu.
- In full screen the waveform spans the width also with a cover; the knob of the volume slider is smaller.

### Fixed

- The timeline did not zoom with two fingers on phones; the second finger moved it.

## [0.59.0] - 2026-10-08

Fingerprint `25a79457` — previously `3e4f8efd`.

### Added

- Own controls for audio under "Files", with the photos and in full screen: play, volume, a stereo level meter and the waveform as a slider.
- With a mouse, the level meter runs from −48 to 0 dBFS and keeps a clip mark until clicked; without a mouse, only ▷ and the time show.
- Volume and mute are kept per browser; videos keep the browser's controls.
- New card "Detail view" in "Personal" with image strip, links, search engines and blocks; "Appearance" keeps language, colour scheme, font size and timeline.
- "Old backups" names the last cleanup: date and number of deleted backups, or "nothing to delete".

### Changed

- "Clean up daily at midnight" deletes old backups at midnight server time (`TZ`), no longer after each backup; a missed midnight is caught up at start.
- The security log names these deletions "automatically at midnight".
- "More" stays open where a taller card beside it leaves room.
- "Preview and export up to" is aligned with the other upload limits.
- Collapsed "Links" shows the number once ("3 Links"), without brackets.
- ↓ ↑ under "Files" are as high as the fields beside them.

## [0.58.0] - 2026-10-07

Fingerprint `3e4f8efd` — previously `046110b5`.

> NPMplus with CrowdSec: add `audio` to the upload location, `(photos|videos|audio|comments|images)` (README, "Behind a reverse proxy"); otherwise audio files over 10 MB are rejected with 403.

### Added

- Photos, videos and audio files keep the name they were uploaded with; "Info", full screen and the download use it.
- Without a name, the download is called `<Title>_Entry-12_Photo-345`; fixed names such as `image.jpg` from phones count as missing.
- Audio files with the photos, in the same formats as under "Files"; tiles and full screen show the cover, otherwise the waveform.
- New upload limit "Audio": 50 MB by default, 1 to 100 MB.
- "Info" names the bit depth of audio; a sentence explains when a browser such as Firefox does not play a 32-bit FLAC.
- The timeline shows the scale 1 to 5 on the left edge and "Show all" as long as not all test days are visible.

### Changed

- Export format 23 carries names and audio files; "Include videos and audio" takes audio along. Format 14 to 22 is still imported, without names.
- "Metrics", the tiles in the overview, the delete dialog and the check of a backup count audio files separately.
- "Upload limits" and "Old backups": name and range on the left, the field on the right; all fields of a card end at the same edge.
- "More" only where the extra text takes three lines or more; shorter text stands directly below its sentence, on every device and at every width.
- The legend of the timeline is above the frame, larger, with the controls on the right; "Height = grade" is gone.

### Fixed

- A FLAC with an ID3 tag under "Files" did not play in Firefox; the same file with the photos plays too. The download stays byte-identical.
- An import answered before the uploaded file was closed and deleted.

## [0.57.2] - 2026-10-07

Fingerprint `046110b5` — previously `76ccc4c2`.

### Added

- "Copy all" below the recovery codes copies them, one code per line.
- "Names in:" above categories and criteria and "Words in:" in "Vocabulary" choose the language to rename in; a number names missing names.

### Changed

- "Appearance" and "Documents" use connected bars; a bar that does not fit becomes a list.
- Changing the language keeps the card in place. On tablets, the settings tabs are always open.
- "My account": the hint about the address is below the email field, "Save" below the password fields. Short extra text stands below its sentence; "More" only for longer text.
- "Categories" and "Tags": "Only admins · Everyone" sets who creates new names; an existing or empty name is reported at the field.
- Counts carry a word ("4 entries"); the "Partial" threshold is only in "Rating: criteria".
- "★ Favourites" is at the end of the status row. The sort direction is a bar "↓ · ↑" in the overview and under "Files".
- "New user": "First password" is a bar "By link · Set password"; known mail errors get a sentence with the server's message below.
- "Default" in "Languages", "Search engines" and "Image formats" is a column of radio buttons; a locked "Convert existing images" names the reason.
- The upload limit "Attachment" is called "Preview and export up to" and is listed below "File under “Files”".
- Old backups show "today" and "yesterday". New backups are named after the local time of the server (`TZ`).
- The waveform shows the average loudness per section; loud recordings no longer look like a flat band. Existing waveforms are recomputed on opening.

### Fixed

- "New user" overflowed at 360 px in Turkish; after locking a user, the message showed the status word.
- "Requests" said three times that registration is off; the backup card said "about 1 seconds".

## [0.57.1] - 2026-10-07

Fingerprint `76ccc4c2` — previously `62ad14cb`.

### Added

- The timeline zooms: activate it, then zoom with the mouse wheel or two fingers down to three months; dragging or the scrollbar moves.
- The chosen span is kept per account; by default the last three years.
- Setup offers the language, preselected from the browser. It becomes the default language and the language of the first account; the three supplied criteria are renamed into it.
- The search also finds the reason of a rejection.

### Changed

- "Status" and "Rejection" are connected bars without "All"; a second click turns a choice off.
- "Category" counts follow the other filters; on a phone, filter rows scroll sideways.
- "News" keeps its rows until reload and jumps to the oldest new comment; the menu icon carries a dot.
- Tasks in "Open tasks" jump to the task; ← leads back.
- Cards show "⌀ Score 4.3" and at most four lines of title. On a phone, "Compare" is a table.
- Saving a view under an existing name asks to replace it; similar titles are found by whole words.
- Up to 860 px, the entry shows the title first; potential and rating come first until the blocks are moved.
- Fields for a new category or tag appear after "+ New category" and "+ Tag"; a locked "Tested" shows a padlock.
- File names break at "_", "-" and "."; the upload tile shows the remaining time.
- The audio preview shows the waveform with a playhead.
- Errors stay until ✕ or a change of view; other messages stay 2.6 to 8 seconds by length. Errors in dialogs stand at the field.
- After too many failed sign-ins, the page counts down and locks "Sign in" for the whole network; "Forgot your password?" is on the sign-in page.
- A new installation is called "Kriterion". In English, vocabulary words are lower-case inside a sentence.

### Fixed

- An entry opened by its address showed the default title and could not browse until the overview had loaded. Back from an entry, the overview started at the top.
- Signing out left the sign-in page in the language of the account.

## [0.57.0] - 2026-10-06

Fingerprint `62ad14cb` — previously `44105c96`.

### Added

- Audio files under "Files" play without conversion: MP3, WAV, FLAC, AAC, Opus, Vorbis and WebM audio.
- A click opens a player in the preview, "Open" the full screen; audio resumes where it was paused. A file the browser cannot play offers "Download".
- An embedded cover appears on the tile, in the preview and in full screen; below it the waveform with a playhead, which seeks on tap or drag.
- The browser computes the waveform during the upload; older files get it when the uploader opens the entry.
- In full screen, two fingers zoom a photo and load the original beyond 1,600 pixels; with the mouse, dragging moves an enlarged photo.

### Changed

- The full screen buttons have one order everywhere; "Proxy · Original" is a connected bar, the version that plays is orange.
- On a phone in portrait, the buttons stay in one line that can be swiped sideways.
- "Load whole" names the file size and shows the progress while loading, then "✓ Loaded"; on a phone it is an icon.
- "Info" on a video shows the resolution under "General"; video, audio and proxy are under one "More info".
- Opening full screen with the mouse or a finger puts the focus on the view instead of ✕, so ✕ no longer shows the orange frame. Tab still reaches ✕ first.
- A double tap zooms to 2.5 times the fitted size, at most to the original. A swipe browses also on a video.
- Arrows over a playing video, and over photos on touch devices, disappear after 3 seconds.
- "Choose thumbnail …" shows a hint in full screen. After deleting the last photo, full screen shows the previous one.

### Fixed

- On zoom, the picture disappeared until the original had loaded; images without an original, such as comment images, showed a zoom pointer.
- In Edge with touch, a swipe to the right in full screen could go back a page. The arrows covered the sides of the message that a video cannot be played.

## [0.56.9] - 2026-10-06

Fingerprint `44105c96` — previously `538fcc56`.

### Changed

- Buttons follow one set of rules everywhere: orange for the main action, red only where data is lost, grey without fill for "Cancel" and "Close". "Save" is always orange.
- Confirmation dialogs are red only when data is lost; in a red question the focus is on "Cancel", so Enter deletes nothing.
- The bin icon deletes, ✕ only closes, clears or removes an assignment. "Delete for good" in the trash is a word. The delete buttons at links and test days are always visible.
- In the settings lists, pencil and bin are half visible on the desktop instead of appearing only on hover. "Users" shows "12 entries" instead of "12".
- "Search engines" has one "Save" below the three custom rows instead of three "Apply" buttons, each of which saved all rows.
- The import dialog reads "Cancel", "Replace", "Merge"; "Merge" is the main button, and only "Replace" is red in the box above.
- Notes without danger stand in a neutral box; optional features that are off are no longer red. Missing translations get an orange border.
- "Tiles · List" is a connected bar like the filters, with the chosen field in orange.
- The thumb in "None · Partial · 👍" and the folder icon are drawn in the text colour instead of as yellow emoji.
- A link to a folder becomes a marker with the folder icon and name in comments and descriptions, like links to files and photos.

### Fixed

- "Create entry" and the import dialogs did not close with Escape. With two dialogs open, Escape closed both.
- After a tap on a tablet or phone, a button kept its hover colour.
- Disabled buttons in lists, such as "↓ Load" under "Export in parts", looked active.
- Checkboxes outside "Export" were browser blue.
- The date field at test days and the selection in "Add folder" looked different from the fields next to them.

### Security

- `sharp` 0.35.5 and `@img/sharp-libvips-*` 1.3.4 after an `npm audit` report (high).

## [0.56.8] - 2026-10-06

Fingerprint `538fcc56` — previously `f672383e`.

### Changed

- A comment not yet sent, or being edited, stays in the browser tab after leaving the entry or reloading; it goes after sending, "Cancel" or signing out.
- A click next to a dialog with typed text no longer closes it. The back button closes an open dialog like "Cancel".
- A settings card with unsaved changes shows "not saved"; changing the section or leaving asks first.
- Saving "My account" ends the other sessions only when the password changes.
- On restore from the trash, category, tags and criteria are matched by number, so renamed ones come back under the new name.
- The export dialogs say what the file contains; before "Replace", the question names what the file does not contain.
- The result of an import appears in one dialog.
- "Languages" counts only vocabulary words without a default and names where names are missing.
- After deleting an entry, a message names the trash; the back button no longer leads to the deleted entry.
- A link opened before signing in leads to its address after signing in, also after the second factor.
- The upload menu item is called "Cancel upload"; its question closes with "Keep uploading".
- With a video in full screen, the space bar plays it instead of closing the view.

### Fixed

- The first click on a button below a focused comment field did not count, because the formatting bar disappeared on mousedown.
- The PDF preview showed "This page has been blocked" in Chrome and Edge.
- A file missing on the server showed a black stage or a player error; its tile now shows ⚠ and offers no "Open".
- If the chosen original of a video did not play, the view now returns to the proxy at the same position.
- Reloading "Compare" lost the selection and trapped the back button.
- A network error showed the browser's English text; a failed view now shows "Server not reachable." with "Try again".
- An ended session showed the internal text "kriterion:session-gone"; the sign-in page now names the reason.
- A wrong password emptied the username on the sign-in and setup pages.

### Security

- `proxy-addr` 2.0.8 and `source-map-js` 1.2.2 after two `npm audit` reports (critical and high).

## [0.56.7] - 2026-10-04

Fingerprint `f672383e` — previously `55fa87e4`.

### Changed

- Images under "Files" show as a version with 1,600 pixels on the long side; "100 %" and "Download" load the original.
- The search finds a category by its name in every language.
- On restore from the trash, a favourite goes back to the account that set it.
- Content without an author stays without an author ("No author"); only an admin may change it.
- Settings cards show one sentence per setting with a short name; the rest is under "More".
- Hint texts have a contrast of at least 4.5 : 1 in both colour schemes.

### Fixed

- The highlight of a search term was shifted after "İ" and missing for "I" in Turkish.
- The image worker repeated the start steps of the database at every start and stopped when another connection held the write lock.
- A direct API call allowed an empty title and switching off "Tested" while test days exist; the server now refuses both.

## [0.56.6] - 2026-10-03

Fingerprint `55fa87e4` — previously `859baa64`.

### Changed

- Someone who is neither author nor admin sees an entry without the buttons for what they may not change; someone else's test day is read-only.
- The import checks the free space for the unpacked content before reading the file and refuses with the figures.
- "Info" reads PDF details in a compressed object stream and Office and OpenDocument files stored as ZIP64.

### Fixed

- A transaction that first read and then wrote failed at once with "database is locked" while another connection was writing; it now waits up to 5 seconds.
- Moving files from the database to disk could stop for an hour this way; a failed file is now retried after a minute.
- An import file with a too old format stayed open until the restart and kept its disk space.
- After a refused change, title, description, category, crop and order show the saved state again.

## [0.56.5] - 2026-10-03

Fingerprint `859baa64` — previously `5d8a9336`.

### Changed

- The overview filter "◆ ★" is a bar "None · Partial · 👍"; 👍 shows entries with own stars for at least the threshold. A second click switches it off.

## [0.56.4] - 2026-10-03

Fingerprint `5d8a9336` — previously `6a318ea6`.

### Changed

- Full screen: a click or double tap shows the original at 100 %, and the clicked spot stays in place; the button is called "100 %".
- Full screen on a phone in portrait: the title has its own line next to ✕; for files, the file name comes first.
- On touch devices, the arrows ‹ › are hidden while a video plays; "Load whole" shows the progress in the button.
- Input fields have a stronger border; the light theme has more contrast for the focus ring and the symbols on photos.
- Buttons that appear on hover also appear with keyboard focus.
- Sign-in rate limit: for IPv6, the whole /64 network counts as one address.

### Fixed

- Full screen ignored the notch and the gesture bar of the phone; zooming showed a white corner between the scroll bars.
- Entry preview: a swipe still browsed when a second finger joined; the arrows changed their transparency after a tap.

## [0.56.3] - 2026-10-03

Fingerprint `6a318ea6` — previously `df009920`.

### Changed

- The overview filter for own stars is called "◆ ★", only "★" without the potential mode.
- The threshold for "Partial" can be set in "Potential: criteria" and "Rating: criteria"; both show the same value.
- "Info" on images and videos opens only "General"; the other groups open on click.
- Behind a reverse proxy, `X-Forwarded-For` is read only from the own network: loopback, private networks, 100.64.0.0/10, IPv6 ULA and link-local.

### Fixed

- Emails showed "{instanceTitle}" instead of the title of the installation.
- Sign-in rate limit: parallel attempts got through before the lock; password and two-factor code were not limited for signed-in users.
- "Old backups" did not save its value, and "Delete now" could delete more than shown.
- A test day after midnight failed with "date in the future" until 2 a.m. in Germany and 3 a.m. in Turkey.
- Fetching files back from a full or read-only backup drive ended the server; an update during a backup blocked backups for 24 hours.
- `keytool.sh`: a failed copy went unnoticed and the new key showed in the process list; `.env.before-key-change-*` ended up in the image.
- A blank password in the mail settings reused the stored one for a different server.
- A locked owner admin could not be demoted or removed while another owner admin was active.
- Interface: late answers overwrote the open view, "Next ›" ignored filters, and a double click created an entry or comment twice.

## [0.56.2] - 2026-10-03

Fingerprint `df009920` — previously `a8fe80d0`.

### Changed

- "Extended info" on images and videos is now called "Info", as on documents: in the ⋯ menu, at ⓘ in full screen and in the dialog.

## [0.56.1] - 2026-10-03

Fingerprint `a8fe80d0` — previously `a161550c`.

### Changed

- The overview filters own values in one group "Own values: None · Partial" at the end of the status row.
- Untested entries count by potential, tested ones by rating; saved filters and views drop their old values.
- Full screen: "Close" stays at the top right, the bin is the first button of the bar.
- Full screen: on touch, a tap beside the picture no longer closes it; a mouse click still does.
- Full screen covers the page completely in the dark scheme.

### Fixed

- Full screen on a phone in landscape: no strip and a lower header; on 640 × 360, a 16:9 video gets 544 × 306 instead of 263 × 148 px.
- Full screen: the buttons at the top wrapped although one row had room.
- Full screen: Back in the browser or on the phone closes it; before, the page behind changed and full screen stayed open.
- Full screen: a swipe no longer browses when it starts on a video, uses two fingers or the page is zoomed.
- Full screen takes the focus and gives it back when closed; Tab and screen readers no longer reach the page behind.

## [0.56.0] - 2026-10-02

Fingerprint `a161550c` — previously `cc298c6f`.

### Added

- The owner admin sets the proxy bit rate in the card "Proxy": 1 to 8 Mbit/s for 1080p30, default 5.
- In the list view under "Files", a computer shows "Proxy" before Edit and Link for a video with a proxy.

### Changed

- The proxy bit rate follows pixels and frame rate, at most 10 Mbit/s; before, 0.23 Mbit per frame up to 7.5 Mbit/s.
- After the update and after each change of the bit rate, proxies are replaced in the background, played videos first.
- The old proxy plays until the new one is ready; a replacement that fails keeps it until the next start.

### Fixed

- On a phone, an entry with files was 719 instead of 412 px wide: the buttons in the header of "Files" did not wrap.
- Full screen on a phone showed only part of a video: Chrome laid it out as wide as the page. It now fits the screen.
- The strip in full screen scrolls only itself, no longer the page behind it.
- Full screen on a phone: the buttons at the top wrap; with "Load whole" and "Proxy" shown, "Close" was off-screen.

## [0.55.1] - 2026-10-02

Fingerprint `cc298c6f` — previously `064133fa`.

### Added

- "Extended info" shows in the group "Proxy" the bit rates of video and audio, measured on the proxy.

### Changed

- In full screen, the proxy button names what plays, "Proxy" or "Original", and has no highlight.

## [0.55.0] - 2026-10-02

Fingerprint `064133fa` — previously `6402677f`.

> For proxies of videos, add `tmpfs: - /tmp:size=2g` to `docker-compose.yml`, and `devices: - /dev/dri:/dev/dri` for Quick Sync (README, "Proxies for videos").

### Added

- Proxies for videos under "Files": a smaller H.264/AAC version, at most 1080 pixels on the shorter side, up to 7.5 Mbit/s.
- The proxy plays as soon as it is ready; "Original" in full screen switches for one playback, "Download" delivers the original.
- The owner admin switches proxies on in the new card "Proxy" (default off).
- Quick Sync encodes the proxies when `/dev/dri` is mounted; otherwise the CPU converts at the lowest priority. The image builds its own ffmpeg.
- `mkv`, `avi`, `wmv` and `flv` play through their proxy and get a thumbnail from it.
- "Extended info" shows the group "Proxy" with state, resolution and size.
- "Reconcile" in "Storage and maintenance" (owner admin) lists files in `data/files/` without a reference and deletes the chosen ones where it is safe.
- It also lists missing files, fetches them back from the backup folder and checks the database.
- A missing file shows "missing" under "Files".
- "Storage and maintenance" shows the free space inside the database.

### Changed

- "Load whole" in full screen loads a video once and continues from the copy; without it, the browser buffers as before.
- Settings are reorganised into sections; "Backup" holds "Backup", "Old backups" and "Export and import".
- "Metrics" is split into "Metrics", "Storage and maintenance" and "Version and encryption"; "Second factor" is a card of its own.
- A user sees only "Personal" under Settings. Admins see locked fields as text; only the owner admin sees the hint about the key next to the database.
- Where the owner admin sees a server command, everyone else reads "ask an admin who can help you with it".
- Deleting files without a reference moved from a button in the card into "Reconcile".
- `docker-compose.example.yml` puts `/tmp` into RAM (`tmpfs`, 2 GB); proxies are only created there. `/dev/dri` is listed, commented out.

## [0.54.0] - 2026-10-01

Fingerprint `6402677f` — previously `5e5fb3c7`.

### Added

- "Rename …" in the "…" menu of an own file; the extension stays, and a name already used in the same folder is refused.
- "Info" for Word, Excel, PowerPoint, OpenDocument and PDF files: upload, last save in the Document Server and its account, and title, author, pages and dates from the file.
- "Extended info" of an image shows EXIF under "Capture": time taken, camera, lens, exposure, aperture, ISO, focal length; a location only as "yes". New dependency `exif-reader`.
- Overview filters "Potential" and "Rating" with "None" and "Partial", measured by your own stars; an admin sets the threshold for "Partial" (default 80 %) in "Rating: criteria".

### Changed

- "Type" shows format and pixels of an image as displayed ("PNG · 1920 × 1080"); the thumbnail shows the format.
- Thumbnails embedded in an image file appear as one row under "Image" instead of further "Image" groups.
- After the update, Kriterion reads each image and photo once more in the background for orientation and EXIF.
- Collapsed, the "Files" header shows only counts and size.
- "Rejected on … by …" and the title of the task button come from the language files; in English the card and section are "Users".
- The manual no longer describes "Export entry", which does not exist.

## [0.53.0] - 2026-10-01

Fingerprint `5e5fb3c7` — previously `a4d2ab5e`.

### Added

- "Delete file" moves the file to the "Trash" for 30 days; the owner admin restores it with folder, author and date.
- "Deleted files …" in an entry (owner admin) lists files from the trash and from Backups; "Fetch back" restores them.
- A file saved again since the Backup comes back next to the current one as "Name (Backup DD.MM.YYYY).ext".
- "Files" also sorts by "Type"; folders then sort by name.
- "Extended info" for the photos and videos of an entry; ⓘ in the full-screen view opens it.
- Security log: "File fetched from backup" for each file taken from a Backup.

### Changed

- "Extended info" shows the "Container" of a video and the codec as "H.264 (AVC)"; thumbnails and the list show "H.264".
- With a dialog open over the full-screen view, arrow keys no longer page and Esc closes only the dialog.
- After the update, Kriterion reads each photo and video of the entries once in the background.
- README and manual in English (`README.md`, `manual.md`), German (`README-de.md`, `manual-de.md`) and Turkish.
- The CHANGELOG is in English and shorter.

## [0.52.0] - 2026-09-30

Fingerprint `a4d2ab5e` — previously `7ace25ed`.

### Added

- "Files" sorts by "Name", "Date" or "Size" with a direction button; on desktop the list header sorts too.
- "Grouped by type": a divider row with a count per file type, also inside each folder.
- "Extended info" in the "…" menu of images and videos: codec, resolution, bit rates, frame rate, audio tracks.
- A video's codec shows on its thumbnail and in the list; new dependency `mediainfo.js`.
- Full-screen playback loads the whole video (up to 2 GB on desktop, 500 MB on phones) and shows "loaded … %".

### Changed

- After the update, Kriterion reads each image and video under "Files" once in the background; files stay unchanged.
- "Type" names the kind of file (Video, Image, PDF, Word …) instead of the extension.
- "…" menu: five groups, "Open" for images and videos; "Choose thumbnail …" replaces "Use this frame as thumbnail".
- List rows stack type, size and date, also next to "Edit"; ✎ and 🔗 sit in a fixed column.

## [0.51.0] - 2026-09-30

Fingerprint `7ace25ed` — previously `2b87077f`.

> After updating from the ZIP, make the new script executable: `chmod +x kriterion/backuptool.sh`.

### Added

- `./backuptool.sh list`, `show`, `check`, `restore`: inspect Backups (version, files, key, schema) and restore one.
- `restore` first backs up the current state; afterwards `data/files/` holds exactly the files of the chosen Backup.
- "Old backups" shows version, files and "only here" per Backup; "Select" deletes several, keeping "Keep at least".
- "check" names the version and whether the schema fits the installed version.
- "Files" sorts by "Oldest first", "Newest first" or "Name", per account; list view shows "Edit" in the row.

### Changed

- "Files" now shows the oldest folder first by default; "Newest first" gives the previous order.
- Every Backup writes its file list, whose first line names the version; the "Backup" card points to `./backuptool.sh`.
- "from 3:12" and "From the start" stay 10 s instead of 5 s when a video resumes.

## [0.50.0] - 2026-09-30

Fingerprint `2b87077f` — previously `210a7f57`.

> First start moves all files from the database to `data/files/`; without room for them plus 1 GB, it does not start.
> "Video on test day" is now the limit "File" (default 2048 MB) for all files; set it again under "Upload limits".
> `POST /api/items/:id/attachments` is gone, scripts upload in chunks; NPMplus: drop `attachments` from the location.

### Added

- "Select" under "Files" and in the photo strip deletes several tiles at once; under "Files" it also moves them.
- Videos resume per account where you stopped; folders stay open or closed per account.
- "Metrics" counts the files still waiting to be moved to disk.

### Changed

- Every file under "Files" is stored encrypted on disk and uploaded in chunks, up to the "File" limit.
- The backup copies every file to `kriterion-files/`; the backup folder needs room for all of them.
- Above the "Attachment" limit, Office and text files are download-only; PDF, images and videos still open.
- Camera-branded videos such as Sony XAVC HS count as MP4.

### Removed

- `POST /api/items/:id/attachments` and the limit of 20 files per selection.

### Fixed

- On a test day, "more" shows only when tags are hidden.

## [0.49.0] - 2026-09-29

Fingerprint `210a7f57` — previously `e480ecfc`.

> NPMplus: use `uploads/[0-9a-f]+` in the upload location, not `uploads/[0-9a-f]{32}`; the braces take the host offline.
> A Document Server now fetches every Office file and PDF once for thumbnails; they stay unencrypted in its cache.

### Added

- "Tiles" and "List" in the header of "Files", per account; "List" shows name, type, size, upload date and author.
- Document thumbnails show the first lines of text files and the first page of Office files and PDF.

### Changed

- Thumbnails for existing documents are created in the background after the update.
- Each group in "Files" has a frame; the Docker image includes the font `fonts-dejavu-core`.

## [0.48.0] - 2026-09-29

Fingerprint `e480ecfc` — previously `a49b4154`.

> Files in folders with a test day live in `data/files/`: copy it with `data/`; the backup folder needs room for them.
> Behind NPMplus, add `uploads/[0-9a-f]{32}` with "Disable Request Buffering" to the upload location (see README),
> and a location for `^/api/attachments/[0-9]+/raw$` with "Disable Response Buffering".

### Added

- Folders with a test day; 📁 in the test day row jumps to the folder, and every folder has an address and "Copy link".
- Uploads into such folders go in resumable 8 MB chunks, up to the new limit "Video on test day" (default 2048 MB).
- Files on disk under `data/files/`, each encrypted; "Metrics" shows files on disk, uploads, free space, missing and orphaned files.

### Changed

- Moving a file into a folder with a test day moves it from the database to disk; there is no way back.
- The backup copies the files on disk to `kriterion-files/` and shows progress; it locks the backup folder.
- The export leaves out large videos and names them beforehand; export format 22 adds the folders' test days.
- `keytool.sh` backs up `data/` without `data/files/`.

## [0.47.1] - 2026-09-29

Fingerprint `a49b4154` — previously `636c7c11`.

### Security

- `nodemailer` 9.1.1 → 10.0.12 (GHSA-6vj9-mwq6-2f5v); version 10 needs Node 20, the image ships Node 22.
- `multer` 2.3.0 → 2.4.0 (GHSA-3pph-fpjx-jg34).

## [0.47.0] - 2026-09-29

Fingerprint `636c7c11` — previously `643e8f9e`.

### Added

- Folders under "Files" with "Add folder"; upload into a folder with its "+" or by dropping onto it.
- "Move to …" in the menu of your own file; deleting a folder leaves its files loose.

### Changed

- Export format 21 carries folders, video thumbnails and durations; import and "Trash" restore them.
- A bare 403 shows "The reverse proxy in front refused the request (403)."; the README names the CrowdSec limit of 10 MB.

## [0.46.0] - 2026-09-28

Fingerprint `643e8f9e` — previously `6935aee7`.

### Added

- Videos under "Files" (MP4, M4V, WebM, MOV) play in full screen, also on iPhone; ← → page through images and videos.
- Video tiles show a thumbnail with ▶ and duration; "Use this frame as thumbnail" sets your own.
- If the browser cannot play a video, full screen says so and offers "Download".

### Changed

- With a video focused, ← and → skip 5 seconds; a video file's address opens the entry in full screen.
- Every file is served with range requests, so videos can be seeked; thumbnail and duration come back from "Trash".

## [0.45.0] - 2026-09-28

Fingerprint `6935aee7` — previously `46ae4e39`.

### Added

- "Files" shows square tiles with thumbnail or extension, name and size; a ⋯ menu on every tile offers what the server allows.
- Upload with the "+" tile or by dropping files, with progress, "Cancel" and "Try again"; uploads continue when you switch entries.

### Changed

- A click never downloads: images open in full screen, PDF, text and Office files in a preview.
- An entry holds 100 files instead of 20; one upload still takes 20.

## [0.44.2] - 2026-09-27

Fingerprint `46ae4e39` — previously `8237adde`.

### Changed

- The link list shows the account name in its own column before ↗, as for files, also on phones.

## [0.44.1] - 2026-09-27

Fingerprint `8237adde` — previously `37520fc0`.

### Added

- "Copy link" on the large image of an entry, next to the crop button.

### Fixed

- Size, account, ▸ and buttons in file rows now line up in fixed columns on desktop.

## [0.44.0] - 2026-09-27

Fingerprint `37520fc0` — previously `0c19372c`.

### Added

- A file or photo address in a comment or description becomes a reference; a Document Server file opens a viewer.
- "Copy link" in every file row and in photo full screen; `#/item/<Eintrag>/photo/<Foto>` opens that photo.
- Image files get a thumbnail tile like photos (existing ones on first display); Export, Import and "Trash" skip it.

### Changed

- A file's own view also shows images, PDF and text; other files download there with ↓.

### Fixed

- With more than 200 comment references in an entry, the rest showed as "deleted".

## [0.43.2] - 2026-09-27

Fingerprint `0c19372c` — previously `66001468`.

### Added

- A pencil appears only on files you may edit and opens them for editing; ⤢ now always opens for viewing.
- "Documents" in "Personal": Document Server theme ("Like Kriterion", "Modern light", "Modern dark") and upload default.
- The uploader toggles "Editable by all" in the file row with the two-person icon.

### Changed

- From the second account on, every file and link shows its uploader's name.
- The upload has no tick anymore; the "Documents" card switch is the default for accounts without their own.

### Fixed

- Returning from a file's own view now shows the file's row instead of the top of the entry.

## [0.43.1] - 2026-09-27

Fingerprint `66001468` — previously `c83a6a27`.

> If the old interface still shows after the update, reload once without cache (Ctrl+Shift+R).

### Fixed

- After an update, browsers kept the old interface for up to an hour; compressed files now carry `Cache-Control`.

## [0.43.0] - 2026-09-27

Fingerprint `c83a6a27` — previously `90d99a0b`.

### Added

- Office files can be edited through the Document Server in their own view, by the uploader.
- "Editable by all" (preset on the "Documents" card) lets every account edit; otherwise admins can only delete.
- The version before the last edit is kept ("Restore previous version").

### Changed

- Editing turns `.doc`, `.xls` and `.ppt` into `.docx`, `.xlsx` and `.pptx` after asking; the old file is kept.
- Export format 20 carries the tick per file; the previous version is only in the Backup.

## [0.42.3] - 2026-09-26

Fingerprint `90d99a0b` — previously `59983d51`.

### Added

- A full-screen button in a file's own view shows only the document, also in landscape on phones; Back or Esc ends it.

### Changed

- The "Documents" card shows each variable name small above its value.

## [0.42.2] - 2026-09-26

Fingerprint `59983d51` — previously `526a9c34`.

### Changed

- A file's own view fills the window without the Kriterion header: only back, file name and download.

### Fixed

- The hint below the viewer was cut off in a file's own view.

## [0.42.1] - 2026-09-26

Fingerprint `526a9c34` — previously `48829449`.

### Added

- ⤢ opens an Office file in its own full-window view; on phones a tap on the file does.

### Changed

- The viewer shows the signed-in account without asking for a name and hides chat and comments; phones get it embedded.

### Fixed

- Umlauts in uploaded file names were garbled ("Ömer" became "Ãmer"); names already stored stay as they are.
- The viewer stayed empty on phones; long addresses overflowed the "Documents" card.

## [0.42.0] - 2026-09-25

Fingerprint `48829449` — previously `dcbfdfb6`.

> A Document Server in the same Docker network needs `ALLOW_PRIVATE_IP_ADDRESS=true`, or it cannot fetch files.
> Every file it shows stays unencrypted in its cache. Without the new `.env` variables nothing changes.

### Added

- View Word, Excel, PowerPoint and OpenDocument files through a Document Server (Euro-Office, OnlyOffice); see README.
- "Documents" card under "Installation": switch for admins and a connection check in both directions.
- `.env`: `DOCUMENT_SERVER_ADDRESS`, `DOCUMENT_SERVER_SECRET`, `DOCUMENT_SERVER_INTERNAL_ADDRESS`, `INTERNAL_ADDRESS`.

### Changed

- With `DOCUMENT_SERVER_ADDRESS` set, the CSP allows scripts and frames from that address.

## [0.41.1] - 2026-09-25

Fingerprint `dcbfdfb6` — previously `d5aaeb21`.

### Added

- The set-password page says an admin can create a new link; the README explains how to restore a Backup.

### Changed

- Interface texts are aligned in German, English and Turkish; the role with all rights is "Owner admin".
- "Account" replaces "Zugang" and "Konto"; upload hints name the configured limit.
- The README covers installation and operation, the manual covers usage.

### Fixed

- Several English and Turkish sentences were cut off or ungrammatical.
- `.env.example` pointed to the "Encryption" card for the key value; it is on the "Metrics" card.

## Older versions — 0.10.0 to 0.41.0

- 0.41.0: Comments take videos; photos and videos can be downloaded; "Upload limits" card under "Database"; new installations use English names such as `kriterion-backup`.
- 0.40.0: The Export is one file again at any size and streams; the Import reads the file entry by entry and accepts up to 4 GB.
- 0.39.1: The four German environment variable names are no longer read; README, manual and `.env.example` drop the upgrade paths through earlier versions.
- 0.39.0: `data` comes last in `photos`, `comment_images` and `attachments`, so tiles load faster; optional `tools/reorder.js` reorders an existing database.
- 0.38.6: Kriterion is under the MIT license; the README lists dependency licenses and says the code was written with Claude Code.
- 0.38.5: README and manual have a table of contents; the instance starts on an incomplete database and writes nothing to it at startup.
- 0.38.4: Three indexes speed up criteria counts, file lists and tiles; new installations get the bundled criteria in the install language.
- 0.38.3: A reference within the open entry scrolls to the comment instead of redrawing the page; a reference used twice in one view works both times.
- 0.38.2: The comment number sits at the far right; a reference to its own entry jumps to its top; a hit found only in a link target shows a snippet.
- 0.38.1: Every address of this instance becomes a reference; copying the comment number works over plain HTTP; references jump on every click.
- 0.38.0: Formatting in comments and descriptions, with a formatting menu; numbered comments with copyable links; "Reply with quote"; export format 18.
- 0.37.0: The notice about an incomplete database names the old column; `AUTH_RESET` logs that it has no effect; the README uses current table names.
- 0.36.0: Every writing route requires a CSRF token; the login lockout survives a restart; every value written into the interface is escaped.
- 0.35.2: Uploading more than 40 photos at once works; log lines carry a time in the zone of `TZ`; `GET /api/items/:id/export` is removed.
- 0.35.1: A damaged `data/encryption.key` stops the start; a rejected settings request saves nothing; a "Trash" row can no longer be restored twice.
- 0.35.0: A single entry can be downloaded as a file; responses are compressed; the filters of the "Security log" work again.
- 0.34.4: An invitation or reset link can no longer be used twice at the same moment.
- 0.34.3: No change to the application; source comments only.
- 0.34.2: The README covers the server; usage moved unchanged to `manual-de.md`.
- 0.34.1: The README is shorter; every feature is still described.
- 0.34.0: No change to the application; the test suite is split into modules.
- 0.33.2: The log names a missing backup folder in a sentence instead of a key; eleven German sentences in the English log are now English.
- 0.33.1: Two moderate vulnerabilities in `qs` are fixed; the startup log says "Own server" for the mail provider.
- 0.33.0: Missing columns are no longer added at startup but listed in a log notice; the container log is in English; export format 17.
- 0.32.1: The comment block shows short counts; sorting by rating or potential no longer adds a status filter; Turkish case endings are fixed.
- 0.32.0: `@name` mentions an account in notes, reports and tasks; the bell panel has three sections; "Score" is a vocabulary word.
- 0.31.4: Turkish uses the singular after a number and the plural otherwise.
- 0.31.3: All Turkish texts are proofread; about twenty wrong sentences are fixed.
- 0.31.2: All English texts are proofread; eight garbled sentences are fixed.
- 0.31.1: Every language file key holds a whole sentence; custom language files translate sentences, not fragments.
- 0.31.0: German texts are proofread; error messages give the reason briefly and always the way out.
- 0.30.3: On phones, the collapsed tag row shows seven tags in two lines instead of four.
- 0.30.2: "Reset tags" and "more"/"less" are icons; with a tag filter active, the expanded tag cloud no longer puts each tag on its own line.
- 0.30.1: Due dates are visible to everyone who sees the entry and show their state; a done task without a date can get one.
- 0.30.0: The tag row opens with the filters; due dates show their state and stay on done tasks; a locked database at startup no longer ends the server.
- 0.29.0: Tasks can have a due date; "check" on a Backup reports its contents; an email address belongs to one account only; export format 16.
- 0.28.1: Sorting has a field and a direction button; "Previous" and "Next" at the foot of the entry; sorting by "Title" works after switching.
- 0.28.0: Arrows in the header page between entries in overview order; Kriterion can be added to the home screen; a shared header with search and menu.
- 0.27.0: "Image formats" under "Database": PNG, WebP lossless or WebP lossy; new thumbnails are WebP; "Convert existing images".
- 0.26.0: The "Potential" mode can be turned off; the file picker opens again after the first image; "End all other sessions" shows again.
- 0.25.4: A Turkish sentence that said the opposite of the German is fixed; missing singular forms such as "in 1 days" are fixed.
- 0.25.3: The two fields of a row in the "Vocabulary" card are aligned when a label wraps.
- 0.25.2: The name cards show the right notes when the interface language differs; the "Vocabulary" switch follows them.
- 0.25.1: The count on a language pill and the frame of incomplete cards apply per card; Turkish uses `yedekleme` for Backup throughout.
- 0.25.0: Category and criterion names carry their language; language pills show missing names; changing the default language no longer moves base names.
- 0.24.6: Changing a criterion's weight no longer renames it; without a name in the default language, the next available language is shown.
- 0.24.5: The language pills show the card's language, not the reader's; a missing translation is marked and the fallback is not saved as one.
- 0.24.4: Turkish is added; search treats `İ`, `I`, `ı` and `i` alike; vocabulary entered for one language no longer shows in others.
- 0.24.3: English is added; each account picks its language in "Appearance"; "Languages" card for the default language; export format 14.
- 0.24.2: Settings unreadable since 0.24.1 are back: own search engines and the mail setup; emails go out again.
- 0.24.1: Database, source code, API roots and addresses use English names; old addresses still work; older export files are translated on Import.
- 0.24.0: All interface texts live in `public/sprachen/de.json`; dates, times, numbers and sorting follow the language.
- 0.23.0: A light theme in "Appearance": "Light", "Dark" or "Auto", per account; dark stays the default.
- 0.22.1: The image crop can be moved and resized; untested entries have no rating box; the score in the header shows once, as the average over all users.
- 0.22.0: Photo strip size in "Appearance"; Kriterion's own confirmation dialogs; only the owner admin sees server commands; new German terms; new look.
- 0.21.1: Sorting by rating shows only "Tested" entries, by potential only "Untested"; a status pill set by hand overrides it.
- 0.21.0: A second star box "Potential" with its own criteria for untested entries; × on your own star row resets that criterion; export format 13.
- 0.20.1: "Old backups" lists every Backup and marks those the next run deletes; the fields are "Keep at least" and "Delete when older than".
- 0.20.0: "Old backups" under "Database" deletes Backups beyond the newest 3 and older than 30 days, with a preview and an optional automatic run.
- 0.19.6: Leaving an entry right after a crop, a delete or an upload no longer shows a false error.
- 0.19.5: Thumbnails are recreated square and cropped; cropped tiles and strips are sharp.
- 0.19.4: Photo thumbnails are recreated at the size tiles need; tiles were blurry before.
- 0.19.3: `GET /api/items` returns no tags per test day; image conversion runs in its own thread.
- 0.19.2: "Settings" and the overview load faster; a tight crop can be moved in every direction.
- 0.19.1: Only `docker-compose.example.yml` ships; "Image formats" is its own card.
- 0.19.0: Pasted screenshots become lossless WebP; "Convert all PNG to WebP"; tighter crops (`photos.zoom`).
- 0.18.1: "My sessions" shows ten sign-ins again.
- 0.18.0: Search hits show where the term was found, with a snippet; the term is highlighted.
- 0.17.5: Cards with short lists are no longer too tall; the "Security log" is aligned.
- 0.17.4: Cards in a row have the same height; the "Security log" shows 15 rows before it scrolls.
- 0.17.3: "Reset filters" in the sort row; mail delivery is set up in a dialog.
- 0.17.2: Vote counts show from two votes on; the bell no longer reports your own contributions.
- 0.17.1: "Anlage" became "Instanz"; a video no longer restarts when switched to full screen.
- 0.17.0: The bell says what is new and from whom and replaces the filter "New since …".
- 0.16.0: "Settings" has five sections; a bell for news and open tasks; ratings store their time.
- 0.15.1: The rejection reason no longer shows on entries that are not rejected.
- 0.15.0: Filters "Rejected" and "Not rejected"; only the author of a rejection reason rewrites it.
- 0.14.0: A rejection records date, reason and author; a cookie with `%` no longer locks a browser out.
- 0.13.2: A pinned comment had one edge in a different colour.
- 0.13.1: Label and toggle of the filter row are aligned.
- 0.13.0: HTTPS and the home network with the same settings; filters for the "Security log".
- 0.12.4: "Export in parts" with 50 to 300 MB each.
- 0.12.3: The export card shows the expected size; a too-large export is refused beforehand.
- 0.12.2: The preview row no longer leaves an empty strip on phones.
- 0.12.1: The buttons of the image area sit in one row at the top right.
- 0.12.0: Kriterion works on phones and tablets.
- 0.11.0: Search runs on the server and also finds comments, links and test days; saved views.
- 0.10.0: Optional second factor with an authenticator app; Semantic Versioning and Keep a Changelog.

## 0.9.1 — Self-registration

- "Request access" on the sign-in page (off by default): the address is confirmed by email, then an admin decides.
- Needs mail setup and `OEFFENTLICHE_ADRESSE`; admins approve on the "Requests" card. Make a Backup first.

## 0.9.0 — The server sends email itself

- The owner admin sets up SMTP on the "Mail delivery" card, with a test email; links go out as plain-text email.
- New dependency nodemailer (update with `--build`); accounts get an email address; opened links expire after 15 min.

## 0.8.91 — The key can be changed

- The encryption key can be changed on the host; the old value stays commented out in `.env` and opens older Backups.
- Make a Backup first and try it on a test instance; the "Backup" card marks copies made with the old key.

## 0.8.90 — Critical actions

- Critical actions ask for your password a second time; the "Security log" records sign-ins and instance-wide changes.
- Optional `OEFFENTLICHE_ADRESSE` in `.env`. Make a Backup of the data folder first.

## 0.8.80 — Invitation, reset, sessions

- Accounts are created and passwords reset with a link valid for seven days and once; nothing is sent by email.
- "My sessions" lists your sign-ins and ends them one by one. Make a Backup of the data folder first.

## 0.8.71 — The backup location moves

- The backup location is in the project folder, as the "Backup" card shows; update `docker-compose.yml` along with it.

## 0.8.70 — Backup and trash

- "Trash" (admins see it, the owner admin restores); Backup on demand outside the project folder, pausing the instance.
- A single entry can be downloaded as a file. Make a Backup of `data` first and use the new `docker-compose.yml`.

## 0.8.60 — What is open, what is new

- "Open tasks" lists all unfinished tasks, with "mine / all"; the filter "New since …" shows what changed.
- The "Metrics" card names its checksum Fingerprint; the database is not touched.

## 0.8.50 — Short videos with the photos

- Videos up to 20 MB (MP4, WebM, MOV) sit with the photos; export format 10 includes them. Back up `data` first.

## 0.8.40 — Weighted rating criteria

- Each rating criterion has a weight from 0.2 to 2 (all at 1 changes nothing); export format 9. Back up `data` first.

## 0.8.31 — Files get an author

- From two accounts on, other people's file rows show the uploader's name; export format 8. Back up `data` first.

## 0.8.30 — The link list gets an author

- From two accounts on, link rows show their author; delete dialogs count links; export format 7. Back up first.

## 0.8.20 — Hardening

- Photos are checked by content; a `Content-Security-Policy`, a container health check and clean shutdown.
- Optional `HINTER_PROXY` in `.env`, empty without a reverse proxy; SVG photos from before are served as downloads.

## 0.8.10 — Tooling

- The Fingerprint in the "Metrics" card; the build is reproducible.
- `sharp` 0.35.3 and Node 22 in the image; update with `--build`.

## 0.8.6 — Fixes from operation

- Only admins see who gave which rating; average and number of raters stay visible to everyone.
- The header shows who is signed in; "Created by" shows the date; the link list is cut off instead of scrolling.

## Older versions — 0.8.5 and earlier

These versions had no changelog, and a Fingerprint exists only since 0.8.10.

- 0.8.0 to 0.8.5: three roles, locking, sign-in throttling, `zugang.js`; 0.8.1 needs a database from 0.8.0 or newer.
- 0.7.0 to 0.7.2: own stars beside average and count, permission checks on the server, authors in Export and Import.
- 0.6.0 to 0.6.6: multi-user basis, authors for entries, comments and test days, favourites and settings per user.
- 0.5.0 to 0.5.11: first sign-in with a stored password hash, the name "Kriterion", tasks, clickable links.
- 0.4.7 to 0.4.10 and 4.1 to 4.5: phone use, attachments, tags on test days, timeline, vocabulary, criteria.
- 4.0 and older are not documented; their databases cannot be taken over.
