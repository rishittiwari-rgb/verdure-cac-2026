// Actual callable and client-rule paths, isolated fictional records on loopback only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,"127.0.0.1:8899");
process.env.FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; process.env.GCLOUD_PROJECT="connectify-19dd8";
const {db}=await import("../lib/common.js"), {Timestamp}=await import("firebase-admin/firestore");
const {geocodeFixtureId}=await import("../lib/staff-partners.js"), {expirePrograms}=await import("../lib/programs.js");
const {getAuth}=await import("firebase-admin/auth");
const {initializeApp,deleteApp}=await import("firebase/app");
const {getAuth:clientAuth,connectAuthEmulator,signInWithEmailAndPassword}=await import("firebase/auth");
const {getFirestore,connectFirestoreEmulator,setDoc,doc,getDoc,terminate}=await import("firebase/firestore");
const suffix=Date.now().toString(36), password="local-program-fixture", users=[], events=[],apps=[],stores=[], geocodes=[], audits=[];
let passed=0;function check(label,condition){assert.ok(condition,label);passed++;console.log(`PASS ${label}`);}
async function account(label,birthYear){const email=`program-${suffix}-${label}@example.test`;const u=await(await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})})).json();assert.ok(u.idToken);users.push(u.localId);await db.doc(`users/${u.localId}`).set({birthYear,ageBand:2026-birthYear<18?"minor":"adult",interests:["community"],studentStatus:true});return {...u,email};}
async function call(name,data,u){return(await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`,{method:"POST",headers:{"content-type":"application/json",...(u?{authorization:`Bearer ${u.idToken}`}:{})},body:JSON.stringify({data})})).json();}
const originalCache=(await db.doc("feedCaches/san-jose-ca").get()).data();const area=`qa-programs-${suffix}`;
try{
 const staff=await account("staff",2000), teen=await account("teen",2011),adult=await account("adult",2000), unknown=await account("unknown",2000);
 await db.doc(`users/${unknown.localId}`).update({birthYear:null});
 execFileSync(process.execPath,[fileURLToPath(new URL("staff-admin.mjs",import.meta.url)),"--uid",staff.localId,"--grant","--reason","Local fictional program curation test"],{env:process.env,stdio:"ignore"});
 const login=await(await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:staff.email,password,returnSecureToken:true})})).json();assert.ok(login.idToken);staff.idToken=login.idToken;
 const address=`123 Fictional Program Street ${suffix}, San Jose, CA`,geo=geocodeFixtureId(address);geocodes.push(geo);
 await db.doc(`qaGeocodes/${geo}`).set({response:{result:{addressMatches:[{matchedAddress:address,coordinates:{x:-121.8863,y:37.3382}}]}}});
 const base={programId:`program-${suffix}-first`,title:"Fictional program",organization:"Fictional program organization",officialURL:"https://example.org/official-program",deadlineMs:Date.now()+86400000,minimumAge:13,maximumAge:17,cost:0,format:"in-person",address,active:true,reason:"Fictional published listing validation"};
 for(const name of ["listStaffPrograms","saveProgram","deactivateProgram"]){
  check(`${name} denies guest`,(await call(name,base)).error?.status==="UNAUTHENTICATED");
  check(`${name} denies non-admin including UI admin claim`,(await call(name,{...base,admin:true},teen)).error?.status==="PERMISSION_DENIED");
 }
 for(const patch of [{minimumAge:undefined},{maximumAge:undefined},{cost:undefined},{reason:""},{deadlineMs:Date.now()-1},{latitude:37}])
  check(`server rejects incomplete/invalid curation ${JSON.stringify(patch)}`,(await call("saveProgram",{...base,...patch},staff)).error?.status==="INVALID_ARGUMENT");
 check("invalid curation leaves no document",!(await db.doc(`events/${base.programId}`).get()).exists);
 events.push(base.programId);const saved=(await call("saveProgram",base,staff)).result;
 check("staff creates geocoded free program with required facts",saved?.active&&saved.latitude===37.3382);
 const record=(await db.doc(`events/${base.programId}`).get()).data();
 check("program uses deadline and zero points, distinct from volunteering",record.category==="Program"&&record.pointValue===0&&record.applicationDeadline.toMillis()===base.deadlineMs&&record.minimumAge===13&&record.maximumAge===17);
 const firstAudit=await db.collection("staffAudit").where("target","==",`events/${base.programId}`).get();audits.push(...firstAudit.docs.map(d=>d.id));
 check("creation is audited with actor, reason and before/after",firstAudit.docs.some(d=>d.data().action==="program:save"&&d.data().actor===staff.localId&&d.data().before===null&&d.data().after.title===base.title));
 check("public program list needs sign-in for age eligibility",(await call("programListings",{lat:37.3382,lng:-121.8863,radiusMiles:25})).error?.status==="UNAUTHENTICATED");
 const browse={lat:37.3382,lng:-121.8863,radiusMiles:25};
 check("unknown age fails closed",!(await call("programListings",browse,unknown)).result.items.some(i=>i.id===base.programId));
 check("adult excluded from teen-only program",!(await call("programListings",browse,adult)).result.items.some(i=>i.id===base.programId));
 for(let i=2;i<=9;i++){const id=`program-${suffix}-${i}`;events.push(id);assert.ok((await call("saveProgram",{...base,programId:id,title:`Fictional program ${i}`},staff)).result);}
 let listed=(await call("programListings",browse,teen)).result;
 check("nine current eligible programs keep chip hidden",listed.currentInRadius===9&&listed.chipVisible===false);
 const tenth=`program-${suffix}-ten`;events.push(tenth);assert.ok((await call("saveProgram",{...base,programId:tenth,format:"virtual",cost:12.50},staff)).result);
 listed=(await call("programListings",browse,teen)).result;
 check("ten current in-radius programs reveal chip, including local virtual listing",listed.currentInRadius===10&&listed.chipVisible===true&&listed.items.find(i=>i.id===tenth)?.virtual===true);
 const adultId=`program-${suffix}-adult`;events.push(adultId);assert.ok((await call("saveProgram",{...base,programId:adultId,minimumAge:18,maximumAge:110},staff)).result);
 check("fifteen-year-old cannot see eighteen-plus program",!(await call("programListings",browse,teen)).result.items.some(i=>i.id===adultId));
 check("radius does not fall back to farther listings",(await call("programListings",{lat:0,lng:0,radiusMiles:25},teen)).result.currentInRadius===0);
 check("client cannot override server age",!(await call("programListings",{...browse,birthYear:2000,uid:adult.localId},teen)).result.items.some(i=>i.id===adultId));
 for(const id of events)await db.doc(`events/${id}`).update({areaId:area});
 const ranking=(await call("recommendedEvents",{areaId:area,lat:37.3382,lng:-121.8863,limit:100,telemetryEnabled:true},teen)).result;
 check("recommended feed filters ineligible programs without changing ranking code",ranking?.events.length===10&&!ranking.events.some(i=>i.id===adultId));
 const session=await db.doc(`feedSessions/${ranking.feedSessionId}`).get();
 check("telemetry candidate IDs exclude ineligible program",!JSON.stringify(session.data()).includes(adultId));
 // Deadline checks must work before the scheduled cleanup gets a chance to run.
 await db.doc(`events/${tenth}`).update({applicationDeadline:Timestamp.fromMillis(Date.now()-1)});
 listed=(await call("programListings",browse,teen)).result;
 check("deadline removes listing immediately, returning chip to hidden",listed.currentInRadius===9&&!listed.chipVisible&&!listed.items.some(i=>i.id===tenth));
 const afterDeadline=(await call("recommendedEvents",{areaId:area,limit:100},teen)).result;
 check("stale ranking snapshot cannot retain expired program",!afterDeadline.events.some(i=>i.id===tenth));
 check("scheduled expiry deactivates past deadline",await expirePrograms()>=1&&!(await db.doc(`events/${tenth}`).get()).data().active);
 check("scheduled expiry keeps current program active",(await db.doc(`events/${base.programId}`).get()).data().active);
 const deactivated=(await call("deactivateProgram",{programId:base.programId,reason:"Fictional listing withdrawn"},staff)).result;
 check("staff deactivation succeeds",deactivated?.active===false);
 check("deactivation removed from public list",!(await call("programListings",browse,teen)).result.items.some(i=>i.id===base.programId));
 check("deactivation without reason rejected",(await call("deactivateProgram",{programId:adultId},staff)).error?.status==="INVALID_ARGUMENT");
 await db.doc(`events/${base.programId}`).update({hidden:true});
 assert.ok((await call("saveProgram",{...base,active:true},staff)).result);
 check("edit cannot bypass moderation",(await db.doc(`events/${base.programId}`).get()).data().hidden===true);
 const p1=(await call("listStaffPrograms",{limit:3},staff)).result,p2=(await call("listStaffPrograms",{limit:3,afterId:p1.nextCursor},staff)).result;
 check("staff pagination includes current inactive expired entries without duplicates",p1.items.length===3&&p2.items.length===3&&!p1.items.some(a=>p2.items.some(b=>a.programId===b.programId)));
 check("program RSVP refused server-side",(await call("rsvpToEvent",{eventId:adultId,going:true},adult)).error?.status==="FAILED_PRECONDITION");
 check("program event invite refused server-side",(await call("inviteToEvent",{eventId:adultId,toUids:[teen.localId]},adult)).error?.status==="FAILED_PRECONDITION");
 const app=initializeApp({projectId:"connectify-19dd8",apiKey:"local",appId:`program-${suffix}`},`program-${suffix}`);apps.push(app);
 const auth=clientAuth(app);connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});await signInWithEmailAndPassword(auth,teen.email,password);
 const store=getFirestore(app);connectFirestoreEmulator(store,"127.0.0.1",8899);stores.push(store);
 const forbidden=`program-${suffix}-forged`;events.push(forbidden);
 await assert.rejects(setDoc(doc(store,"events",forbidden),{title:"Fictional forged listing",organizer:"Fixture",date:new Date(Date.now()+86400000),time:"Deadline",locationName:"Fixture",category:"Program",creatorID:teen.localId,attendeeCount:0,pointValue:0,hidden:false,active:true,broadcast:false,source:"community"}));
 check("client SDK cannot fabricate Program curation",true);
 const auditsAll=await db.collection("staffAudit").where("actor","==",staff.localId).get();audits.push(...auditsAll.docs.map(d=>d.id));
 check("every Program staff path creates audit",["program:save","program:deactivate","program:list"].every(action=>auditsAll.docs.some(d=>d.data().action===action)));
 await getAuth().setCustomUserClaims(staff.localId,{});
 for(const name of ["listStaffPrograms","saveProgram","deactivateProgram"])check(`${name} rejects stale revoked admin token`,(await call(name,base,staff)).error?.status==="PERMISSION_DENIED");
 console.log(`${passed} Program callable/rules/security checks passed`);
}finally{
 for(const id of events){const a=await db.collection("staffAudit").where("target","==",`events/${id}`).get();audits.push(...a.docs.map(d=>d.id));await db.recursiveDelete(db.doc(`events/${id}`));}
 for(const id of new Set(audits))await db.doc(`staffAudit/${id}`).delete();
 for(const id of geocodes)await db.doc(`qaGeocodes/${id}`).delete();
 for(const uid of users){const claims=await db.collection("staffAudit").where("target","==",`auth/${uid}`).get();for(const d of claims.docs)await d.ref.delete();await db.recursiveDelete(db.doc(`users/${uid}`));const limits=await db.collection("rateLimits").where("uid","==",uid).get();for(const d of limits.docs)await d.ref.delete();const telemetry=await db.collection("feedSessions").where("uid","==",uid).get();for(const d of telemetry.docs)await db.recursiveDelete(d.ref);await getAuth().deleteUser(uid).catch(()=>{});}
 await db.doc(`feedCaches/${area}`).delete();if(originalCache)await db.doc("feedCaches/san-jose-ca").set(originalCache);else await db.doc("feedCaches/san-jose-ca").delete();
 for(const store of stores)await terminate(store);for(const app of apps)await deleteApp(app);
}
