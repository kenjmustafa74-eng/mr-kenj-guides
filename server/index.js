const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');

const config = require('./config');
const { createRepo } = require('./db');
const auth = require('./auth');
const P = require('../public/js/progress-core.js');

const repo = createRepo();
const content = JSON.parse(fs.readFileSync(config.contentPath, 'utf8'));
const answers = JSON.parse(fs.readFileSync(config.answersPath, 'utf8'));
const UNIT_IDS = content.units.map((u) => u.id);
const ITEM_IDS = new Set(content.units.flatMap((u) => [...u.sb, ...u.wb].map((x) => x.id)));
const CARD_IDS = new Set(content.units.flatMap((u) => u.cards.map((c) => c.id)));
const QUESTIONS = new Map(content.units.flatMap((u) => u.practice.map((q) => [q.id, { ...q, unit: u.id }])));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'manifest-src': ["'self'"],
      'worker-src': ["'self'"],
      'upgrade-insecure-requests': config.production ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// Rate limits are keyed per account rather than only per IP address, because a whole class
// often shares one school IP address.
const ipKey = (req) => rateLimit.ipKeyGenerator(req.ip || '');
const sessionKey = (req) => {
  const t = req.cookies && req.cookies.kenj_session;
  return t ? `s:${crypto.createHash('sha256').update(t).digest('hex').slice(0, 32)}` : `ip:${ipKey(req)}`;
};
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `${ipKey(req)}|${String((req.body && req.body.email) || '').trim().toLowerCase()}`,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });
const authIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: ipKey,
  message: { error: 'Too many attempts from this network. Please wait a few minutes and try again.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: sessionKey,
  message: { error: 'You are going a bit fast! Please wait a moment and try again.' } });
app.use('/api/', apiLimiter);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireAuth = auth.requireAuth(repo);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.app.timezone || 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
async function studied(userId) {
  await repo.touchActivityDay(userId, today());
  await repo.touchUser(userId);
}
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// ---------- public ----------
app.get('/api/health', (req, res) => res.json({ ok: true, app: config.app.id, backend: repo.kind }));
app.get('/api/config', (req, res) => {
  const a = config.app;
  res.json({
    id: a.id, appName: a.appName, shortName: a.shortName, yearLabel: a.yearLabel, stage: a.stage, teacherName: a.teacherName,
    school: a.school, course: a.course, books: a.books, publisher: a.publisher, bookUrl: a.bookUrl, bookSiteName: a.bookSiteName,
    themeColour: a.themeColour, overallQuizLength: a.overallQuizLength, classCodeRequired: !!config.classCode,
  });
});
app.get('/manifest.webmanifest', (req, res) => {
  const a = config.app;
  res.type('application/manifest+json').send(JSON.stringify({
    name: a.appName, short_name: a.shortName, id: '/', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait',
    background_color: a.backgroundColour, theme_color: a.themeColour, lang: 'en-GB',
    description: `${a.course} ${a.stage} study guide for ${a.yearLabel} students at ${a.school}.`,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 1));
});

// ---------- auth ----------
app.post('/api/auth/signup', authIpLimiter, authLimiter, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (config.classCode && String(req.body.classCode || '').trim().toUpperCase() !== config.classCode.toUpperCase()) {
    return res.status(400).json({ error: 'That class code is not right. Ask your teacher for the code.', field: 'classCode' });
  }
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Please enter your name (2 to 60 characters).', field: 'name' });
  if (!EMAIL_RE.test(email) || email.length > 120) return res.status(400).json({ error: 'Please enter a valid email address.', field: 'email' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Your password needs at least 8 characters.', field: 'password' });
  if (await repo.getUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists. Try signing in.', field: 'email' });
  const user = await repo.createUser({ email, name, passwordHash: await bcrypt.hash(password, 12), role: 'student' });
  auth.issue(res, user);
  await repo.touchUser(user.id);
  res.status(201).json({ user: publicUser(user) });
}));

app.post('/api/auth/signin', authIpLimiter, authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = email && (await repo.getUserByEmail(email));
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) return res.status(401).json({ error: 'The email or password is not right. Please try again.' });
  auth.issue(res, user);
  await repo.touchUser(user.id);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/signout', (req, res) => { auth.clear(res); res.json({ ok: true }); });

app.post('/api/auth/password', authLimiter, requireAuth, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await bcrypt.compare(String(current || ''), req.user.password_hash))) return res.status(400).json({ error: 'Your current password is not right.', field: 'current' });
  if (String(next || '').length < 8) return res.status(400).json({ error: 'Your new password needs at least 8 characters.', field: 'next' });
  await repo.updatePassword(req.user.id, await bcrypt.hash(String(next), 12));
  res.json({ ok: true });
}));

