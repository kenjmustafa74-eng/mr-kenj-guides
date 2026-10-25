#!/usr/bin/env node
/*
 * One-off set-up for a Firebase project (run on the teacher's own computer, never on GitHub).
 *
 *   1. creates the teacher's sign-in (or finds it) and gives it the teacher role (roles/{uid})
 *   2. uploads the answer keys from private/<year>/answers.json to years/<year>/answers/<unit>_<sb|wb>
 *   3. creates years/<year>/meta/unlocks (everything locked) if it does not exist yet
 *   4. sets the class code students need to create an account (years/<year>/meta/classCode)
 *
 * The teacher's password and the class code are written to a private file (never printed).
 *
 * Usage (real project – needs a service-account key from Firebase console > Project settings > Service accounts):
 *   node tools/firebase/seed.js --app year5 --service-account private/service-accounts/kenj-guides.json \
 *        --teacher-email mr.kenj@example.com [--class-code KENJ5] [--no-class-code] [--reset-teacher-password]
 * Usage (local emulators): FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   node tools/firebase/seed.js --app year5 --project demo-kenj-guides --teacher-email teacher@example.com
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; };
const flag = (name) => args.includes(`--${name}`);
const die = (msg) => { console.error(`\n${msg}\n`); process.exit(1); };

const APP = opt('app', 'year5');
const cfgFile = path.join(ROOT, 'config', 'apps', `${APP}.json`);
if (!fs.existsSync(cfgFile)) die(`No config/apps/${APP}.json`);
const appCfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;

// ---- connect ----
let projectId = opt('project');
if (emulated) {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) die('Set FIREBASE_AUTH_EMULATOR_HOST as well as FIRESTORE_EMULATOR_HOST.');
  process.env.METADATA_SERVER_DETECTION = 'none'; // no Google Cloud metadata lookups on a local computer
  projectId = projectId || 'demo-kenj-guides';
  initializeApp({ projectId });
} else {
  const keyFile = opt('service-account', process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (!keyFile || !fs.existsSync(keyFile)) die('Give the service-account key file: --service-account private/service-accounts/<file>.json\n(Firebase console > Project settings > Service accounts > Generate new private key). Keep it in private/ – it is never committed.');
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  projectId = projectId || key.project_id;
  initializeApp({ credential: cert(key), projectId });
}
const auth = getAuth();
const db = getFirestore();
const yearRef = db.collection('years').doc(APP);

const outFile = opt('out', path.join(ROOT, 'private', 'credentials', `firebase-${projectId}-${APP}.txt`));
const words = ['maple', 'river', 'falcon', 'harbour', 'meadow', 'comet', 'lantern', 'pebble', 'orchard', 'summit', 'violet', 'dune', 'cedar', 'willow'];
const classCodeGen = () => `${words[crypto.randomInt(words.length)].toUpperCase()}-${crypto.randomInt(100, 1000)}`;

(async () => {
  const notes = [];
  // ---- 1. teacher ----
  const email = String(opt('teacher-email', '')).trim().toLowerCase();
  if (!email) die('Give the teacher\'s email: --teacher-email name@example.com');
  const name = opt('teacher-name', appCfg.teacherName || 'Teacher');
  let user, password = null;
  try { user = await auth.getUserByEmail(email); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  if (!user) {
    password = `Kenj-${crypto.randomBytes(12).toString('base64url')}`;
    user = await auth.createUser({ email, password, displayName: name, emailVerified: true });
    notes.push(`Created the teacher sign-in ${email}.`);
  } else if (flag('reset-teacher-password')) {
    password = `Kenj-${crypto.randomBytes(12).toString('base64url')}`;
    await auth.updateUser(user.uid, { password });
    notes.push(`Set a new password for ${email}.`);
  } else notes.push(`Teacher sign-in ${email} already exists (password unchanged; add --reset-teacher-password to set a new one).`);
  await db.collection('roles').doc(user.uid).set({ role: 'teacher', name, email, updatedAt: FieldValue.serverTimestamp() });
  notes.push('Teacher role set.');

  // ---- 2. answer keys ----
  const answersFile = path.join(ROOT, appCfg.answersFile);
  if (flag('skip-answers')) notes.push('Answer keys skipped (--skip-answers).');
  else if (!fs.existsSync(answersFile)) die(`Answer keys not found at ${appCfg.answersFile}. Build them first: python3 private/tools/fix_answers.py ${APP}`);
  else {
    const data = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
    const batch = db.batch();
    let n = 0;
    for (const u of data.units) {
      for (const section of ['sb', 'wb']) {
        batch.set(yearRef.collection('answers').doc(`${u.unit}_${section}`), {
          unit: u.unit, section, title: u.title || '', json: JSON.stringify(u[section] || []), updatedAt: FieldValue.serverTimestamp(),
        });
        n++;
      }
    }
    await batch.commit();
    notes.push(`Uploaded ${n} answer-key documents (${data.units.length} units × Student Book and Workbook).`);
  }

  // ---- 3. unlocks ----
  const unlocks = yearRef.collection('meta').doc('unlocks');
  if (!(await unlocks.get()).exists) {
    await unlocks.set({ open: {}, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'seed' });
    notes.push('All answer keys start locked.');
  } else notes.push('Existing unlock settings kept.');

  // ---- 4. class code ----
  const codeRef = yearRef.collection('meta').doc('classCode');
  let code = null;
  if (flag('no-class-code')) {
    await codeRef.delete();
    notes.push('Class code removed: anyone with the link can create an account. Set "classCodeRequired": false in the app config to match.');
  } else {
    const wanted = opt('class-code');
    const existing = await codeRef.get();
    if (wanted) code = wanted.trim().toUpperCase();
    else if (existing.exists) code = existing.data().code;
    else code = classCodeGen();
    await codeRef.set({ code, updatedAt: FieldValue.serverTimestamp() });
    notes.push('Class code set.');
    if (!(appCfg.site && appCfg.site.classCodeRequired)) notes.push('Note: the app config has "classCodeRequired": false, so the sign-up form will not ask for the code. Set it to true.');
  }

  // ---- private record (never printed) ----
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const old = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  const keep = (label) => { const m = old.match(new RegExp(`^${label}: (.*)$`, 'm')); return m ? m[1] : ''; };
  const lines = [
    `${appCfg.appName} – Firebase project ${projectId}${emulated ? ' (LOCAL EMULATOR)' : ''}`,
    `Teacher email: ${email}`,
    `Teacher password: ${password || keep('Teacher password') || '(unchanged – not known to this script)'}`,
    `Class code: ${code || '(none)'}`,
    'Keep this file private. The teacher can change the password in the app (Account > Change password).',
    '',
  ];
  fs.writeFileSync(outFile, lines.join('\n'), { mode: 0o600 });
  fs.chmodSync(outFile, 0o600);
  console.log(`${notes.map((n) => `• ${n}`).join('\n')}\nPassword and class code saved to ${path.relative(process.cwd(), outFile)} (not printed).`);
  process.exit(0);
})().catch((e) => die(`Seeding failed: ${e.message}`));
