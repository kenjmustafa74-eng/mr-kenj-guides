// UI walkthrough + screenshots at mobile and desktop sizes. Also reports console errors, failed requests and sideways overflow.
// Usage (Node server):   BASE=http://localhost:3100 TEACHER_FILE=/path/to/TEACHER_PASSWORD.txt node tools/screenshots.js
// Usage (static build with Firebase emulators):
//   BASE=http://localhost:5050/mr-kenj-guides/year-five TEACHER_FILE=/tmp/kenj-emu-teacher.txt OUT_DIR=screenshots/firebase node tools/screenshots.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, '..', 'screenshots'));
const TFILE = process.env.TEACHER_FILE || path.join(__dirname, '..', 'TEACHER_PASSWORD.year5.txt');
const TEACHER = fs.readFileSync(TFILE, 'utf8');
const CLASS_CODE = (TEACHER.match(/class code: (.+)/i) || [])[1] || process.env.CLASS_CODE || '';
fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const shots = [];

async function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${label}] console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${label}] page error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`[${label}] request failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`); });
}
async function shot(page, name, full = false) {
  await page.waitForTimeout(350);
  await page.waitForFunction(() => !document.querySelector('.toast') || document.querySelector('.toast').hidden, null, { timeout: 4000 }).catch(() => {});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) problems.push(`[${name}] page is ${overflow}px wider than the screen`);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  shots.push(file);
}

