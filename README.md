# Mr. Kenj's Guides (Year Five, and Year Six to come)

A mobile-first study companion (Progressive Web App) for Year 5 students at Brighton International Academy,
following Cambridge Primary English Stage 5 (Marshall Cavendish Student Book 5 and Workbook 5).
The same code makes **Mr. Kenj's Guide to Year Six**: only a config file and the content files change.

There are two ways to run it, sharing one front end (`public/`):

| | **Static site + Firebase** (main way to publish) | **Node server** (fallback) |
|---|---|---|
| Hosting | GitHub Pages (free), built by GitHub Actions | any Node host with a disk |
| Accounts | Firebase Authentication (email + password, reset by email) | bcrypt + JWT cookie |
| Data | Cloud Firestore, protected by `firestore.rules` | SQLite (`data/<year>.sqlite`) |
| Answer keys | Firestore `years/<year>/answers/*`, readable only once unlocked | served by the server once unlocked |

The front end talks to its data through one function, `api()`. On the Node server that is an HTTP call; in the static
build `src/firebase-backend.js` answers the same routes with Firebase, so every screen works the same in both.
The Node version is also kept on its own git branch, `node-server`.

## What students get
- Sign up / sign in with email and password (and a class code from the teacher). Forgotten password: reset link by email.
- Home: the 9 units as cards with progress, a study streak and **The Big Quiz** (20 random questions from all units, with score history).
- Each unit has tabs: **Overview** (objectives, text summaries, key vocabulary, links to the books on MC EduHub),
  **Student Book** and **Workbook** guides (study tips and page references for every lesson and activity, tick-off boxes),
  **Practice** quiz with instant feedback and score history, **Memory cards** (flip, shuffle, "I know it / still learning"),
  **Word Catching Basket** game (drag on touch screens, arrow keys on computers; score, lives, levels, best score saved),
  **My Summary** (guided prompts, saved to the account and visible to the teacher) and **Answers** (locked until the teacher unlocks them).
- Progress per unit = activities ticked 50% + best practice quiz 20% + memory cards known 15% + My Summary 10% + basket game played 5%.
- Account page: change password, delete account (removes all their data), install the app.

## What the teacher gets
- One teacher account (made by a script, never by signing up).
- Dashboard: lock or unlock the answer keys for each unit, separately for the Student Book and Workbook.
- Every student's progress, streak, Big Quiz best, summaries and last activity; a page per student with unit-by-unit
  progress, quiz history and their My Summary text; password help (reset email, or a temporary password on the Node server).

