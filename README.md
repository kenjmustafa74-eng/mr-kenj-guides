# Mr. Kenj's Guide to Year Five

A mobile-first study companion (Progressive Web App) for Year 5 students at Brighton International Academy,
following Cambridge Primary English Stage 5 (Marshall Cavendish Student Book 5 and Workbook 5).
The same code runs **Mr. Kenj's Guide to Year Six**: only the config and the content files change.

## What students get
- Sign up / sign in with email and password.
- Home: the 9 units as cards with progress, a study streak and **The Big Quiz** (20 random questions from all units, with score history).
- Each unit has tabs: **Overview** (objectives, text summaries, key vocabulary, links to the books on MC EduHub),
  **Student Book** and **Workbook** guides (study tips and page references for every lesson and activity, tick-off boxes),
  **Practice** quiz with instant feedback and score history, **Memory cards** (flip, shuffle, "I know it / still learning"),
  **Word Catching Basket** game (drag on touch screens, arrow keys on computers; score, lives, levels, best score saved),
  **My Summary** (guided prompts, saved to the account and visible to the teacher) and **Answers** (locked until the teacher unlocks them).
- Progress per unit = activities ticked 50% + best practice quiz 20% + memory cards known 15% + My Summary 10% + basket game played 5%.

## What the teacher gets
- One teacher account (created by a script, see below).
- Dashboard: lock or unlock the answer keys for each unit, separately for the Student Book and Workbook.
- Every student's progress, streak, Big Quiz best, summaries and last activity; a detail page per student with their
  unit-by-unit progress, quiz history and My Summary text; a "temporary password" button for students who forget theirs.

## Run it
```bash
npm install                 # Node 20+
npm run build               # answers (Python 3) + content -> content/year5*.json
npm run seed:teacher        # creates the teacher; password written to TEACHER_PASSWORD.year5.txt (chmod 600)
npm start                   # http://localhost:3000
npm test                    # API smoke test against a running server
npm run screenshots         # Playwright walkthrough (needs Chrome; set CHROME=/path/to/chrome)
```
Environment variables: see `.env.example` (`APP`, `PORT`, `CLASS_CODE`, `JWT_SECRET`, `DATA_DIR`, `DATA_BACKEND`).
Set `CLASS_CODE` before publishing so that only your class can create accounts.

## Making the Year Six guide
1. Copy `config/apps/year6.sample.json` to `config/apps/year6.json` and adjust if needed.
2. Write `content-src/year6/unit1.yaml` … `unit9.yaml` (same structure as Year 5) and put the publisher's answer text in
   `content-src/year6/answers-raw/ans1.txt` … (pdftotext -layout output), then add any Year 6 corrections to `tools/fix_answers.py`.
3. `python3 tools/fix_answers.py year6 && node tools/build-content.js year6 && python3 tools/make_icons.py 6`
4. Run with `APP=year6 npm start` (it uses its own database, `data/year6.sqlite`). Run each year as a separate deployment.

## Project layout
```
config/apps/            app name, school, books, theme (one file per year)
content-src/year5/      editable unit sources (YAML), answers-raw/ (publisher text), ANSWER-FIXES.md (every correction made)
content/                built JSON: year5.json (sent to students) and year5.answers.json (server-only)
server/                 Express app, auth (bcrypt + JWT in an httpOnly cookie), routes
server/db/              repository interface + SQLite implementation (swap for Firebase/Supabase via DATA_BACKEND)
public/                 the PWA: index.html, css, js (app, game, shared progress maths), icons, service worker
tools/                  content builders, icon generator, smoke test, screenshot walkthrough
```

## Security notes
- Passwords are hashed with bcrypt (cost 12). Sessions are signed JWTs in an httpOnly, SameSite=Lax cookie (Secure in production).
- Answer keys never reach a student's device unless the teacher has unlocked that unit and book; quizzes are marked on the server.
- Helmet security headers with a strict Content Security Policy; rate limits on sign-in/sign-up and the API.

## Publishing
See the hosting and app store notes in the final report, or summary:
- **Web/PWA** (recommended first): any Node host with a persistent disk (Render, Railway, Fly.io, a small VPS) behind HTTPS.
  Students open the address and choose *Add to Home Screen*.
- **App stores**: wrap with Capacitor (`capacitor.config.json` is included; set `server.url` to the hosted HTTPS address),
  then `npx cap add android` / `npx cap add ios`. Needs a Google Play developer account and an Apple Developer Program
  membership, a privacy policy URL, store listing artwork (`public/icons/icon-1024.png`), and the stores' rules for
  children's apps (Google Play Families policy; Apple Kids category is optional). The stores require an in-app way to delete an account.

## Credits
Book content © Marshall Cavendish Education. This guide contains original study notes, questions and summaries;
answer keys come from the publisher's Suggested Answers, with corrections listed in `content-src/year5/ANSWER-FIXES.md`.
Icons: Lucide (ISC licence, `public/vendor/LUCIDE-LICENSE.txt`).