async function studentRun(browser, kind, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await watch(page, `${kind}-student`);
  const n = (s) => `${kind}-${s}`;
  await page.goto(BASE + '/#/signin');
  await page.waitForSelector('#authForm');
  await shot(page, n('01-sign-in'));
  await page.click('text=Forgotten your password?');
  await page.waitForSelector('.auth .card h2');
  await shot(page, n('01b-forgot-password'));
  await page.goto(BASE + '/#/signin');
  await page.waitForSelector('#authForm');
  await page.click('text=Create an account');
  await page.waitForSelector('input[name=name]');
  await page.fill('input[name=name]', kind === 'mobile' ? 'Layla Haddad' : 'Omar Siddiqui');
  await page.fill('input[name=email]', `${kind}.${Date.now()}@example.com`);
  await page.fill('input[name=password]', 'reading-rocks-5');
  if (await page.$('input[name=classCode]')) await page.fill('input[name=classCode]', CLASS_CODE.trim());
  await shot(page, n('02-sign-up'));
  await page.click('button[type=submit]');
  await page.waitForSelector('.unit-card');
  // unit 1: tick activities first so the home page shows progress
  await page.goto(BASE + '/#/unit/1/sb');
  await page.waitForSelector('.activity');
  for (let i = 0; i < 4; i++) { await page.locator('.tick').nth(i).click(); await page.waitForTimeout(250); }
  await shot(page, n('05-unit-student-book'));
  await page.goto(BASE + '/#/unit/1/wb');
  await page.waitForSelector('.activity');
  for (let i = 0; i < 3; i++) { await page.locator('.tick').nth(i).click(); await page.waitForTimeout(250); }
  await shot(page, n('06-unit-workbook'));
  await page.goto(BASE + '/#/unit/1');
  await page.waitForSelector('.vocab');
  await shot(page, n('04-unit-overview'));
  // practice quiz
  await page.goto(BASE + '/#/unit/1/practice');
  await page.click('#qStart');
  await page.waitForSelector('.option');
  await page.locator('.option').first().click();
  await page.waitForSelector('#qNext');
  await shot(page, n('07-practice-quiz'));
  for (let i = 1; i < 8; i++) { await page.click('#qNext'); await page.waitForSelector('.option:not([disabled])'); await page.locator('.option').nth(i % 4).click(); await page.waitForSelector('#qNext'); }
  await page.click('#qNext');
  await page.waitForSelector('.result');
  await shot(page, n('08-practice-result'));
  // memory cards
  await page.goto(BASE + '/#/unit/1/cards');
  await page.waitForSelector('.flip');
  await page.click('#cKnow'); await page.waitForTimeout(250);
  await page.click('#cLearn'); await page.waitForTimeout(250);
  await page.click('.flip'); await page.waitForTimeout(700);
  await shot(page, n('09-memory-cards'));
  // basket game
  await page.goto(BASE + '/#/unit/1/game');
  await page.waitForSelector('#gStart');
  await shot(page, n('10-basket-game-start'));
  await page.click('#gStart');
  await page.waitForTimeout(2600);
  const box = await page.locator('#gCanvas').boundingBox();
  if (kind === 'mobile') {
    await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height - 40);
  } else {
    await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(250); await page.keyboard.up('ArrowLeft');
  }
  await page.waitForTimeout(1800);
  await shot(page, n('11-basket-game-playing'));
  await page.evaluate(() => window.BasketGame._current._finish());
  await page.waitForSelector('text=Game over');
  await page.waitForTimeout(500);
  await shot(page, n('12-basket-game-over'));
  // my summary
  await page.goto(BASE + '/#/unit/1/summary');
  await page.waitForSelector('#smForm');
  await page.fill('textarea[name=mainIdea]', 'Traditional tales like fables and folktales teach us lessons about how to behave.');
  await page.fill('textarea[name=learnt]', 'A fable has an opening, a climax and a resolution, and it ends with a moral. I also learnt the IDEAS strategy.');
  await page.fill('textarea[name=favourite]', 'Anansi and the pot of wisdom, because his son was cleverer than him!');
  await page.fill('textarea[name=wonder]', 'Who were the first people to tell the Anansi stories?');
  await page.click('#smForm button[type=submit]');
  await page.waitForSelector('text=Saved');
  await shot(page, n('13-my-summary'));
  // answers (locked)
  await page.goto(BASE + '/#/unit/1/answers');
  await page.waitForSelector('.lockbox');
  await shot(page, n('14-answers-locked'));
  // big quiz
  await page.goto(BASE + '/#/quiz');
  await page.click('#qStart');
  await page.waitForSelector('.option');
  await page.locator('.option').nth(1).click();
  await page.waitForSelector('#qNext');
  await shot(page, n('15-big-quiz'));
  for (let i = 1; i < 20; i++) { await page.click('#qNext'); await page.waitForSelector('.option:not([disabled])'); await page.locator('.option').nth((i * 3) % 4).click(); await page.waitForSelector('#qNext'); }
  await page.click('#qNext');
  await page.waitForSelector('.result');
  await shot(page, n('16-big-quiz-result'));
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.unit-card');
  await shot(page, n('03-home'));
  await shot(page, n('03-home-full'), true);
  await page.goto(BASE + '/#/progress');
  await page.waitForSelector('table');
  await shot(page, n('17-my-progress'));
  // every other unit's tabs render without errors
  for (let u = 2; u <= 9; u++) for (const tab of ['overview', 'sb', 'wb', 'practice', 'cards', 'game', 'summary', 'answers']) {
    await page.goto(`${BASE}/#/unit/${u}/${tab}`);
    await page.waitForSelector('#tab > *');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) problems.push(`[${kind} unit ${u} ${tab}] ${overflow}px sideways overflow`);
  }
  await page.goto(BASE + '/#/account');
  await page.waitForSelector('#pwForm');
  await shot(page, n('18-account'));
  return { ctx, page };
}