app.post('/api/account/delete', authLimiter, requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'student') return res.status(400).json({ error: 'The teacher account cannot be deleted here.' });
  if (!(await bcrypt.compare(String(req.body.password || ''), req.user.password_hash))) return res.status(400).json({ error: 'That password is not right.', field: 'password' });
  await repo.deleteStudent(req.user.id);
  auth.clear(res);
  res.json({ ok: true });
}));

// ---------- signed-in ----------
app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
// Like /api/me but answers 200 with { user: null } when signed out (keeps the browser console clean at start-up).
app.get('/api/session', (req, res, next) => {
  requireAuth(req, { status: () => ({ json: () => res.json({ user: null }) }) }, () => res.json({ user: publicUser(req.user) })).catch(next);
});
app.get('/api/content', requireAuth, (req, res) => res.json(content));

async function stateFor(userId) {
  const [progress, quiz, cards, games, summaries, unlocks, days] = await Promise.all([
    repo.getProgress(userId), repo.getQuizAttempts(userId), repo.getCardStatuses(userId), repo.getGames(userId),
    repo.getSummaries(userId), repo.getUnlocks(), repo.getActivityDays(userId),
  ]);
  return { progress, quiz, cards, games, summaries, unlocks, streak: P.streak(days, today()), today: today() };
}
app.get('/api/state', requireAuth, wrap(async (req, res) => res.json(await stateFor(req.user.id))));

app.put('/api/progress/:itemId', requireAuth, wrap(async (req, res) => {
  const { itemId } = req.params;
  if (!ITEM_IDS.has(itemId)) return res.status(404).json({ error: 'Unknown activity.' });
  await repo.setProgress(req.user.id, itemId, !!req.body.done);
  if (req.body.done) await studied(req.user.id);
  res.json({ ok: true });
}));

app.post('/api/quiz', requireAuth, wrap(async (req, res) => {
  const scope = String(req.body.scope || '');
  if (!(scope === 'overall' || UNIT_IDS.map((n) => `u${n}`).includes(scope))) return res.status(400).json({ error: 'Unknown quiz.' });
  const list = Array.isArray(req.body.answers) ? req.body.answers.slice(0, 40) : [];
  if (!list.length) return res.status(400).json({ error: 'No answers were sent.' });
  const seen = new Set();
  const details = [];
  for (const a of list) {
    const q = QUESTIONS.get(a.qid);
    if (!q || seen.has(a.qid)) return res.status(400).json({ error: 'Unknown question.' });
    if (scope !== 'overall' && `u${q.unit}` !== scope) return res.status(400).json({ error: 'Question is not in this unit.' });
    seen.add(a.qid);
    details.push({ qid: a.qid, correct: a.choice === q.options[q.answer] });
  }
  const score = details.filter((d) => d.correct).length;
  await repo.addQuizAttempt(req.user.id, scope, score, details.length, details);
  await studied(req.user.id);
  res.json({ score, total: details.length, details });
}));

app.put('/api/cards/:cardId', requireAuth, wrap(async (req, res) => {
  const { cardId } = req.params;
  const status = req.body.status;
  if (!CARD_IDS.has(cardId) || !['known', 'learning'].includes(status)) return res.status(400).json({ error: 'Unknown card.' });
  await repo.setCardStatus(req.user.id, cardId, status);
  await studied(req.user.id);
  res.json({ ok: true });
}));

app.post('/api/game', requireAuth, wrap(async (req, res) => {
  const unit = Number(req.body.unit);
  const score = Math.floor(Number(req.body.score));
  const level = Math.floor(Number(req.body.level));
  if (!UNIT_IDS.includes(unit) || !(score >= 0 && score <= 100000) || !(level >= 1 && level <= 50)) return res.status(400).json({ error: 'Invalid score.' });
  const result = await repo.recordGame(req.user.id, unit, score, level);
  await studied(req.user.id);
  res.json({ best: result.best_score, bestLevel: result.best_level, plays: result.plays, newBest: result.newBest });
}));

