const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','teacher')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active TEXT
);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS quiz_user ON quiz_attempts(user_id, scope);
CREATE TABLE IF NOT EXISTS card_status (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('known','learning')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, card_id)
);
CREATE TABLE IF NOT EXISTS game_scores (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL,
  best_score INTEGER NOT NULL DEFAULT 0,
  best_level INTEGER NOT NULL DEFAULT 1,
  plays INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, unit_id)
);
CREATE TABLE IF NOT EXISTS summaries (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL,
  main_idea TEXT NOT NULL DEFAULT '',
  learnt TEXT NOT NULL DEFAULT '',
  favourite TEXT NOT NULL DEFAULT '',
  wonder TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, unit_id)
);
CREATE TABLE IF NOT EXISTS grammar_scores (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  best INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, topic_id)
);
CREATE TABLE IF NOT EXISTS unlocks (
  unit_id INTEGER NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('sb','wb')),
  unlocked_by INTEGER,
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (unit_id, section)
);
CREATE TABLE IF NOT EXISTS activity_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);
`;

function create({ dir, name }) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, `${name}.sqlite`));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const q = (sql) => db.prepare(sql);
  const s = {
    insertUser: q('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)'),
    userByEmail: q('SELECT * FROM users WHERE email = ?'),
    userById: q('SELECT * FROM users WHERE id = ?'),
    students: q("SELECT id, email, name, created_at, last_active FROM users WHERE role = 'student' ORDER BY name COLLATE NOCASE"),
    updatePassword: q('UPDATE users SET password_hash = ? WHERE id = ?'),
    deleteUser: q("DELETE FROM users WHERE id = ? AND role = 'student'"),
    touchUser: q("UPDATE users SET last_active = datetime('now') WHERE id = ?"),
    setProgress: q(`INSERT INTO progress (user_id, item_id, done) VALUES (?, ?, ?)
      ON CONFLICT(user_id, item_id) DO UPDATE SET done = excluded.done, updated_at = datetime('now')`),
    getProgress: q('SELECT item_id FROM progress WHERE user_id = ? AND done = 1'),
    addQuiz: q('INSERT INTO quiz_attempts (user_id, scope, score, total, details) VALUES (?, ?, ?, ?, ?)'),
    getQuiz: q('SELECT id, scope, score, total, created_at FROM quiz_attempts WHERE user_id = ? ORDER BY id'),
    setCard: q(`INSERT INTO card_status (user_id, card_id, status) VALUES (?, ?, ?)
      ON CONFLICT(user_id, card_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`),
    getCards: q('SELECT card_id, status FROM card_status WHERE user_id = ?'),
    getGame: q('SELECT * FROM game_scores WHERE user_id = ? AND unit_id = ?'),
    upsertGame: q(`INSERT INTO game_scores (user_id, unit_id, best_score, best_level, plays) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(user_id, unit_id) DO UPDATE SET best_score = MAX(best_score, excluded.best_score),
        best_level = MAX(best_level, excluded.best_level), plays = plays + 1, updated_at = datetime('now')`),
    getGames: q('SELECT unit_id, best_score, best_level, plays, updated_at FROM game_scores WHERE user_id = ?'),
    saveSummary: q(`INSERT INTO summaries (user_id, unit_id, main_idea, learnt, favourite, wonder) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, unit_id) DO UPDATE SET main_idea = excluded.main_idea, learnt = excluded.learnt,
        favourite = excluded.favourite, wonder = excluded.wonder, updated_at = datetime('now')`),
    getSummaries: q('SELECT unit_id, main_idea, learnt, favourite, wonder, updated_at FROM summaries WHERE user_id = ?'),
    getGrammarOne: q('SELECT best, total, attempts FROM grammar_scores WHERE user_id = ? AND topic_id = ?'),
    putGrammar: q(`INSERT INTO grammar_scores (user_id, topic_id, best, total, attempts) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, topic_id) DO UPDATE SET best = excluded.best, total = excluded.total, attempts = excluded.attempts, updated_at = datetime('now')`),
    getGrammar: q('SELECT topic_id, best, total, attempts, updated_at FROM grammar_scores WHERE user_id = ?'),
    unlock: q('INSERT OR REPLACE INTO unlocks (unit_id, section, unlocked_by) VALUES (?, ?, ?)'),
    lock: q('DELETE FROM unlocks WHERE unit_id = ? AND section = ?'),
    getUnlocks: q('SELECT unit_id, section, unlocked_at FROM unlocks ORDER BY unit_id, section'),
    touchDay: q('INSERT OR IGNORE INTO activity_days (user_id, day) VALUES (?, ?)'),
    getDays: q('SELECT day FROM activity_days WHERE user_id = ? ORDER BY day'),
  };

  return {
    kind: 'sqlite',
    close: () => db.close(),
    createUser({ email, name, passwordHash, role }) {
      const info = s.insertUser.run(email.toLowerCase(), name, passwordHash, role);
      return s.userById.get(info.lastInsertRowid);
    },
    getUserByEmail: (email) => s.userByEmail.get(String(email).toLowerCase()),
    getUserById: (id) => s.userById.get(id),
    listStudents: () => s.students.all(),
    updatePassword: (id, hash) => s.updatePassword.run(hash, id),
    touchUser: (id) => s.touchUser.run(id),
    deleteStudent: (id) => s.deleteUser.run(id).changes > 0,
    setProgress: (userId, itemId, done) => s.setProgress.run(userId, itemId, done ? 1 : 0),
    getProgress: (userId) => s.getProgress.all(userId).map((r) => r.item_id),
    addQuizAttempt: (userId, scope, score, total, details) => s.addQuiz.run(userId, scope, score, total, JSON.stringify(details || null)),
    getQuizAttempts: (userId) => s.getQuiz.all(userId),
    setCardStatus: (userId, cardId, status) => s.setCard.run(userId, cardId, status),
    getCardStatuses: (userId) => Object.fromEntries(s.getCards.all(userId).map((r) => [r.card_id, r.status])),
    recordGame(userId, unitId, score, level) {
      const before = s.getGame.get(userId, unitId);
      s.upsertGame.run(userId, unitId, score, level);
      const after = s.getGame.get(userId, unitId);
      return { ...after, newBest: score > 0 && (!before || score > before.best_score) };
    },
    getGames: (userId) => s.getGames.all(userId),
    saveSummary: (userId, unitId, f) => s.saveSummary.run(userId, unitId, f.mainIdea || '', f.learnt || '', f.favourite || '', f.wonder || ''),
    getSummaries: (userId) => s.getSummaries.all(userId),
    // Keeps the best result (as a fraction of the questions) for each grammar topic.
    recordGrammar(userId, topicId, score, total) {
      const before = s.getGrammarOne.get(userId, topicId);
      const better = !before || score / total >= before.best / before.total;
      const best = better ? score : before.best, tot = better ? total : before.total;
      s.putGrammar.run(userId, topicId, best, tot, (before ? before.attempts : 0) + 1);
      return { best, total: tot };
    },
    getGrammar: (userId) => Object.fromEntries(s.getGrammar.all(userId).map((r) => [r.topic_id, { best: r.best, total: r.total, attempts: r.attempts, updated_at: r.updated_at }])),
    setUnlock: (unitId, section, unlocked, by) => (unlocked ? s.unlock.run(unitId, section, by) : s.lock.run(unitId, section)),
    getUnlocks: () => s.getUnlocks.all(),
    touchActivityDay: (userId, day) => s.touchDay.run(userId, day),
    getActivityDays: (userId) => s.getDays.all(userId).map((r) => r.day),
  };
}

module.exports = { create };
