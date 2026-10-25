/*
 * Firebase backend for the static (GitHub Pages) build.
 *
 * The app talks to its data through one function, api(path, options). On the Node server that is a fetch()
 * to /api/...; in the static build this module answers the same routes with the same response shapes,
 * using Firebase Authentication (email + password) and Cloud Firestore. app.js does not need to know which
 * backend it is using.
 *
 * Firestore layout (everything for one year lives under years/{appId}, so Year 5 and Year 6 can share a project):
 *   roles/{uid}                          { role: 'teacher', name }       written only by tools/firebase/seed.js
 *   years/{app}/students/{uid}           one document per student: profile, progress, quiz attempts, cards,
 *                                        game scores, summaries and study days
 *   years/{app}/staff/{uid}              the teacher's own progress (same shape, never listed as a student)
 *   years/{app}/meta/unlocks             { open: { '1_sb': timestamp, ... } }   written by the teacher
 *   years/{app}/meta/classCode           { code }   optional, unreadable by apps; checked by the security rules
 *   years/{app}/answers/{unit}_{sb|wb}   { json }   answer keys, uploaded by the seed script; readable only
 *                                        when unlocked (or by the teacher) – see firestore.rules
 */
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider, deleteUser, updateProfile,
} from 'firebase/auth';
import {
  initializeFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
  runTransaction, serverTimestamp, arrayUnion, FieldPath, deleteField, Timestamp, setLogLevel,
} from 'firebase/firestore/lite';

const CFG = window.KENJ_CONFIG;
const A = CFG.app;
const APP_ID = A.id;
const QUIZ_KEEP = 300; // quiz attempts kept per student (oldest are dropped)

