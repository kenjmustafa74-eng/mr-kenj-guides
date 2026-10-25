/* Mr Kenj's Guide – single-page app (no build step). */
(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(window.ICONS || {})[name] || ''}</svg>`;
  const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const pageWord = (p) => (/[–-]/.test(String(p)) ? 'pages' : 'page');
  const fmtDate = (iso) => {
    if (!iso) return '–';
    const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Qatar' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Qatar' });
  };
  const fmtDay = (iso) => {
    if (!iso) return '–';
    const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Qatar' });
  };

  // All data goes through api(). The Node server answers /api/... over HTTP; the static (GitHub Pages) build
  // loads js/backend-firebase.js, which answers the same routes using Firebase (see src/firebase-backend.js).
  async function api(path, opts = {}) {
    if (window.KenjBackend) return window.KenjBackend.request(opts.method || 'GET', path, opts.body);
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // ---------- state ----------
  const S = { config: null, user: null, content: null, state: null };
  const unitById = (id) => S.content.units.find((u) => u.id === Number(id));
  const P = () => window.ProgressCore;

  async function loadAll() {
    const [content, state] = await Promise.all([api('/api/content'), api('/api/state')]);
    S.content = content; S.state = state;
  }
  async function refreshState() { S.state = await api('/api/state'); }

  // ---------- shell ----------
  const app = $('#app');
  function shell({ title, sub, back, active, body }) {
    const teacher = S.user && S.user.role === 'teacher';
    const nav = [
      ['#/', 'house', 'Home', 'home'],
      ['#/quiz', 'trophy', 'Big Quiz', 'quiz'],
      teacher ? ['#/teacher', 'users', 'Dashboard', 'teacher'] : ['#/progress', 'list-checks', 'Progress', 'progress'],
      ['#/account', 'user', 'Account', 'account'],
    ];
    const navLinks = nav.map(([href, ic, label, key]) => `<a href="${href}" ${active === key ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`).join('');
    app.innerHTML = `
      <header class="topbar"><div class="topbar-inner">
        ${back ? `<a class="back" href="${back}" aria-label="Back">${icon('chevron-left')}</a>` : ''}
        <a class="brand" href="#/">${esc(title || S.config.appName)}${sub ? `<small>${esc(sub)}</small>` : ''}</a>
        <nav class="topnav" aria-label="Main">${navLinks}</nav>
      </div></header>
      <main id="main" tabindex="-1">${body}</main>
      <nav class="bottomnav" aria-label="Main">${navLinks}</nav>`;
  }

  // ---------- auth views ----------
  function authView(mode) {
    const signup = mode === 'signup';
    const c = S.config;
    document.title = `${signup ? 'Create an account' : 'Sign in'} – ${c.appName}`;
    app.innerHTML = `
      <div class="auth"><div class="auth-box">
        <div class="auth-head">
          <img src="icons/icon-192.png" alt="" width="72" height="72">
          <h1>${esc(c.appName)}</h1>
          <p>${esc(c.course)} · ${esc(c.yearLabel)} · ${esc(c.school)}</p>
        </div>
        <form class="card" id="authForm" novalidate>
          <h2>${signup ? 'Create your account' : 'Welcome back!'}</h2>
          <p class="muted small">${signup ? 'Use your own email address and choose a password you will remember.' : 'Sign in with the email and password you used to create your account.'}</p>
          <div class="form-error" hidden></div>
          ${signup ? `<label class="field"><span>Your name</span><input name="name" autocomplete="name" required maxlength="60" placeholder="First name and surname"></label>` : ''}
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" inputmode="email" required placeholder="name@example.com"></label>
          <label class="field"><span>Password</span><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="${signup ? 8 : 1}">
            ${signup ? '<small class="hint">At least 8 characters.</small>' : '<small class="hint"><a href="#/forgot">Forgotten your password?</a></small>'}</label>
          ${signup && c.classCodeRequired ? `<label class="field"><span>Class code</span><input name="classCode" autocomplete="off" required><small class="hint">Your teacher will give you this code.</small></label>` : ''}
          <button class="btn block" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
          <p class="switch-link small">${signup ? 'Already have an account? <a href="#/signin">Sign in</a>' : 'New here? <a href="#/signup">Create an account</a>'}</p>
        </form>
      </div></div>`;
    const form = $('#authForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = $('.form-error', form);
      $$('.field', form).forEach((f) => f.classList.remove('invalid'));
      const body = Object.fromEntries(new FormData(form));
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        const r = await api(signup ? '/api/auth/signup' : '/api/auth/signin', { method: 'POST', body });
        S.user = r.user;
        await loadAll();
        location.hash = '#/';
        route();
      } catch (err) {
        errBox.hidden = false;
        errBox.innerHTML = `<div class="notice bad" role="alert">${icon('circle-x')}<span>${esc(err.message)}</span></div>`;
        const f = err.data && err.data.field && form.elements[err.data.field];
        if (f) { f.closest('.field').classList.add('invalid'); f.focus(); }
      } finally { btn.disabled = false; }
    });
    setTimeout(() => form.elements[0] && form.elements[0].focus(), 50);
  }

  function forgotView() {
    const c = S.config;
    const byEmail = c.features && c.features.resetByEmail;
    document.title = `Reset your password – ${c.appName}`;
    app.innerHTML = `
      <div class="auth"><div class="auth-box">
        <div class="auth-head">
          <img src="icons/icon-192.png" alt="" width="72" height="72">
          <h1>${esc(c.appName)}</h1>
          <p>${esc(c.course)} · ${esc(c.yearLabel)} · ${esc(c.school)}</p>
        </div>
        ${byEmail ? `<form class="card" id="forgotForm" novalidate>
          <h2>Reset your password</h2>
          <p class="muted small">Type the email you used for your account. We will send you a link to choose a new password.</p>
          <div class="form-error" hidden></div>
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" inputmode="email" required placeholder="name@example.com"></label>
          <button class="btn block" type="submit">${icon('mail')}Send the reset link</button>
          <p class="switch-link small"><a href="#/signin">Back to sign in</a></p>
        </form>` : `<div class="card">
          <h2>Forgotten your password?</h2>
          <p>Ask ${esc(c.teacherName)} to make you a temporary password. Sign in with it, then choose a new password in <b>Account</b>.</p>
          <a class="btn block" href="#/signin">Back to sign in</a>
        </div>`}
      </div></div>`;
    const form = $('#forgotForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const box = $('.form-error', form);
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        await api('/api/auth/reset', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
        form.innerHTML = `<h2>Check your email</h2><div class="notice ok">${icon('mail')}<span>If there is an account for that email, a link to reset your password is on its way. Check your inbox and your junk folder.</span></div>
          <p class="switch-link small"><a href="#/signin">Back to sign in</a></p>`;
      } catch (err) {
        box.hidden = false;
        box.innerHTML = `<div class="notice bad" role="alert">${icon('circle-x')}<span>${esc(err.message)}</span></div>`;
        btn.disabled = false;
      }
    });
    setTimeout(() => form.elements[0].focus(), 50);
  }

  // ---------- home ----------
  function homeView() {
    const st = S.state, units = S.content.units, c = S.config;
    const overall = P().overallProgress(units, st);
    const first = S.user.name.split(' ')[0];
    const overallAttempts = st.quiz.filter((q) => q.scope === 'overall');
    const best = P().bestPercent(overallAttempts);
    const teacher = S.user.role === 'teacher';
    document.title = c.appName;
    shell({ active: 'home', body: `
      <div class="hello">
        <div><h1>Hello, ${esc(first)}!</h1><p class="muted" style="margin:0">${teacher ? 'You are signed in as the teacher. You can browse every unit and see all the answers.' : `Let’s keep learning. Pick a unit to continue.`}</p></div>
      </div>
      <div class="stats">
        <div class="stat">${icon('flame')}<b>${st.streak.current}</b><span>${st.streak.current === 1 ? 'day' : 'days'} in a row</span></div>
        <div class="stat">${icon('target')}<b>${overall}%</b><span>overall progress</span></div>
        <div class="stat">${icon('star')}<b>${st.streak.best}</b><span>best streak (days)</span></div>
      </div>
      ${st.streak.studiedToday ? '' : `<div class="notice" style="margin-bottom:1rem">${icon('flame')}<span>${st.streak.current ? 'Study today to keep your streak going!' : 'Tick an activity, take a quiz or play a game to start a study streak.'}</span></div>`}
      <a class="quiz-cta" href="#/quiz">${icon('trophy')}<div><b>The Big Quiz</b><span>${c.overallQuizLength} mixed questions from all nine units${best != null ? ` · best ${best}%` : ''}</span></div>${icon('chevron-right')}</a>
      <h2 class="section-title">${icon('book-open')} Units</h2>
      <div class="units">${units.map((u) => {
        const p = P().unitProgress(u, st);
        return `<a class="unit-card" href="#/unit/${u.id}">
          <div class="band" style="background:${u.colour}">${icon(u.icon)}<div><small>Unit ${u.id}</small><b>${esc(u.title)}</b></div></div>
          <div class="body">
            <div class="meta"><span>${p.ticked} of ${p.totalItems} activities</span><b>${p.pct}%</b></div>
            <div class="bar" role="progressbar" aria-label="Unit ${u.id} progress" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p.pct}%;background:${u.colour}"></span></div>
            <div class="row wrap small muted">
              ${p.bestQuiz != null ? `<span class="pill ok">${icon('circle-help')} Quiz ${p.bestQuiz}%</span>` : ''}
              ${p.cardsKnown ? `<span class="pill">${icon('layers')} ${p.cardsKnown}/${p.cardsTotal} cards</span>` : ''}
              ${p.summary ? `<span class="pill gold">${icon('pen-line')} Summary</span>` : ''}
              ${p.gameBest != null ? `<span class="pill">${icon('shopping-basket')} Best ${p.gameBest}</span>` : ''}
            </div>
          </div></a>`;
      }).join('')}</div>` });
  }

  // ---------- progress (student) ----------
  function progressView() {
    const st = S.state, units = S.content.units;
    const rows = units.map((u) => ({ u, p: P().unitProgress(u, st) }));
    document.title = `My progress – ${S.config.appName}`;
    shell({ active: 'progress', title: 'My progress', sub: S.config.appName, body: `
      <div class="stats">
        <div class="stat">${icon('flame')}<b>${st.streak.current}</b><span>${st.streak.current === 1 ? 'day' : 'days'} in a row</span></div>
        <div class="stat">${icon('target')}<b>${P().overallProgress(units, st)}%</b><span>overall</span></div>
        <div class="stat">${icon('notebook-pen')}<b>${st.streak.totalDays}</b><span>${st.streak.totalDays === 1 ? 'day' : 'days'} studied</span></div>
      </div>
      <div class="card"><h2>Unit by unit</h2>
        <div class="table-scroll"><table class="students stackable"><thead><tr><th>Unit</th><th>Progress</th><th>Activities</th><th>Best quiz</th><th>Cards known</th><th>Summary</th><th>Basket best</th></tr></thead><tbody>
        ${rows.map(({ u, p }) => `<tr class="link" data-href="#/unit/${u.id}"><td><b>${u.id}.</b> ${esc(u.title)}</td><td class="wide" data-label="Progress" style="min-width:110px"><div class="bar"><span style="width:${p.pct}%;background:${u.colour}"></span></div><span class="small">${p.pct}%</span></td>
          <td data-label="Activities">${p.ticked}/${p.totalItems}</td><td data-label="Best quiz">${p.bestQuiz != null ? p.bestQuiz + '%' : '–'}</td><td data-label="Cards known">${p.cardsKnown}/${p.cardsTotal}</td><td data-label="Summary">${p.summary ? 'Written' : '–'}</td><td data-label="Basket best">${p.gameBest != null ? p.gameBest : '–'}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="small muted" style="margin-top:.75rem">How progress is worked out: activities ticked 50%, best practice quiz 20%, memory cards known 15%, My Summary 10% and playing the basket game 5%.</p>
      </div>` });
    $$('tr.link').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  }

  // ---------- unit ----------
  const TABS = [
    ['overview', 'book-open', 'Overview'],
    ['sb', 'book-open-text', 'Student Book'],
    ['wb', 'notebook-pen', 'Workbook'],
    ['practice', 'circle-help', 'Practice'],
    ['cards', 'layers', 'Memory cards'],
    ['game', 'shopping-basket', 'Basket game'],
    ['summary', 'pen-line', 'My Summary'],
    ['answers', 'key-round', 'Answers'],
  ];
  let activeGame = null;

  function unitView(id, tab = 'overview') {
    const u = unitById(id);
    if (!u) return notFound();
    if (!TABS.some((t) => t[0] === tab)) tab = 'overview';
    const p = P().unitProgress(u, S.state);
    const tabLabel = TABS.find((t) => t[0] === tab)[2];
    document.title = `Unit ${u.id}: ${u.title} – ${tabLabel} – ${S.config.appName}`;
    shell({ active: 'home', back: '#/', title: `Unit ${u.id}: ${u.title}`, sub: S.config.appName, body: `
      <div class="unit-hero" style="background:${u.colour};--unit:${u.colour}">${icon(u.icon)}
        <div><small>Unit ${u.id}</small><h1>${esc(u.title)}</h1><span class="pages"><span>${esc(S.config.books.sb.short)} pp. ${esc(u.sbPages)}</span> · <span>${esc(S.config.books.wb.short)} pp. ${esc(u.wbPages)}</span></span></div>
        <div class="pct" id="unitPct">${p.pct}%<span>complete</span></div>
      </div>
      <nav class="tabs" aria-label="Unit sections">${TABS.map(([k, ic, label]) => `<a href="#/unit/${u.id}/${k}" ${k === tab ? 'aria-current="page"' : ''}>${icon(ic)}${label}</a>`).join('')}</nav>
      <section id="tab" style="--unit:${u.colour}"></section>` });
    const cur = $('.tabs a[aria-current]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    const el = $('#tab');
    ({ overview: tabOverview, sb: tabSB, wb: tabWB, practice: tabPractice, cards: tabCards, game: tabGame, summary: tabSummary, answers: tabAnswers })[tab](u, el);
  }

  function updateUnitPct(u) {
    const el = $('#unitPct');
    if (el) el.innerHTML = `${P().unitProgress(u, S.state).pct}%<span>complete</span>`;
  }

  function bookLink(book, pages) {
    const c = S.config;
    return `<a class="pageref" href="${esc(c.bookUrl)}" target="_blank" rel="noopener" title="Open ${esc(c.books[book].name)} on ${esc(c.bookSiteName)}">${icon('book-open')}${esc(c.books[book].short)} ${pageWord(pages) === 'pages' ? 'pp.' : 'p.'} ${esc(pages)}</a>`;
  }

  function tabOverview(u, el) {
    const c = S.config;
    el.innerHTML = `
      <div class="card"><h2>What this unit is about</h2><p>${esc(u.overview)}</p>
        <div class="row wrap small muted">${u.parts.map((pt) => `<span class="pill">Part ${esc(pt.code)}: ${esc(pt.title)}</span>`).join('')}</div></div>
      <div class="card"><h2 class="row">${icon('target')} By the end of this unit, you will be able to…</h2><ul class="clean ticks">${u.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></div>
      <h2 class="section-title">${icon('scroll-text')} The texts you will read</h2>
      <div class="grid two">${u.texts.map((t) => `<div class="card text-card"><h3>${esc(t.title)}</h3><p class="small muted">${esc(t.kind)} · ${bookLink('sb', t.pages)}</p><p>${esc(t.summary)}</p></div>`).join('')}</div>
      <h2 class="section-title">${icon('sparkles')} Key vocabulary</h2>
      <div class="vocab">${u.vocab.map((v) => `<div><b>${esc(v.word)}</b>${esc(v.meaning)}<i>${esc(v.example)}</i></div>`).join('')}</div>
      <div class="card" style="margin-top:1rem"><h2 class="row">${icon('book-open')} Your books</h2>
        <p class="small muted">Your books are on ${esc(c.bookSiteName)}. Sign in with the details from school, then open the right book and turn to the page.</p>
        <div class="book-links">
          <a class="btn secondary" href="${esc(c.bookUrl)}" target="_blank" rel="noopener">${icon('external-link')}${esc(c.books.sb.name)} · pp. ${esc(u.sbPages)}</a>
          <a class="btn secondary" href="${esc(c.bookUrl)}" target="_blank" rel="noopener">${icon('external-link')}${esc(c.books.wb.name)} · pp. ${esc(u.wbPages)}</a>
        </div></div>`;
  }

  function activityList(u, items, kind) {
    const done = new Set(S.state.progress);
    const n = items.filter((i) => done.has(i.id)).length;
    return `
      <div class="card">
        <div class="progress-line"><b>${n} of ${items.length} done</b><div class="bar"><span style="width:${Math.round((100 * n) / items.length)}%;background:${u.colour}"></span></div></div>
        <p class="small muted" style="margin:0">${kind === 'sb' ? 'Work through each lesson in your Student Book. Tick it off when you have finished.' : 'Use these tips while you complete your Workbook. Tick each activity off when it is done.'}</p>
      </div>
      <div class="card">${items.map((it) => {
        const isDone = done.has(it.id);
        const kicker = kind === 'sb'
          ? `<span class="pill">${esc(it.lesson)}</span><span class="pill gold">Part ${esc(it.part)}</span>`
          : `<span class="pill">${it.code === 'J' ? 'Journal' : `Activity ${esc(it.code)}`}</span>`;
        return `<div class="activity ${isDone ? 'done' : ''}" data-id="${it.id}">
          <button class="tick" type="button" aria-pressed="${isDone}" aria-label="Mark ${esc(it.title)} as done">${icon('check')}</button>
          <div class="content">
            <div class="kicker">${kicker}${bookLink(kind, it.pages)}</div>
            <h3>${esc(it.title)}</h3>
            ${it.steps ? `<ol class="steps">${it.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
            <div class="tip">${icon('sparkles')}<span>${esc(it.tip)}</span></div>
          </div></div>`;
      }).join('')}</div>`;
  }
  function bindTicks(u, el, rerender) {
    $$('.tick', el).forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('.activity').dataset.id;
      const done = b.getAttribute('aria-pressed') !== 'true';
      b.disabled = true;
      try {
        await api(`/api/progress/${encodeURIComponent(id)}`, { method: 'PUT', body: { done } });
        const set = new Set(S.state.progress);
        done ? set.add(id) : set.delete(id);
        S.state.progress = [...set];
        if (done) await refreshState();
        rerender();
        updateUnitPct(u);
        if (done) toast('Nice work! Activity ticked off.');
      } catch (e) { toast(e.message); b.disabled = false; }
    }));
  }
  function tabSB(u, el) { el.innerHTML = activityList(u, u.sb, 'sb'); bindTicks(u, el, () => tabSB(u, el)); }
  function tabWB(u, el) { el.innerHTML = activityList(u, u.wb, 'wb'); bindTicks(u, el, () => tabWB(u, el)); }

  // ---------- quiz engine (unit practice + Big Quiz) ----------
  function quizHistory(scope) {
    const list = S.state.quiz.filter((q) => q.scope === scope).slice(-8).reverse();
    if (!list.length) return '<p class="muted small">No attempts yet.</p>';
    return `<div class="history">${list.map((a) => {
      const pct = Math.round((100 * a.score) / a.total);
      return `<div class="history-row"><span class="muted">${fmtDate(a.created_at)}</span><div class="bar"><span style="width:${pct}%"></span></div><b>${a.score}/${a.total}</b></div>`;
    }).join('')}</div>`;
  }

  function runQuiz(el, { scope, questions, title, onDone }) {
    const qs = questions.map((q) => ({ ...q, shown: shuffle(q.options) }));
    let i = 0;
    const picks = [];
    const start = () => {
      const best = P().bestPercent(S.state.quiz.filter((a) => a.scope === scope));
      el.innerHTML = `<div class="card"><h2 class="row">${icon('circle-help')} ${esc(title)}</h2>
        <p>${qs.length} questions. Choose an answer to see straight away whether you are right, with a short explanation.</p>
        ${best != null ? `<p class="small muted">Your best score so far: <b>${best}%</b></p>` : ''}
        <button class="btn" id="qStart">${icon('play')}Start the quiz</button></div>
        <div class="card"><h3>Your recent scores</h3>${quizHistory(scope)}</div>`;
      $('#qStart', el).addEventListener('click', () => show());
    };
    const show = () => {
      const q = qs[i];
      el.innerHTML = `<div class="card">
        <div class="quiz-top"><span>Question ${i + 1} of ${qs.length}</span>${q.unitTitle ? `<span class="pill">Unit ${q.unit}</span>` : ''}</div>
        <div class="bar" style="margin-bottom:1rem"><span style="width:${Math.round((100 * i) / qs.length)}%"></span></div>
        <p class="quiz-q">${esc(q.q)}</p>
        <div class="options">${q.shown.map((o, k) => `<button class="option" type="button" data-k="${k}"><span class="letter">${'ABCD'[k]}</span><span>${esc(o)}</span></button>`).join('')}</div>
        <div class="feedback" aria-live="polite"></div></div>`;
      $$('.option', el).forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.k))));
      $('.option', el).focus({ preventScroll: true });
    };
    const answer = (k) => {
      const q = qs[i];
      const choice = q.shown[k];
      const right = q.options[q.answer];
      const ok = choice === right;
      picks.push({ qid: q.id, choice });
      $$('.option', el).forEach((b, idx) => {
        b.disabled = true;
        if (q.shown[idx] === right) b.classList.add('correct');
        else if (idx === k) b.classList.add('wrong');
      });
      const last = i === qs.length - 1;
      $('.feedback', el).innerHTML = `<div class="notice ${ok ? 'ok' : 'bad'}">${icon(ok ? 'circle-check' : 'circle-x')}<span><b>${ok ? 'Correct!' : 'Not quite.'}</b> ${esc(q.explain)}</span></div>
        <button class="btn block" style="margin-top:.8rem" id="qNext">${last ? 'See my score' : 'Next question'}${icon('arrow-right')}</button>`;
      $('#qNext', el).focus({ preventScroll: true });
      $('#qNext', el).addEventListener('click', () => { if (last) finish(); else { i++; show(); } });
    };
    const finish = async () => {
      el.innerHTML = '<div class="card empty"><div class="spinner" style="margin:0 auto"></div></div>';
      try {
        const r = await api('/api/quiz', { method: 'POST', body: { scope, answers: picks } });
        await refreshState();
        const pct = Math.round((100 * r.score) / r.total);
        const msg = pct === 100 ? 'Perfect score – brilliant!' : pct >= 80 ? 'Excellent work!' : pct >= 60 ? 'Good effort! Check the ones you missed.' : 'Keep practising – look back at the guide and try again.';
        el.innerHTML = `<div class="card result">${icon('trophy')}<div class="big">${r.score}/${r.total}</div><p><b>${pct}%</b> · ${msg}</p>
          <div class="row wrap" style="justify-content:center"><button class="btn" id="qAgain">${icon('rotate-ccw')}Try again</button></div></div>
          <div class="card"><h3>Check your answers</h3>${qs.map((q, n) => {
            const d = r.details[n];
            return `<div class="review-item"><div class="row" style="align-items:flex-start">${icon(d.correct ? 'circle-check' : 'circle-x', d.correct ? 'ok' : 'bad')}<div><b>${esc(q.q)}</b><br>
              ${d.correct ? '' : `<span class="muted">You chose: ${esc(picks[n].choice)}</span><br>`}<span>Answer: <b>${esc(q.options[q.answer])}</b></span></div></div></div>`;
          }).join('')}</div>
          <div class="card"><h3>Your recent scores</h3>${quizHistory(scope)}</div>`;
        $('#qAgain', el).addEventListener('click', () => onDone && onDone());
      } catch (e) {
        el.innerHTML = `<div class="notice bad">${icon('circle-x')}<span>${esc(e.message)}</span></div>`;
      }
    };
    start();
  }

  function tabPractice(u, el) {
    runQuiz(el, { scope: `u${u.id}`, title: `Unit ${u.id} practice quiz`, questions: shuffle(u.practice), onDone: () => { tabPractice(u, el); updateUnitPct(u); } });
  }

  function bigQuizView() {
    const n = S.config.overallQuizLength || 20;
    document.title = `The Big Quiz – ${S.config.appName}`;
    shell({ active: 'quiz', title: 'The Big Quiz', sub: S.config.appName, body: '<section id="tab"></section>' });
    const all = S.content.units.flatMap((u) => u.practice.map((q) => ({ ...q, unit: u.id, unitTitle: u.title })));
    // spread questions across units: take a shuffled round-robin
    const byUnit = S.content.units.map((u) => shuffle(all.filter((q) => q.unit === u.id)));
    const picked = [];
    for (let r = 0; picked.length < Math.min(n, all.length); r++) for (const list of shuffle(byUnit)) if (list[r] && picked.length < n) picked.push(list[r]);
    runQuiz($('#tab'), { scope: 'overall', title: 'The Big Quiz: all units', questions: shuffle(picked), onDone: bigQuizView });
  }

  // ---------- memory cards ----------
  function tabCards(u, el) {
    let order = u.cards.map((c) => c.id);
    let filter = 'all';
    let idx = 0;
    const statuses = () => S.state.cards || {};
    const deck = () => order.filter((id) => filter === 'all' || statuses()[id] !== 'known');
    const render = () => {
      const d = deck();
      const known = u.cards.filter((c) => statuses()[c.id] === 'known').length;
      if (!d.length) {
        el.innerHTML = `<div class="card result">${icon('star')}<h2>You know every card in this unit!</h2><p class="muted">Great memory work. Shuffle and go through them again to keep them fresh.</p>
          <button class="btn" id="cAll">${icon('rotate-ccw')}Show all cards</button></div>`;
        $('#cAll', el).addEventListener('click', () => { filter = 'all'; idx = 0; render(); });
        return;
      }
      idx = Math.min(idx, d.length - 1);
      const card = u.cards.find((c) => c.id === d[idx]);
      const stt = statuses()[card.id];
      el.innerHTML = `
        <div class="card"><div class="progress-line"><b>${known} of ${u.cards.length} known</b><div class="bar"><span style="width:${Math.round((100 * known) / u.cards.length)}%;background:${u.colour}"></span></div></div>
          <p class="small muted" style="margin:0">Read the question, say your answer out loud, then tap the card to check. Be honest!</p></div>
        <div class="flip-wrap" style="margin-top:1rem">
          <button class="flip" type="button" aria-label="Flip card">
            <div class="face front"><small>Card ${idx + 1} of ${d.length}${stt ? ` · ${stt === 'known' ? 'I know it' : 'Still learning'}` : ''}</small><span>${esc(card.front)}</span><span class="hint">Tap to flip</span></div>
            <div class="face back"><small>Answer</small><span>${esc(card.back)}</span><span class="hint">Tap to flip back</span></div>
          </button>
        </div>
        <div class="card-actions">
          <button class="btn warn" id="cLearn">${icon('rotate-ccw')}Still learning</button>
          <button class="btn ok" id="cKnow">${icon('check')}I know it</button>
        </div>
        <div class="dots" aria-hidden="true">${d.map((id, k) => `<i class="${statuses()[id] || ''} ${k === idx ? 'current' : ''}"></i>`).join('')}</div>
        <div class="card-tools">
          <button class="btn secondary small" id="cPrev" ${idx === 0 ? 'disabled' : ''}>${icon('arrow-left')}Back</button>
          <button class="btn secondary small" id="cShuffle">${icon('shuffle')}Shuffle</button>
          <button class="btn secondary small" id="cFilter" aria-pressed="${filter === 'learning'}">${icon('layers')}${filter === 'all' ? 'Only cards I’m learning' : 'Show all cards'}</button>
          <button class="btn secondary small" id="cNext" ${idx >= d.length - 1 ? 'disabled' : ''}>Next${icon('arrow-right')}</button>
        </div>`;
      const flip = $('.flip', el);
      flip.addEventListener('click', () => flip.classList.toggle('flipped'));
      const mark = async (status) => {
        try {
          await api(`/api/cards/${card.id}`, { method: 'PUT', body: { status } });
          S.state.cards = { ...statuses(), [card.id]: status };
          refreshState().then(() => updateUnitPct(u));
          if (filter === 'learning' && status === 'known') { /* card leaves the deck; stay on same index */ } else idx++;
          if (idx >= deck().length && deck().length) { idx = 0; toast(status === 'known' ? 'Round finished! Starting again from the first card.' : 'Round finished!'); }
          render();
        } catch (e) { toast(e.message); }
      };
      $('#cKnow', el).addEventListener('click', () => mark('known'));
      $('#cLearn', el).addEventListener('click', () => mark('learning'));
      $('#cPrev', el).addEventListener('click', () => { idx--; render(); });
      $('#cNext', el).addEventListener('click', () => { idx++; render(); });
      $('#cShuffle', el).addEventListener('click', () => { order = shuffle(order); idx = 0; render(); toast('Cards shuffled.'); });
      $('#cFilter', el).addEventListener('click', () => { filter = filter === 'all' ? 'learning' : 'all'; idx = 0; render(); });
    };
    render();
  }

  // ---------- basket game ----------
  function tabGame(u, el) {
    const g = (S.state.games || []).find((x) => x.unit_id === u.id);
    el.innerHTML = `<div class="game-shell">
      <div class="game-hud">
        <div>Score<b id="gScore">0</b></div><div>Level<b id="gLevel">1</b></div>
        <div>Lives<b id="gLives"></b></div><div>Best<b id="gBest">${g ? g.best_score : 0}</b></div>
      </div>
      <div class="game-prompt" id="gPrompt">${esc(u.basket[0].prompt)}</div>
      <div class="game-stage" id="gStage"><canvas id="gCanvas" aria-label="Word Catching Basket game"></canvas>
        <div class="game-overlay" id="gOverlay"><div class="inner">${icon('shopping-basket', 'big')}
          <h2>Word Catching Basket</h2>
          <p class="small">Words fall from the top. Move the basket to <b>catch the words that match the prompt</b> and dodge the others. You have 3 lives. Catch 6 correct words to reach the next level.</p>
          <p class="small muted">Phone or tablet: drag the basket with your finger. Computer: use the arrow keys (or A and D).</p>
          <button class="btn" id="gStart">${icon('play')}Start game</button>
          ${g ? `<p class="small muted" style="margin-top:.6rem">Best score ${g.best_score} · level ${g.best_level} · played ${g.plays} time${g.plays === 1 ? '' : 's'}</p>` : ''}
        </div></div>
      </div>
      <div class="game-controls">
        <button class="btn secondary" id="gLeft" aria-label="Move left">${icon('arrow-left')}</button>
        <button class="btn secondary" id="gPause" aria-label="Pause">${icon('pause')}</button>
        <button class="btn secondary" id="gRight" aria-label="Move right">${icon('arrow-right')}</button>
      </div></div>`;
    const hearts = (n) => `<span class="hearts">${[0, 1, 2].map((k) => icon('heart', k < n ? '' : 'lost')).join('')}</span>`;
    $('#gLives').innerHTML = hearts(3);
    if (activeGame) activeGame.destroy();
    activeGame = window.BasketGame.create({
      stage: $('#gStage'), canvas: $('#gCanvas'), rounds: u.basket, colour: u.colour,
      onHud: (h) => {
        $('#gScore').textContent = h.score; $('#gLevel').textContent = h.level; $('#gLives').innerHTML = hearts(h.lives);
        $('#gPrompt').textContent = h.prompt;
      },
      onOver: async (h) => {
        let saved = null;
        try { saved = await api('/api/game', { method: 'POST', body: { unit: u.id, score: h.score, level: h.level } }); await refreshState(); updateUnitPct(u); } catch (e) { toast(e.message); }
        if (saved) $('#gBest').textContent = saved.best;
        $('#gOverlay').hidden = false;
        $('#gOverlay').innerHTML = `<div class="inner">${icon('trophy', 'big')}<h2>Game over</h2>
          <p>You scored <b>${h.score}</b> and reached level <b>${h.level}</b>.</p>
          <p class="small">${h.caught} correct word${h.caught === 1 ? '' : 's'} caught.${saved && saved.newBest ? ' <b>New best score!</b>' : ''}</p>
          ${h.missedCorrect.length ? `<p class="small muted">Words you could have caught: ${h.missedCorrect.slice(0, 6).map(esc).join(', ')}</p>` : ''}
          ${h.wrongCaught.length ? `<p class="small muted">Not right for the prompt: ${h.wrongCaught.slice(0, 6).map(esc).join(', ')}</p>` : ''}
          <button class="btn" id="gStart">${icon('rotate-ccw')}Play again</button></div>`;
        $('#gStart').addEventListener('click', startGame);
      },
    });
    function startGame() { $('#gOverlay').hidden = true; $('#gPause').innerHTML = icon('pause'); activeGame.start(); $('.game-hud').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    $('#gStart').addEventListener('click', startGame);
    const hold = (btn, dir) => {
      const on = (e) => { e.preventDefault(); activeGame.press(dir, true); };
      const off = () => activeGame.press(dir, false);
      btn.addEventListener('pointerdown', on); btn.addEventListener('pointerup', off); btn.addEventListener('pointerleave', off); btn.addEventListener('pointercancel', off);
    };
    hold($('#gLeft'), -1); hold($('#gRight'), 1);
    $('#gPause').addEventListener('click', () => {
      const paused = activeGame.togglePause();
      $('#gPause').innerHTML = icon(paused ? 'play' : 'pause');
      $('#gPause').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
    });
  }

  // ---------- My Summary ----------
  function tabSummary(u, el) {
    const sm = (S.state.summaries || []).find((x) => x.unit_id === u.id) || {};
    const fields = [
      ['mainIdea', 'main_idea', 'The main idea of this unit is…', 'In one or two sentences, what was this unit mostly about?'],
      ['learnt', 'learnt', 'I learnt…', 'Write at least two things you learnt, for example a new word, a grammar rule or a fact from a text.'],
      ['favourite', 'favourite', 'My favourite part was…', 'Which text, activity or idea did you enjoy most? Why?'],
      ['wonder', 'wonder', 'I still wonder…', 'What questions do you still have? What would you like to find out more about?'],
    ];
    el.innerHTML = `<form class="card" id="smForm">
      <h2 class="row">${icon('pen-line')} My Summary</h2>
      <p class="small muted">Write in your own words. ${esc(S.config.teacherName)} can read your summary. Fill in the first two boxes to count it towards your progress.</p>
      ${fields.map(([k, col, label, hint]) => `<label class="field"><span class="prompt-label">${esc(label)}</span><small class="hint">${esc(hint)}</small>
        <textarea name="${k}" maxlength="2000" rows="3">${esc(sm[col] || '')}</textarea></label>`).join('')}
      <div class="row wrap"><button class="btn" type="submit">${icon('save')}Save my summary</button><span class="small muted" id="smSaved">${sm.updated_at ? `Last saved ${fmtDate(sm.updated_at)}` : 'Not saved yet'}</span></div>
    </form>`;
    const form = $('#smForm', el);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try {
        await api(`/api/summary/${u.id}`, { method: 'PUT', body });
        await refreshState();
        updateUnitPct(u);
        const s2 = S.state.summaries.find((x) => x.unit_id === u.id);
        $('#smSaved').textContent = `Saved ${fmtDate(s2 && s2.updated_at)}`;
        toast(P().summaryWritten(s2) ? 'Summary saved. Well done!' : 'Saved. Add more to the first two boxes to complete it.');
      } catch (err) { toast(err.message); } finally { btn.disabled = false; }
    });
  }

  // ---------- answers ----------
  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<u>$1</u>');
  }
  function renderGroups(groups) {
    return groups.map((g) => `<div class="ans-group"><h3>${esc(g.title)}</h3>${g.parts.map((p) => `<div class="ans-page">${esc(p.page)}</div>${p.items.map((it) => {
      if (it.label) return `<div class="ans-label">${esc(it.label)}</div>`;
      if (it.table) return `<div class="table-wrap"><table class="ans"><thead><tr>${it.table.head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${it.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      return `<p class="ans-line l${it.lvl}">${inline(it.text)}</p>`;
    }).join('')}`).join('')}</div>`).join('');
  }
  async function tabAnswers(u, el) {
    el.innerHTML = '<div class="card empty"><div class="spinner" style="margin:0 auto"></div></div>';
    try { await refreshState(); } catch { /* use the last known state */ }
    if (!el.isConnected) return;
    const teacher = S.user.role === 'teacher';
    const unlocked = (sec) => S.state.unlocks.some((x) => x.unit_id === u.id && x.section === sec);
    el.innerHTML = `${teacher ? `<div class="notice" style="margin-bottom:.9rem">${icon('info')}<span>As the teacher, you can always see the answers. Students only see a section after you unlock it in the <a href="#/teacher">dashboard</a>.</span></div>` : ''}
      ${['sb', 'wb'].map((sec) => `<div class="card" id="ans-${sec}">
        <div class="lockbox">${icon(unlocked(sec) ? 'lock-open' : 'lock')}<div><h2 style="margin:0">${esc(S.config.books[sec].name)} answers</h2>
        <span class="small muted">${unlocked(sec) ? 'Unlocked by your teacher' : teacher ? 'Locked for students' : `Locked – ${esc(S.config.teacherName)} will unlock these when it is time to check your work.`}</span></div></div>
        <div class="ans-body" style="margin-top:.8rem"></div></div>`).join('')}`;
    ['sb', 'wb'].forEach(async (sec) => {
      if (!teacher && !unlocked(sec)) return;
      const body = $(`#ans-${sec} .ans-body`, el);
      body.innerHTML = '<div class="spinner"></div>';
      try {
        const r = await api(`/api/answers/${u.id}/${sec}`);
        body.innerHTML = `<p class="small muted">Use these to check your own work after you have tried each activity. Answers marked “Answers will vary” can be different from the examples. Longer writing tasks are not listed, because everyone’s writing will be different.</p>${renderGroups(r.groups)}`;
      } catch (e) {
        body.innerHTML = `<div class="notice">${icon('lock')}<span>${esc(e.message)}</span></div>`;
      }
    });
  }

  // ---------- account ----------
  function accountView() {
    document.title = `Account – ${S.config.appName}`;
    shell({ active: 'account', title: 'My account', sub: S.config.appName, body: `
      <div class="card"><h2>${esc(S.user.name)}</h2><p class="muted">${esc(S.user.email)} · ${S.user.role === 'teacher' ? 'Teacher' : 'Student'}</p>
        <button class="btn secondary" id="signOut">${icon('log-out')}Sign out</button></div>
      <form class="card" id="pwForm"><h2>Change password</h2><div class="form-error" hidden></div>
        <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
        <label class="field"><span>New password</span><input type="password" name="next" autocomplete="new-password" minlength="8" required><small class="hint">At least 8 characters.</small></label>
        <button class="btn" type="submit">${icon('key-round')}Update password</button></form>
      ${S.user.role === 'student' ? `<form class="card" id="delForm"><h2>Delete my account</h2><p class="small muted">This removes your account and all your progress, quiz scores and summaries. It cannot be undone.</p><div class="form-error" hidden></div>
        <label class="field"><span>Type your password to confirm</span><input type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn secondary" type="submit">${icon('x')}Delete my account</button></form>` : ''}
      <div class="card"><h2>Install the app</h2><p class="small">On a phone or tablet, open your browser menu and choose <b>Add to Home Screen</b> (Safari: the Share button, then <b>Add to Home Screen</b>). The guide will open like an app.</p>
        <button class="btn secondary" id="installBtn" hidden>${icon('download')}Install now</button></div>
      <p class="small muted">${esc(S.config.appName)} · ${esc(S.config.course)} ${esc(S.config.stage)} · ${esc(S.config.school)}. Book content © ${esc(S.config.publisher)}; this guide contains original study notes only. Icons by Lucide (ISC licence).</p>` });
    $('#signOut').addEventListener('click', async () => { await api('/api/auth/signout', { method: 'POST' }); S.user = null; S.content = null; S.state = null; location.hash = '#/signin'; route(); });
    const form = $('#pwForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const box = $('.form-error', form);
      try {
        await api('/api/auth/password', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
        form.reset(); box.hidden = true; toast('Password updated.');
      } catch (err) { box.hidden = false; box.innerHTML = `<div class="notice bad">${icon('circle-x')}<span>${esc(err.message)}</span></div>`; }
    });
    const del = $('#delForm');
    if (del) del.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm('Delete your account and all your progress? This cannot be undone.')) return;
      const box = $('.form-error', del);
      try {
        await api('/api/account/delete', { method: 'POST', body: Object.fromEntries(new FormData(del)) });
        S.user = null; S.content = null; S.state = null; location.hash = '#/signin'; route();
      } catch (err) { box.hidden = false; box.innerHTML = `<div class="notice bad">${icon('circle-x')}<span>${esc(err.message)}</span></div>`; }
    });
    if (deferredInstall) { const b = $('#installBtn'); b.hidden = false; b.addEventListener('click', async () => { deferredInstall.prompt(); deferredInstall = null; b.hidden = true; }); }
  }

  // ---------- teacher ----------
  async function teacherView() {
    if (S.user.role !== 'teacher') return notFound();
    document.title = `Teacher dashboard – ${S.config.appName}`;
    shell({ active: 'teacher', title: 'Teacher dashboard', sub: S.config.appName, body: '<div class="card empty"><div class="spinner" style="margin:0 auto"></div></div>' });
    let data;
    try { data = await api('/api/teacher/overview'); } catch (e) { $('main').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    const units = S.content.units;
    const isOn = (unit, sec) => data.unlocks.some((x) => x.unit_id === unit && x.section === sec);
    const students = data.students;
    const avg = students.length ? Math.round(students.reduce((a, s) => a + s.overallPct, 0) / students.length) : 0;
    const activeToday = students.filter((s) => s.streak.studiedToday).length;
    $('main').innerHTML = `
      <div class="stats">
        <div class="stat">${icon('users')}<b>${students.length}</b><span>students</span></div>
        <div class="stat">${icon('target')}<b>${avg}%</b><span>average progress</span></div>
        <div class="stat">${icon('flame')}<b>${activeToday}</b><span>studied today</span></div>
      </div>
      <div class="card"><h2 class="row">${icon('key-round')} Answer keys</h2>
        <p class="small muted">Answers are locked for students until you unlock them. Unlock the Student Book and Workbook answers separately for each unit. You can lock them again at any time.</p>
        <div class="table-scroll"><table class="unlock-grid"><thead><tr><th>Unit</th><th class="c">${esc(S.config.books.sb.short)}</th><th class="c">${esc(S.config.books.wb.short)}</th></tr></thead><tbody>
        ${units.map((u) => `<tr><td><b>${u.id}.</b> ${esc(u.title)}</td>${['sb', 'wb'].map((sec) => `<td class="c"><button class="toggle" type="button" data-unit="${u.id}" data-sec="${sec}" aria-pressed="${isOn(u.id, sec)}" aria-label="Unit ${u.id} ${S.config.books[sec].short} answers">${icon(isOn(u.id, sec) ? 'lock-open' : 'lock')}${isOn(u.id, sec) ? 'Unlocked' : 'Locked'}</button></td>`).join('')}</tr>`).join('')}
        </tbody></table></div></div>
      <div class="card"><h2 class="row">${icon('graduation-cap')} Students</h2>
        ${students.length ? `<div class="table-scroll"><table class="students stackable"><thead><tr><th>Name</th><th>Overall</th><th>Units 1–9</th><th>Streak</th><th>Big Quiz</th><th>Summaries</th><th>Last active</th></tr></thead><tbody>
        ${students.map((s) => `<tr class="link" data-href="#/teacher/student/${s.id}" tabindex="0"><td><b>${esc(s.name)}</b><br><span class="small muted">${esc(s.email)}</span></td>
          <td data-label="Overall"><b>${s.overallPct}%</b></td>
          <td data-label="Units 1–9"><div class="mini-bars" title="Progress in each unit">${s.units.map((x) => `<i title="Unit ${x.id}: ${x.pct}%"><span style="height:${x.pct}%"></span></i>`).join('')}</div></td>
          <td data-label="Streak">${s.streak.current} ${s.streak.current === 1 ? 'day' : 'days'}</td><td data-label="Big Quiz best">${s.overallQuiz.best != null ? s.overallQuiz.best + '%' : '–'}</td><td data-label="Summaries">${s.summaries} of 9</td><td data-label="Last active" class="small">${fmtDate(s.lastActive)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">No students yet. Ask your class to open the app and create an account.</p>'}
      </div>`;
    $$('.toggle').forEach((b) => b.addEventListener('click', async () => {
      const unlocked = b.getAttribute('aria-pressed') !== 'true';
      b.disabled = true;
      try {
        const r = await api('/api/teacher/unlocks', { method: 'PUT', body: { unit: Number(b.dataset.unit), section: b.dataset.sec, unlocked } });
        S.state.unlocks = r.unlocks;
        b.setAttribute('aria-pressed', unlocked);
        b.innerHTML = `${icon(unlocked ? 'lock-open' : 'lock')}${unlocked ? 'Unlocked' : 'Locked'}`;
        toast(`Unit ${b.dataset.unit} ${S.config.books[b.dataset.sec].short} answers ${unlocked ? 'unlocked' : 'locked'}.`);
      } catch (e) { toast(e.message); } finally { b.disabled = false; }
    }));
    $$('tr.link').forEach((tr) => {
      tr.addEventListener('click', () => { location.hash = tr.dataset.href; });
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = tr.dataset.href; });
    });
  }

  async function studentView(id) {
    if (S.user.role !== 'teacher') return notFound();
    shell({ active: 'teacher', back: '#/teacher', title: 'Student', sub: 'Teacher dashboard', body: '<div class="card empty"><div class="spinner" style="margin:0 auto"></div></div>' });
    let d;
    try { d = await api(`/api/teacher/students/${encodeURIComponent(id)}`); } catch (e) { $('main').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    const s = d.student, st = d.state, units = S.content.units;
    document.title = `${s.name} – Teacher dashboard – ${S.config.appName}`;
    $('.brand').innerHTML = `${esc(s.name)}<small>Teacher dashboard</small>`;
    const quizRows = st.quiz.slice().reverse().slice(0, 15);
    $('main').innerHTML = `
      <div class="card"><h1 style="margin-bottom:.2rem">${esc(s.name)}</h1><p class="muted small">${esc(s.email)} · joined ${fmtDay(s.createdAt)} · last active ${fmtDate(s.lastActive)}</p>
        <div class="row wrap"><span class="pill">${icon('target')} ${s.overallPct}% overall</span><span class="pill gold">${icon('flame')} ${s.streak.current}-day streak (best ${s.streak.best})</span><span class="pill">${icon('notebook-pen')} ${s.streak.totalDays} ${s.streak.totalDays === 1 ? 'day' : 'days'} studied</span></div></div>
      <div class="card"><h2>Units</h2><div class="table-scroll"><table class="students stackable"><thead><tr><th>Unit</th><th>Progress</th><th>Activities</th><th>Best quiz</th><th>Cards known</th><th>Basket best</th></tr></thead><tbody>
        ${s.units.map((x) => { const u = units.find((y) => y.id === x.id); return `<tr><td><b>${u.id}.</b> ${esc(u.title)}</td><td class="wide" data-label="Progress" style="min-width:110px"><div class="bar"><span style="width:${x.pct}%;background:${u.colour}"></span></div><span class="small">${x.pct}%</span></td><td data-label="Activities">${x.ticked}/${x.totalItems}</td><td data-label="Best quiz">${x.bestQuiz != null ? x.bestQuiz + '%' : '–'}</td><td data-label="Cards known">${x.cardsKnown}/${x.cardsTotal}</td><td data-label="Basket best">${x.gameBest != null ? `${x.gameBest} (${x.gamePlays} ${x.gamePlays === 1 ? 'play' : 'plays'})` : '–'}</td></tr>`; }).join('')}
      </tbody></table></div></div>
      <div class="card"><h2 class="row">${icon('pen-line')} My Summary entries</h2>
        ${st.summaries.filter((x) => Object.values({ a: x.main_idea, b: x.learnt, c: x.favourite, d: x.wonder }).some((v) => v && v.trim())).sort((a, b) => a.unit_id - b.unit_id).map((x) => `<div class="summary-box" style="margin-bottom:.7rem"><b>Unit ${x.unit_id}: ${esc(units.find((u) => u.id === x.unit_id).title)}</b> <span class="small muted">· ${fmtDate(x.updated_at)}</span>
          <dl>${[['The main idea of this unit is…', x.main_idea], ['I learnt…', x.learnt], ['My favourite part was…', x.favourite], ['I still wonder…', x.wonder]].filter(([, v]) => v && v.trim()).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`).join('') || '<p class="muted">No summaries written yet.</p>'}
      </div>
      <div class="card"><h2 class="row">${icon('trophy')} Quiz history</h2>
        ${quizRows.length ? `<div class="history">${quizRows.map((a) => `<div class="history-row"><span class="small"><b>${a.scope === 'overall' ? 'Big Quiz' : `Unit ${a.scope.slice(1)}`}</b><br><span class="muted">${fmtDate(a.created_at)}</span></span><div class="bar"><span style="width:${Math.round((100 * a.score) / a.total)}%"></span></div><b>${a.score}/${a.total}</b></div>`).join('')}</div>` : '<p class="muted">No quizzes taken yet.</p>'}
      </div>
      ${S.config.features && S.config.features.resetByEmail
        ? `<div class="card"><h2 class="row">${icon('key-round')} Password help</h2><p class="small muted">If ${esc(s.name.split(' ')[0])} forgets their password, send them an email with a link to choose a new one. They can also do this themselves from the sign-in page.</p>
        <button class="btn secondary" id="resetPw">${icon('mail')}Send a password reset email</button><div id="pwOut" style="margin-top:.7rem"></div></div>`
        : `<div class="card"><h2 class="row">${icon('key-round')} Password help</h2><p class="small muted">If ${esc(s.name.split(' ')[0])} forgets their password, create a temporary one here and share it privately. They can change it in Account.</p>
        <button class="btn secondary" id="resetPw">${icon('refresh-cw')}Create a temporary password</button><div id="pwOut" style="margin-top:.7rem"></div></div>`}`;
    $('#resetPw').addEventListener('click', async () => {
      const byEmail = S.config.features && S.config.features.resetByEmail;
      if (!confirm(byEmail ? `Send a password reset email to ${s.email}?` : `Create a new temporary password for ${s.name}? Their old password will stop working.`)) return;
      try {
        if (byEmail) {
          const r = await api(`/api/teacher/students/${encodeURIComponent(s.id)}/reset-email`, { method: 'POST' });
          $('#pwOut').innerHTML = `<div class="notice ok">${icon('mail')}<span>Password reset email sent to <b>${esc(r.email)}</b>.</span></div>`;
        } else {
          const r = await api(`/api/teacher/students/${s.id}/reset-password`, { method: 'POST' });
          $('#pwOut').innerHTML = `<div class="notice ok">${icon('key-round')}<span>Temporary password: <b>${esc(r.temporaryPassword)}</b></span></div>`;
        }
      } catch (e) { toast(e.message); }
    });
  }

  function notFound() {
    shell({ active: '', back: '#/', body: `<div class="card empty"><h1>Page not found</h1><p>That page does not exist.</p><a class="btn" href="#/">${icon('house')}Go home</a></div>` });
  }

  // ---------- router ----------
  async function route() {
    if (activeGame) { activeGame.destroy(); activeGame = null; }
    const hash = location.hash.replace(/^#/, '') || '/';
    const parts = hash.split('/').filter(Boolean);
    if (!S.user) {
      if (parts[0] === 'signup') return authView('signup');
      if (parts[0] === 'forgot') return forgotView();
      return authView('signin');
    }
    if (!S.content) await loadAll();
    window.scrollTo(0, 0);
    switch (parts[0]) {
      case undefined: return homeView();
      case 'signin': case 'signup': case 'forgot': location.replace('#/'); return homeView();
      case 'unit': return unitView(parts[1], parts[2]);
      case 'quiz': return bigQuizView();
      case 'progress': return progressView();
      case 'account': return accountView();
      case 'teacher': return parts[1] === 'student' ? studentView(parts[2]) : teacherView();
      default: return notFound();
    }
  }

  // The "Skip to content" link must not change the hash (the hash is the page address in this app).
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.skip');
    if (!a) return;
    e.preventDefault();
    const m = $('#main') || $('main');
    if (m) m.focus();
  });

  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

  async function boot() {
    try {
      S.config = await api('/api/config');
      S.user = (await api('/api/session')).user;
      window.addEventListener('hashchange', route);
      await route();
    } catch (e) {
      app.innerHTML = `<div class="boot"><p>Sorry, the guide could not load. Please check your internet connection and try again.</p><button class="btn" id="reloadBtn">Try again</button></div>`;
      $('#reloadBtn').addEventListener('click', () => location.reload());
    }
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  boot();
})();
