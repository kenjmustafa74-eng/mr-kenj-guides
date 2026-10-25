// Loads the app config (name, books, theme, content files) for the selected year.
// Choose the app with APP=year5 (default) or APP=year6. Everything year-specific lives in config + content files.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = process.env.APP || 'year5';
const file = [path.join(ROOT, 'config', 'apps', `${APP}.json`), path.join(ROOT, 'config', 'apps', `${APP}.sample.json`)].find((f) => fs.existsSync(f));
if (!file) throw new Error(`No config found for APP=${APP} in config/apps/`);
const app = JSON.parse(fs.readFileSync(file, 'utf8'));

module.exports = {
  ROOT,
  app,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  dataBackend: process.env.DATA_BACKEND || 'sqlite',
  classCode: process.env.CLASS_CODE || '',
  production: process.env.NODE_ENV === 'production',
  contentPath: path.join(ROOT, app.contentFile),
  answersPath: path.join(ROOT, app.answersFile),
};
