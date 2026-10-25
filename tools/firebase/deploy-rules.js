#!/usr/bin/env node
/*
 * Publishes firestore.rules to the real project with the service-account key, using the Firebase Rules API.
 * (firebase-tools needs extra Service Usage permission that the Admin SDK key does not have.)
 * Usage: node tools/firebase/deploy-rules.js [private/service-accounts/mr-kenj-guide.json]
 */
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const ROOT = path.join(__dirname, '..', '..');
const keyFile = path.resolve(process.argv[2] || path.join(ROOT, 'private', 'service-accounts', 'mr-kenj-guide.json'));
(async () => {
  const projectId = JSON.parse(fs.readFileSync(keyFile, 'utf8')).project_id;
  const c = await new GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const P = `projects/${projectId}`;
  const content = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  const rs = (await c.request({ method: 'POST', url: `https://firebaserules.googleapis.com/v1/${P}/rulesets`, data: { source: { files: [{ name: 'firestore.rules', content }] } } })).data;
  await c.request({ method: 'PATCH', url: `https://firebaserules.googleapis.com/v1/${P}/releases/cloud.firestore`, data: { release: { name: `${P}/releases/cloud.firestore`, rulesetName: rs.name } } });
  const live = (await c.request({ url: `https://firebaserules.googleapis.com/v1/${P}/releases/cloud.firestore` })).data;
  const src = (await c.request({ url: `https://firebaserules.googleapis.com/v1/${live.rulesetName}` })).data.source.files[0].content;
  if (src !== content) throw new Error('the live rules do not match firestore.rules');
  console.log(`Firestore rules published to ${projectId} (${live.rulesetName.split('/').pop()}) and verified.`);
})().catch((e) => { console.error('Publishing rules failed:', (e.response && JSON.stringify(e.response.data)) || e.message); process.exit(1); });
