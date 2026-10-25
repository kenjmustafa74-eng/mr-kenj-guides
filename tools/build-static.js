#!/usr/bin/env node
/*
 * Builds the static website (GitHub Pages) for every year that has content:
 *   dist/index.html            a small page linking to each guide
 *   dist/<site.path>/          one complete guide per year, e.g. dist/year-five/ and dist/year-six/
 *
 * The Firebase web config comes from (first found):
 *   1. the FIREBASE_WEB_CONFIG environment variable (JSON) – e.g. a GitHub Actions variable
 *   2. config/firebase.web.json
 * Options:
 *   --emulators     talk to the local Firebase emulators (127.0.0.1:9099 / :8080) – for testing only
 *   --out <dir>     output folder (default dist)
 *
 * Safety: the build fails if anything that looks like an answer key ends up in the output.
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const EMU = args.includes('--emulators');
const OUT = path.resolve(ROOT, opt('out', 'dist'));
const die = (m) => { console.error(`\nStatic build FAILED: ${m}\n`); process.exit(1); };

// ---- Firebase web config (public by design: access is protected by firestore.rules and Auth settings) ----
let firebase;
if (EMU) firebase = { apiKey: 'demo-api-key', authDomain: 'demo-kenj-guides.firebaseapp.com', projectId: 'demo-kenj-guides', appId: 'demo-app' };
else if (process.env.FIREBASE_WEB_CONFIG && process.env.FIREBASE_WEB_CONFIG.trim()) {
  try { firebase = JSON.parse(process.env.FIREBASE_WEB_CONFIG); } catch { die('FIREBASE_WEB_CONFIG is not valid JSON.'); }
} else if (fs.existsSync(path.join(ROOT, 'config', 'firebase.web.json'))) firebase = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'firebase.web.json'), 'utf8'));
else die('No Firebase web config. Copy config/firebase.web.example.json to config/firebase.web.json and fill it in from the Firebase console.');
for (const k of ['apiKey', 'authDomain', 'projectId', 'appId']) if (!firebase[k] || /PASTE|000000/.test(firebase[k])) die(`Firebase web config is missing "${k}".`);
// Only what Auth and Firestore need. No Analytics (measurementId is dropped on purpose: this is a children's app).
firebase = Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].filter((k) => firebase[k]).map((k) => [k, firebase[k]]));

// ---- which years to build ----
const apps = fs.readdirSync(path.join(ROOT, 'config', 'apps'))
  .filter((f) => /^[a-z0-9]+\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'apps', f), 'utf8')))
  .filter((a) => a.site && a.site.path && fs.existsSync(path.join(ROOT, a.contentFile)))
  .sort((a, b) => a.id.localeCompare(b.id));
if (!apps.length) die('No app has both a "site" section in config/apps/*.json and a built content file.');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const bundle = esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src', 'firebase-backend.js')], bundle: true, minify: true, format: 'iife',
  target: ['es2020'], write: false, legalComments: 'none', logLevel: 'error',
}).outputFiles[0].contents;

const PUBLIC = path.join(ROOT, 'public');
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (from === PUBLIC && /^icons-/.test(e.name)) continue; // per-year icon sets are handled below
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
};
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const connect = ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://firestore.googleapis.com'];
if (EMU) connect.push('http://127.0.0.1:9099', 'http://127.0.0.1:8080');
const CSP = [`default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, `connect-src ${connect.join(' ')}`,
  `manifest-src 'self'`, `worker-src 'self'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`].join('; ');

for (const a of apps) {
  const dir = path.join(OUT, a.site.path);
  copyDir(PUBLIC, dir);
  // A year can have its own icons in public/icons-<id>/ (e.g. a "6" for Year Six); otherwise public/icons/ is used.
  const ownIcons = path.join(PUBLIC, `icons-${a.id}`);
  if (fs.existsSync(ownIcons)) copyDir(ownIcons, path.join(dir, 'icons'));
  const pub = {
    id: a.id, appName: a.appName, shortName: a.shortName, yearLabel: a.yearLabel, stage: a.stage, teacherName: a.teacherName,
    school: a.school, course: a.course, books: a.books, publisher: a.publisher, bookUrl: a.bookUrl, bookSiteName: a.bookSiteName,
    themeColour: a.themeColour, overallQuizLength: a.overallQuizLength, timezone: a.timezone,
    classCodeRequired: !!a.site.classCodeRequired, features: { resetByEmail: true },
    // Links to the other years' guides on the same website (e.g. Year Five <-> Year Six).
    otherGuides: apps.filter((x) => x.id !== a.id).map((x) => ({ id: x.id, appName: x.appName, yearLabel: x.yearLabel, href: `../${x.site.path}/` })),
  };
  const runtime = { app: pub, firebase, allAppIds: apps.map((x) => x.id),
    emulators: EMU ? { auth: 'http://127.0.0.1:9099', firestoreHost: '127.0.0.1', firestorePort: 8080 } : null };
  fs.writeFileSync(path.join(dir, 'js', 'config.js'), `/* Generated by tools/build-static.js – do not edit. */\nwindow.KENJ_CONFIG = ${JSON.stringify(runtime, null, 1)};\n`);
  fs.writeFileSync(path.join(dir, 'js', 'backend-firebase.js'), bundle);
  fs.copyFileSync(path.join(ROOT, a.contentFile), path.join(dir, 'content.json'));
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
    .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">\n  <meta name="referrer" content="strict-origin-when-cross-origin">`)
    .replace('<meta name="referrer"', `${a.site.url ? `<link rel="canonical" href="${escHtml(a.site.url)}">\n  ` : ''}<meta name="referrer"`)
    .replaceAll('{{APP_NAME}}', escHtml(a.appName))
    .replaceAll('{{THEME}}', a.themeColour)
    .replace('{{BACKEND_SCRIPTS}}', '  <script src="js/config.js" defer></script>\n  <script src="js/backend-firebase.js" defer></script>');
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify({
    name: a.appName, short_name: a.shortName, id: './', start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
    background_color: a.backgroundColour, theme_color: a.themeColour, lang: 'en-GB',
    description: `${a.course} ${a.stage} study guide for ${a.yearLabel} students at ${a.school}.`,
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 1));
}