const fbApp = initializeApp(CFG.firebase);
const auth = initializeAuth(fbApp, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
const db = initializeFirestore(fbApp, {});
// Refused requests (e.g. a wrong class code) are normal here and shown to the user; keep the SDK from logging them.
setLogLevel('error');
if (CFG.emulators) {
  connectAuthEmulator(auth, CFG.emulators.auth, { disableWarnings: true });
  connectFirestoreEmulator(db, CFG.emulators.firestoreHost, CFG.emulators.firestorePort);
}

// ---------- helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const P = () => window.ProgressCore;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: A.timezone || 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const iso = (v) => (v instanceof Timestamp ? v.toDate().toISOString() : v || null);
const yearDoc = (...p) => doc(db, 'years', APP_ID, ...p);
const studentRef = (uid) => yearDoc('students', uid);
const staffRef = (uid) => yearDoc('staff', uid);
const unlocksRef = () => yearDoc('meta', 'unlocks');

function fail(status, error, extra = {}) {
  const e = new Error(error);
  e.status = status; e.data = { error, ...extra };
  return e;
}
// Turns Firebase errors into the same friendly messages the Node server gives.
function friendly(err) {
  if (err && err.data) return err;
  const code = (err && err.code) || '';
  const map = {
    'auth/invalid-email': [400, 'Please enter a valid email address.', 'email'],
    'auth/missing-email': [400, 'Please enter a valid email address.', 'email'],
    'auth/weak-password': [400, 'Your password needs at least 8 characters.', 'password'],
    'auth/missing-password': [400, 'Please enter your password.', 'password'],
    'auth/email-already-in-use': [409, 'An account with this email already exists. Try signing in.', 'email'],
    'auth/invalid-credential': [401, 'The email or password is not right. Please try again.'],
    'auth/invalid-login-credentials': [401, 'The email or password is not right. Please try again.'],
    'auth/wrong-password': [401, 'The email or password is not right. Please try again.'],
    'auth/user-not-found': [401, 'The email or password is not right. Please try again.'],
    'auth/user-disabled': [403, 'This account has been switched off. Please speak to your teacher.'],
    'auth/too-many-requests': [429, 'Too many attempts. Please wait a few minutes and try again.'],
    'auth/network-request-failed': [503, 'Could not connect. Please check your internet connection and try again.'],
    'auth/requires-recent-login': [401, 'For your safety, please sign out, sign in again and then try once more.'],
    'auth/operation-not-allowed': [503, 'Signing in with email is not switched on yet. Please tell your teacher.'],
    'auth/configuration-not-found': [503, 'Signing in with email is not switched on yet. Please tell your teacher.'],
    'auth/unauthorized-domain': [503, 'This website address is not yet allowed to sign in. Please tell your teacher.'],
    'permission-denied': [403, 'Sorry, you do not have permission to do that.'],
    'failed-precondition': [503, 'The guide’s database is not ready yet. Please tell your teacher.'],
    unavailable: [503, 'Could not connect. Please check your internet connection and try again.'],
    'deadline-exceeded': [503, 'The connection is slow. Please try again.'],
  };
  const m = map[code];
  if (m) return fail(m[0], m[1], m[2] ? { field: m[2] } : {});
  console.warn('Unexpected error', err); // eslint-disable-line no-console
  return fail(500, 'Something went wrong. Please try again.');
}

let contentCache = null;
async function content() {
  if (!contentCache) {
    const r = await fetch('content.json', { cache: 'no-cache' });
    if (!r.ok) throw fail(503, 'Could not load the guide. Please check your internet connection and try again.');
    contentCache = await r.json();
  }
  return contentCache;
}

// ---------- user and profile ----------
let me = null; // { id, name, email, role }

async function isTeacher(uid) {
  const r = await getDoc(doc(db, 'roles', uid));
  return r.exists() && r.data().role === 'teacher' ? r.data() : null;
}
function newProfile(user, name, extra = {}) {
  return {
    name, email: user.email, createdAt: serverTimestamp(), lastActive: serverTimestamp(),
    progress: {}, cards: {}, quiz: [], games: {}, summaries: {}, days: [], ...extra,
  };
}
async function resolveUser(user) {
  const role = await isTeacher(user.uid);
  if (role) {
    const ref = staffRef(user.uid);
    const snap = await getDoc(ref);
    const name = role.name || user.displayName || A.teacherName;
    if (!snap.exists()) await setDoc(ref, newProfile(user, name));
    return { id: user.uid, name, email: user.email, role: 'teacher' };
  }
  const snap = await getDoc(studentRef(user.uid));
  if (!snap.exists()) return null;
  return { id: user.uid, name: snap.data().name, email: snap.data().email, role: 'student' };
}
const myRef = () => (me.role === 'teacher' ? staffRef(me.id) : studentRef(me.id));

function cleanName(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
function checkName(name) { if (name.length < 2 || name.length > 60) throw fail(400, 'Please enter your name (2 to 60 characters).', { field: 'name' }); }

// Creates this year's profile for a signed-in Firebase user (new account, or a student joining a new year).
async function joinYear(user, name, classCode) {
  const extra = A.classCodeRequired ? { classCode: String(classCode || '').trim().toUpperCase() } : {};
  try {
    await setDoc(studentRef(user.uid), newProfile(user, name, extra));
  } catch (e) {
    if (e.code === 'permission-denied' && A.classCodeRequired) throw fail(400, 'That class code is not right. Ask your teacher for the code.', { field: 'classCode' });
    throw e;
  }
  return { id: user.uid, name, email: user.email, role: 'student' };
}

async function signup(b) {
  const name = cleanName(b.name);
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (A.classCodeRequired && !String(b.classCode || '').trim()) throw fail(400, 'Please enter the class code from your teacher.', { field: 'classCode' });
  checkName(name);
  if (!EMAIL_RE.test(email) || email.length > 120) throw fail(400, 'Please enter a valid email address.', { field: 'email' });
  if (password.length < 8 || password.length > 128) throw fail(400, 'Your password needs at least 8 characters.', { field: 'password' });
  let cred, created = false;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
    created = true;
  } catch (e) {
    if (e.code !== 'auth/email-already-in-use') throw e;
    // The email already has an account (for example from the other year's guide). If the password matches,
    // sign in and join this year; otherwise ask them to sign in.
    try { cred = await signInWithEmailAndPassword(auth, email, password); } catch { throw friendly(e); }
    const existing = await resolveUser(cred.user);
    if (existing) { me = existing; return { user: me }; }
  }
  try {
    if (created) await updateProfile(cred.user, { displayName: name });
    me = await joinYear(cred.user, name, b.classCode);
    return { user: me };
  } catch (e) {
    // Do not leave a half-made account behind (for example when the class code was wrong).
    if (created) await deleteUser(cred.user).catch(() => {});
    else await signOut(auth).catch(() => {});
    throw e;
  }
}

async function signin(b) {
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!email || !password) throw fail(401, 'The email or password is not right. Please try again.');
  const cred = await signInWithEmailAndPassword(auth, email, password);
  let user = await resolveUser(cred.user);
  if (!user) {
    if (A.classCodeRequired) {
      await signOut(auth);
      throw fail(403, `You have not joined ${A.yearLabel} yet. Choose “Create an account”, then use the same email and password with the class code from your teacher.`);
    }
    user = await joinYear(cred.user, cleanName(cred.user.displayName) || email.split('@')[0], '');
  }
  me = user;
  await updateDoc(myRef(), { lastActive: serverTimestamp() }).catch(() => {});
  return { user: me };
}

