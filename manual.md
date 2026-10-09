# Kriterion — Manual

English · [Deutsch](manual-de.md) · [Türkçe](manual-tr.md)

How to use Kriterion. Installation, the key, backup and update are covered in
the [README](README.md).

---

**Contents**

- [Signing in](#signing-in)
- [Users and roles](#users-and-roles)
- [Overview](#overview)
- [Entry](#entry)
- [Comments](#comments)
- [Rating](#rating)
- [Settings](#settings)
- [Export and import](#export-and-import)
- [On phones and tablets](#on-phones-and-tablets)
- [Language](#language)
- [Vocabulary](#vocabulary)
- [Light or dark](#light-or-dark)
- [Font size](#font-size)

---

## Signing in

Without signing in, only the public title is visible. Sessions expire after
30 days. A link opened before signing in leads to its address afterwards. If a
session ends while in use, the sign-in page names the reason.

After several failed attempts, the sign-in answers with a delay. After ten
failed attempts from the same IP address, it is locked for a few minutes, even
across a restart; the lock applies to every device on the same network. The
sign-in page counts down the waiting time in minutes and seconds and enables
“Sign in” again afterwards. For IPv6, the whole /64 network counts as one
address. Per username, it is only delayed, never locked.

“Forgot your password?” is below “Sign in”: an admin creates a new link. The
page of an invitation link shows the username, so a password manager stores it
with the new password.

On the first visit, the page sets up the owner admin. The language is
preselected from the browser and can be changed above; it becomes the default
language of the installation and the language of the first account. The three
supplied criteria are then named in this language.

An invalid invitation or reset link (expired, used, wrong or account locked)
always gives the same message: “This link is no longer valid. Please ask the
admin for a new one.”

### Second factor

Optional, per account, off by default. Nobody can switch it on or off for
someone else, not even the owner admin. The code comes from an app on the
phone; Kriterion does not send codes.

Switch it on in “My account” under “Personal”, section “Second factor”:

1. Install a TOTP app, such as Google Authenticator, Aegis, 1Password or the
   Passwords app of iOS.
2. Choose “Switch the second factor on” and enter the password. On the phone,
   “Open in the app” opens the app directly; on a computer, type the key
   without spaces.
3. Enter the six-digit code and choose “Switch on”.

After that, the sign-in asks for password and code. Each code is valid once;
a code that was already used gets its own message, then wait for the next code
in the app. The clocks may differ by half a minute. The code is also required when a reset
link is used and before an export, an import, a role assignment or setting
someone else's password.

**Recovery codes:** When the second factor is switched on, eight codes appear.
They are shown only once, and each one works once in place of an app code.
**Keep them separate from the phone.** Without them, a lost phone is a lost
account. New codes are available in “Second factor” in exchange for password and
code; the old ones then expire. “Copy all” below the codes copies them, one code
per line.

If the phone and the codes are gone, the owner admin switches the second
factor off on the server (README, “Commands on the server”).

### Second confirmation

Before an export, an import, a role assignment, setting someone else's
password, creating a link, deleting a user and saving the mail account,
Kriterion asks the user for their password once more. The confirmation is
valid once, only for this action and only in this session.

Not confirmed: locking and unlocking, creating a user, changes to the user's
own account, the test email and everything on an entry.

## Users and roles

| Role | may |
|---|---|
| User | own entries, comments, ratings, test days, favourites |
| Admin | in addition criteria, tags, categories, title, vocabulary, search engines; delete other users' contributions (not change them); manage users, but not admins and not the owner admin |
| Owner admin | in addition export, import, backup, mail account, role assignment, key value, security log |

The person who sets up the installation is the owner admin. The role can be
passed on.

Users are managed in the “Users” card (Settings › Users). The rules:

- An admin does not change other admins or the owner admin.
- The last active owner admin cannot be demoted, locked or removed.
- Nobody can lock or remove themselves.

Locking takes effect at once: the session ends, and the user's open links
expire.

### Creating a user

The bar “First password” decides how:

- **“By link”** (default): “+ Create and generate a link” creates the user
  without a password and shows a link. The person who opens it chooses their
  password. Until then, the list shows “no password yet”.
- **“Set password”**: a password field and “+ Create”.

After creating, role and “First password” are back at their defaults.

A link is valid for seven days and can be used once. After it is first opened,
15 minutes remain. **Anyone who has the link can set the password.** It is
shown only once.

With an email address in the optional field, the link is also sent by email,
provided mail delivery is set up. After that, only the user can change the
address, in “My account”.

### Resetting a password

- **Reset link:** the old password stays valid until the link is used; then
  all sessions of the user end.
- **Setting the password directly:** all sessions end at once.

If nobody can get in any more, only the command on the server helps (README).

### Deleting a user

The name becomes free; the contributions stay and show “Deleted user 7”. Two
ticks optionally delete as well:

- the user's entries, including other users' comments, ratings and test days
  on them (the dialog shows the numbers);
- their contributions in other users' entries, including their folders there.

Sessions, open links, favourites and personal settings are always deleted as
well. To only stop someone from signing in, lock the user instead of deleting.
Deleted users are listed under “Deleted users (n)”.

### Registration

With registration switched on, someone can ask for an account on the sign-in
page through “Request access”. It is off by default. The switch is in the
“Requests” card and can only be switched on when:

- a test email has got through (again after every change to the mail account),
- `PUBLIC_ADDRESS` is set in the `.env` (README, “Configuration”).

Steps:

1. Request with username and email address, without a password.
2. Kriterion sends a confirmation link, valid for 24 hours. It does not open
   an account.
3. Only a confirmed request appears in the “Requests” card.
4. An admin approves it (role User, with an invitation link) or rejects it.
5. The user sets their password through the invitation link.

The answer to a request is always the same, whether the name is free or not.
At most 20 requests wait at the same time. If mail delivery fails later, the
switch stays on; the card shows a red line.

### Mail delivery

Optional. Without a mail account, every link is shown for copying. Kriterion
sends only two kinds of email, both as plain text: token links and the test
email.

Only the owner admin sets up the mail account, in the “Mail delivery” card
(Settings › Users). The dialog asks for provider (GMX, Web.de, Gmail, Strato,
IONOS or “Own server”), username, password and sender address. For the
presets, Kriterion supplies server, port and encryption. The password is never
shown; an empty field leaves it unchanged.

If the test email fails, the card names known causes in one sentence, such as
“Server or port is wrong”; the message of the mail server stands below in small
print.

Common mistakes:

- Gmail requires an app password.
- GMX and Web.de require sending through other programs to be enabled in the
  account.
- The sender address must belong to the account.
- Never send directly from a home internet connection, always through the SMTP
  server of a provider.

If the email lands in spam, the sender domain usually lacks the SPF, DKIM and
DMARC records. The mail provider supplies the values. To check, send a test
email to a Gmail account and look under “Show original”.

“Test email to me” goes to the address of the signed-in account. If the mail
server does not answer, the attempt stops after 20 seconds; the link is still
shown for copying.

### My sessions

The card shows where the account is signed in, and “End all other sessions”
ends all but the current one. Device and IP address are not stored. Each user
sees only their own sessions. A new password in the “Password” card ends the
other sessions; a new name or address in “My account” does not.

### Security log

Only for the owner admin. It records sign-ins (successful and failed), changes
to users and roles, passwords set, links created and used, export, import,
backup and key changes. Not in it: contents of entries, IP addresses, browser
identifiers.

The views “All · Failed · Sign-ins · User · Second factor · Database” each
show the 100 most recent rows. Names lead to the “Users” card. Rows are kept
for 180 days and cannot be deleted before then.

### Who may do what

On a single entry. The “author” is the person who created the item in question.

| | Author | anyone else | Admin |
|---|---|---|---|
| see everything | ✔ | ✔ | ✔ |
| title, description, photos, videos, tags, category, tested, rejected | ✔ | — | ✔ |
| rewrite the reason for a rejection | the person who rejected | — | the person who rejected |
| remove the reason for a rejection | ✔ | — | ✔ |
| delete the entry | ✔ | — | ✔ |
| favourite | each user for themselves | | |
| own rating, own test day | ✔ | ✔ | ✔ |
| add a link, upload a file | ✔ | ✔ | ✔ |
| delete own link, own file | ✔ | ✔ | ✔ |
| delete someone else's link or file | — | — | ✔ |
| create a folder | ✔ | ✔ | ✔ |
| rename a folder, upload into a folder | ✔ | — | — |
| delete a folder | ✔ | — | ✔ |
| move a file, only into own folders | ✔ | — | — |
| set the thumbnail of a video under “Files” | ✔ | — | — |
| reorder links | ✔ | — | ✔ |
| write a comment | ✔ | ✔ | ✔ |
| change own comment | ✔ | — | — |
| delete someone else's comment | — | — | ✔ |
| kind and pinning of a comment | ✔ | — | ✔ |
| delete someone else's test day or rating | — | — | ✔ |
| change someone else's score or rating | — | — | — |
| see who rated how | — | — | ✔ |
| attach an image or video to a comment | ✔ | — | — |
| delete an image or video from a comment | ✔ | — | ✔ |

An admin deletes other users' contributions but does not change them. If an
admin removes an image from someone else's comment, the comment shows “2
images or videos removed by the admin”.

Anyone else sees the entry without the buttons for what only the author and
the admin may change: title, description, status and category are plain
text; the drop field for photos and videos, the crop, deleting and dragging
are missing. At someone else's test day, score, bin and tags are read-only. The
server checks every change all the same.

### Authors

From the second account on, entry, comment and test day show their author.
Links and files show who added them, including the author of the entry; the
date appears on hover. The rating shows only the user's own value and the
average; only the admin sees who rated how, through “Who rated”.

## Overview

### Search

The search finds text in title, description, category, tags on the entry,
tags on test days, link URLs, comments and the reason of a rejection. `/` jumps to the search field. Upper
and lower case do not matter; `ß` and `ss` count as the same, and so do I, İ, ı
and i. The search finds a category by its name in every language.

Each result tile shows below the title where the term was found, for example
“comment: …recommended in Bellavista…”. The term is highlighted in the tile,
the link list and the comments. The URL of an opened result contains the term
(`#/item/12?q=ella`); reloading keeps the highlighting.

When an entry is created, “Similar titles: …” shows existing entries that
share a word of four letters or more with the new title, or a word with the
same first five letters. Entries sharing more words come first.

### Filters and sort order

- **Status:** a bar “Tested · Untested”; a second click switches it off, and
  without a choice everything is shown. In addition “Rejection” as a bar
  “Rejected · Not rejected”, “◆ ★” and, at the end of the row, “★ Favourites”.
  All of them can be combined.
- **Categories:** several can be chosen, always combined with Or; without a
  choice everything is shown. “Without” shows entries without a category. The
  number at a category counts with all other filters; a category without a
  match is dimmed.
- **Tags:** several can be chosen. The bar “And · Or” sets And (default) or Or.
  Dimmed tags would give no match with the other filters.
- **◆ ★:** a bar with “None”, “Partial” and 👍, measured by the user's own stars;
  a second click switches it off. Untested entries count by “Potential” (◆),
  tested ones by “Rating” (★). The title of the group names the words from the
  vocabulary. “None”: no own star. “Partial”: fewer own stars than the
  threshold, by default 80 % of the criteria. 👍: at least the threshold. An
  admin sets the threshold in “Rating: criteria”; it applies to rating and
  potential. If the potential mode is off, only ★ is shown and
  untested entries drop out; so do the entries of a box without criteria.
  Without criteria, the group is missing.
- **“Reset filters (n)”** appears in the sort row as soon as a filter is set.
  The search term, the sort order and saved views stay.
- **Sort order:** by last change, rating, potential, title, number of test
  days, average and last day score. The button next to it names the direction
  in words, for example “new → old”; a click reverses it. Entries without a
  value are always at the end.

Filters and sort order are saved and apply on every device. On a phone, the
bars scroll sideways; the edge fades where more buttons follow. Back from an
entry, the overview is at the same place.

For tested entries, the tile shows the rating (“★ 3.8”), otherwise the
potential (“◆ 4.2”).

### Saved views

“+ Save view” stores filters, sort order and search term as a button. An
existing name is replaced after a question; the button keeps its place. The
cross on the button removes it. Up to eight views per account.

### Timeline

Between the filters and the tiles: one dot per test day, the date horizontally,
the score vertically; the scale 1 to 5 is on the left edge. From two accounts
on, the line above it shows “● mine ○ others”. A click on a dot opens the
entry. It appears from five test days on and can be switched off in
“Appearance”.

It shows the last three years up to the latest test day. A double click into
the timeline activates it (orange frame): the mouse wheel zooms down to three
months, dragging and the scrollbar move; another double click, Esc or a click
outside ends it. On a touch device, a double tap switches it on and off; two
fingers zoom at once, and one finger moves it, also on a dot. The first tap on
a dot shows title and score, the second opens the entry. A line below the
timeline names the controls; as long as not all test days are visible, it also
holds “Show all” for the whole span. The chosen span is saved per account.

### Comparison

The box ⇄ on a tile adds the entry to the comparison. From two accounts on,
“Mine · All” switches between the user's own values and the average of all.
On a phone, the comparison is a table: criteria as rows, the entries as
columns that can be swiped. ← in an entry opened from there leads back to the
comparison.

### The bell and “Open tasks”

The bell reports new comments and ratings by others since it was last opened.
The panel groups them into “Addressed to me” (marked with `@name`), “My
entries” and “Everything else”. Each row says what is new and leads to the
oldest new comment; if only ratings are new, to the “Rating” block. Comments
show who wrote them; ratings stay anonymous. The rows stay until the page is
reloaded, opened ones dimmed. A dot on the menu icon also shows news.

Limits of the bell:

- It counts when the overview loads, not continuously.
- It keeps no read state per notification: opening the panel marks everything
  as seen.
- It does not report changed titles, new files or new test days.

“Open tasks” counts the unfinished tasks of all entries. The view behind it
orders them by due date: overdue, today, later, no date. They can be ticked
off right there. The text of a task leads to it; ← in the entry opened this way
leads back.

### Messages

A confirmation such as “Saved.” stays 2.6 to 8 seconds, depending on its
length. An error stays until ✕ closes it or the view changes. In a dialog, an
error about a field is shown in red below it, for example when creating an
entry or a folder. With a dialog open, messages are shown at the top.

## Entry

### Photos and videos

- Add them through the file picker, Ctrl+V or by dropping them on the field.
  Ctrl+V takes only images.
- Photos up to 30 MB, videos (MP4, WebM, MOV) up to 20 MB, audio files up to
  50 MB. The owner admin sets the limits. The number of photos is not limited.
  If a video is too large but fits under the “File” limit, the message points
  to the “Files” block: it can be uploaded there.
- **Audio:** the same formats as under “Files”: MP3, WAV, FLAC, AAC (`aac`,
  `m4a`), Opus and Vorbis (`opus`, `ogg`) and WebM audio (`weba`). Thumbnail,
  main image and full screen show the cover of the file, otherwise the
  waveform; main image and full screen play it, with the same controls as
  under “Files”. With a cover, ♪ and the duration are in the
  corner. If an audio file is first, the tile in the overview and the
  comparison show it the same way. An audio file continues where it was
  paused, like a video. There is no cropping or zoom for audio.
- **Names:** Photos, videos and audio files keep the name they were uploaded
  with. “Info” and full screen show it, ↓ downloads under it; the extension
  follows the content, so `Sketch.png` stored as WebP downloads as
  `Sketch.webp`. Fixed names from phones and the clipboard such as
  `image.jpg` count as missing. Without a name, the download is called
  `<Title>_Entry-12_Photo-345`, `…_Video-345` or `…_Audio-345`; images and
  videos in comments `<Title>_Entry-12_Comment-88_Image-5`. A name cannot be
  changed.
- The first item is the main image. Change the order by dragging the
  thumbnails.
- Browse with ← → or the arrows. A click opens the full screen view. There, a
  click on the picture shows the original at 100 %, and the clicked spot stays
  in place; “100 %” at the top shows the middle. The previous picture stays
  until the original has loaded. In the enlarged picture, dragging moves the
  view; a click without dragging shows the whole picture again. Esc, ✕ at the
  top right and Back in the browser
  close it, with the mouse also a click beside the picture. ↓ in full screen
  downloads the file. When a video has the focus, for example after a click on it, ← and →
  jump 5 seconds back or forward in it, in the entry as well as in full screen.
- **Buttons in full screen:** from the left the counter, ⓘ, the chain, for
  videos “Load whole” and “Proxy · Original”, “100 %”, ↓, the picture icon for
  the thumbnail and the bin; on the right ✕. A missing button does not apply
  to the file or is not allowed. Tab reaches ✕ first.
- **Copy link:** the chain icon in full screen copies the URL of the photo or
  video shown. The URL opens the entry and the full screen view at this item.
- Videos do not play by themselves and pause when browsing.
- **Position in the video:** A video continues where it was last paused or
  closed, per account and on every device. For 10 seconds, “from 3:12” is
  shown with “From the start” above it. Under 10 seconds and in the last part
  (5 %, at least 10 seconds), Kriterion stores nothing; the video then starts
  from the beginning. This also applies to videos under “Files” and in
  comments.
- **Loading the whole video:** In full screen, a video shows “Load whole” at
  the top, up to 2 GB on a computer and up to 500 MB on a phone; the title
  states the size. On a phone, the button is a cylinder with an arrow. A click
  pauses the video and loads the whole file once. Meanwhile the button shows
  the share, for example “37 %”, and the full screen view shows “Loading …
  37 %” with the point where the video continues. Another click cancels. The
  video then continues at the same point, and jumping needs no loading. The
  button then shows “✓ Loaded”, on a phone the cylinder with a check mark;
  this also applies when the browser has already loaded the whole video. The
  copy stays until the page
  is reloaded or another video is loaded whole. Without the button, the browser
  loads the video in pieces as usual. This also applies to videos under
  “Files” and in comments.
- **Selecting:** “Select” above the image strip puts a checkbox on every photo
  and video; a click or the space bar selects. The bar below shows the number
  and offers “Delete” with a confirmation, “Select all” and “Cancel”; Esc ends
  the selection. Only for the author of the entry and the admin.
- An image from the clipboard becomes considerably larger than the original
  file. Uploading the file is better.

### Crop

“Crop” above the image sets which square part appears on the tile. Dragging
outside the frame draws a new one, dragging inside the frame moves it, corners
and edges change the size. The slider sets the zoom (on the phone the only size
setting). The original stays unchanged. The hint for it is shown below the
image while the mode is open.

### Tags, files, links

- **Tags:** a click in the tag cloud sets or removes a tag. Test days can have
  their own tags.
- **Files:** appear in the “Files” block as tiles or as a list. The switch is
  in the block header, with “Tiles” and “List”; the choice applies to all
  entries and on every device. The tile shows a thumbnail or the file
  extension, with name and size below. A name breaks after “_”, “-” and “.”;
  if it does not fit in two lines, it is shortened in the middle and keeps its
  extension. The list shows one row per file: small
  thumbnail, name, type, size, upload date and, with several accounts, who
  uploaded it; on the phone, size, for videos and audio the length, and date
  are below the name. The type is Video, Image, PDF, Word, Excel, PowerPoint,
  Text, Archive or Other; for a video, codec, resolution with frame rate and
  length appear there, for example “H.265 · 1080p30 · 3:12”. The number is the
  shorter side of the picture, from 2160 on it says “4K”; “i” stands for
  interlaced video with its field rate, for example “1080i50”. For an image,
  format and pixels as displayed appear there, for example “PNG · 1920 × 1080”.
  Without details read from the file, it says “Image”. Click, menu, preview and
  keyboard work the same in both views. Up to 2 GB per file (limit “File”), at
  most 100 per entry. Collapsed, the block header shows only numbers and size,
  for example “3 folders · 12 videos · 9 images · 4 others · 1122.2 MB”; a type
  without files is left out. Sort order, view and buttons are only in the
  expanded header.
- **List on a computer:** A header row is shown above the list. A click on
  “Name”, “Type”, “Size” or “Date” sorts by it, a second click reverses the
  direction; ▲ or ▼ marks the sorted column. At the end of each row are ✎
  (Edit, only on a file the user may edit) and 🔗 (copy the link to the
  file); on the phone, both are only in the menu. If a video has a proxy,
  “Proxy” stands before them; pixels and size of the proxy appear on hover.
- **Sorting:** the selection next to “Tiles” and “List” sorts by “Name”,
  “Date”, “Size” or “Type”. The button next to it names the direction, for
  example “A → Z”, “old → new” or “large → small”; a click reverses it. After switching to another sort key, “A → Z”, “old → new”
  or “large → small” applies; the default is “Date” with “old → new”. “Type”
  orders the types as “Grouped by type” does and, within each type, by name;
  “Z → A” reverses both. The choice applies to all entries and on every
  device. The date is the upload date. “Name” ignores upper and lower case and
  puts “2” before “10”. The files without a folder stay at the top, and each
  folder stays a group; the folders follow the same choice, by size with the
  total of their files, by “Type” by name. Running uploads are at the end of
  their group.
- **Grouping:** “Grouped by type” in the second selection adds a separator row
  with the count for each type, for example “PDF · 3”. The types are ordered by
  name, “Other” last; within each type, the sort order applies. Each folder gets
  its own type groups. The full screen view browses in the same order. Like the
  sort order, the choice applies to all entries and on every device.
  Upload with the “+” tile, in the list with “Upload files” or by dropping
  files on the block. Each file appears as a tile at once and is uploaded on
  its own, the smallest first. The tile shows “waiting”, the progress such as
  “340 MB of 1.2 GB · about 4 min left” or ⚠ with the reason. If a file of the
  selection is larger than the “File” limit, none is uploaded; the message
  names the file and the limit. An upload continues when another entry is
  opened; when the tab is closed, the browser asks first. If the connection is
  lost, Kriterion tries again after 2, 5 and 15 seconds; the tile counts the
  seconds down.
- **Folders:** “Add folder” in the block header creates one; the name has 1 to
  80 characters, and identical names are allowed. The files without a folder
  are at the top, below them the folders in the sort order; each group has its
  own frame, and a collapsed folder is a bar. A click on its header expands or
  collapses a folder; Kriterion remembers this per account, on every device. A
  new folder is open. A jump to a folder, for example from the test day row,
  opens it only for this view. The header shows the number and size of the
  files and, with several accounts, who created the folder; when collapsed, it
  shows the state of its uploads. Users upload into their own folder with its
  “+” or by dropping files on it; nobody uploads into someone else's folder.
  “Move to …” in the menu of the user's own file offers their own folders and
  “No folder”; the file keeps its URL, thumbnail and “Editable by all”. The ⋯
  menu of a folder offers “Edit …”, “Copy link” and “Delete folder”; the files
  of a deleted folder then appear without a folder. If a folder is deleted
  while files are being uploaded into it, the waiting ones show ⚠ “This folder
  no longer exists.” An upload that is already running finishes; the file then
  appears without a folder.
- **Folder with a test day:** When creating a folder or later under “Edit …”,
  its creator can link it to one of their own test days of the same entry; a
  test day has at most one folder. The test day row then shows 📁; a click
  opens the block and the folder. The folder header shows the date with ↑ and
  leads back to the test day row. If the test day is deleted, the folder stays
  with its name and files.
- **Upload in chunks:** Each file is uploaded in requests of 8 MB. If the
  connection drops, the tile shows “interrupted” with the progress; the upload
  continues by itself as soon as the connection is back. After the tab has been
  closed, “Resume” in the menu continues with the same file. An interrupted
  upload expires after 24 hours. Each account has at most three open uploads.
  On the phone, keep the page open and the screen on.
- **Above “Preview and export up to”:** A file above this limit has no text
  preview and no thumbnail and does not open in the Document Server; it is
  downloaded instead. The browser still shows PDFs, images and videos. No
  export contains such files; they are in the backup.
- **Files on disk:** Kriterion stores each file individually encrypted next to
  the database. If a file is missing on the server, its tile shows ⚠.
- **Selecting:** “Select” in the block header puts a checkbox on every file the
  user may delete; a click or the space bar selects. The checkbox in the header
  of a folder selects everything in it, “Select all” in the bar selects all
  files. The bar shows the number and offers “Delete” with a confirmation and,
  if every selected file is the user's own, “Move to …”. “Cancel” or Esc ends
  the selection.
- **Click on a file:** An image or video opens the full screen view; ← and →
  browse through the images, videos and audio files of the same group, without a folder or
  in the same folder, in the order shown. At the top, the file name is shown,
  the entry title small next to it. An image over 1,600 pixels is shown in the
  full screen view and the preview as a version with 1,600 pixels on the long
  side; “100 %” and “Download” load the original. PDF, text, Markdown, CSV, log and
  `.docx` show the preview below the tiles, on the phone the separate view. If
  the admin has switched on a Document Server, this also applies to Word, Excel
  and PowerPoint files and their OpenDocument counterparts; below the viewer it
  says which Document Server shows the file. Any other file opens its menu. A
  click never downloads.
- **Videos:** MP4, M4V, WebM and MOV play in full screen, also on the iPhone.
  The tile shows a thumbnail, ▶, the duration and, at the bottom left, the
  codec, for example “H.265”; the tile of an image shows the format there, for
  example “JPEG”. Kriterion reads the codec after the upload; for videos from
  before the update, at the next start. The thumbnail is created
  in the browser during the upload, at 10 % of the length. If it is missing,
  for example after an import, the browser of the person who uploaded the video
  creates it when the entry is opened. “Choose thumbnail …” in the ⋯ menu opens
  the full screen view with the hint “Seek to the spot you want, then tap the
  picture icon”; the picture icon is highlighted and takes the frame shown. Only the person who uploaded the video may do this. If the browser
  cannot play a video, for example HEVC in Firefox, a sentence and “Download”
  are shown instead.
- **Audio:** MP3, WAV, FLAC, AAC (`aac`, `m4a`), Opus and Vorbis (`opus`,
  `ogg`) and WebM audio (`weba`) play without conversion. A click on the tile
  opens the preview, on a phone the full screen view; “Open” in the ⋯ menu
  opens the full screen view. Preview and full screen show the cover of the
  file and the waveform: the average loudness per section, the played part in
  orange, a line at the position. The waveform is a slider: a tap or click
  jumps there, dragging seeks, ← → jump 5 seconds, Home and End go to the
  start and the end. ▷ plays, ⏸ pauses; the time is below the waveform on the
  right. With a mouse, the speaker (mute), the volume and ▷ are on the left,
  next to them a level meter for L and R from −48 to 0 dBFS: green up to −18,
  yellow up to −6, red above. A line holds the peak for 1.5 seconds; a red mark
  at the top shows clipping until the meter is clicked. Mono shows one bar
  “M”. The meter measures before the volume and moves when muted too. Volume
  and mute apply per browser to all audio files. Without a mouse, for example
  on a phone, only ▷ and the time are shown; the device sets the volume.
  Videos keep the browser's controls. In full screen the waveform spans the
  width; large without a cover, below it with a cover. The tile shows the cover or the waveform, ♪ and
  the duration. The browser computes the waveform during the upload; if it is
  missing, for example after an import, the browser of the person who uploaded
  the file adds it. Until then, an icon is shown. An audio file continues
  where it was paused, like a video. If the browser cannot play a file, for
  example ALAC in `m4a`, a sentence and “Download” are shown instead. For a
  FLAC with 32 bit, a second sentence names the reason: some browsers, such as
  Firefox, do not play it; Edge, Chrome and Android do.
- **Proxy:** A video under “Files” plays its proxy as soon as it is ready: a
  smaller version in H.264 (README, “Proxies for videos”). In full screen,
  the bar “Proxy · Original” shows what plays in orange; a click on the other
  field switches, for this playback only. The next time it opens, the proxy plays again. The
  position applies to both. “Download”
  always delivers the original. No browser plays videos with the endings
  `mkv`, `avi`, `wmv` and `flv`; they play only with their proxy, and their
  thumbnail is made from it. If a proxy is missing or cannot be read, the
  original plays, and Kriterion creates the proxy again. After a change of the
  bit rate, the old proxy plays until the new one is ready; a video that is
  being played comes first.
- **Thumbnail of a document:** Text, Markdown, CSV and log files show their
  first lines on the tile. Word, Excel and PowerPoint files, their OpenDocument
  counterparts and PDF show the first page if the admin has switched on a
  Document Server. The image appears a few seconds after the upload and again
  after every save in the editor. The file extension is shown above it. If the
  Document Server cannot convert a file, the extension stays.
- **Preview:** at most one in the block, below the tiles of its group; a click
  on another tile switches it; a click on the same tile or collapsing its
  folder closes it. In its header, ⤢ opens the separate view, ↓ downloads, ×
  or Esc closes. If Kriterion cannot read an image file as an image, the tile
  shows the extension.
- **⋯ menu:** is on every tile and offers only what the user may do, in five
  groups separated by lines: “Open” and “Edit”; “Download”, “Copy link to this
  file” and “Info”; “Rename …”, “Move to …” and “Choose
  thumbnail …”; “Restore previous version” and “Editable by all”; “Delete
  file”. The top shows the
  name and, with several accounts, who uploaded the file and when. On the
  phone, the menu opens at the bottom edge. A tile that is still uploading
  offers “Cancel”, after an error “Try again” and “Remove”.
- **Info on images, videos and audio files:** “Info” in the ⋯ menu and ⓘ in
  full screen show what the file contains. ⓘ is also in the full screen view
  of the entry's photos, videos and audio files; there, the dialog shows the
  name and below it the position, for example “Image 3 / 7”. General: for videos the container and the
  resolution, otherwise the format, plus file size, duration, overall bit rate,
  recording date and, for videos, the number of audio tracks. Video: codec, profile, resolution, frame rate, bit
  rate, bit depth, chroma subsampling and HDR. H.264 and H.265 carry the
  MediaInfo name in brackets, for example “H.265 (HEVC)”; the list and the
  thumbnail show just “H.265”. Per audio track: codec, channels, sampling rate,
  bit depth, bit rate and language; lossy formats such as AAC and Opus have no
  bit depth. Image: the main image with format, resolution as
  displayed, bit depth, colour space and chroma subsampling; thumbnails inside
  the file, for example in the EXIF block, appear as one row with number and
  sizes. Capture: from EXIF the time taken, camera, lens, exposure time,
  aperture, ISO and focal length, with the 35 mm equivalent if the file states
  it. If the file contains a location, only “Location in the file: yes” is
  shown; Kriterion does not store coordinates. With a time taken from EXIF,
  “Recorded” under “General” is left out for images. Images from before the
  update are read again once after the start. If a video needs a proxy, the
  group “Proxy” states its state, resolution and size and the bit rates of video
  and audio, measured on the proxy. What the file does not state is left out.
  For videos, only “General” is open; video, audio and proxy are together under
  “More info”, which is closed each time the dialog opens. For images and
  audio files, all groups are open.
- **Info on documents:** “Info” in the ⋯ menu of a Word, Excel, PowerPoint or
  PDF file and their OpenDocument counterparts shows two groups. “In Kriterion”:
  uploaded by and on, modified before upload (the time of the file on the
  computer, only for files since the update), last saved by and on in the
  Document Server, number of saves and the date of the previous version. “In the
  file”: title, created by, created, last modified by, modified, pages, words,
  slides and application; for PDF title, author, created with, produced by,
  created, modified and pages. It is read when the dialog opens; parts of an
  Office file over 1 MB and, for PDF, everything except the first and the last
  MB stay unread. For `.doc`, `.xls`, `.ppt` and `.rtf` only the details from
  Kriterion appear. What is missing is not shown.
- **Rename:** “Rename …” in the ⋯ menu of an own file shows the name without
  the extension; the extension stays. Enter saves, Esc cancels. In the same
  folder, or among the files without a folder, no second file may have the
  same name; upper and lower case do not count. Only the person who uploaded
  the file may rename it, also while it is open in the Document Server. The
  previous version gets the new name with its own extension.
- **Keyboard:** Tab reaches every tile and its ⋯. Shift+F10 opens the menu, ↑
  and ↓ select, Enter runs the item, Esc closes.
- **Copy link:** copies the URL of the file. The URL of an image or video opens
  the entry and the full screen view in it. Any other URL opens the file in the
  separate view; a file without a preview is downloaded there with ↓.
- **Separate view:** shows the file across the whole window. The arrow at the
  top left and ✕ at the top right lead back to the entry, to the tile of the
  file; its folder is then open. The full screen icon in the bar shows only the
  document across the whole screen, also in landscape; Back or Esc ends it. If
  the browser cannot show full screen, the icon is missing.
- **Edit:** “Edit” in the menu opens the file in the separate view for editing;
  it appears only on files the user may edit. “Open” shows the file for
  viewing. The person who uploaded the file may edit it. If the file has
  “Editable by all”, every account edits it. Without it, not even the admin
  edits the file; the admin may only delete it. Each account sets in its
  personal section under “Documents” whether new files get this setting;
  without a personal setting, the admin's start value applies. The person who
  uploaded a single file switches it with “Editable by all” in the menu or with
  the tick in the bar of the view.
  Saving happens with Save in the editor and about 10 seconds after the last
  person has left the view. `.doc`, `.xls` and `.ppt` become `.docx`, `.xlsx`
  and `.pptx` in the process; the view asks first, and without OK the file is
  only viewed. On the phone, files are only viewed.
- **Previous version:** Kriterion keeps the version from before the last edit.
  “Restore previous version” in the menu or ↶ in the bar of the view restores
  it; the current version becomes the previous one, and doing it a second time
  undoes it. The previous version is only in the backup, not in the JSON
  export and not in the trash.
- **Links:** anyone may add them. The author of the entry or the admin may
  reorder them. A text without a URL (a word, an article number) becomes a
  search with the chosen search engine. The header names the number, for
  example “3 Links”, also when collapsed.

### Description

A click in the text or on the pen opens the field, leaving it saves, Esc
discards. The formatting is the same as for comments.

### Test days

Only with “Tested”. Each row is a day with an overall score. A date occurs once
per user; entering it again replaces the score. From three days on, a curve
shows the progression. As long as test days exist, “Tested” cannot be taken
back; the switch is then dimmed with a padlock. “+ Tags” in a row opens the
field for the tags of that day. If a test day has a folder, its row shows 📁; a click jumps to the folder.

### Rejecting

Setting “Rejected” opens a field for the reason (optional, up to 200
characters). Afterwards it reads, for example: “Rejected on 14.03.2026, 09:12
by Anna — delivery time over 6 months.” Only the person who rejected may change
the reason; anyone who may change the entry may remove it (bin). If the
rejection is withdrawn and set again later, the old reason is suggested in the
field.

### Blocks

The blocks of an entry can be moved by their handle and collapsed through their
header row. Next to the image, potential and rating come first, then category
and tags. The fields for a new category and a new tag appear after “+ New
category” and “+ Tag”. The layout applies to all entries and is reset in “Detail view”. If
a jump opens a collapsed block, this applies only to this view; a click on the
header row collapses it again.

### Deleting and the trash

Every deletion asks for confirmation. For an entry, the confirmation says what
belongs to it. The bin icon deletes; ✕ closes, clears or removes an assignment,
such as a tag from an entry. A red button loses data; in its question the focus
is on “Cancel”, so Enter deletes nothing. Deleted entries and files deleted one by one under “Files” stay
in the trash for 30 days; the owner admin can bring them back (Settings ›
Inventory, “Trash” card). Folders, and the thumbnail and duration of a video,
come back with them. Photos and videos of the entry and images in comments are
deleted at once.

**Deleted files …** appears for the owner admin in the header of “Files”. The
dialog lists the entry's deleted files from the trash and from every readable
backup, with source and folder. “Fetch back” puts the selected files back into
the entry, with their previous author and date. If their folder is missing, it
is created again with the same name. If the Document Server has saved a file
since the backup, the version from the backup is added as a separate file, with
“(Backup DD.MM.YYYY)” in the name. A file whose copy is missing from the backup
folder is shown without a checkbox.

## Comments

A comment has a **kind** (note, report or task) and can be **pinned**. Order:
pinned ones, then open tasks, reports, notes; within each group the oldest at
the top. The kind button steps through: note → task → done → note.

A comment not yet sent, or one being edited, stays in this browser tab. It is
back after leaving the entry or reloading, and goes after sending, “Cancel” or
signing out.

The left edge shows the kind: orange for report, blue for task, green for done.
Pinned comments have a golden frame.

- **Due date:** a task can have a date. There is no reminder, and nothing is
  sent.
- **Mentions:** `@name` in the text marks a user, who gets a notification in
  the bell. Names with spaces cannot be marked.
- **Images and videos:** up to 6 per comment in total. Images are stored scaled
  down, videos unchanged (up to 20 MB).
- **Formatting:** `**fett**`, `_kursiv_`, `` `Code` ``, `[Name](Adresse)`,
  `> ` quote, `- ` bulleted list, `1. ` numbered list. The menu above the field
  and Ctrl+B / Ctrl+I insert the same characters. `\` cancels the effect of a
  character.
- **URLs** with `http://`, `https://` or `www.` become links.
- **Number:** every comment has a number (`#3`). A click on it copies its URL;
  pasted into a field, it becomes a reference with the entry title.
- **Reference to a file or a photo:** a URL from “Copy link” becomes a marker
  in the text, also in the description. A file for the Document Server (Word,
  Excel, PowerPoint, OpenDocument) shows an icon and the file name; a click
  opens a small viewer below it, a second click closes it, ⤢ opens the
  separate view. Only the click loads the viewer; on the phone it opens the
  separate view. An image file shows its tile and opens the full screen view in
  the entry; other files show an icon and the file name and open the separate
  view. A photo shows its tile and opens the full screen view.
  A deleted file is shown as “deleted”.
- **Reference to a folder:** a URL from “Copy link” in the folder menu becomes a
  marker with the folder icon and name; a click opens the entry with the
  folder.
- **Quoting:** the quotation mark in the header row copies the comment into the
  input field. Selected text can be quoted through the “Quote” menu.

The block header shows a short count: **12 · ⚑3 · ☐3 · ☑2** (comments,
reports, open and done tasks). The full text appears on hover.

## Rating

An entry has two star boxes with their own criteria, weights and averages:

- **Potential:** before trying it out.
- **Rating:** afterwards, only on tested entries.

On a tested entry, the rating is expanded and the potential collapsed,
otherwise the other way round. The collapsed box shows its number in its
header. The potential mode can be switched off in the “Potential: criteria”
card (owner admin only); the stars are kept.

- The stars are the user's own rating. From two users on, the average of all
  appears next to them, from two ratings on with the count.
- The round button at the end of the row removes the user's own stars in this
  row, with “Undo”.
- Criteria can have different weights (`×1,5` after the name). The average
  stays between 1 and 5.
- A click on the number in the header shows the calculation: score, weight and
  product per criterion, sum, divisor, result. Only rated criteria count;
  rounding happens at the end.

The admin creates criteria in the settings, separately for both boxes. A
criterion belongs to one box for good. A deleted criterion takes all its stars
with it.

## Settings

The gear icon in the header opens the settings. Each section has its own URL.
Sections without a visible card do not appear. A card with unsaved changes
shows “not saved”; changing the section or leaving asks first. In the lists,
pencil and bin are half visible and become fully visible over the row.

| Section | Cards |
|---|---|
| Personal | My account, Password, My sessions, Appearance, Detail view, Documents |
| Inventory | Categories, Tags, Rating: criteria, Potential: criteria, Trash |
| Users | Users, Requests, Security log, Mail delivery |
| Database | Metrics, Storage and maintenance, Image formats, Upload limits |
| Backup | Backup, Old backups, Export and import |
| Installation | Title, Languages, Vocabulary, Search engines, Documents, Proxy, Version and encryption |

A user sees only “Personal”. The admin sees everything else; what they may not
change is shown as text. Only the owner admin sees the “Backup” section, the
“Languages”, “Security log” and “Mail delivery” cards and the commands for the
server. Everyone else reads instead of a command: “ask an admin who can help
you with it.”

| Card | Content |
|---|---|
| Title | title before signing in (visible to everyone, choose with care) and title after signing in |
| Documents | switch viewing and editing through a Document Server on and off; who may edit (“Only me · Everyone”): start value as long as an account has not set its own; the card checks the connection. URLs and secret are in the `.env`, see README |
| Proxy | switch proxies for videos under “Files” on and off and set the bit rate at 1080p30, 1 to 8 Mbit/s, only the owner admin, default off and 5 Mbit/s; whether Quick Sync encodes or the CPU converts, and why; whether `/tmp` is in RAM and how much is free; ready proxies, those with an old bit rate, waiting and failed ones. See README, “Proxies for videos” |
| Metrics | size of the inventory: entries, photos, videos, audio files, comments, links and test days |
| Storage and maintenance | database size, trash, files on disk (of which above “Preview and export up to” with its value and in the trash), uploads, free space. Only when there are any: free space in the database (“of which free”), files still in the database waiting to be moved to disk, missing files, files waiting to be deleted and files without a reference. For the owner admin “Reconcile”, see below |
| Version and encryption | version, fingerprint, encryption methods; for the owner admin the key value, as long as the key lies next to the database |
| Categories, Tags | create, rename, delete; the bar “Only admins · Everyone” sets who creates new names on an entry. An existing name is not created twice; the card names it at the field |
| Rating: criteria, Potential: criteria | create, rename, sort, weight (0.2 to 2, default 1); in “Rating: criteria” the threshold for “Partial” in the overview filters (1 to 100 %, default 80); “Potential: criteria” names it with a reference |
| Search engines | six built-in and up to three custom ones (`%s` as placeholder), saved with “Save”; a new custom one is ticked afterwards. The radio point in the column “Default” chooses the engine that comes first |
| My account | username and email address; “Save” asks for the password. Below it “Second factor”: switch on and off, new recovery codes, see “Second factor”; personal |
| Password | current and new password; afterwards all other sessions end; personal |
| Appearance | language, colour scheme, font size, timeline; personal |
| Detail view | size of the pictures in the image strip, number of visible link rows and engine names, block layout; personal |
| Documents (personal) | colour scheme in the Document Server (“Kriterion · Light · Dark”; “Light” and “Dark” are its “Modern” themes) and who may edit the user's own new files (“Only me · Everyone”). Only with the Document Server switched on |

### Reconcile

Only the owner admin sees “Reconcile” in the “Storage and maintenance” card. It
compares `data/files/` with the database and checks the database. Nothing is
deleted or fetched back without a confirmation.

Files without a reference are files, directories and symbolic links in
`data/files/` that the database does not know, with any name; `upload/` is not
one of them. The list states size, date and reason. One of them can be deleted if
one of these cases applies:

| Case | Reason in the list |
|---|---|
| Kriterion does not create the name, or it is a directory or a symbolic link | Kriterion does not create this name. |
| The backup folder contains the file with the same length | The backup folder contains it with the same length. |
| No backup in the backup folder names it. Only the file's row in the database holds its key; without it the file cannot be read | No backup names it; without its row it cannot be read. |

Everything else stays: a file that a backup names, if the backup folder does
not contain it; every file with a Kriterion name as long as a backup has no file
list or no backup folder is reachable. A directory is deleted with its content,
a symbolic link as a link and never its target. Nothing is deleted while a
backup is running.

Missing files are missing on disk or have the wrong length. The list states
entry, folder and file name, also for files in the trash and previous versions.
If the backup folder contains the file with the same length, “Fetch back”
restores it; otherwise it can be deleted in its entry. Under “Files”, a missing
file shows “missing”.

The database check (`quick_check` and `foreign_key_check` of SQLite) runs in a
thread of its own; Kriterion stays usable. It only reports and repairs nothing.
If it reports errors: README, “Restoring a backup”.

### Upload limits

Only the owner admin changes them. They apply from the next upload on.

| Type | Default (MB) | adjustable (MB) |
|---|---:|---:|
| Photo | 30 | 1 to 50 |
| Image in a comment | 20 | 1 to 50 |
| Video | 20 | 1 to 100 |
| Video in a comment | 20 | 1 to 100 |
| Audio | 50 | 1 to 100 |
| File under “Files” | 2048 | 1 to 4096 |
| Preview and export up to | 50 | 1 to 100 |

The first limit applies per file under “Files”. Up to “Preview and export up
to”, the export carries the content of a file, and the file has preview,
thumbnail and Document Server; above it, the file is only available for
download, except PDF, image and video. If this value is above the limit per
file, it counts as the limit per file. Files are sent in chunks of 8 MB; a reverse proxy in front must let
through requests as large as the limits for photos, videos and audio (README).

### Image formats

The “Storage method” section of the “Image formats” card sets how PNG images
are stored:

| Method | Effect |
|---|---|
| PNG | unchanged, largest storage |
| WebP lossless | about two thirds smaller; default |
| WebP lossy | useful only for photos; larger for screenshots with text |

The radio point in the column “Default” chooses the method. JPEG, GIF and WebP
stay unchanged. “Convert existing images” applies the method to the existing
images; the old version is gone afterwards. Make a backup first. If the button
is locked, the reason stands below it.

### Backup

Only for the owner admin. Creates a complete, encrypted backup. The card shows
location and duration and the last backup. If the backup folder lies inside
the project folder on the server, next to `data/`, a red warning stands above;
if it is on the same disk as `data/`, a sentence says so. Backups lie directly
in the mounted folder; there is no subfolder. Backups from before a key change
are marked red. Restoring is done on the server with `./backuptool.sh`
(README, “Restoring a backup”).

A backup is named after the local time of the server (`TZ` in
`docker-compose.yml`), for example `kriterion-2026-10-07-14-30-00.sqlite`.

The backup copies files on disk to `kriterion-files/` in the backup folder,
each one only once. While it copies, the card shows the number and size of the
copied files. If a file was missing on disk, the card shows the number. If a
backup into the same backup folder is already running, even from another
installation, the button does not start a second one and reports this.

### Old backups

Lists all backups with number, date, age and size. The second line shows the
version that created the backup, the number and size of its files and how many
of them are only in this backup; “before restoring” marks the backup that
`backuptool.sh` creates before restoring. Above the list are the number and
size of all files in `kriterion-files/`. “check” opens a backup as a test and
shows entries, photos, accounts, the most recent date, how many of the files
from its list are in `kriterion-files/`, the version and whether the schema
fits the installed version; “Not readable with this key” means it belongs to a
different key.

“Select” in the header of the list puts a checkbox on every backup. The N most
recent ones that match the current key are locked; they are the same ones the
rule protects. “Delete” in the bar asks for confirmation and shows the size of
the databases and of the files that are only in these backups. It also requires
the second confirmation.

Cleanup deletes a backup only if both apply: it is not among the N most recent
(1 to 20) **and** it is older than X days (7 to 365).

- The switch “Clean up daily at midnight” is off by default. When it is on,
  Kriterion deletes what the rule hits once a day at midnight in the server's
  local time (`TZ`). If the server was off at midnight, it cleans up at start.
  If a backup is running, it tries again an hour later. A new backup deletes
  nothing. Without the tick, backups are deleted by button only. The card
  names the last cleanup with date and number.
- Only backups matching the pattern `kriterion-….sqlite` and their lists
  `kriterion-….files` in the backup folder are deleted, plus every copy in
  `kriterion-files/` that no remaining list names. Other files stay.
- The rule does not touch backups from before a key change; they have their
  own button.
- Every deletion is recorded in the security log. A deletion at midnight
  names “automatically at midnight” as its author.

### Trash

The admin can view it, the owner admin can act. The card lists the deletions of
the last 30 days, entries and files. A file is shown with its entry and folder
before its name. “Restore” recreates the entry with all its contents or puts
the file back into its entry; “Delete for good” deletes it. On restore, a
favourite goes back to the account that set it, if that account still exists.
Category, tags and criteria come back under their current name, also after a
rename. Anything deleted in the meantime is left out; the message names it.
Entries removed when a user is deleted or by a replacing import do not go to
the trash.

## Export and import

Both are in the “Export and import” card, only for the owner admin, with a
password prompt.

| Way | for |
|---|---|
| Export into one file | moving, archiving, passing on; unencrypted |
| Export in parts | when an upload limit or a storage medium rules out one large file |
| Backup | complete, encrypted backup of the database (README) |

The export file contains only entries with author names. With the tick for
files, it also carries the folders with their test day and the thumbnail of
every video under “Files”; from an older export file, the files come without
folders. No export contains files above the preview and export limit; the card names them
beforehand. The import puts every file on disk. Before reading, it checks
the free space: three quarters of the file for the content, plus the database
and 1 GB of reserve; otherwise it refuses with the figures.
Not in it:
users, passwords, sessions, second factor, mail account, title, vocabulary,
search engines, settings, security log, trash.

**Export into one file:** “With photos” or “Without photos”; ticks for files
and for videos and audio. Photos, videos and audio files keep their names. The card shows the expected size. From 300 MB on, a note says that
it takes a while.

**Export in parts:** a part is a complete export file only with both ticks set.
The part size can be chosen (50 to 300 MB). To import: part 1 with “Replace”, all others with
“Merge”.

**Import:** the dialog offers “Cancel”, “Replace” and “Merge”; “Merge” is the
main button.

- **Merge** adds and leaves the existing entries in place.
- **Replace** deletes the existing entries first. This cannot be undone. The
  question before it names the files, videos, audio files and comment images
  that the file does not contain.

The dialogs before export and import name what the file contains. The import
changes everything or nothing. Contributions go to users with the same name,
otherwise to the person importing; the result afterwards lists these names. So when moving, create the users with the same names first.

There is no progress display; the window has to stay open until the process
has finished.

## On phones and tablets

The same interface, adapted to screen width and input.

- On the phone, the bell, “Open tasks”, Settings and Sign out are behind the
  menu icon. Search and “+ Entry” stay visible. A tablet with touch gets the
  same menu.
- On the phone, the filters are collapsed. The toggle shows the number of
  active filters.
- Messages span the whole width.
- In portrait up to 860 pixels wide, the entry shows the title before the
  image.
- “‹ Previous” and “Next ›” at the foot of an entry browse in the order of the
  overview, with filters and sort order.
- On the image, a swipe browses. Deleting is done on the large image, not on
  the thumbnail tile.
- Sorting by dragging needs a short hold with the finger.
- In full screen, a double tap enlarges the picture 2.5 times, at most to the
  original; the tapped spot stays under the finger. Two fingers zoom the
  picture; beyond the version with 1,600 pixels, the original loads. A swipe
  browses, also on a video; the strip with the timeline at the bottom and the
  waveform of an audio file stay free. The arrows ‹ › disappear after 3
  seconds without touch, at once while a video plays; a tap on the picture or
  video shows them again. A tap beside the picture does not close it; the back
  button does.
- In portrait, the title in full screen has its own line with the counter next
  to ✕; the buttons are below it in one line. If they do not fit, the line can
  be swiped sideways; the edge fades where more buttons follow.
- In landscape, full screen has no strip of thumbnails; browse with the arrows
  or by swiping.
- With “Add to Home Screen” in the browser, Kriterion can be placed on the
  home screen like an app. Without a network, it does not open.

## Language

German, English and Turkish. Each user chooses their language in “Appearance”;
the change takes effect at once. Without a choice of their own, the default
language of the installation applies. The sign-in page shows the default
language, also after signing out.

In “Settings › Installation › Languages”, the owner admin sets the default
language and the languages to choose from. A new installation starts in the
language chosen during setup.

Names of categories and criteria can be entered per language. If a name is
missing, the following apply in order: default language, language at creation,
original text. A name from another language is shown pale and in italics, with
the language below it. The bar “Names in:” above the lists chooses the
language in which names are renamed and shows, per language, a dot (everything
entered) or the number of missing names; in the vocabulary it is called “Words
in:”. On leaving the settings, the user's own language applies again.

## Vocabulary

Fifteen words of the interface can be renamed, for example “Entry” → “Machine”
or “Test day” → “Session”, also “Potential”, “Rating” and “Score”. Only the
labels change; the database and export files stay the same. A sample below the
fields shows the words in real sentences. Empty fields fall back to the
default. There is a vocabulary per language.

## Light or dark

In “Appearance” the bar “Light · Dark · Auto”; the default is Dark, Auto
follows the operating system.
The setting applies per account. The full screen view stays dark in both
schemes.

## Font size

In “Appearance”, five steps from 80 to 120 percent. Spacing stays the same.
The sign-in page keeps the default size.
