#!/usr/bin/env node
/*
 * Security-rules tests against the local Firestore emulator.
 * Run: firebase emulators:exec --only firestore --project demo-kenj-rules "node tools/firebase/rules.test.js"
 *  (or with the emulators already running: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node tools/firebase/rules.test.js)
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { setLogLevel, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, deleteField, arrayUnion, FieldPath } = require('firebase/firestore');

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
let pass = 0, fail = 0;
async function check(name, p) {
  try { await p; pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.log(`  ✗ ${name}\n      ${String(e.message).split('\n')[0]}`); }
}
const profile = (email, extra = {}) => ({
  name: 'Test Student', email, createdAt: serverTimestamp(), lastActive: serverTimestamp(),
  progress: {}, cards: {}, quiz: [], games: {}, summaries: {}, days: [], ...extra,
});

(async () => {
  setLogLevel('silent'); // expected refusals would otherwise be logged
  const env = await initializeTestEnvironment({
    projectId: 'demo-kenj-rules',
    firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8') },
  });
  await env.clearFirestore();
  // Set-up as Admin (rules bypassed), like the seed script.
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'roles/teacher1'), { role: 'teacher', name: 'Mr Kenj' });
    await setDoc(doc(db, 'years/year5/meta/classCode'), { code: 'KENJ5' });
    await setDoc(doc(db, 'years/year5/meta/unlocks'), { open: {}, updatedBy: 'seed' });
    for (const k of ['1_sb', '1_wb', '2_sb']) await setDoc(doc(db, `years/year5/answers/${k}`), { json: '[]' });
    await setDoc(doc(db, 'years/year5/students/bob'), { name: 'Bob', email: 'bob@example.com', progress: {}, cards: {}, quiz: [], games: {}, summaries: {}, days: [] });
  });
  const amy = env.authenticatedContext('amy', { email: 'amy@example.com' }).firestore();
  const eve = env.authenticatedContext('eve', { email: 'eve@example.com' }).firestore(); // signed in, never joined
  const teacher = env.authenticatedContext('teacher1', { email: 'mr.kenj@example.com' }).firestore();
  const anon = env.unauthenticatedContext().firestore();
  const amyDoc = doc(amy, 'years/year5/students/amy');

  console.log('Joining the class');
  await check('no class code: refused', assertFails(setDoc(amyDoc, profile('amy@example.com'))));
  await check('wrong class code: refused', assertFails(setDoc(amyDoc, profile('amy@example.com', { classCode: 'WRONG' }))));
  await check('someone else\'s email: refused', assertFails(setDoc(amyDoc, profile('bob@example.com', { classCode: 'KENJ5' }))));
  await check('profile for another user id: refused', assertFails(setDoc(doc(amy, 'years/year5/students/zed'), profile('amy@example.com', { classCode: 'KENJ5' }))));
  await check('starting with ready-made progress: refused', assertFails(setDoc(amyDoc, profile('amy@example.com', { classCode: 'KENJ5', progress: { 'u1-sb-1': true } }))));
  await check('extra fields (e.g. role): refused', assertFails(setDoc(amyDoc, profile('amy@example.com', { classCode: 'KENJ5', role: 'teacher' }))));
  await check('right class code: allowed', assertSucceeds(setDoc(amyDoc, profile('amy@example.com', { classCode: 'KENJ5' }))));

  console.log('A student\'s own data');
  await check('reads own profile', assertSucceeds(getDoc(amyDoc)));
  await check('ticks an activity', assertSucceeds(updateDoc(amyDoc, new FieldPath('progress', 'u1-sb-1'), true, 'lastActive', serverTimestamp(), 'days', arrayUnion('2026-10-25'))));
  await check('saves a summary', assertSucceeds(updateDoc(amyDoc, new FieldPath('summaries', '1'), { main_idea: 'x', learnt: 'y' }, 'lastActive', serverTimestamp())));
  await check('cannot change own name', assertFails(updateDoc(amyDoc, { name: 'Someone Else', lastActive: serverTimestamp() })));
  await check('cannot change own email', assertFails(updateDoc(amyDoc, { email: 'x@example.com', lastActive: serverTimestamp() })));
  await check('cannot change class code', assertFails(updateDoc(amyDoc, { classCode: 'OTHER', lastActive: serverTimestamp() })));
  await check('cannot add a role field', assertFails(updateDoc(amyDoc, { role: 'teacher', lastActive: serverTimestamp() })));

  console.log('Other students\' data');
  await check('cannot read another student', assertFails(getDoc(doc(amy, 'years/year5/students/bob'))));
  await check('cannot list all students', assertFails(getDocs(collection(amy, 'years/year5/students'))));
  await check('cannot change another student', assertFails(updateDoc(doc(amy, 'years/year5/students/bob'), { lastActive: serverTimestamp() })));
  await check('cannot delete another student', assertFails(deleteDoc(doc(amy, 'years/year5/students/bob'))));
  await check('signed-out visitor cannot read a student', assertFails(getDoc(doc(anon, 'years/year5/students/bob'))));

  console.log('Teacher role');
  await check('student cannot make themselves teacher', assertFails(setDoc(doc(amy, 'roles/amy'), { role: 'teacher' })));
  await check('student cannot read the teacher\'s role doc', assertFails(getDoc(doc(amy, 'roles/teacher1'))));
  await check('student cannot create a staff record', assertFails(setDoc(doc(amy, 'years/year5/staff/amy'), profile('amy@example.com'))));
  await check('teacher reads own role', assertSucceeds(getDoc(doc(teacher, 'roles/teacher1'))));
  await check('teacher cannot change roles from the app', assertFails(setDoc(doc(teacher, 'roles/amy'), { role: 'teacher' })));
  await check('teacher lists students', assertSucceeds(getDocs(collection(teacher, 'years/year5/students'))));
  await check('teacher reads a student', assertSucceeds(getDoc(doc(teacher, 'years/year5/students/amy'))));
  await check('teacher cannot edit a student\'s work', assertFails(updateDoc(doc(teacher, 'years/year5/students/amy'), { lastActive: serverTimestamp() })));
  await check('teacher creates own staff record', assertSucceeds(setDoc(doc(teacher, 'years/year5/staff/teacher1'), profile('mr.kenj@example.com'))));

  console.log('Answer keys');
  await check('student: locked answers refused', assertFails(getDoc(doc(amy, 'years/year5/answers/1_sb'))));
  await check('signed-out visitor: refused', assertFails(getDoc(doc(anon, 'years/year5/answers/1_sb'))));
  await check('student cannot unlock', assertFails(setDoc(doc(amy, 'years/year5/meta/unlocks'), { open: { '1_sb': serverTimestamp() }, updatedBy: 'amy' }, { merge: true })));
  await check('teacher reads locked answers', assertSucceeds(getDoc(doc(teacher, 'years/year5/answers/1_wb'))));
  await check('teacher cannot write answers from the app', assertFails(setDoc(doc(teacher, 'years/year5/answers/1_sb'), { json: '[]' })));
  await check('teacher cannot add other fields to unlocks', assertFails(setDoc(doc(teacher, 'years/year5/meta/unlocks'), { open: {}, hacked: true, updatedBy: 'teacher1' }, { merge: true })));
  await check('teacher unlocks Unit 1 Student Book', assertSucceeds(setDoc(doc(teacher, 'years/year5/meta/unlocks'), { open: { '1_sb': serverTimestamp() }, updatedAt: serverTimestamp(), updatedBy: 'teacher1' }, { merge: true })));
  await check('student reads unlocked Unit 1 Student Book', assertSucceeds(getDoc(doc(amy, 'years/year5/answers/1_sb'))));
  await check('student: Unit 1 Workbook still refused', assertFails(getDoc(doc(amy, 'years/year5/answers/1_wb'))));
  await check('student: Unit 2 Student Book still refused', assertFails(getDoc(doc(amy, 'years/year5/answers/2_sb'))));
  await check('signed in but not in the class: refused even when unlocked', assertFails(getDoc(doc(eve, 'years/year5/answers/1_sb'))));
  await check('student reads which units are unlocked', assertSucceeds(getDoc(doc(amy, 'years/year5/meta/unlocks'))));
  await check('teacher locks again', assertSucceeds(setDoc(doc(teacher, 'years/year5/meta/unlocks'), { open: { '1_sb': deleteField() }, updatedAt: serverTimestamp(), updatedBy: 'teacher1' }, { merge: true })));
  await check('student: refused again after locking', assertFails(getDoc(doc(amy, 'years/year5/answers/1_sb'))));

  console.log('Class code and other paths');
  await check('student cannot read the class code', assertFails(getDoc(doc(amy, 'years/year5/meta/classCode'))));
  await check('teacher cannot read the class code from the app', assertFails(getDoc(doc(teacher, 'years/year5/meta/classCode'))));
  await check('unknown collections are closed', assertFails(setDoc(doc(amy, 'notes/x'), { a: 1 })));
  await check('student deletes own account data', assertSucceeds(deleteDoc(amyDoc)));

  await env.cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
