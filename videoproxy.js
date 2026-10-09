/* Proxys fuer Videos unter „Dateien": Auswahl, Wahl des Wegs, Aufruf von ffmpeg und Test von Quick Sync.
   Kein Zugriff auf Datenbank und Schluessel; server.js liefert das Original und verschluesselt das Ergebnis. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { proxyOnly } = require('./attachments');

const DRI = '/dev/dri/renderD128';
// `nobody`; ffmpeg laeuft ohne Zugriff auf data/ und ohne die Umgebung von Kriterion.
const FFMPEG_UID = 65534;
// Was Quick Sync des N100 dekodiert; alles andere dekodiert die CPU (Weg B).
const HW_DECODE = ['HEVC', 'VP9', 'AV1'];
const SHORT_SIDE = 1080;
const MAX_VIDEO_BPS = 12e6;
const MAX_PROXY_BPS = 10e6;
const PLAIN_AUDIO = ['AAC', 'MPEG Audio', 'Opus'];
const AUDIO_BPS = 128000;

const plainH264 = (v) => v.format === 'AVC' && (v.bitDepth == null || v.bitDepth === 8) &&
  (v.chroma == null || v.chroma === '4:2:0');

/* `info` aus attachment_media. Ein Proxy, wenn eines zutrifft: kuerzere Seite ueber 1080 Pixel,
   Video nicht H.264 mit 8 Bit und 4:2:0, Ton nicht AAC, MP3 oder Opus, Video ueber 12 Mbit/s,
   mkv, avi, wmv oder flv. */
function needsProxy(info, filename) {
  const v = info && Array.isArray(info.video) ? info.video[0] : null;
  if (!v) return false;
  if (proxyOnly(filename)) return true;
  if (Math.min(v.width || 0, v.height || 0) > SHORT_SIDE) return true;
  if (!plainH264(v)) return true;
  if ((info.audio || []).some(a => !PLAIN_AUDIO.includes(a.format))) return true;
  return (v.bitRate || 0) > MAX_VIDEO_BPS;
}

const frameRateOf = (v) => Number(v.frameRate) > 0 ? Number(v.frameRate) : 30;

// A: Quick Sync dekodiert und kodiert; B: die CPU dekodiert, Quick Sync kodiert; C: nur die CPU.
function wayOf(info, quickSync) {
  if (!quickSync) return 'C';
  const v = info.video[0];
  return plainH264(v) || HW_DECODE.includes(v.format) ? 'A' : 'B';
}

// Die kuerzere Seite hoechstens 1080 Pixel und gerade, sonst bricht libx264 ab; -noautorotate laesst
// ein Hochkant-Video liegend.
const SCALE = "w='if(gt(iw,ih),-2,min(1080,trunc(iw/2)*2))':h='if(gt(iw,ih),min(1080,trunc(ih/2)*2),-2)'";

// Breite und Hoehe, die SCALE ergibt.
function proxyPixels(v) {
  const w = v.width || 0, h = v.height || 0;
  if (!w || !h) return { width: null, height: null };
  const even = (n) => 2 * Math.round(n / 2);
  if (w > h) { const ph = Math.min(SHORT_SIDE, 2 * Math.floor(h / 2)); return { width: even(w * ph / h), height: ph }; }
  const pw = Math.min(SHORT_SIDE, 2 * Math.floor(w / 2));
  return { width: pw, height: even(h * pw / w) };
}

// `base` in bit/s gilt fuer 1920 × 1080 bei 30 Bildern je Sekunde; Pixel des Proxys und Bildrate im Verhaeltnis.
function videoBitRate(base, v) {
  const { width, height } = proxyPixels(v);
  const pixels = width && height ? width * height : 1920 * 1080;
  return Math.round(Math.min(MAX_PROXY_BPS, base * frameRateOf(v) / 30 * pixels / (1920 * 1080)));
}

function ffmpegArgs(way, input, output, v, base) {
  const bps = videoBitRate(base, v);
  const gop = Math.max(1, Math.round(2 * frameRateOf(v)));
  const decode = way === 'A' ? ['-hwaccel', 'vaapi', '-hwaccel_device', DRI, '-hwaccel_output_format', 'vaapi']
    : way === 'B' ? ['-init_hw_device', `vaapi=va:${DRI}`, '-filter_hw_device', 'va'] : [];
  const filter = way === 'A' ? `scale_vaapi=${SCALE}:format=nv12`
    : way === 'B' ? `scale=${SCALE},format=nv12,hwupload` : `scale=${SCALE},format=yuv420p`;
  const encode = way === 'C' ? ['-c:v', 'libx264', '-preset', 'veryfast'] : ['-c:v', 'h264_vaapi'];
  return ['-hide_banner', '-nostdin', '-nostats', '-progress', 'pipe:1', '-y', ...decode, '-noautorotate',
    '-i', input, '-vf', filter, ...encode, '-b:v', String(bps), '-maxrate', String(bps),
    '-bufsize', String(2 * bps), '-g', String(gop), '-c:a', 'aac', '-b:a', String(AUDIO_BPS),
    '-movflags', '+faststart', output];
}

// Groesse des Proxys in Bytes, mit einem Zehntel Spielraum; `duration` in Sekunden.
function expectedBytes(info, base) {
  const seconds = Number(info.general && info.general.duration) || 0;
  return Math.ceil(seconds * (videoBitRate(base, info.video[0]) + AUDIO_BPS) / 8 * 1.1);
}

