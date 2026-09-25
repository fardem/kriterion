/* Zeitstempel fuers Containerprotokoll in ISO 8601 mit Versatz aus TZ;
   gespeicherte Zeiten bleiben UTC. */

const NAME = '[Kriterion]';

function stamp(at = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  // getTimezoneOffset() zaehlt nach Westen, ISO 8601 nach Osten.
  const off = -at.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const away = Math.abs(off);
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}` +
         `T${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}` +
         `${sign}${two(Math.floor(away / 60))}:${two(away % 60)}`;
}

const logLine = (...parts) => console.log(stamp(), NAME, ...parts);
const logWarn = (...parts) => console.warn(stamp(), NAME, ...parts);
const logFail = (...parts) => console.error(stamp(), NAME, ...parts);

module.exports = { stamp, logLine, logWarn, logFail, NAME };