async function teacherRun(browser, kind, opts, student) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await watch(page, `${kind}-teacher`);
  const n = (s) => `${kind}-${s}`;
  await page.goto(BASE + '/#/signin');
  await page.waitForSelector('#authForm');
  await page.fill('input[name=email]', TEACHER.match(/email: (.+)/i)[1].trim());
  await page.fill('input[name=password]', TEACHER.match(/password: (.+)/i)[1].trim());
  await page.click('button[type=submit]');
  await page.waitForSelector('.unit-card');
  await page.goto(BASE + '/#/teacher');
  await page.waitForSelector('.toggle');
  const t = page.locator('.toggle[data-unit="1"][data-sec="sb"]');
  if ((await t.getAttribute('aria-pressed')) !== 'true') await t.click();
  await page.waitForSelector('.toggle[data-unit="1"][data-sec="sb"][aria-pressed="true"]');
  await page.waitForTimeout(400);
  await shot(page, n('20-teacher-dashboard'));
  await shot(page, n('20-teacher-dashboard-full'), true);
  await page.locator('tr.link').first().click();
  await page.waitForSelector('h1');
  await shot(page, n('21-teacher-student-detail'), true);
  await page.goto(BASE + '/#/unit/7/answers');
  await page.waitForSelector('#ans-wb .ans-group');
  await shot(page, n('22-teacher-answers-preview'));
  await page.locator('#ans-wb h3', { hasText: 'Activity 7E' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -90));
  await shot(page, n('23-answers-formatting-7E'));
  await page.goto(BASE + '/#/unit/2/answers');
  await page.waitForSelector('#ans-wb .ans-group');
  await page.locator('#ans-wb h3', { hasText: 'Activity 2I' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -90));
  await shot(page, n('24-answers-table-2I'));
  // the student now sees unlocked answers
  await student.goto(BASE + '/#/');
  await student.goto(BASE + '/#/unit/1/answers');
  await student.waitForSelector('#ans-sb .ans-group');
  await shot(student, n('19-answers-unlocked'));
  await ctx.close();
}

// A few demo students so the teacher dashboard shows realistic data.
async function seedDemo(browser) {
  const people = [['Aisha Rahman', 0.8], ['Yusuf Karim', 0.45], ['Mariam Al-Thani', 0.2]];
  for (const [name, level] of people) {
    let cookie = '';
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + '/#/signin');
    await page.waitForSelector('#authForm');
    const firebase = await page.evaluate(() => !!window.KenjBackend);
    const call = async (method, p, body) => {
      if (firebase) return page.evaluate(([m, x, b]) => window.KenjBackend.request(m, x, b).catch((e) => e.data), [method, p, body]);
      const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return r.json().catch(() => null);
    };
    await call('POST', '/api/auth/signup', { name, email: `${name.split(' ')[0].toLowerCase()}.${Date.now()}@example.com`, password: 'demo-password-1', classCode: CLASS_CODE.trim() });
    const c = await call('GET', '/api/content');
    for (const u of c.units.slice(0, Math.ceil(9 * level))) {
      for (const it of [...u.sb, ...u.wb].slice(0, Math.round(29 * level))) await call('PUT', `/api/progress/${it.id}`, { done: true });
      await call('POST', '/api/quiz', { scope: `u${u.id}`, answers: u.practice.map((q, i) => ({ qid: q.id, choice: i / 8 < level ? q.options[q.answer] : 'x' })) });
      for (const card of u.cards.slice(0, Math.round(6 * level))) await call('PUT', `/api/cards/${card.id}`, { status: 'known' });
      await call('POST', '/api/game', { unit: u.id, score: Math.round(300 * level), level: 1 + Math.round(3 * level) });
      if (level > 0.4) await call('PUT', `/api/summary/${u.id}`, { mainIdea: `This unit was about ${u.title.toLowerCase()} and the texts we read.`, learnt: `I learnt new words such as ${u.vocab[0].word} and ${u.vocab[1].word}.`, favourite: '', wonder: '' });
    }
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  if (process.env.SEED_DEMO) await seedDemo(browser);
  const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
  const desktop = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 };
  for (const [kind, opts] of [['mobile', mobile], ['desktop', desktop]]) {
    console.log(`Running ${kind}…`);
    const s = await studentRun(browser, kind, opts);
    await teacherRun(browser, kind, opts, s.page);
    await s.ctx.close();
  }
  await browser.close();
  console.log(`${shots.length} screenshots in ${OUT}`);
  console.log(problems.length ? `Problems:\n${problems.join('\n')}` : 'No console errors, failed requests or overflow found.');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
