/* Shared progress maths, used by both the browser and the server (teacher dashboard). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProgressCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const WEIGHTS = { activities: 0.5, quiz: 0.2, cards: 0.15, summary: 0.1, game: 0.05 };

  function bestPercent(attempts) {
    if (!attempts || !attempts.length) return null;
    return Math.max(...attempts.map((a) => Math.round((100 * a.score) / a.total)));
  }

  function summaryWritten(sm) {
    return !!(sm && sm.main_idea && sm.main_idea.trim().length >= 10 && sm.learnt && sm.learnt.trim().length >= 10);
  }

  // state: { progress:Set|Array, quiz:[attempts], cards:{id:status}, games:[...], summaries:[...] }
  function unitProgress(unit, state) {
    const done = state.progress instanceof Set ? state.progress : new Set(state.progress || []);
    const items = [...unit.sb, ...unit.wb];
    const ticked = items.filter((i) => done.has(i.id)).length;
    const attempts = (state.quiz || []).filter((a) => a.scope === `u${unit.id}`);
    const best = bestPercent(attempts);
    const known = unit.cards.filter((c) => (state.cards || {})[c.id] === 'known').length;
    const sm = (state.summaries || []).find((x) => x.unit_id === unit.id);
    const game = (state.games || []).find((g) => g.unit_id === unit.id);
    const parts = {
      activities: items.length ? ticked / items.length : 0,
      quiz: best == null ? 0 : best / 100,
      cards: unit.cards.length ? known / unit.cards.length : 0,
      summary: summaryWritten(sm) ? 1 : 0,
      game: game && game.plays > 0 ? 1 : 0,
    };
    const pct = Math.round(100 * Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * parts[k], 0));
    return {
      pct, ticked, totalItems: items.length, bestQuiz: best, quizAttempts: attempts.length,
      cardsKnown: known, cardsTotal: unit.cards.length, summary: summaryWritten(sm),
      gameBest: game ? game.best_score : null, gamePlays: game ? game.plays : 0,
    };
  }

  function overallProgress(units, state) {
    if (!units.length) return 0;
    return Math.round(units.reduce((s, u) => s + unitProgress(u, state).pct, 0) / units.length);
  }

  // days: sorted array of 'YYYY-MM-DD'; today: 'YYYY-MM-DD' in the school's time zone.
  function streak(days, today) {
    const set = new Set(days || []);
    const dayMs = 86400000;
    const toDate = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
    const fmt = (t) => new Date(t).toISOString().slice(0, 10);
    let t = toDate(today);
    if (!set.has(today)) t -= dayMs; // a streak stays alive until the end of today
    let current = 0;
    while (set.has(fmt(t))) { current++; t -= dayMs; }
    let best = 0, run = 0, prev = null;
    for (const d of [...set].sort()) {
      const v = toDate(d);
      run = prev !== null && v - prev === dayMs ? run + 1 : 1;
      best = Math.max(best, run);
      prev = v;
    }
    return { current, best, studiedToday: set.has(today), totalDays: set.size };
  }

  return { WEIGHTS, unitProgress, overallProgress, streak, bestPercent, summaryWritten };
});