async function session() {
  await auth.authStateReady();
  const u = auth.currentUser;
  if (!u) { me = null; return { user: null }; }
  me = await resolveUser(u);
  if (!me && !A.classCodeRequired) me = await joinYear(u, cleanName(u.displayName) || u.email.split('@')[0], '');
  if (!me) { await signOut(auth); return { user: null }; }
  return { user: me };
}

function requireMe() { if (!me || !auth.currentUser) throw fail(401, 'Please sign in again.'); }
function requireTeacher() { requireMe(); if (me.role !== 'teacher') throw fail(403, 'Only the teacher can do that.'); }

async function reauth(password, field) {
  try {
    await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, String(password || '')));
  } catch (e) {
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials', 'auth/missing-password'].includes(e.code)) {
      throw fail(400, field === 'current' ? 'Your current password is not right.' : 'That password is not right.', { field });
    }
    throw e;
  }
}

// ---------- state ----------
function toState(d, unlocks) {
  d = d || {};
  const day = today();
  return {
    progress: Object.keys(d.progress || {}).filter((k) => d.progress[k]),
    quiz: (d.quiz || []).map((q, i) => ({ id: i + 1, scope: q.scope, score: q.score, total: q.total, created_at: q.at })),
    cards: { ...(d.cards || {}) },
    games: Object.entries(d.games || {}).map(([k, g]) => ({ unit_id: Number(k), best_score: g.best, best_level: g.bestLevel, plays: g.plays, updated_at: g.at })),
    summaries: Object.entries(d.summaries || {}).map(([k, s]) => ({ unit_id: Number(k), main_idea: s.main_idea || '', learnt: s.learnt || '', favourite: s.favourite || '', wonder: s.wonder || '', updated_at: s.at })),
    unlocks,
    streak: P().streak([...new Set(d.days || [])].sort(), day),
    today: day,
  };
}
async function getUnlocks() {
  const snap = await getDoc(unlocksRef());
  const open = (snap.exists() && snap.data().open) || {};
  return Object.entries(open).map(([k, at]) => {
    const [u, section] = k.split('_');
    return { unit_id: Number(u), section, unlocked_at: iso(at) };
  }).sort((a, b) => a.unit_id - b.unit_id || a.section.localeCompare(b.section));
}
async function state() {
  requireMe();
  const [snap, unlocks] = await Promise.all([getDoc(myRef()), getUnlocks()]);
  return toState(snap.data(), unlocks);
}
// Fields that record a study day and keep "last active" fresh, added to every study action.
const studied = () => ['lastActive', serverTimestamp(), 'days', arrayUnion(today())];

async function setProgress(itemId, b) {
  requireMe();
  const c = await content();
  if (!c.units.some((u) => [...u.sb, ...u.wb].some((x) => x.id === itemId))) throw fail(404, 'Unknown activity.');
  if (b.done) await updateDoc(myRef(), new FieldPath('progress', itemId), true, ...studied());
  else await updateDoc(myRef(), new FieldPath('progress', itemId), deleteField(), 'lastActive', serverTimestamp());
  return { ok: true };
}

async function quiz(b) {
  requireMe();
  const c = await content();
  const scope = String(b.scope || '');
  if (!(scope === 'overall' || c.units.some((u) => `u${u.id}` === scope))) throw fail(400, 'Unknown quiz.');
  const list = Array.isArray(b.answers) ? b.answers.slice(0, 40) : [];
  if (!list.length) throw fail(400, 'No answers were sent.');
  const Q = new Map(c.units.flatMap((u) => u.practice.map((q) => [q.id, { ...q, unit: u.id }])));
  const seen = new Set();
  const details = list.map((a) => {
    const q = Q.get(a.qid);
    if (!q || seen.has(a.qid)) throw fail(400, 'Unknown question.');
    if (scope !== 'overall' && `u${q.unit}` !== scope) throw fail(400, 'Question is not in this unit.');
    seen.add(a.qid);
    return { qid: a.qid, correct: a.choice === q.options[q.answer] };
  });
  const score = details.filter((d) => d.correct).length;
  const attempt = { scope, score, total: details.length, at: new Date().toISOString() };
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(myRef());
    const quizList = [...((snap.data() || {}).quiz || []), attempt].slice(-QUIZ_KEEP);
    tx.update(myRef(), 'quiz', quizList, ...studied());
  });
  return { score, total: details.length, details };
}

