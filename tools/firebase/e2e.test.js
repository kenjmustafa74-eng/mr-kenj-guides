#!/usr/bin/env node
/*
 * End-to-end test of the static build with Firebase (Auth + Firestore emulators), driven through a real browser.
 * Every call goes through the same backend module the app uses (window.KenjBackend), so this tests the real
 * sign-up, sign-in, progress, quiz, cards, game, summary, answer-key, teacher and account flows.
 *
 * Needs: emulators running, the emulator build served (tools/serve-static.js), and the emulator seeded
 *   (tools/firebase/seed.js with --class-code). Then:
 *   BASE=http://localhost:5050/mr-kenj-guides/year-five TEACHER_FILE=/tmp/kenj-emu-teacher.txt node tools/firebase/e2e.test.js
 */
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:5050/mr-kenj-guides/year-five';
const TFILE = process.env.TEACHER_FILE || '/tmp/kenj-emu-teacher.txt';
const tf = fs.readFileSync(TFILE, 'utf8');
const T_EMAIL = tf.match(/email: (.+)/i)[1].trim();
const T_PASS = tf.match(/password: (.+)/i)[1].trim();
const CODE = tf.match(/class code: (.+)/i)[1].trim();

let pass = 0, fail = 0;
const problems = [];
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };

async function client(browser, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${label}] page error: ${e.message}`));
  // Refused requests that this test makes on purpose (wrong password, wrong class code…) show up in the browser
  // console as "Failed to load resource … 400/403". Anything else is a real problem.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 40[03]/.test(m.text())) problems.push(`[${label}] console error: ${m.text()}`); });
  await page.goto(BASE + '/#/signin');
  await page.waitForFunction(() => window.KenjBackend && document.querySelector('#authForm, .unit-card'));
  const call = (method, path, body) => page.evaluate(async ([m, p, b]) => {
    try { return { status: 200, data: await window.KenjBackend.request(m, p, b) }; } catch (e) { return { status: e.status || 0, data: e.data || { error: e.message } }; }
  }, [method, path, body]);
  return { ctx, page, call };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const A = await client(browser, 'student');
  const s = A.call;
  const email = `e2e.${Date.now()}@example.com`;
  const pw = 'reading-rocks-5';

  console.log('Sign up and sign in');
  let r = await s('GET', '/api/config');
  check('config comes from the build (Firebase mode, class code required)', r.data.id === 'year5' && r.data.features.resetByEmail && r.data.classCodeRequired);
  r = await s('POST', '/api/auth/signup', { name: 'Test Student', email, password: 'short', classCode: CODE });
  check('short password refused', r.status === 400 && r.data.field === 'password');
  r = await s('POST', '/api/auth/signup', { name: 'Test Student', email, password: pw, classCode: '' });
  check('missing class code refused', r.status === 400 && r.data.field === 'classCode');
  r = await s('POST', '/api/auth/signup', { name: 'Test Student', email, password: pw, classCode: 'WRONG-1' });
  check('wrong class code refused', r.status === 400 && r.data.field === 'classCode', JSON.stringify(r.data));
  r = await s('POST', '/api/auth/signin', { email, password: pw });
  check('…and no half-made account is left behind', r.status === 401, JSON.stringify(r.data));
  r = await s('POST', '/api/auth/signup', { name: 'Test Student', email, password: pw, classCode: CODE.toLowerCase() });
  check('sign up with the class code (any letter case)', r.status === 200 && r.data.user.role === 'student', JSON.stringify(r.data));
  await s('POST', '/api/auth/signout');
  r = await s('GET', '/api/session');
  check('signed out', r.data.user === null);
  r = await s('POST', '/api/auth/signup', { name: 'Test Student', email, password: 'another-password', classCode: CODE });
  check('sign up again with the same email refused', r.status === 409);
  r = await s('POST', '/api/auth/signin', { email, password: 'wrong-password' });
  check('wrong password refused', r.status === 401);
  r = await s('POST', '/api/auth/signin', { email: email.toUpperCase(), password: pw });
  check('sign in (email not case-sensitive)', r.status === 200 && r.data.user.name === 'Test Student');
  await A.page.reload();
  await A.page.waitForSelector('.unit-card');
  check('stays signed in after reloading the page', true);
  r = await s('POST', '/api/auth/reset', { email });
  check('password reset email can be requested', r.status === 200);
  r = await s('POST', '/api/auth/reset', { email: 'nobody.here@example.com' });
  check('reset does not reveal unknown emails', r.status === 200);

  console.log('Studying');
  const content = (await s('GET', '/api/content')).data;
  check('content has 9 units', content.units.length === 9);
  check('content has no answer keys', !JSON.stringify(content).includes('Answers will vary'));
  const u1 = content.units[0];
  r = await s('PUT', `/api/progress/${u1.sb[0].id}`, { done: true });
  check('tick Student Book section', r.status === 200);
  r = await s('PUT', `/api/progress/${u1.wb[0].id}`, { done: true });
  check('tick Workbook activity', r.status === 200);
  r = await s('PUT', `/api/progress/${u1.wb[1].id}`, { done: true });
  r = await s('PUT', `/api/progress/${u1.wb[1].id}`, { done: false });
  check('untick an activity', r.status === 200);
  r = await s('PUT', '/api/progress/not-a-real-id', { done: true });
  check('unknown activity refused', r.status === 404);
  const answers = u1.practice.map((q, i) => ({ qid: q.id, choice: i < 6 ? q.options[q.answer] : q.options[(q.answer + 1) % 4] }));
  r = await s('POST', '/api/quiz', { scope: 'u1', answers });
  check('unit quiz marked (6/8)', r.data && r.data.score === 6 && r.data.total === 8, JSON.stringify(r.data));
  const mix = content.units.flatMap((u) => u.practice.slice(0, 2)).map((q) => ({ qid: q.id, choice: q.options[q.answer] }));
  r = await s('POST', '/api/quiz', { scope: 'overall', answers: mix });
  check('Big Quiz marked (18/18)', r.data && r.data.score === 18);
  r = await s('POST', '/api/quiz', { scope: 'u2', answers: [{ qid: u1.practice[0].id, choice: 'x' }] });
  check('question from another unit refused', r.status === 400);
  r = await s('PUT', `/api/cards/${u1.cards[0].id}`, { status: 'known' });
  check('memory card marked known', r.status === 200);
  r = await s('PUT', `/api/cards/${u1.cards[1].id}`, { status: 'learning' });
  check('memory card marked still learning', r.status === 200);
  r = await s('POST', '/api/game', { unit: 1, score: 0, level: 1 });
  check('a score of 0 is not a new best', r.data && r.data.newBest === false && r.data.plays === 1);
  r = await s('POST', '/api/game', { unit: 1, score: 120, level: 3 });
  check('game score saved', r.data && r.data.best === 120 && r.data.newBest);
  r = await s('POST', '/api/game', { unit: 1, score: 40, level: 1 });
  check('best score kept', r.data && r.data.best === 120 && !r.data.newBest && r.data.plays === 3 && r.data.bestLevel === 3);
  r = await s('PUT', '/api/summary/1', { mainIdea: 'Traditional tales teach lessons.', learnt: 'A fable ends with a moral.', favourite: 'Anansi', wonder: '' });
  check('summary saved', r.status === 200);
  r = await s('GET', '/api/answers/1/sb');
  check('answers locked for student', r.status === 403 && r.data.locked);
  r = await s('GET', '/api/teacher/overview');
  check('student cannot open teacher dashboard', r.status === 403);
  const st = (await s('GET', '/api/state')).data;
  check('state: progress, quiz, cards, game, summary, streak', st.progress.length === 2 && st.quiz.length === 2 && st.cards[u1.cards[0].id] === 'known'
    && st.games[0].best_score === 120 && st.summaries.length === 1 && st.streak.current === 1 && st.streak.studiedToday, JSON.stringify(st.streak));
  check('progress maths: unit 1 shows progress', unitPct(content, st) > 0);

  console.log('Teacher');
  const T = await client(browser, 'teacher');
  const t = T.call;
  r = await t('POST', '/api/auth/signin', { email: T_EMAIL, password: T_PASS });
  check('teacher sign in', r.status === 200 && r.data.user.role === 'teacher', JSON.stringify(r.data));
  r = await t('GET', '/api/state');
  check('teacher has own progress record', r.status === 200);
  r = await t('GET', '/api/answers/1/wb');
  check('teacher can preview locked answers', r.status === 200 && r.data.groups.length > 5);
  r = await t('PUT', '/api/teacher/unlocks', { unit: 1, section: 'sb', unlocked: true });
  check('teacher unlocks Unit 1 Student Book answers', r.status === 200 && r.data.unlocks.some((x) => x.unit_id === 1 && x.section === 'sb'));
  r = await s('GET', '/api/answers/1/sb');
  check('student now sees Unit 1 Student Book answers', r.status === 200 && r.data.groups[0].parts.length > 0);
  r = await s('GET', '/api/answers/1/wb');
  check('Unit 1 Workbook answers still locked', r.status === 403);
  r = await s('GET', '/api/answers/2/sb');
  check('Unit 2 answers still locked', r.status === 403);
  r = await t('GET', '/api/teacher/overview');
  const me = r.data && r.data.students.find((x) => x.email === email);
  check('teacher sees the student with progress', !!me && me.overallPct > 0 && me.summaries === 1, JSON.stringify(me && me.units[0]));
  check('teacher is not listed as a student', r.data && !r.data.students.some((x) => x.email === T_EMAIL));
  r = await t('GET', `/api/teacher/students/${encodeURIComponent(me.id)}`);
  check('teacher sees the student summary text', r.status === 200 && r.data.state.summaries[0].main_idea.startsWith('Traditional tales'));
  r = await t('POST', `/api/teacher/students/${encodeURIComponent(me.id)}/reset-email`);
  check('teacher can send the student a password reset email', r.status === 200 && r.data.email === email);
  r = await t('PUT', '/api/teacher/unlocks', { unit: 1, section: 'sb', unlocked: false });
  r = await s('GET', '/api/answers/1/sb');
  check('teacher locks again', r.status === 403);
  r = await t('POST', '/api/account/delete', { password: T_PASS });
  check('teacher account cannot be deleted in the app', r.status === 400);

  console.log('Second student cannot see the first');
  const B = await client(browser, 'student2');
  const b = B.call;
  const email2 = `e2e2.${Date.now()}@example.com`;
  r = await b('POST', '/api/auth/signup', { name: 'Second Student', email: email2, password: pw, classCode: CODE });
  check('second student signs up', r.status === 200);
  const b2 = r.data.user;
  r = await b('GET', `/api/teacher/students/${encodeURIComponent(me.id)}`);
  check('second student cannot read the first student', r.status === 403);
  // Ask Firestore directly (REST, outside the app) with student 2's own sign-in token.
  const idToken = (await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email2, password: pw, returnSecureToken: true }),
  })).json()).idToken;
  const rest = async (p, token) => (await fetch(`http://127.0.0.1:8080/v1/projects/demo-kenj-guides/databases/(default)/documents/${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).status;
  check('direct read of another student\'s document refused', (await rest(`years/year5/students/${me.id}`, idToken)) === 403);
  check('direct listing of all students refused', (await rest('years/year5/students', idToken)) === 403);
  check('direct read of own document allowed', (await rest(`years/year5/students/${b2.id}`, idToken)) === 200);
  check('direct read of a locked answer key refused', (await rest('years/year5/answers/1_wb', idToken)) === 403);
  check('direct read of the class code refused', (await rest('years/year5/meta/classCode', idToken)) === 403);
  check('signed-out direct read of answers refused', (await rest('years/year5/answers/1_sb')) === 403);

  console.log('Account');
  r = await s('POST', '/api/auth/password', { current: 'wrong-password', next: 'new-password-9' });
  check('change password: wrong current password refused', r.status === 400 && r.data.field === 'current');
  r = await s('POST', '/api/auth/password', { current: pw, next: 'short' });
  check('change password: short new password refused', r.status === 400 && r.data.field === 'next');
  r = await s('POST', '/api/auth/password', { current: pw, next: 'new-password-9' });
  check('change password', r.status === 200);
  await s('POST', '/api/auth/signout');
  r = await s('POST', '/api/auth/signin', { email, password: 'new-password-9' });
  check('sign in with the new password', r.status === 200);
  r = await s('POST', '/api/account/delete', { password: 'wrong-password' });
  check('wrong password does not delete', r.status === 400);
  r = await s('POST', '/api/account/delete', { password: 'new-password-9' });
  check('student can delete their account', r.status === 200);
  r = await s('POST', '/api/auth/signin', { email, password: 'new-password-9' });
  check('deleted account can no longer sign in', r.status === 401);
  r = await t('GET', '/api/teacher/overview');
  check('deleted student is gone from the dashboard', r.data && !r.data.students.some((x) => x.email === email));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (problems.length) console.log(`Browser problems:\n${problems.join('\n')}`);
  process.exit(fail || problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function unitPct(content, st) {
  const P = require('../../public/js/progress-core.js');
  return P.unitProgress(content.units[0], st).pct;
}
