// Cross-checks every word in lessons/*.json against persian-core's merged
// lexicon (persian-core's seed.json already ingested this repo's own data
// during its Phase 2 build, keyed by step id - see persian-core's
// scripts/build-seed.mjs). This catches drift: lesson content that's
// changed since that snapshot, or wording that never made it into the
// reconciled canonical form.
//
// Read-only report, same spirit as noghteh's scripts/vowel-audit.mjs - it
// doesn't rewrite lesson files or the lexicon. Flagged words still need a
// human (native-speaker) call, not a guess from this script.
//
// Usage: npm run lexicon-audit
import { readFileSync } from 'node:fs';
import { toMacron, lookup } from 'persian-core';

const isPersianWord = (s) => /^[؀-ۿ‌]+$/u.test(s ?? '');

const words = new Map(); // "fa|fin" -> { fa, fin, stepIds: [] }
const index = JSON.parse(readFileSync(new URL('../lessons/index.json', import.meta.url)));
for (const lessonId of index) {
  const lesson = JSON.parse(readFileSync(new URL(`../lessons/${lessonId}.json`, import.meta.url)));
  for (const step of lesson.steps) {
    for (const item of [step, ...(step.items ?? [])]) {
      for (const w of item.words ?? []) {
        if (!isPersianWord(w.fa)) continue;
        const key = `${w.fa}|${w.fin}`;
        if (!words.has(key)) words.set(key, { fa: w.fa, fin: w.fin, stepIds: [] });
        words.get(key).stepIds.push(item.id);
      }
    }
  }
}

const clean = [];
const diverges = [];
const missing = [];

for (const w of words.values()) {
  const entries = lookup(w.fa);
  if (entries.length === 0) {
    missing.push(w);
    continue;
  }
  const { ok, canonical } = toMacron(w.fa, w.fin);
  const current = ok ? canonical : w.fin.toLowerCase();
  if (entries.some((e) => e.canonical === current)) clean.push(w);
  else diverges.push({ ...w, current, canonicals: entries.map((e) => e.canonical) });
}

console.log(`${words.size} distinct (word, spelling) pairs: ${clean.length} clean, ${diverges.length} diverge, ${missing.length} not in lexicon`);

if (diverges.length) {
  console.log('\nDiverges from persian-core\'s lexicon:');
  for (const w of diverges) {
    console.log(`  ${w.fa} "${w.fin}" (steps: ${w.stepIds.join(', ')}) -> re-derives to "${w.current}", lexicon has [${w.canonicals.join(', ')}]`);
  }
}

if (missing.length) {
  console.log('\nNot found in persian-core\'s lexicon (new vocabulary, or filtered out of the seed build):');
  for (const w of missing) {
    console.log(`  ${w.fa} "${w.fin}" (steps: ${w.stepIds.join(', ')})`);
  }
}