/* ---- Umgebung ---- */
function findTool(name) {
  for (const dir of String(process.env.PATH || '/usr/local/bin:/usr/bin:/bin').split(':')) {
    const file = path.join(dir || '.', name);
    try { fs.accessSync(file, fs.constants.X_OK); return file; } catch {}
  }
  return null;
}

// Der Eintrag aus /proc/mounts, der /tmp traegt; null, wenn die Datei fehlt.
function tmpMount() {
  let rows;
  try { rows = fs.readFileSync('/proc/mounts', 'utf8').split('\n'); } catch { return null; }
  let best = null;
  for (const row of rows) {
    const [, where, type] = row.split(' ');
    if (!where || !(where === '/' || '/tmp' === where || '/tmp'.startsWith(where + '/'))) continue;
    if (!best || where.length > best.where.length) best = { where, type };
  }
  return best;
}

function tmpState() {
  const mount = tmpMount();
  let total = null, free = null;
  try { const z = fs.statfsSync('/tmp'); total = z.bsize * z.blocks; free = z.bsize * z.bavail; } catch {}
  return { tmpfs: !!mount && mount.type === 'tmpfs', total, free };
}

/* ---- Aufruf ---- */
/* `bench`: Skript des Pruefstands und seine Argumente statt ffmpeg; es laeuft unter derselben
   Nummer wie Kriterion. Sonst nur als root, unter FFMPEG_UID mit der Gruppe von /dev/dri. */
function launcher(bench) {
  // nice statt os.setPriority(): Docker gibt root kein CAP_SYS_NICE fuer einen Prozess unter FFMPEG_UID.
  const nice = findTool('nice');
  if (!nice) return { error: 'missing' };
  if (bench) return { file: nice, prefix: ['-n', '19', process.execPath, ...bench], ids: {} };
  const file = findTool('ffmpeg');
  if (!file) return { error: 'missing' };
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return { error: 'notRoot' };
  let gid = FFMPEG_UID;
  try { gid = fs.statSync(DRI).gid; } catch {}
  return { file: nice, prefix: ['-n', '19', file], ids: { uid: FFMPEG_UID, gid } };
}

/* Startet ffmpeg mit Prioritaet 19. `onProgress(seconds)` je Fortschrittszeile.
   Liefert { done, stop }; `done` loest mit { code, log } auf. */
function run(bench, args, { cwd, onProgress } = {}) {
  const how = launcher(bench);
  if (how.error) return { done: Promise.resolve({ code: -1, log: how.error }), stop: () => {} };
  const child = spawn(how.file, [...how.prefix, ...args], { cwd, env: {}, stdio: ['ignore', 'pipe', 'pipe'], ...how.ids });
  let log = '', rest = '';
  child.stderr.on('data', d => { log = (log + d).slice(-4000); });
  child.stdout.on('data', d => {
    rest += d;
    const rows = rest.split('\n');
    rest = rows.pop();
    for (const row of rows) {
      const m = /^out_time_us=(\d+)/.exec(row);
      if (m && onProgress) onProgress(Number(m[1]) / 1e6);
    }
  });
  const done = new Promise(resolve => {
    child.on('error', e => resolve({ code: -1, log: e.message }));
    child.on('close', code => resolve({ code: code == null ? -1 : code, log }));
  });
  return { done, stop: () => { try { child.kill('SIGKILL'); } catch {} } };
}

// Ein Verzeichnis unter /tmp, das nur FFMPEG_UID gehoert; im Pruefstand dem eigenen Benutzer.
function workDir(bench) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kriterion-video-'));
  if (!bench) fs.chownSync(dir, FFMPEG_UID, FFMPEG_UID);
  fs.chmodSync(dir, 0o700);
  return dir;
}

/* Zwei Sekunden testsrc2 ueber h264_vaapi, erst mit fester Bitrate; ohne HuC-Firmware gelingt nur der zweite Versuch.
   `reason`: noDevice, missing, notRoot, huc, firmware oder failed. */
async function probe(bench) {
  if (!bench && !fs.existsSync(DRI)) return { quickSync: false, reason: 'noDevice' };
  const test = (extra) => run(bench, ['-hide_banner', '-nostdin', '-v', 'verbose',
    '-init_hw_device', `vaapi=va:${DRI}`, '-filter_hw_device', 'va',
    '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=1920x1080:rate=30',
    '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', ...extra, '-f', 'null', '-'], { cwd: os.tmpdir() }).done;
  const fixed = await test(['-b:v', '5M', '-maxrate', '5M', '-bufsize', '10M']);
  if (fixed.code === 0) {
    const driver = (/VAAPI driver: (.*)\./.exec(fixed.log) || [])[1] || 'VA-API';
    return { quickSync: true, driver };
  }
  if (fixed.log === 'missing' || fixed.log === 'notRoot') return { quickSync: false, reason: fixed.log };
  const free = await test([]);
  // Ohne Firmware fuer i915 auf dem Host startet der Intel-Treiber nicht.
  const firmware = /iHD_drv_video\.so init failed/.test(fixed.log);
  return { quickSync: false, reason: free.code === 0 ? 'huc' : firmware ? 'firmware' : 'failed',
    detail: fixed.log.split('\n').filter(z => /libva|vaapi|fail|error/i.test(z)).slice(-3).join(' ').slice(0, 300) };
}

module.exports = { needsProxy, proxyPixels, videoBitRate, wayOf, ffmpegArgs, expectedBytes, tmpState, run,
  workDir, probe, launcher };
