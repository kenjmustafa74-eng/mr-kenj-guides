#!/usr/bin/env node
/*
 * Cross-year test on the emulators: the two guides share one website (and so one login), but each year keeps its own
 * class code, its own student records and its own answer keys.
 *   BASE5=… BASE6=… TEACHER_FILE5=… TEACHER_FILE6=… node tools/firebase/cross-year.test.js
 */
const fs = require('fs');
const { chromium } = require('playwright-core');

const B5 = process.env.BASE5, B6 = process.env.BASE6;
const read = (f) => { const t = fs.readFileSync(f, 'utf8'); return { email: t.match(/email: (.+)/i)[1].trim(), pass: t.match(/password: (.+)/i)[1].trim(), code: t.match(/class code: (.+)/i)[1].trim() }; };
const T5 = read(process.env.TEACHER_FILE5), T6 = read(process.env.TEACHER_FILE6);
let pass = 0, fail = 0;
const problems = [];
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 40[03]/.test(m.text())) problems.push(`console error: ${m.text()}`); });
  const open = async (base, hash = '#/signin') => { await page.goto(base + '/' + hash); await page.waitForFunction(() => window.KenjBackend && document.querySelector('#authForm, .unit-card')); };
  const call = (m, p, b) => page.evaluate(async ([m, p, b]) => {
    try { return { status: 200, data: await window.KenjBackend.request(m, p, b) }; } catch (e) { return { status: e.status || 0, data: e.data || { error: e.message } }; }
  }, [m, p, b]);

  const email = `cross.${Date.now()}@example.com`, pw = 'both-years-ok';
  console.log('Year 5 student');
  await open(B5);
  check('Year 5 class code differs from Year 6', T5.code !== T6.code);
  let r = await call('POST', '/api/auth/signup', { name: 'Cross Student', email, password: pw, classCode: T5.code });
  check('signs up to Year 5', r.status === 200);
  await page.reload(); await page.waitForSelector('.unit-card');
  check('Year 5 home links to Year 6', await page.locator('.other-guides a[href*="year-six"]').count() === 1);

  console.log('Same login on Year 6');
  await open(B6);
  check('not treated as a Year 6 student yet', await page.locator('#authForm').count() === 1);
  check('Year 6 sign-in page links to Year 5', await page.locator('a[href*="year-five"]').count() >= 1);
  r = await call('POST', '/api/auth/signin', { email, password: pw });
  check('Year 6 sign-in explains how to join', r.status === 403 && /not joined Year 6/.test(r.data.error || ''), JSON.stringify(r.data));
  r = await call('POST', '/api/auth/signup', { name: 'Cross Student', email, password: pw, classCode: T5.code });
  check('Year 5 class code refused on Year 6', r.status === 400 && r.data.field === 'classCode', JSON.stringify(r.data));
  r = await call('POST', '/api/auth/signup', { name: 'Cross Student', email, password: pw, classCode: T6.code });
  check('joins Year 6 with the Year 6 code and the same login', r.status === 200 && r.data.user.role === 'student', JSON.stringify(r.data));
  const c6 = (await call('GET', '/api/content')).data;
  check('Year 6 content is the Year 6 book', c6.units[0].title === 'Time and Space' && c6.units.every((u) => u.grammar.length >= 2));
  await call('PUT', `/api/progress/${c6.units[0].sb[0].id}`, { done: true });
  r = await call('GET', '/api/answers/1/sb');
  check('Year 6 answers locked', r.status === 403);

  console.log('Back on Year 5');
  await open(B5);
  await page.waitForSelector('.unit-card');
  check('still signed in on Year 5 (shared login not signed out)', true);
  const c5 = (await call('GET', '/api/content')).data;
  check('Year 5 content is the Year 5 book', c5.units[0].title !== 'Time and Space' && c5.units.every((u) => u.grammar.length >= 2));
  const st5 = (await call('GET', '/api/state')).data;
  check('Year 6 progress does not appear in Year 5', st5.progress.length === 0);

  console.log('Teachers');
  const tctx = await browser.newContext(); const tp = await tctx.newPage();
  const tcall = (m, p, b) => tp.evaluate(async ([m, p, b]) => { try { return { status: 200, data: await window.KenjBackend.request(m, p, b) }; } catch (e) { return { status: e.status || 0, data: e.data || { error: e.message } }; } }, [m, p, b]);
  await tp.goto(B6 + '/#/signin'); await tp.waitForFunction(() => window.KenjBackend);
  r = await tcall('POST', '/api/auth/signin', { email: T6.email, password: T6.pass });
  check('teacher signs in to Year 6', r.status === 200 && r.data.user.role === 'teacher', JSON.stringify(r.data));
  r = await tcall('GET', '/api/teacher/overview');
  check('Year 6 dashboard lists the student', r.data.students.some((x) => x.email === email));
  r = await tcall('PUT', '/api/teacher/unlocks', { unit: 1, section: 'sb', unlocked: true });
  r = await call('GET', '/api/answers/1/sb');
  check('Year 6 unlock does not unlock Year 5', r.status === 403);
  await tcall('PUT', '/api/teacher/unlocks', { unit: 1, section: 'sb', unlocked: false });
  await tp.goto(B5 + '/#/signin'); await tp.waitForFunction(() => window.KenjBackend && document.querySelector('#authForm, .unit-card'));
  r = await tcall('POST', '/api/auth/signin', { email: T5.email, password: T5.pass });
  check('same teacher account works on Year 5', r.status === 200 && r.data.user.role === 'teacher');

  console.log('Delete');
  r = await call('POST', '/api/account/delete', { password: pw });
  check('account deleted', r.status === 200);
  r = await tcall('GET', '/api/teacher/overview');
  check('gone from the Year 5 dashboard', !r.data.students.some((x) => x.email === email));
  await tp.goto(B6 + '/#/signin'); await tp.waitForFunction(() => window.KenjBackend && document.querySelector('#authForm, .unit-card'));
  await tp.waitForSelector('.unit-card');
  r = await tcall('GET', '/api/teacher/overview');
  check('gone from the Year 6 dashboard too', r.status === 200 && !r.data.students.some((x) => x.email === email), JSON.stringify(r.data).slice(0, 200));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (problems.length) console.log(`Browser problems:\n${problems.join('\n')}`);
  process.exit(fail || problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
