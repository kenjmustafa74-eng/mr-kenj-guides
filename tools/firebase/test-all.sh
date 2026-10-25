#!/usr/bin/env bash
# Full Firebase test run on local emulators (nothing touches the real project):
#   security-rules tests, then an emulator build of the site, seeding both years, the browser end-to-end test for
#   each year, and the cross-year test (shared login, separate class codes, records and answer keys).
# Needs Java 11+ and the Firebase CLI (npm i -g firebase-tools). Usage: npm run test:firebase
set -euo pipefail
cd "$(dirname "$0")/../.."
firebase emulators:exec --only auth,firestore --project demo-kenj-guides '
  set -e
  node tools/firebase/rules.test.js
  node tools/build-static.js --emulators --out /tmp/kenj-dist-test
  node tools/serve-static.js 5059 /tmp/kenj-dist-test & SERVER=$!
  trap "kill $SERVER" EXIT
  rm -f /tmp/kenj-emu-test-teacher5.txt /tmp/kenj-emu-test-teacher6.txt
  node tools/firebase/seed.js --app year5 --teacher-email teacher@example.com --class-code TEST5 --out /tmp/kenj-emu-test-teacher5.txt
  node tools/firebase/seed.js --app year6 --teacher-email teacher@example.com --class-code TEST6 --out /tmp/kenj-emu-test-teacher6.txt --password-from /tmp/kenj-emu-test-teacher5.txt
  echo "== Year 5 end-to-end"
  APP=year5 BASE=http://localhost:5059/mr-kenj-guides/year-five TEACHER_FILE=/tmp/kenj-emu-test-teacher5.txt node tools/firebase/e2e.test.js
  echo "== Year 6 end-to-end"
  APP=year6 BASE=http://localhost:5059/mr-kenj-guides/year-six TEACHER_FILE=/tmp/kenj-emu-test-teacher6.txt node tools/firebase/e2e.test.js
  echo "== Cross-year"
  BASE5=http://localhost:5059/mr-kenj-guides/year-five BASE6=http://localhost:5059/mr-kenj-guides/year-six TEACHER_FILE5=/tmp/kenj-emu-test-teacher5.txt TEACHER_FILE6=/tmp/kenj-emu-test-teacher6.txt node tools/firebase/cross-year.test.js
'