## Private files – never committed
Everything in `private/` stays on the teacher's computer (see `.gitignore`):
`private/tools/` (answer-key builder with the corrections), `private/<year>/answers-raw/` (publisher's Suggested Answers text),
`private/<year>/answers.json` (the corrected keys), `private/<year>/ANSWER-FIXES.md` (every correction made),
`private/service-accounts/` (Firebase Admin key) and `private/credentials/` (teacher password, class code).
The build fails if any answer-key text or private file ever ends up in the website, and `tools/build-content.js`
fails if answer-key text appears in the public study content.

## Publish: static site on GitHub Pages + Firebase
One repository holds both years; GitHub Pages serves them side by side:
`https://<github-user>.github.io/<repo>/year-five/` and later `…/year-six/` (plus a small page at `…/<repo>/` linking both).

**Once, in the Firebase console (project `mr-kenj-guide`):**
1. *Build › Authentication › Sign-in method*: enable **Email/Password** (leave "Email link" off).
2. *Authentication › Settings › Authorised domains*: add `<github-user>.github.io`.
3. *Build › Firestore Database*: create the database (production mode; pick a location near Qatar, e.g. `me-central1` Doha, or `europe-west1`).
4. *Authentication › Templates*: optionally set the template language to English (UK) and the sender name to "Mr Kenj".
5. Publish the security rules: paste `firestore.rules` into *Firestore › Rules* and press **Publish**
   (or `npm run firebase:deploy-rules`, which uses the service-account key in step 6).
6. *Project settings › Service accounts › Generate new private key*: save the file as
   `private/service-accounts/mr-kenj-guide.json` (never share or commit it), then run:
   ```bash
   npm run firebase:seed -- --app year5 --service-account private/service-accounts/mr-kenj-guide.json \
     --teacher-email <teacher email> [--class-code KENJ5]
   ```
   This creates the teacher login and role, uploads the answer keys (all locked) and sets the class code.
   The password and class code are written to `private/credentials/firebase-mr-kenj-guide-year5.txt`.
   Run it again whenever the answer keys change (unlock settings are kept).

**Once, on GitHub:** create the repository, push the `main` branch, then *Settings › Pages › Source: GitHub Actions*.
Every push to `main` builds and publishes the site (`.github/workflows/deploy.yml`).
The Firebase web config comes from `config/firebase.web.json` (these values are public by design – security comes
from the rules and Authentication settings), or from a repository variable `FIREBASE_WEB_CONFIG` holding the same JSON.

## Run and test locally
```bash
npm install                     # Node 20+
npm run build                   # answer keys (Python 3, needs private/) + content -> content/year5.json
npm run build:site              # static site for the real Firebase project -> dist/
npm run build:site:emulators    # static site that talks to local emulators
npm run serve:site              # dist/ at http://localhost:5050/mr-kenj-guides/ (same shape as GitHub Pages)
npm run test:firebase           # Firestore rules tests + browser end-to-end test on the emulators (needs Java 11+ and firebase-tools)

# Node server (fallback)
npm run seed:teacher            # teacher for the Node server; password in TEACHER_PASSWORD.year5.txt (chmod 600)
npm start                       # http://localhost:3000
npm test                        # API smoke test against a running Node server
npm run screenshots             # Playwright walkthrough (BASE, TEACHER_FILE, OUT_DIR; needs Chrome)
```
Node server environment variables: see `.env.example` (`APP`, `PORT`, `CLASS_CODE`, `JWT_SECRET`, `DATA_DIR`, `DATA_BACKEND`).

## Making the Year Six guide
1. Copy `config/apps/year6.sample.json` to `config/apps/year6.json` and adjust if needed (its `site.path` is `year-six`).
2. Write `content-src/year6/unit1.yaml` … `unit9.yaml` (same structure as Year 5); put the publisher's answer text in
   `private/year6/answers-raw/ans1.txt` … (pdftotext -layout output) and add any Year 6 corrections to `private/tools/fix_answers.py`.
3. `python3 private/tools/fix_answers.py year6 && node tools/build-content.js year6 && python3 tools/make_icons.py 6 public/icons-year6`
   (Year Six gets its own icons; the site build uses `public/icons-<year>/` when it exists).
4. `npm run firebase:seed -- --app year6 …` uploads Year 6's answer keys; Year 6 data lives under `years/year6/` in the same Firebase project.
5. Push: `npm run build:site` builds every year that has a config and content, so the workflow then publishes `…/year-six/` as well.
6. Capacitor: make a second `capacitor.config.json` for Year Six (`appId` ending `.year6`, `webDir: dist/year-six`).

## Firestore layout
```
roles/{uid}                          { role: 'teacher', name }       – set by the seed script only
years/{year}/students/{uid}          one student: profile, ticks, quiz attempts, cards, game scores, summaries, study days
years/{year}/staff/{uid}             the teacher's own progress
years/{year}/meta/unlocks            { open: { '1_sb': time, … } }   – written by the teacher
years/{year}/meta/classCode          { code }                        – unreadable from the app, checked by the rules
years/{year}/answers/{unit}_{sb|wb}  answer keys                     – readable only when unlocked, or by the teacher
```

## Project layout
```
config/apps/            app name, school, books, theme, site path (one file per year); firebase.web.json (public web config)
content-src/year5/      editable unit sources (YAML)
content/                built study content sent to students (no answer keys)
public/                 the PWA: index.html, css, js (app, game, shared progress maths), icons, service worker
src/firebase-backend.js Firebase Auth + Firestore adapter for the static build (bundled by tools/build-static.js)
firestore.rules         Firestore security rules;  firebase.json: emulator settings
server/                 Node + Express server (fallback): auth, routes, SQLite repository
tools/                  content and site builders, icons, local static server, tests, screenshots
tools/firebase/         seed.js (Admin set-up), rules.test.js, e2e.test.js, test-all.sh
private/                NOT COMMITTED – answer keys, publisher material, credentials
```

## Security notes
- Firebase: students can read and write only their own record; the teacher (role set with the Admin SDK) can read every
  student but cannot change their work; answer keys can be read only after the teacher unlocks that unit and book;
  nobody can write roles, answer keys or the class code from the app. Covered by `tools/firebase/rules.test.js`.
- Practice quizzes are marked in the browser in the static build (the questions are original, not the publisher's answers),
  so a determined student could change their own quiz score – but never anyone else's, and never see locked answer keys.
- No analytics or tracking. Strict Content Security Policy in both versions.
- Node server: bcrypt (cost 12), signed JWT in an httpOnly SameSite=Lax cookie, Helmet headers, rate limits.

## App stores
Wrap the static build with Capacitor (`capacitor.config.json`, `webDir: dist/year-five`): `npm run build:site`, then
`npx cap add android` / `npx cap add ios`. Needs a Google Play developer account and an Apple Developer Program membership,
a privacy policy URL, store artwork (`public/icons/icon-1024.png`), and the stores' rules for children's apps.
Account deletion is already in the app.

## Credits
Book content © Marshall Cavendish Education. This guide contains original study notes, questions and summaries;
answer keys come from the publisher's Suggested Answers (kept private), with corrections listed in `private/year5/ANSWER-FIXES.md`.
Icons: Lucide (ISC licence, `public/vendor/LUCIDE-LICENSE.txt`). Firebase JS SDK (Apache 2.0).