async function setCard(cardId, b) {
  requireMe();
  const c = await content();
  if (!c.units.some((u) => u.cards.some((x) => x.id === cardId)) || !['known', 'learning'].includes(b.status)) throw fail(400, 'Unknown card.');
  await updateDoc(myRef(), new FieldPath('cards', cardId), b.status, ...studied());
  return { ok: true };
}

async function game(b) {
  requireMe();
  const c = await content();
  const unit = Number(b.unit), score = Math.floor(Number(b.score)), level = Math.floor(Number(b.level));
  if (!c.units.some((u) => u.id === unit) || !(score >= 0 && score <= 100000) || !(level >= 1 && level <= 50)) throw fail(400, 'Invalid score.');
  let out;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(myRef());
    const before = ((snap.data() || {}).games || {})[unit];
    const g = {
      best: Math.max(score, before ? before.best : 0), bestLevel: Math.max(level, before ? before.bestLevel : 1),
      plays: (before ? before.plays : 0) + 1, at: new Date().toISOString(),
    };
    tx.update(myRef(), new FieldPath('games', String(unit)), g, ...studied());
    out = { best: g.best, bestLevel: g.bestLevel, plays: g.plays, newBest: score > 0 && (!before || score > before.best) };
  });
  return out;
}

async function summary(unitId, b) {
  requireMe();
  const c = await content();
  const unit = Number(unitId);
  if (!c.units.some((u) => u.id === unit)) throw fail(404, 'Unknown unit.');
  const clip = (v) => String(v || '').slice(0, 2000);
  const s = { main_idea: clip(b.mainIdea), learnt: clip(b.learnt), favourite: clip(b.favourite), wonder: clip(b.wonder), at: new Date().toISOString() };
  const any = [s.main_idea, s.learnt, s.favourite, s.wonder].some((v) => v.trim());
  await updateDoc(myRef(), new FieldPath('summaries', String(unit)), s, ...(any ? studied() : ['lastActive', serverTimestamp()]));
  return { ok: true, savedAt: s.at };
}

async function answers(unitId, section) {
  requireMe();
  const unit = Number(unitId);
  if (!(unit >= 1 && unit <= 20) || !['sb', 'wb'].includes(section)) throw fail(404, 'Not found.');
  const unlocked = (await getUnlocks()).some((u) => u.unit_id === unit && u.section === section);
  if (!unlocked && me.role !== 'teacher') throw fail(403, `${A.teacherName} has not unlocked these answers yet.`, { locked: true });
  let snap;
  try { snap = await getDoc(yearDoc('answers', `${unit}_${section}`)); } catch (e) {
    if (e.code === 'permission-denied') throw fail(403, `${A.teacherName} has not unlocked these answers yet.`, { locked: true });
    throw e;
  }
  if (!snap.exists()) throw fail(404, 'These answers have not been uploaded yet. The teacher needs to run the answer upload (see the README).');
  return { unit, section, unlocked, groups: JSON.parse(snap.data().json) };
}

// ---------- account ----------
async function changePassword(b) {
  requireMe();
  await reauth(b.current, 'current');
  if (String(b.next || '').length < 8) throw fail(400, 'Your new password needs at least 8 characters.', { field: 'next' });
  await updatePassword(auth.currentUser, String(b.next));
  return { ok: true };
}
async function deleteAccount(b) {
  requireMe();
  if (me.role !== 'student') throw fail(400, 'The teacher account cannot be deleted here.');
  await reauth(b.password, 'password');
  const uid = auth.currentUser.uid;
  // Remove this student's documents in every year's guide, then the login itself.
  for (const id of new Set([APP_ID, ...(CFG.allAppIds || [])])) {
    await deleteDoc(doc(db, 'years', id, 'students', uid)).catch((e) => { if (id === APP_ID) throw e; });
  }
  await deleteUser(auth.currentUser);
  me = null;
  return { ok: true };
}
async function resetEmail(b) {
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw fail(400, 'Please enter a valid email address.', { field: 'email' });
  try { await sendPasswordResetEmail(auth, email); } catch (e) {
    // Do not reveal whether an account exists for this email.
    if (e.code !== 'auth/user-not-found') throw e;
  }
  return { ok: true };
}

