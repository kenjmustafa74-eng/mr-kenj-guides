#!/usr/bin/env bash
# Full Firebase test run on local emulators (nothing touches the real project):
#   security-rules tests, then an emulator build of the site, seeding, and the browser end-to-end test.
# Needs Java 11+ and the Firebase CLI (npm i -g firebase-tools). Usage: npm run test:firebase
set -euo pipefail
cd "$(dirname "$0")/../.."
firebase emulators:exec --only auth,firestore --project demo-kenj-guides '
  set -e
  node tools/firebase/rules.test.js
  node tools/build-static.js --emulators --out /tmp/kenj-dist-test
  node tools/serve-static.js 5059 /tmp/kenj-dist-test & SERVER=$!
  trap "kill $SERVER" EXIT
  node tools/firebase/seed.js --app year5 --teacher-email teacher@example.com --class-code TEST5 --out /tmp/kenj-emu-test-teacher.txt
  BASE=http://localhost:5059/mr-kenj-guides/year-five TEACHER_FILE=/tmp/kenj-emu-test-teacher.txt node tools/firebase/e2e.test.js
'
