// Isolated local emulator proof; no GPS, device delivery or real partner claim.
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth as clientAuth,connectAuthEmulator,signInWithEmailAndPassword} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,setDoc,terminate} from 'firebase/firestore';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8899');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
process.env.GCLOUD_PROJECT='connectify-19dd8';
const {db}=await import('../lib/common.js');
const {getAuth}=await import('firebase-admin/auth');
const {claimPushSlot,weekKey}=await import('../lib/notifications.js');
const tag=`live-alert-${Date.now()}`,users=[],paths=[];let checks=0;
let client,clientDB;
const check=(label,condition)=>{assert.ok(condition,label);checks++;console.log(`PASS ${label}`)};
async function account(kind){
 const r=await(await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${tag}-${kind}@example.test`,password:'local-alert-fixture-only',returnSecureToken:true})})).json();
 assert.ok(r.idToken);users.push(r.localId);await db.doc(`users/${r.localId}`).set({displayName:'Fictional Live Alert QA',...(kind==='unknown'?{}:{ageBand:kind})});return r;
}
async function call(user,name,data={}){return(await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`,{method:'POST',headers:{'content-type':'application/json',...(user?{authorization:`Bearer ${user.idToken}`}:{})},body:JSON.stringify({data})})).json();}
try{
 const adult=await account('adult'),minor=await account('minor'),unknown=await account('unknown');
 check('guest consent denied',(await call(null,'setLivePartnerConsent',{enabled:true,promotionalConsent:true})).error?.status==='UNAUTHENTICATED');
 check('off by default',(await call(adult,'getLivePartnerConsent')).result?.enabled===false);
 for(const user of [minor,unknown])check('minor or unknown age entirely ineligible',(await call(user,'getLivePartnerConsent')).result?.eligible===false&&(await call(user,'setLivePartnerConsent',{enabled:true,promotionalConsent:true})).error?.status==='PERMISSION_DENIED');
 check('explicit promotional consent required',(await call(adult,'setLivePartnerConsent',{enabled:true})).error?.status==='INVALID_ARGUMENT');
 check('adult explicitly opts in',(await call(adult,'setLivePartnerConsent',{enabled:true,promotionalConsent:true})).result?.enabled===true);
 client=initializeApp({projectId:'connectify-19dd8',apiKey:'local'},tag);
 const auth=clientAuth(client);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
 await signInWithEmailAndPassword(auth,`${tag}-adult@example.test`,'local-alert-fixture-only');
 clientDB=getFirestore(client);connectFirestoreEmulator(clientDB,'127.0.0.1',8899);
 await setDoc(doc(clientDB,`users/${adult.localId}`),{displayName:'Edited ordinary profile after opt-in'},{merge:true});
 check('profile SDK edit preserves server-added consent',(await call(adult,'getLivePartnerConsent')).result?.enabled===true);
 let consentDenied=false;
 try{await setDoc(doc(clientDB,`users/${adult.localId}`),{notificationPrefs:{livePartnerAlerts:false}},{merge:true})}catch(e){consentDenied=e.code==='permission-denied'}
 check('direct SDK cannot bypass consent callable',consentDenied);
 await db.doc(`users/${adult.localId}`).set({notificationPrefs:{quietStart:0,quietEnd:0,timeZone:'America/Los_Angeles'}},{merge:true});
 const venueHour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hourCycle:'h23'}).format(new Date()));
 check('ordinary preference save preserves consent',(await call(adult,'setNotificationPrefs',{friendActivity:false})).result&& (await call(adult,'getLivePartnerConsent')).result?.enabled===true);
 const {Timestamp}=await import('firebase-admin/firestore');
 for(let i=0;i<23;i++){
  const partner=`${tag}-partner-${i}`,perk=`${tag}-perk-${i}`;paths.push(`partners/${partner}`,`partnerPerks/${perk}`);
  await db.doc(`partners/${partner}`).set({name:`Fictional partner ${i}`,category:'retail',active:true,latitude:33.2+i*.0001,longitude:-114.1,agreement:{agreedBy:'Fictional QA owner',agreedAt:Timestamp.now(),reference:'Fictional written local-only agreement'}});
  await db.doc(`partnerPerks/${perk}`).set({partnerId:partner,title:'Fictional nearby offer',description:'Local QA only',active:true,pointCost:500,codePoolCount:2,expiresAt:Timestamp.fromMillis(Date.now()+86400000),hours:i===0?[venueHour,(venueHour+1)%24]:[],days:[]});
 }
 const position={lat:33.2,lng:-114.1,accuracy:10,sampleAtMs:Date.now()};
 const page=(await call(adult,'livePartnerRegions',position)).result;
 check('exactly nearest 20 unique eligible partners',page.regions.length===20&&page.regions[0].partnerId===`${tag}-partner-0`&&page.regions.at(-1).partnerId===`${tag}-partner-19`);
 check('no coordinates persisted in consent profile',!(await db.doc(`users/${adult.localId}`).get()).data().latitude);
 const first={...position,perkId:`${tag}-perk-0`};
 check('old location refused',(await call(adult,'livePartnerEntry',{...first,sampleAtMs:Date.now()-120000})).error?.status==='INVALID_ARGUMENT');
 check('inaccurate location refused',(await call(adult,'livePartnerEntry',{...first,accuracy:101})).error?.status==='INVALID_ARGUMENT');
 check('distant location cannot authorize alert',(await call(adult,'livePartnerEntry',{...first,lat:0,lng:0})).result?.alert===null);
 await db.doc(`users/${adult.localId}`).set({notificationPrefs:{timeZone:'UTC'}},{merge:true});
 check('nearby opted-in adult receives alert payload',!!(await call(adult,'livePartnerEntry',first)).result?.alert);
 check('venue hours independent of account timezone',(await db.doc(`users/${adult.localId}`).get()).data().notificationPrefs.timeZone==='UTC');
 await db.doc(`users/${adult.localId}`).set({notificationPrefs:{timeZone:'America/Los_Angeles'}},{merge:true});
 check('same partner retried once only',(await call(adult,'livePartnerEntry',first)).result?.alert===null);
 check('second distinct partner uses remaining shared slot',!!(await call(adult,'livePartnerEntry',{...position,perkId:`${tag}-perk-1`})).result?.alert);
 check('third partner refused by shared weekly cap',(await call(adult,'livePartnerEntry',{...position,perkId:`${tag}-perk-2`})).result?.alert===null);
 check('organic/friend push also sees exhausted cap',await claimPushSlot(adult.localId,Date.now())===false);
 await db.doc(`users/${adult.localId}`).set({notifyBudget:{week:weekKey(Date.now()),sent:0}},{merge:true});
 const race=await Promise.all([call(adult,'livePartnerEntry',{...position,perkId:`${tag}-perk-3`}),claimPushSlot(adult.localId,Date.now()),claimPushSlot(adult.localId,Date.now())]);
 check('concurrent alert and ordinary push cannot exceed cap',race.filter(r=>r===true||r?.result?.alert).length===2&&(await db.doc(`users/${adult.localId}`).get()).data().notifyBudget.sent===2);
 await db.doc(`users/${adult.localId}`).set({notifyBudget:{week:weekKey(Date.now()),sent:0},notificationPrefs:{quietStart:0,quietEnd:0}},{merge:true});
 await db.doc(`partners/${tag}-partner-4`).update({active:false});
 check('withdrawn partner never produces stale alert',(await call(adult,'livePartnerEntry',{...position,perkId:`${tag}-perk-4`})).result?.alert===null);
 await db.doc(`users/${adult.localId}`).set({notificationPrefs:{quietStart:0,quietEnd:23}},{merge:true});
 // Check a guaranteed quiet window around the current local hour (same boundaries except 23).
 const h=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hourCycle:'h23'}).format(new Date()));
 await db.doc(`users/${adult.localId}`).set({notificationPrefs:{quietStart:h,quietEnd:(h+1)%24}},{merge:true});
 check('quiet hours respected',(await call(adult,'livePartnerEntry',{...position,perkId:`${tag}-perk-5`})).result?.alert===null);
 check('opt-out saved',(await call(adult,'setLivePartnerConsent',{enabled:false})).result?.enabled===false);
 check('opted-out account gets no monitored regions',(await call(adult,'livePartnerRegions',position)).result?.regions.length===0);
 check('opted-out account gets no alert',(await call(adult,'livePartnerEntry',{...position,perkId:`${tag}-perk-6`})).result?.alert===null);
 const notifications=await db.collection(`users/${adult.localId}/notifications`).get();
 check('notification records contain no location fields',notifications.docs.every(d=>!('latitude'in d.data())&&!('lat'in d.data())&&!('sampleAtMs'in d.data())));
 console.log(`${checks} local live-partner alert checks passed`);
}finally{
 if(clientDB)await terminate(clientDB);if(client)await deleteApp(client);
 for(const path of paths)await db.doc(path).delete();
 for(const uid of users){await db.recursiveDelete(db.doc(`users/${uid}`));await getAuth().deleteUser(uid);for(const action of ['setNotificationPrefs','livePartnerEntry','livePartnerRegions'])await db.doc(`rateLimits/${uid}_${action}`).delete();}
}
