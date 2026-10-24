// All timestamps are stored as full ISO-8601 UTC strings (with ms) and serialised without ms.
let lastMono = 0;

const nowMs = () => Date.now();
const nowIso = () => new Date().toISOString();
const isoFromMs = (ms) => new Date(ms).toISOString();
const toMs = (iso) => (iso ? Date.parse(iso) : null);
/** Public form: 2026-10-11T08:30:00Z */
const pub = (iso) => (iso ? String(iso).replace(/\.\d+Z$/, 'Z') : null);
/** Strictly increasing millisecond value, used for FIFO ordering. */
function mono() {
  const n = Date.now();
  lastMono = n > lastMono ? n : lastMono + 1;
  return lastMono;
}
const minutesBetween = (aIso, bMs = Date.now()) => Math.max(0, (bMs - Date.parse(aIso)) / 60000);
const round1 = (n) => Math.round(n * 10) / 10;

/** Monday 00:00 UTC of the week containing ms. */
function weekStartMs(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday=0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
function dayStartMs(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

module.exports = { nowMs, nowIso, isoFromMs, toMs, pub, mono, minutesBetween, round1, weekStartMs, dayStartMs, dayKey };
