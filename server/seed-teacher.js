// Creates (or resets) the single teacher account and writes the generated password to a private file.
// Usage: node server/seed-teacher.js [--email teacher@example.com] [--name "Mr Kenj"] [--out TEACHER_PASSWORD.txt]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { createRepo } = require('./db');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const email = arg('email', process.env.TEACHER_EMAIL || 'mr.kenj@kenj-guides.local').toLowerCase();
const name = arg('name', config.app.teacherName || 'Teacher');
const out = path.resolve(arg('out', path.join(config.ROOT, `TEACHER_PASSWORD.${config.app.id}.txt`)));

(async () => {
  const repo = createRepo();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const password = Array.from({ length: 16 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  const hash = await bcrypt.hash(password, 12);
  const existing = await repo.getUserByEmail(email);
  if (existing) {
    if (existing.role !== 'teacher') throw new Error(`${email} belongs to a student account.`);
    await repo.updatePassword(existing.id, hash);
  } else {
    await repo.createUser({ email, name, passwordHash: hash, role: 'teacher' });
  }
  fs.writeFileSync(out, `${config.app.appName} – teacher sign-in\nEmail: ${email}\nPassword: ${password}\n\nKeep this file private. Change the password after signing in (Teacher dashboard > Account), or run this script again to generate a new one.\n`, { mode: 0o600 });
  fs.chmodSync(out, 0o600);
  repo.close?.();
  console.log(`Teacher account ${existing ? 'reset' : 'created'} for ${email}. Password written to ${out}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
