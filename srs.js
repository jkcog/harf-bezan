// Lightweight Leitner-box spaced repetition, keyed by a word's `fin`.
// Independent of lesson/session state - just tracks how well each word
// sticks and when it's next due for another look.

const KEY = 'hb_srs';
const DAY = 24 * 60 * 60 * 1000;
const BOX_DAYS = [0, 1, 3, 7, 16, 35]; // box index -> days until next due
const MAX_BOX = BOX_DAYS.length - 1;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode */ }
}

// Call once per word per answered prompt: correct pushes it further out,
// wrong drops it back to box 0 (due immediately).
export function recordResult(fin, correct) {
  const data = load();
  const rec = data[fin] || { box: 0, due: 0, seen: 0, missed: 0 };
  rec.seen++;
  rec.box = correct ? Math.min(MAX_BOX, rec.box + 1) : Math.max(0, rec.box - 1);
  if (!correct) rec.missed++;
  rec.due = Date.now() + BOX_DAYS[rec.box] * DAY;
  data[fin] = rec;
  save(data);
}

// Words with a tracked record that's due now. Words never seen in a
// prompt aren't "due" - there's nothing to review yet.
export function dueWords(fins, now = Date.now()) {
  const data = load();
  return fins.filter(fin => data[fin] && data[fin].due <= now);
}

export function dueCount(fins, now = Date.now()) {
  return dueWords(fins, now).length;
}
