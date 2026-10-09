/* Kriterion — Pruefstand: Ersatz fuer ffmpeg. videoproxy.js ruft ihn mit dem Inhalt von KRITERION_TESTBENCH als
   erstem Argument auf. Schalter: qsv=1 Quick Sync kodiert, qsv=2 nur ohne feste Bitrate; ffmpegfail=1 Abbruch,
   ffmpegfail=2 nur auf Weg A; ffmpeghold=<ms> wartet vor dem Schreiben. */
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const [bench = '', ...args] = process.argv.slice(2);
const set = {};
for (const piece of bench.split(':').slice(1)) {
  const [k, v] = piece.split('=');
  if (/^\d+$/.test(v || '')) set[k] = Number(v);
}

const box = (name, ...parts) => {
  const body = Buffer.concat(parts), head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(name, 4, 'latin1');
  return Buffer.concat([head, body]);
};
const u32 = (...n) => { const b = Buffer.alloc(4 * n.length); n.forEach((x, i) => b.writeUInt32BE(x >>> 0, 4 * i)); return b; };
const u16 = (...n) => { const b = Buffer.alloc(2 * n.length); n.forEach((x, i) => b.writeUInt16BE(x, 2 * i)); return b; };
const full = (name, ...parts) => box(name, Buffer.alloc(4), ...parts);

// MediaInfo rechnet die Bitrate aus der Groesse in stsz und 10 s Dauer; die Proben selbst fehlen in der Datei.
function moov(videoBps, audioBps) {
  const length = 10000, matrix = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
  const tkhd = (id, w, h) => box('tkhd', u32(7, 0, 0, id, 0, length), Buffer.alloc(8), u16(0, 0, 0, 0), matrix, u32(w << 16, h << 16));
  const tables = (entry, bps) => box('stbl', full('stsd', u32(1), entry), full('stts', u32(1, 1, length)),
    full('stsc', u32(1, 1, 1, 1)), full('stsz', u32(0, 1, Math.round(bps * 10 / 8))), full('stco', u32(1, 48)));
  const media = (type, head, entry, bps) => box('mdia', full('mdhd', u32(0, 0, 1000, length), u16(0x55c4, 0)),
    full('hdlr', u32(0), Buffer.from(type), Buffer.alloc(12), Buffer.from('\0')),
    box('minf', head, box('dinf', full('dref', u32(1), box('url ', u32(1)))), tables(entry, bps)));
  const picture = box('avc1', Buffer.alloc(6), u16(1), Buffer.alloc(16), u16(1920, 1080), u32(0x480000, 0x480000, 0), u16(1),
    Buffer.alloc(32), u16(0x18, 0xffff));
  const sound = box('mp4a', Buffer.alloc(6), u16(1), Buffer.alloc(8), u16(2, 16, 0, 0), u32(48000 << 16));
  return box('moov', full('mvhd', u32(0, 0, 1000, length, 0x10000), u16(0x100, 0), Buffer.alloc(8), matrix, Buffer.alloc(24), u32(3)),
    box('trak', tkhd(1, 1920, 1080), media('vide', full('vmhd', Buffer.alloc(8)), picture, videoBps)),
    box('trak', tkhd(2, 0, 0), media('soun', full('smhd', Buffer.alloc(4)), sound, audioBps)));
}

async function main() {
  if (args.includes('testsrc2=duration=2:size=1920x1080:rate=30')) {
    const fixed = args.includes('-b:v');
    if (set.qsv === 1 || (set.qsv === 2 && !fixed)) {
      process.stderr.write('[AVHWDeviceContext] VAAPI driver: Intel iHD driver for Intel(R) Gen Graphics - 25.2.3 ().\n');
      return 0;
    }
    process.stderr.write('[AVHWDeviceContext] libva: iHD_drv_video.so init failed\nDevice creation failed: -5.\n');
    return 1;
  }
  const input = args[args.indexOf('-i') + 1];
  const output = args[args.length - 1];
  const r = await fetch(input);
  const original = Buffer.from(await r.arrayBuffer());
  if (!r.ok) { process.stderr.write(`${input}: ${r.status}\n`); return 1; }
  const bare = await fetch(new URL('/x', input)).then(a => a.status, () => 0);
  if (set.ffmpeghold) await new Promise(done => setTimeout(done, set.ffmpeghold));
  if (set.ffmpegfail === 1 || (set.ffmpegfail === 2 && args.includes('-hwaccel'))) {
    process.stderr.write('Conversion failed!\n');
    return 1;
  }
  process.stdout.write('out_time_us=500000\nprogress=continue\nout_time_us=1000000\nprogress=end\n');
  // Die Daten nennen SHA-256 des Originals, Umgebung, Antwort ohne Marke, Prioritaet, Verzeichnis und Argumente.
  const hash = crypto.createHash('sha256').update(original).digest('hex');
  const text = `proxy ${hash} env=${Object.keys(process.env).join(',')} bare=${bare} nice=${os.getPriority()} mode=${(fs.statSync('.').mode & 0o777).toString(8)} cwd=${process.cwd()} ${args.join(' ')}\n`;
  const rate = (flag) => Number(args[args.indexOf(flag) + 1]) || 0;
  fs.writeFileSync(output, Buffer.concat([box('ftyp', Buffer.from('isom\0\0\x02\0isomavc1', 'latin1')),
    box('mdat', Buffer.from(text), Buffer.alloc(3000, 7)), moov(rate('-b:v'), rate('-b:a'))]));
  return 0;
}

main().then(code => process.exit(code), e => { process.stderr.write(String(e && e.message) + '\n'); process.exit(1); });