app.put('/api/summary/:unit', requireAuth, wrap(async (req, res) => {
  const unit = Number(req.params.unit);
  if (!UNIT_IDS.includes(unit)) return res.status(404).json({ error: 'Unknown unit.' });
  const clip = (v) => String(v || '').slice(0, 2000);
  const f = { mainIdea: clip(req.body.mainIdea), learnt: clip(req.body.learnt), favourite: clip(req.body.favourite), wonder: clip(req.body.wonder) };
  await repo.saveSummary(req.user.id, unit, f);
  if (Object.values(f).some((v) => v.trim())) await studied(req.user.id);
  res.json({ ok: true, savedAt: new Date().toISOString() });
}));

// Answer keys are only ever sent from here, and only when unlocked (or to the teacher).
app.get('/api/answers/:unit/:section', requireAuth, wrap(async (req, res) => {
  const unit = Number(req.params.unit);
  const { section } = req.params;
  if (!UNIT_IDS.includes(unit) || !['sb', 'wb'].includes(section)) return res.status(404).json({ error: 'Not found.' });
  const unlocked = (await repo.getUnlocks()).some((u) => u.unit_id === unit && u.section === section);
  if (!unlocked && req.user.role !== 'teacher') return res.status(403).json({ locked: true, error: 'Mr Kenj has not unlocked these answers yet.' });
  const a = answers.units.find((u) => u.unit === unit);
  res.json({ unit, section, unlocked, groups: a[section] });
}));

// ---------- teacher ----------
const teacher = express.Router();
teacher.use(requireAuth, auth.requireTeacher);

async function studentSummary(s) {
  const st = await stateFor(s.id);
  const units = content.units.map((u) => ({ id: u.id, ...P.unitProgress(u, st) }));
  const overall = st.quiz.filter((q) => q.scope === 'overall');
  return {
    id: s.id, name: s.name, email: s.email, createdAt: s.created_at, lastActive: s.last_active,
    overallPct: Math.round(units.reduce((a, u) => a + u.pct, 0) / units.length),
    streak: st.streak, units,
    overallQuiz: { attempts: overall.length, best: P.bestPercent(overall) },
    summaries: st.summaries.filter((x) => P.summaryWritten(x)).length,
  };
}

teacher.get('/overview', wrap(async (req, res) => {
  const students = await repo.listStudents();
  res.json({ unlocks: await repo.getUnlocks(), students: await Promise.all(students.map(studentSummary)) });
}));

teacher.put('/unlocks', wrap(async (req, res) => {
  const unit = Number(req.body.unit);
  const { section } = req.body;
  if (!UNIT_IDS.includes(unit) || !['sb', 'wb'].includes(section)) return res.status(400).json({ error: 'Unknown unit or section.' });
  await repo.setUnlock(unit, section, !!req.body.unlocked, req.user.id);
  res.json({ unlocks: await repo.getUnlocks() });
}));

teacher.get('/students/:id', wrap(async (req, res) => {
  const s = await repo.getUserById(Number(req.params.id));
  if (!s || s.role !== 'student') return res.status(404).json({ error: 'Student not found.' });
  const st = await stateFor(s.id);
  res.json({ student: await studentSummary(s), state: st });
}));

teacher.post('/students/:id/reset-password', wrap(async (req, res) => {
  const s = await repo.getUserById(Number(req.params.id));
  if (!s || s.role !== 'student') return res.status(404).json({ error: 'Student not found.' });
  const words = ['maple', 'river', 'falcon', 'harbour', 'meadow', 'comet', 'lantern', 'pebble', 'orchard', 'summit', 'violet', 'dune'];
  const temp = `${words[crypto.randomInt(words.length)]}-${words[crypto.randomInt(words.length)]}-${crypto.randomInt(100, 1000)}`;
  await repo.updatePassword(s.id, await bcrypt.hash(temp, 12));
  res.json({ temporaryPassword: temp });
}));
app.use('/api/teacher', teacher);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------- static app ----------
const PUBLIC = path.join(config.ROOT, 'public');
app.use(express.static(PUBLIC, {
  index: false,
  setHeaders(res, file) {
    if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    else if (/\.(js|css|svg)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
  .replaceAll('{{APP_NAME}}', config.app.appName.replace(/'/g, '&#39;'))
  .replaceAll('{{THEME}}', config.app.themeColour);
app.get('*', (req, res) => res.type('html').set('Cache-Control', 'no-cache').send(indexHtml));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (require.main === module) {
  app.listen(config.port, config.host, () => console.log(`${config.app.appName} running at http://localhost:${config.port} (data: ${config.dataBackend})`));
}
module.exports = { app, repo };
