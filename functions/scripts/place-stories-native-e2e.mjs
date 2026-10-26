// Read-only emulator verification after the real native owner UI journey.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8899');
process.env.GCLOUD_PROJECT='connectify-19dd8';
const {db}=await import('../lib/common.js');
const uid='qa-stories-native-owner',placeId='osm-999999999999998';
const ownership=(await db.doc(`placeStoryOwnership/${placeId}`).get()).data();
assert.equal(ownership.ownerUid,uid);
const story=(await db.doc(`placeStories/${ownership.storyId}`).get()).data();
assert.equal(story.content,'Fictional native UI story written by its verified organizer.');
const all=await db.collectionGroup('events').where('uid','==',uid).get();
const events=all.docs.filter(d=>d.ref.path.startsWith('analytics/')&&d.data().params?.storyId===ownership.storyId&&d.data().params?.version===story.version)
 .map(d=>({event:d.data().event,params:d.data().params})).sort((a,b)=>a.event.localeCompare(b.event));
assert.deepEqual(events.map(e=>e.event),['story_expanded','story_read_through','story_shown']);
writeFileSync(fileURLToPath(new URL('../../docs/evidence/place-stories-native-engagement-2026-10-04.json',import.meta.url)),JSON.stringify({status:'passed',scope:'Actual native owner UI preview; one exposure, one of each stage; local emulator',fixture:uid,events},null,2)+'\n');
console.log('PASS native telemetry: exactly one shown, one expanded and one end-visible record');