// ---------- teacher ----------
async function studentSummary(id, d, unlocks) {
  const c = await content();
  const st = toState(d, unlocks);
  const units = c.units.map((u) => ({ id: u.id, ...P().unitProgress(u, st) }));
  const overall = st.quiz.filter((q) => q.scope === 'overall');
  return {
    summary: {
      id, name: d.name, email: d.email, createdAt: iso(d.createdAt), lastActive: iso(d.lastActive),
      overallPct: Math.round(units.reduce((a, u) => a + u.pct, 0) / units.length),
      streak: st.streak, units,
      overallQuiz: { attempts: overall.length, best: P().bestPercent(overall) },
      summaries: st.summaries.filter((x) => P().summaryWritten(x)).length,
    },
    state: st,
  };
}
async function overview() {
  requireTeacher();
  const [snaps, unlocks] = await Promise.all([getDocs(collection(db, 'years', APP_ID, 'students')), getUnlocks()]);
  const students = await Promise.all(snaps.docs.map(async (s) => (await studentSummary(s.id, s.data(), unlocks)).summary));
  students.sort((a, b) => a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' }));
  return { unlocks, students };
}
async function studentDetail(id) {
  requireTeacher();
  const [snap, unlocks] = await Promise.all([getDoc(studentRef(id)), getUnlocks()]);
  if (!snap.exists()) throw fail(404, 'Student not found.');
  const r = await studentSummary(id, snap.data(), unlocks);
  return { student: r.summary, state: r.state };
}
async function setUnlock(b) {
  requireTeacher();
  const c = await content();
  const unit = Number(b.unit);
  if (!c.units.some((u) => u.id === unit) || !['sb', 'wb'].includes(b.section)) throw fail(400, 'Unknown unit or section.');
  const key = `${unit}_${b.section}`;
  if (b.unlocked) await setDoc(unlocksRef(), { open: { [key]: serverTimestamp() }, updatedAt: serverTimestamp(), updatedBy: me.id }, { merge: true });
  else await setDoc(unlocksRef(), { open: { [key]: deleteField() }, updatedAt: serverTimestamp(), updatedBy: me.id }, { merge: true });
  return { unlocks: await getUnlocks() };
}
async function studentResetEmail(id) {
  requireTeacher();
  const snap = await getDoc(studentRef(id));
  if (!snap.exists()) throw fail(404, 'Student not found.');
  await sendPasswordResetEmail(auth, snap.data().email);
  return { ok: true, email: snap.data().email };
}

// ---------- router: the same routes as the Node server ----------
const routes = [
  ['GET', /^\/api\/config$/, () => A],
  ['GET', /^\/api\/session$/, session],
  ['POST', /^\/api\/auth\/signup$/, (m, b) => signup(b)],
  ['POST', /^\/api\/auth\/signin$/, (m, b) => signin(b)],
  ['POST', /^\/api\/auth\/signout$/, async () => { await signOut(auth); me = null; return { ok: true }; }],
  ['POST', /^\/api\/auth\/reset$/, (m, b) => resetEmail(b)],
  ['POST', /^\/api\/auth\/password$/, (m, b) => changePassword(b)],
  ['POST', /^\/api\/account\/delete$/, (m, b) => deleteAccount(b)],
  ['GET', /^\/api\/me$/, () => { requireMe(); return { user: me }; }],
  ['GET', /^\/api\/content$/, () => { requireMe(); return content(); }],
  ['GET', /^\/api\/state$/, state],
  ['PUT', /^\/api\/progress\/([^/]+)$/, (m, b) => setProgress(decodeURIComponent(m[1]), b)],
  ['POST', /^\/api\/quiz$/, (m, b) => quiz(b)],
  ['PUT', /^\/api\/cards\/([^/]+)$/, (m, b) => setCard(decodeURIComponent(m[1]), b)],
  ['POST', /^\/api\/game$/, (m, b) => game(b)],
  ['PUT', /^\/api\/summary\/(\d+)$/, (m, b) => summary(m[1], b)],
  ['GET', /^\/api\/answers\/(\d+)\/(sb|wb)$/, (m) => answers(m[1], m[2])],
  ['GET', /^\/api\/teacher\/overview$/, overview],
  ['PUT', /^\/api\/teacher\/unlocks$/, (m, b) => setUnlock(b)],
  ['GET', /^\/api\/teacher\/students\/([^/]+)$/, (m) => studentDetail(decodeURIComponent(m[1]))],
  ['POST', /^\/api\/teacher\/students\/([^/]+)\/reset-email$/, (m) => studentResetEmail(decodeURIComponent(m[1]))],
];

window.KenjBackend = {
  kind: 'firebase',
  async request(method, path, body) {
    for (const [verb, re, fn] of routes) {
      const m = verb === method && path.match(re);
      if (m) {
        try { return await fn(m, body || {}); } catch (e) { throw friendly(e); }
      }
    }
    throw fail(404, 'Not found.');
  },
};
