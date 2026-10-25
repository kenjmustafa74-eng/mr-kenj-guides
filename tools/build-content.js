#!/usr/bin/env node
/*
 * Builds the app's content from the editable sources.
 *   content-src/<year>/unitN.yaml  -> content/<year>.json          (public, sent to every signed-in user)
 *   private/<year>/answers.json    (made by private/tools/fix_answers.py; NEVER public – served by the Node server
 *                                   or uploaded to Firestore by tools/firebase/seed.js, released per unit by the teacher)
 * Usage: node tools/build-content.js [year5]
 * Validates that every unit is complete and that no banned words appear anywhere.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const YEAR = process.argv[2] || 'year5';
const SRC = path.join(ROOT, 'content-src', YEAR);
const OUT = path.join(ROOT, 'content', `${YEAR}.json`);
const ANSWERS = path.join(ROOT, 'private', YEAR, 'answers.json');

// Inline Lucide icon names per unit (no emoji: they render differently on every device).
const ICONS = { 1: 'scroll-text', 2: 'book-user', 3: 'feather', 4: 'cog', 5: 'snail', 6: 'book-open-text', 7: 'drama', 8: 'clapperboard', 9: 'megaphone' };
const BANNED = /rainbow|\bpig(s|let|lets|gy|gies)?\b|\bhogs?\b|\bswine\b|\bpork\b|\boink\b|\u{1F308}|\u{1F437}|\u{1F416}|\u{1F43D}|\u{1F417}/iu;
const NO_SMART = new Set(['colour', 'icon', 'id', 'code', 'part']);

function smart(s) {
  return s
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/(^|\s)'s\b/g, '$1’s')
    .replace(/(^|[\s(\[“—–])'/g, '$1‘')
    .replace(/'/g, '’')
    .replace(/(^|[\s(\[‘—–])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/\s+–\s+/g, ' – ')
    .replace(/\.\.\./g, '…');
}
function deep(x, key) {
  if (typeof x === 'string') return NO_SMART.has(key) ? x : smart(x.trim());
  if (Array.isArray(x)) return x.map((v) => deep(v, key));
  if (x && typeof x === 'object') { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = deep(v, k); return o; }
  return x;
}

const errors = [];
const need = (cond, msg) => { if (!cond) errors.push(msg); };
const units = [];
for (let n = 1; n <= 9; n++) {
  const file = path.join(SRC, `unit${n}.yaml`);
  if (!fs.existsSync(file)) { errors.push(`missing ${file}`); continue; }
  const u = deep(yaml.load(fs.readFileSync(file, 'utf8')));
  const where = `Unit ${n}`;
  need(u.id === n, `${where}: id`);
  for (const k of ['title', 'overview', 'sbPages', 'wbPages', 'colour']) need(u[k], `${where}: ${k}`);
  need(u.objectives?.length >= 5, `${where}: objectives`);
  need(u.texts?.length >= 2 && u.texts.every((t) => t.title && t.summary && t.pages), `${where}: texts`);
  need(u.vocab?.length >= 8 && u.vocab.every((v) => v.word && v.meaning && v.example), `${where}: vocab`);
  need(u.sb?.length >= 12 && u.sb.every((s) => s.title && s.pages && s.tip && s.lesson), `${where}: sb`);
  need(u.wb?.length >= 12 && u.wb.every((w) => w.code && w.title && w.pages && w.tip && w.steps?.length), `${where}: wb`);
  need(u.cards?.length >= 6 && u.cards.every((c) => c.front && c.back), `${where}: cards`);
  need(u.practice?.length >= 8 && u.practice.every((q) => q.q && q.options?.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4 && q.explain), `${where}: practice`);
  need(u.basket?.length >= 3 && u.basket.every((b) => b.prompt && b.correct?.length >= 5 && b.wrong?.length >= 6), `${where}: basket`);
  for (const b of u.basket || []) {
    const overlap = b.correct.filter((w) => b.wrong.includes(w));
    need(!overlap.length, `${where}: basket overlap ${overlap}`);
  }
  for (const q of u.practice || []) need(new Set(q.options).size === 4, `${where}: duplicate options in "${q.q}"`);
  delete u.icon;
  u.icon = ICONS[n];
  // stable ids for progress tracking
  u.sb = u.sb.map((s, i) => ({ id: `u${n}-sb-${i}`, ...s }));
  u.wb = u.wb.map((w) => ({ id: `u${n}-wb-${w.code === 'J' ? 'journal' : w.code}`, ...w }));
  u.cards = u.cards.map((c, i) => ({ id: `u${n}-c${i}`, ...c }));
  u.practice = u.practice.map((q, i) => ({ id: `u${n}-q${i}`, ...q }));
  units.push(u);
}
const ids = units.flatMap((u) => [...u.sb, ...u.wb].map((x) => x.id));
need(new Set(ids).size === ids.length, 'duplicate activity ids');

const out = { year: YEAR, builtAt: new Date().toISOString(), units };
const json = JSON.stringify(out, null, 1);
if (BANNED.test(json)) errors.push(`banned word in content: ${json.match(BANNED)[0]}`);
if (fs.existsSync(ANSWERS)) {
  const a = fs.readFileSync(ANSWERS, 'utf8');
  if (BANNED.test(a)) errors.push(`banned word in answers: ${a.match(BANNED)[0]}`);
  const parsed = JSON.parse(a);
  need(parsed.units.length === 9 && parsed.units.every((u, i) => u.unit === i + 1 && u.sb.length && u.wb.length), 'answers incomplete');
  // The public content must never contain the publisher's suggested answers.
  const lines = [];
  const walk = (v) => { if (typeof v === 'string') lines.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  parsed.units.forEach((u) => { walk(u.sb); walk(u.wb); });
  const norm = (t) => t.replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const pub = norm(json);
  const leaked = [...new Set(lines.map(norm))].filter((t) => t.length >= 30 && pub.includes(t));
  if (leaked.length) errors.push(`answer-key text found in public content: ${leaked.slice(0, 3).join(' | ')}`);
} else if (process.argv.includes('--require-answers')) errors.push(`missing ${ANSWERS} (run: python3 private/tools/fix_answers.py ${YEAR})`);
else console.log(`Note: ${path.relative(ROOT, ANSWERS)} not found – skipping the answer-key checks (expected on GitHub Actions).`);
if (errors.length) { console.error('Content build FAILED:\n - ' + errors.join('\n - ')); process.exit(1); }
fs.writeFileSync(OUT, json);
const c = (k) => units.reduce((s, u) => s + u[k].length, 0);
console.log(`Built ${OUT}: ${units.length} units, ${c('sb')} Student Book sections, ${c('wb')} Workbook activities, ${c('vocab')} words, ${c('cards')} cards, ${c('practice')} questions, ${c('basket')} basket rounds.`);
