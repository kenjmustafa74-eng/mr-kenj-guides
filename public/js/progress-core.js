/* Shared progress maths, used by both the browser and the server (teacher dashboard). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProgressCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const WEIGHTS = { activities: 0.45, quiz: 0.15, grammar: 0.15, cards: 0.1, summary: 0.1, game: 0.05 };

  function bestPercent(attempts) {
    if (!attempts || !attempts.length) return null;
    return Math.max(...attempts.map((a) => Math.round((100 * a.score) / a.total)));
  }

  function summaryWritten(sm) {
    return !!(sm && sm.main_idea && sm.main_idea.trim().length >= 10 && sm.learnt && sm.learnt.trim().length >= 10);
  }

  // Best score on one grammar topic's practice, as a fraction (0 when not tried yet).
  function grammarBest(g) { return g && g.total ? g.best / g.total : 0; }

  // state: { progress:Set|Array, quiz:[attempts], cards:{id:status}, games:[...], summaries:[...], grammar:{topicId:{best,total}} }
  function unitProgress(unit, state) {
    const done = state.progress instanceof Set ? state.progress : new Set(state.progress || []);
    const items = [...unit.sb, ...unit.wb];
    const ticked = items.filter((i) => done.has(i.id)).length;
    const attempts = (state.quiz || []).filter((a) => a.scope === `u${unit.id}`);
    const best = bestPercent(attempts);
    const known = unit.cards.filter((c) => (state.cards || {})[c.id] === 'known').length;
    const sm = (state.summaries || []).find((x) => x.unit_id === unit.id);
    const game = (state.games || []).find((g) => g.unit_id === unit.id);
    const topics = unit.grammar || [];
    const gs = state.grammar || {};
    const grammarTried = topics.filter((t) => gs[t.id]).length;
    const grammarMastered = topics.filter((t) => grammarBest(gs[t.id]) >= 0.75).length;
    const grammarScore = topics.length ? topics.reduce((a, t) => a + grammarBest(gs[t.id]), 0) / topics.length : 0;
    const parts = {
      activities: items.length ? ticked / items.length : 0,
      quiz: best == null ? 0 : best / 100,
      grammar: grammarScore,
      cards: unit.cards.length ? known / unit.cards.length : 0,
      summary: summaryWritten(sm) ? 1 : 0,
      game: game && game.plays > 0 ? 1 : 0,
    };
    // A unit without grammar topics shares the grammar weight out over the other parts.
    const weights = Object.entries(WEIGHTS).filter(([k]) => k !== 'grammar' || topics.length);
    const sumW = weights.reduce((s, [, w]) => s + w, 0);
    const pct = Math.round((100 * weights.reduce((s, [k, w]) => s + w * parts[k], 0)) / sumW);
    return {
      pct, ticked, totalItems: items.length, bestQuiz: best, quizAttempts: attempts.length,
      cardsKnown: known, cardsTotal: unit.cards.length, summary: summaryWritten(sm),
      gameBest: game ? game.best_score : null, gamePlays: game ? game.plays : 0,
      grammarTotal: topics.length, grammarTried, grammarMastered, grammarPct: Math.round(100 * grammarScore),
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

  return { WEIGHTS, unitProgress, overallProgress, streak, bestPercent, summaryWritten, grammarBest };
});
