#!/usr/bin/env node
/* Serves dist/ under /mr-kenj-guides/ – the same address shape as GitHub Pages – for local testing.
 * Usage: node tools/serve-static.js [port] [dist] */
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = Number(process.argv[2] || 5050);
const DIR = path.resolve(process.argv[3] || path.join(__dirname, '..', 'dist'));
const BASE = '/mr-kenj-guides/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(302, { Location: BASE }); return res.end(); }
  if (!url.startsWith(BASE)) { res.writeHead(404); return res.end('Not found'); }
  let file = path.join(DIR, url.slice(BASE.length));
  if (!file.startsWith(DIR)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.endsWith('/')) { res.writeHead(301, { Location: url + '/' }); return res.end(); }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Static site at http://localhost:${PORT}${BASE}`));
