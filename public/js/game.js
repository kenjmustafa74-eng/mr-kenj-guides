/* Word Catching Basket – canvas game. Neutral woven basket, plain word tiles. */
(() => {
  'use strict';
  const CATCH_TO_LEVEL = 6;
  const LIVES = 3;

  function create({ stage, canvas, rounds, colour, onHud, onOver }) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    let running = false, paused = false, raf = 0, last = 0;
    let state;
    const keys = { left: false, right: false };
    const pressDir = { '-1': false, 1: false };

    function resize() {
      const r = stage.getBoundingClientRect();
      W = r.width;
      H = Math.round(Math.min(Math.max(window.innerHeight * 0.58, 360), 560));
      stage.style.height = H + 'px';
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (state) state.basket.y = H - 46;
      draw();
    }

    function reset() {
      state = {
        score: 0, level: 1, lives: LIVES, caughtThisLevel: 0, caught: 0,
        words: [], spawnIn: 0.4, flash: 0, flashColour: null, banner: null,
        basket: { x: W / 2, y: H - 46, w: Math.min(120, W * 0.3), h: 44 },
        missedCorrect: [], wrongCaught: [], recent: [],
      };
    }
    const round = () => rounds[(state.level - 1) % rounds.length];
    const speed = () => 55 + state.level * 16; // px per second
    const interval = () => Math.max(0.75, 1.65 - state.level * 0.12);
    const hud = () => onHud && onHud({ score: state.score, level: state.level, lives: state.lives, prompt: round().prompt });

    function spawn() {
      const r = round();
      const wantCorrect = Math.random() < 0.55;
      const pool = (wantCorrect ? r.correct : r.wrong).filter((w) => !state.recent.includes(w));
      const list = pool.length ? pool : (wantCorrect ? r.correct : r.wrong);
      const text = list[Math.floor(Math.random() * list.length)];
      state.recent.push(text); if (state.recent.length > 4) state.recent.shift();
      ctx.font = '600 16px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
      const w = Math.min(ctx.measureText(text).width + 24, W - 16);
      const x = 8 + Math.random() * (W - 16 - w);
      // avoid stacking directly on top of a word that has only just appeared
      if (state.words.some((o) => o.y < 50 && Math.abs(o.x - x) < w)) { state.spawnIn = 0.15; return; }
      state.words.push({ text, correct: r.correct.includes(text), x, y: -30, w, h: 32, vy: speed() * (0.85 + Math.random() * 0.3) });
    }

    function levelUp() {
      state.level++;
      state.caughtThisLevel = 0;
      state.words = [];
      state.banner = { text: `Level ${state.level}`, sub: round().prompt, t: 2.2 };
      state.spawnIn = 1.6;
      hud();
    }

    function update(dt) {
      const b = state.basket;
      const move = 520 * dt;
      if (keys.left || pressDir['-1']) b.x -= move;
      if (keys.right || pressDir[1]) b.x += move;
      b.x = Math.max(b.w / 2 + 4, Math.min(W - b.w / 2 - 4, b.x));
      if (state.banner) { state.banner.t -= dt; if (state.banner.t <= 0) state.banner = null; }
      state.spawnIn -= dt;
      if (state.spawnIn <= 0) { spawn(); state.spawnIn = interval(); }
      state.flash = Math.max(0, state.flash - dt);
      const top = b.y - b.h / 2;
      for (const w of state.words) {
        w.y += w.vy * dt;
        const cx = w.x + w.w / 2;
        if (!w.done && w.y + w.h >= top && w.y + w.h <= top + 26 && cx > b.x - b.w / 2 - 6 && cx < b.x + b.w / 2 + 6) {
          w.done = true;
          if (w.correct) {
            state.score += 10 * state.level; state.caught++; state.caughtThisLevel++;
            state.flash = 0.25; state.flashColour = 'rgba(46,125,79,0.18)';
            if (state.caughtThisLevel >= CATCH_TO_LEVEL) { levelUp(); return; }
          } else {
            state.lives--; state.wrongCaught.push(w.text);
            state.flash = 0.35; state.flashColour = 'rgba(178,59,59,0.22)';
            if (state.lives <= 0) { hud(); return gameOver(); }
          }
          hud();
        } else if (!w.done && w.y > H) {
          w.done = true;
          if (w.correct && !state.missedCorrect.includes(w.text)) state.missedCorrect.push(w.text);
        }
      }
      state.words = state.words.filter((w) => !w.done);
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }

    function drawBasket(b) {
      const x = b.x - b.w / 2, y = b.y - b.h / 2, w = b.w, h = b.h;
      // handle
      ctx.strokeStyle = '#8a6a43'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(b.x, y + 4, w * 0.36, h * 0.75, 0, Math.PI, 2 * Math.PI); ctx.stroke();
      // body (slightly tapered)
      ctx.fillStyle = '#c9a36b';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - 10, y + h); ctx.lineTo(x + 10, y + h); ctx.closePath(); ctx.fill();
      // weave
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(110,80,45,0.55)'; ctx.lineWidth = 2;
      for (let yy = y + 9; yy < y + h; yy += 9) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
      for (let xx = x + 8, k = 0; xx < x + w; xx += 12, k++) { ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx + (k % 2 ? 3 : -3), y + h); ctx.stroke(); }
      ctx.restore();
      // rim
      ctx.fillStyle = '#8a6a43'; roundRect(x - 4, y - 5, w + 8, 9, 4); ctx.fill();
    }

    function draw() {
      if (!W) return;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#eef3f4'; ctx.fillRect(0, 0, W, H);
      // ground
      ctx.fillStyle = '#e3dccf'; ctx.fillRect(0, H - 18, W, 18);
      if (!state) return;
      if (state.flash > 0) { ctx.fillStyle = state.flashColour; ctx.fillRect(0, 0, W, H); }
      ctx.font = '600 16px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      for (const w of state.words) {
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = colour || '#1f4e5f'; ctx.lineWidth = 2;
        roundRect(w.x, w.y, w.w, w.h, 10); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1d2427'; ctx.fillText(w.text, w.x + w.w / 2, w.y + w.h / 2 + 1, w.w - 12);
      }
      drawBasket(state.basket);
      // level progress
      ctx.fillStyle = 'rgba(31,78,95,0.15)'; roundRect(10, 10, W - 20, 6, 3); ctx.fill();
      ctx.fillStyle = colour || '#1f4e5f'; roundRect(10, 10, ((W - 20) * state.caughtThisLevel) / CATCH_TO_LEVEL, 6, 3); ctx.fill();
      if (state.banner) {
        ctx.fillStyle = 'rgba(31,78,95,0.92)'; roundRect(W / 2 - 150, H / 2 - 48, 300, 96, 14); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '800 26px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
        ctx.fillText(state.banner.text, W / 2, H / 2 - 14);
        ctx.font = '500 14px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
        ctx.fillText(state.banner.sub, W / 2, H / 2 + 18, 280);
      }
      if (paused) {
        ctx.fillStyle = 'rgba(247,244,238,0.85)'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#1d2427'; ctx.font = '800 24px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
        ctx.fillText('Paused', W / 2, H / 2);
      }
    }

    function loop(t) {
      if (!running) return;
      const dt = Math.min(0.05, (t - last) / 1000 || 0);
      last = t;
      if (!paused) update(dt);
      draw();
      if (running) raf = requestAnimationFrame(loop);
    }

    function gameOver() {
      running = false;
      cancelAnimationFrame(raf);
      draw();
      onOver && onOver({ score: state.score, level: state.level, caught: state.caught, missedCorrect: state.missedCorrect, wrongCaught: state.wrongCaught });
    }

    // input
    function pointer(e) {
      if (!running || paused) return;
      const r = canvas.getBoundingClientRect();
      state.basket.x = e.clientX - r.left;
    }
    const onDown = (e) => { if (running) { e.preventDefault(); canvas.setPointerCapture?.(e.pointerId); pointer(e); } };
    const onMove = (e) => { if (running && (e.buttons || e.pointerType === 'touch' || e.pointerType === 'pen')) pointer(e); };
    const onKey = (e, down) => {
      if (!running) return;
      if (['ArrowLeft', 'a', 'A'].includes(e.key)) { keys.left = down; e.preventDefault(); }
      if (['ArrowRight', 'd', 'D'].includes(e.key)) { keys.right = down; e.preventDefault(); }
      if (down && (e.key === 'p' || e.key === 'P' || e.key === 'Escape')) api.togglePause();
    };
    const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
    const vis = () => { if (document.hidden && running && !paused) api.togglePause(); };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', vis);
    resize();

    const api = {
      start() {
        resize(); reset(); hud(); paused = false; running = true;
        state.banner = { text: 'Level 1', sub: round().prompt, t: 1.8 }; state.spawnIn = 1.2;
        last = performance.now(); raf = requestAnimationFrame(loop);
      },
      press(dir, on) { pressDir[dir] = on; },
      togglePause() { if (!running) return paused; paused = !paused; last = performance.now(); draw(); return paused; },
      destroy() {
        running = false; cancelAnimationFrame(raf);
        canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
        window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
        window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', vis);
      },
      _state: () => state,
      _finish: () => { if (running) gameOver(); },
    };
    window.BasketGame._current = api;
    return api;
  }

  window.BasketGame = { create };
})();
