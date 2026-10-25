const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');

const COOKIE = 'kenj_session';
const MAX_AGE_DAYS = 30;

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, 'jwt-secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
const SECRET = loadSecret();

function issue(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, SECRET, { expiresIn: `${MAX_AGE_DAYS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: MAX_AGE_DAYS * 86400000, path: '/',
  });
  return token;
}

function clear(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

// Reads the session from the httpOnly cookie, or from an "Authorization: Bearer" header
// (useful for a future native wrapper that talks to a remote server).
function readToken(req) {
  const h = req.get('authorization');
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return req.cookies && req.cookies[COOKIE];
}

function requireAuth(repo) {
  return async (req, res, next) => {
    try {
      const token = readToken(req);
      if (!token) return res.status(401).json({ error: 'Please sign in.' });
      const payload = jwt.verify(token, SECRET);
      const user = await repo.getUserById(payload.sub);
      if (!user) return res.status(401).json({ error: 'Please sign in.' });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    }
  };
}

function requireTeacher(req, res, next) {
  if (req.user?.role !== 'teacher') return res.status(403).json({ error: 'Only the teacher can do that.' });
  next();
}

module.exports = { issue, clear, requireAuth, requireTeacher };
