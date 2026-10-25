# Repository interface

Every backend (currently `sqlite-repo.js`) exports `create(options)` returning an object with these methods.
All methods are synchronous in the SQLite version; the server `await`s every call, so an async
implementation (Firebase, Supabase, Postgres…) can be dropped in without changing the routes.

| Method | Purpose |
| --- | --- |
| `createUser({ email, name, passwordHash, role })` → user | Create a student or teacher. Emails are stored lower-case and must be unique. |
| `getUserByEmail(email)`, `getUserById(id)` | Look up a user (includes `password_hash`). |
| `listStudents()` | All students, newest first. |
| `updatePassword(userId, passwordHash)` | Change a password. |
| `deleteStudent(userId)` | Delete a student and all of their data. |
| `touchUser(userId)` | Record the last time the user was active. |
| `setProgress(userId, itemId, done)` / `getProgress(userId)` | Ticked Student Book sections and Workbook activities. |
| `addQuizAttempt(userId, scope, score, total, details)` / `getQuizAttempts(userId)` | `scope` is `u1`…`u9` or `overall`. |
| `setCardStatus(userId, cardId, status)` / `getCardStatuses(userId)` | Memory cards: `known` or `learning`. |
| `recordGame(userId, unitId, score, level)` / `getGames(userId)` | Word Catching Basket: best score, best level, plays. |
| `saveSummary(userId, unitId, fields)` / `getSummaries(userId)` | “My Summary” answers. |
| `setUnlock(unitId, section, unlocked, byUserId)` / `getUnlocks()` | Answer keys released by the teacher (`section` is `sb` or `wb`). |
| `touchActivityDay(userId, day)` / `getActivityDays(userId)` | Days (YYYY-MM-DD, Asia/Qatar) with study activity, for the streak. |