// ---- landing page linking the guides ----
const first = apps[0];
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src 'self'">
<title>Mr. Kenj’s Guides</title>
<link rel="icon" type="image/png" href="${first.site.path}/icons/favicon-32.png">
<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f7f4ee;color:#1d2b33}
main{max-width:34rem;margin:0 auto;padding:3rem 1.2rem}h1{font-size:1.6rem;margin:0 0 .4rem}p{color:#53626a}
a.guide{display:flex;align-items:center;gap:1rem;margin-top:1rem;padding:1rem 1.1rem;border-radius:14px;background:#fff;color:inherit;text-decoration:none;box-shadow:0 1px 3px rgba(0,0,0,.12);font-weight:600}
a.guide img{width:48px;height:48px;border-radius:10px}a.guide:hover,a.guide:focus-visible{outline:3px solid #1f4e5f}</style></head>
<body><main><h1>Mr. Kenj’s Guides</h1><p>${escHtml(first.course)} study guides for ${escHtml(first.school)}. Choose your year.</p>
${apps.map((a) => `<a class="guide" href="${a.site.path}/"><img src="${a.site.path}/icons/icon-192.png" alt="">${escHtml(a.appName)}</a>`).join('\n')}
</main></body></html>
`);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

// ---- safety checks on the output ----
const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
walk(OUT);
const bad = files.filter((f) => /answers?[^/]*\.json$|\.pdf$|\.zip$|\.docx?$|\.sqlite|password|service-account|adminsdk/i.test(path.relative(OUT, f)));
if (bad.length) die(`private-looking files in the output: ${bad.join(', ')}`);
const textFiles = files.filter((f) => /\.(html|js|json|css|webmanifest|txt)$/.test(f));
const norm = (t) => t.replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const BANNED = /rainbow|\bpig(s|let|lets|gy|gies)?\b|\u{1F308}|\u{1F437}|\u{1F416}|\u{1F43D}/iu;
let checkedKeys = 0;
for (const a of apps) {
  const keyFile = path.join(ROOT, a.answersFile || '');
  if (!a.answersFile || !fs.existsSync(keyFile)) continue;
  const lines = [];
  const w = (v) => { if (typeof v === 'string') lines.push(norm(v)); else if (v && typeof v === 'object') Object.values(v).forEach(w); };
  JSON.parse(fs.readFileSync(keyFile, 'utf8')).units.forEach((u) => { w(u.sb); w(u.wb); });
  const keys = [...new Set(lines)].filter((t) => t.length >= 30);
  checkedKeys += keys.length;
  for (const f of textFiles) {
    const t = norm(fs.readFileSync(f, 'utf8'));
    const hit = keys.find((k) => t.includes(k));
    if (hit) die(`answer-key text found in ${path.relative(OUT, f)}: "${hit.slice(0, 60)}…"`);
  }
}
for (const f of textFiles) {
  if (f.endsWith('backend-firebase.js')) continue; // third-party SDK code
  const m = fs.readFileSync(f, 'utf8').match(BANNED);
  if (m) die(`banned word "${m[0]}" in ${path.relative(OUT, f)}`);
}
console.log(`Built ${apps.map((a) => `${path.relative(ROOT, OUT)}/${a.site.path}/ (${a.appName})`).join(', ')}${EMU ? ' – EMULATOR build' : ` – Firebase project ${firebase.projectId}`}.`);
console.log(`Safety checks passed: no private files${checkedKeys ? `, none of ${checkedKeys} answer-key lines present` : ' (answer keys not on this computer, so the text check was skipped)'}, no banned words.`);
