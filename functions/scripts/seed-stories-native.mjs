// Reserved, fictional local-only native story fixture. Never touches production.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8899');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
process.env.GCLOUD_PROJECT = 'connectify-19dd8';
const { db } = await import('../lib/common.js');
const { getAuth } = await import('firebase-admin/auth');
const uid = 'qa-stories-native-owner', email = `${uid}@example.test`, org = 'qa-stories-native-org', placeId = 'osm-999999999999998';
let user;
try { user = await getAuth().getUser(uid); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
if (user) assert.equal(user.email, email, 'Refuse to overwrite unrelated account');
const assignment = await db.doc(`placeStoryOwnership/${placeId}`).get();
if (assignment.exists) assert.equal(assignment.data().ownerUid, uid, 'Refuse to remove unrelated ownership');
for (const story of (await db.collection('placeStories').where('ownerUid', '==', uid).get()).docs) await story.ref.delete();
for (const path of [`placeStoryOwnership/${placeId}`, `placeStoryStatus/${placeId}`, `organizers/${org}`, `organizerStoryStatus/${org}`, `storyAuthorStatus/${uid}`, `users/${uid}`]) await db.recursiveDelete(db.doc(path));
for (const collection of ['rateLimits', 'storyEngagementKeys']) {
  for (const doc of (await db.collection(collection).where('uid', '==', uid).get()).docs) await doc.ref.delete();
}
for (const doc of (await db.collectionGroup('events').where('uid', '==', uid).get()).docs) if (doc.ref.path.startsWith('analytics/')) await doc.ref.delete();
if (process.argv.includes('--clean')) {
  if (user) await getAuth().deleteUser(uid);
  console.log('Removed fictional native story fixture; immutable staff audits retained');
} else {
  if (!user) await getAuth().createUser({ uid, email, password: 'local-story-native-only' });
  await db.doc(`users/${uid}`).set({ displayName: 'Fictional Native Story Owner', birthYear: 2000, ageBand: 'adult', organizerId: org });
  await db.doc(`organizers/${org}`).set({ ownerUid: uid, displayName: 'Fictional Native Story Organizer', status: 'approved', category: 'parks', hidden: false, removed: false, manualApprovalCounted: true });
  execFileSync(process.execPath, [fileURLToPath(new URL('staff-admin.mjs', import.meta.url)), '--uid', uid, '--grant', '--reason', 'Fictional local-only native story test fixture'], { env: process.env, stdio: 'inherit' });
  const auth = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local', {
    method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ email, password:'local-story-native-only', returnSecureToken:true }) })).json();
  const result = await (await fetch('http://127.0.0.1:5002/connectify-19dd8/us-central1/setPlaceStoryOwnership', {
    method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${auth.idToken}`}, body:JSON.stringify({ data:{ placeId, organizerId:org, placeName:'Fictional Native Story Place', officialURL:`https://www.openstreetmap.org/node/${placeId.slice(4)}`, active:true, verificationReference:'Fictional local-only written confirmation', reason:'Native story integration proof fixture' } }) })).json();
  assert.equal(result.result?.active, true, JSON.stringify(result));
  console.log('Created fictional story owner and verified place via staff callable');
}
