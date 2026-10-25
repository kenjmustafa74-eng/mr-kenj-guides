#!/usr/bin/env node
// Builds the study content for every year that has a config (config/apps/<id>.json) and sources (content-src/<id>/).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const ids = fs.readdirSync(path.join(ROOT, 'config', 'apps')).filter((f) => /^[a-z0-9]+\.json$/.test(f)).map((f) => f.replace('.json', ''))
  .filter((id) => fs.existsSync(path.join(ROOT, 'content-src', id)));
for (const id of ids) execFileSync(process.execPath, [path.join(__dirname, 'build-content.js'), id], { stdio: 'inherit' });
