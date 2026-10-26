// Account/entitlement/privacy/download checks against loopback emulators.
// Uses the permission-checked real park catalog; all account/event fixtures
// are fictional and deleted. No catalog mutation or production connection.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,"127.0.0.1:8899");
process.env.FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099";
process.env.GCLOUD_PROJECT="connectify-19dd8";
const {db}=await import("../lib/common.js");
const {Timestamp}=await import("firebase-admin/firestore");
const {getAuth:adminAuth}=await import("firebase-admin/auth");
const {buildOfflinePack,PACK_LIFETIME_MS,cleanupExpiredPackStages}=await import("../lib/offline/packs.js");
const {catalog,parkFeature}=await import("../lib/parks/api.js");
const {initializeApp,deleteApp}=await import("firebase/app");
const {getAuth,connectAuthEmulator,signInWithEmailAndPassword}=await import("firebase/auth");
const {getFirestore,connectFirestoreEmulator,doc,getDoc,setDoc,terminate}=await import("firebase/firestore");
const {default:sharp}=await import("sharp");
const {compressThumbnail}=await import("../lib/offline/media.js");
const users=[],events=[],groups=[],sessions=[],partners=[],perks=[],apps=[],stores=[];
const suffix=Date.now().toString(36),password="local-offline-pack-fixture";
let passed=0;
function check(name,ok){assert.ok(ok,name);passed++;console.log(`PASS ${name}`);}
async function call(data,user){return (await fetch("http://127.0.0.1:5002/connectify-19dd8/us-central1/offlinePack",{
 method:"POST",headers:{"content-type":"application/json",...(user?{authorization:`Bearer ${user.idToken}`}:{})},body:JSON.stringify({data})})).json();}
async function account(label,plus){
 const user=await(await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local",{method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({email:`offline-${suffix}-${label}@example.test`,password,returnSecureToken:true})})).json();
 assert.ok(user.idToken);users.push(user.localId);
 await db.doc(`users/${user.localId}`).set({birthYear:2000,ageBand:"adult",plusExpiresAt:plus?Timestamp.fromMillis(Date.now()+86400000):null});return user;
}
async function fixtureEvent(label,point,patch={}){
 const id=`offline-${suffix}-${label}`;events.push(id);
 await db.doc(`events/${id}`).set({title:`Fictional ${label}`,description:"Local offline fixture",organizer:"Fixture",category:"Workshop",locationName:"Fixture venue",
  latitude:point[1],longitude:point[0],date:Timestamp.fromMillis(Date.now()+86400000),active:true,hidden:false,broadcast:true,minimumAge:0,...patch});return id;
}
try{
 const {state,index}=await catalog();assert.ok(state.generation&&index.length>100,"Populate the real C1 catalog first");
 const park=index.find(p=>p.id==="city-parks_342")??index.find(p=>p.source==="city-parks"&&p.status==="open");assert.ok(park);
 const feature=await parkFeature(state.generation,park.id),point=[park.longitude,park.latitude];
 const member=await account("member",true),other=await account("other",true),free=await account("free",false);
 const selection={kind:"parks",parkIds:[park.id]};
 check("guest cannot generate a pack",(await call({action:"preview",selection})).error?.status==="UNAUTHENTICATED");
 check("free account refused by server despite client Plus claim",(await call({action:"preview",selection,plus:true},free)).error?.status==="PERMISSION_DENIED");
 check("bad selection rejected before generation",(await call({action:"preview",selection:{kind:"parks",parkIds:["../users/private"]}},member)).error?.status==="INVALID_ARGUMENT");
 const inside=await fixtureEvent("public-inside",point),outside=await fixtureEvent("public-outside",[0,0]),
  mine=await fixtureEvent("private-owned",[0,0],{broadcast:false,creatorID:member.localId}),
  privateOther=await fixtureEvent("private-other",point,{broadcast:false,creatorID:other.localId}),
  hidden=await fixtureEvent("hidden",point,{hidden:true}),
  blocked=await fixtureEvent("blocked",point,{creatorID:other.localId}),
  expired=await fixtureEvent("expired",point,{date:Timestamp.fromMillis(Date.now()-86400000)}),
  virtual=await fixtureEvent("saved-virtual",[0,0],{virtual:true});
 const program=await fixtureEvent("saved-program",[0,0],{category:"Program",opportunitySubtype:"program",source:"staff-program",minimumAge:18,maximumAge:110,applicationDeadline:Timestamp.fromMillis(Date.now()+86400000),pointValue:0,priceMin:0,isFree:true,virtual:true,website:"https://example.org/official-program"}),
  teenProgram=await fixtureEvent("ineligible-program",point,{category:"Program",minimumAge:13,maximumAge:17,applicationDeadline:Timestamp.fromMillis(Date.now()+86400000)});
 await db.doc(`users/${member.localId}`).update({savedEventIDs:[mine,privateOther,inside,expired,virtual,program,teenProgram]});
 await db.doc(`users/${other.localId}/blocks/${member.localId}`).set({uid:member.localId});
 const session=`offline-${suffix}-plan`;sessions.push(session);
 await db.doc(`eventPlanSessions/${session}`).set({uid:member.localId,selectedIDs:[inside,mine,privateOther],candidateIDs:["private-unselected"]});
 const group=`offline-${suffix}-group`;groups.push(group);
 await db.doc(`groupPlans/${group}`).set({ownerUid:member.localId,memberUIDs:[member.localId],eventIDs:[inside,mine],title:"Fictional own plan",pendingUIDs:[other.localId],votes:{[other.localId]:[inside]}});
 const blockedGroup=`offline-${suffix}-blocked-group`;groups.push(blockedGroup);
 await db.doc(`groupPlans/${blockedGroup}`).set({ownerUid:other.localId,memberUIDs:[member.localId,other.localId],eventIDs:[inside],title:"Hidden blocked-owner group"});
 await db.doc(`users/${member.localId}/adventurePlans/local-place-plan`).set({title:"Fictional place outing",intro:"Fixture",generatedAtMs:Date.now(),stops:[{placeId:"osm-fixture",name:"Fictional stop",latitude:point[1],longitude:point[0],minutes:30,order:1,why:"Fixture"}]});
 const partner=`offline-${suffix}-partner`,perk=`offline-${suffix}-perk`;partners.push(partner);perks.push(perk);
 await db.doc(`partners/${partner}`).set({name:"Fictional pack partner",category:"coffee",active:true,latitude:point[1],longitude:point[0],agreement:{agreedBy:"Fictional owner",agreedAt:Timestamp.now(),reference:"FICTIONAL TEST AGREEMENT"}});
 await db.doc(`partnerPerks/${perk}`).set({partnerId:partner,title:"Fictional perk",description:"Fictional terms",active:true,pointCost:500,codePoolCount:12,expiresAt:Timestamp.fromMillis(Date.now()+86400000),secretCode:"NEVER IN PACK",contactEmail:"NEVER IN PACK"});
 const place={id:"osm-fixture",name:"Fictional local provider result",category:"Parks",latitude:point[1],longitude:point[0],source:"OpenStreetMap",attribution:"© OpenStreetMap contributors",saved:true};
 const preview=(await call({action:"preview",selection,places:[place,{...place,id:"outside-place",latitude:0,longitude:0}],uid:other.localId},member)).result;assert.ok(preview);
 check("member receives exact size/counts before any bytes",preview.downloadBytes>preview.storedBytes&&preview.downloadBytes<=50000000&&preview.parts>=1&&preview.counts.parks===1);
 check("seven-day expiry is server-set",preview.expiresAtMs-preview.createdAtMs===PACK_LIFETIME_MS);
 check("other paid account cannot download owner's pack",(await call({action:"chunk",packId:preview.packId,index:0},other)).error?.status==="NOT_FOUND");
 check("free account cannot bypass generation via chunk API",(await call({action:"chunk",packId:preview.packId,index:0},free)).error?.status==="PERMISSION_DENIED");
 check("invalid part refused",(await call({action:"chunk",packId:preview.packId,index:preview.parts},member)).error?.status==="INVALID_ARGUMENT");
 const parts=[];
 for(let i=0;i<preview.parts;i++){const r=(await call({action:"chunk",packId:preview.packId,index:i},member)).result;assert.equal(r.index,i);assert.equal(r.sha256,preview.sha256);parts.push(Buffer.from(r.data,"base64"));}
 const bytes=Buffer.concat(parts),pack=JSON.parse(bytes.toString());
 check("all delivered bytes match preview size and checksum",bytes.length===preview.storedBytes&&createHash("sha256").update(bytes).digest("hex")===preview.sha256);
 check("request uid cannot redirect private ownership",pack.ownerUid===member.localId);
 check("real guide retains lossless source geometry and attribution",JSON.stringify(pack.guides[0].park.geometry)===JSON.stringify(feature.geometry)&&pack.guides[0].credits.length>0);
 check("public park events join by geometry; outside/private/hidden/blocked absent",pack.events.some(e=>e.id===inside)&&[outside,privateOther,hidden,blocked,expired].every(id=>!pack.events.some(e=>e.id===id)));
 check("own private and virtual saves included only for their member",pack.savedEventIDs.includes(mine)&&pack.savedEventIDs.includes(virtual)&&!pack.savedEventIDs.includes(privateOther));
 check("saved eligible Program retains deadline ages cost virtual format and official link",pack.savedEventIDs.includes(program)&&pack.memberBirthYear===2000&&pack.events.some(e=>e.id===program&&e.deadlineMs>Date.now()&&e.minimumAge===18&&e.maximumAge===110&&e.priceMin===0&&e.virtual&&e.website==="https://example.org/official-program"));
 check("saved Program outside member age is omitted",!pack.savedEventIDs.includes(teenProgram)&&!pack.events.some(e=>e.id===teenProgram));
 check("Programs are not presented as events taking place at parks",pack.guides.every(g=>g.events.every(e=>e.id!==program&&e.id!==teenProgram)));
 check("plans omit unselected/private candidates, invites, votes and blocked owners",pack.plans.some(p=>p.id===session)&&pack.plans.some(p=>p.id===group)&&pack.plans.every(p=>p.id!==blockedGroup)&&!JSON.stringify(pack.plans).includes("private-unselected")&&!JSON.stringify(pack.plans).includes(other.localId));
 check("successful place itineraries are included",pack.plans.some(p=>p.kind==="places"&&p.stops.length===1));
 check("places preserve provider credit, saved flag and correct selection",pack.places.length===1&&pack.places[0].attribution.includes("OpenStreetMap")&&pack.places[0].saved);
 check("perks are view-only with no redemption codes or business contact details",pack.perks.some(p=>p.id===perk&&p.viewOnly)&&!bytes.includes("NEVER IN PACK"));
 check("no offline check-in or base imagery is supplied",pack.checkInAllowed===false&&pack.mapImageryIncluded===false);
 await db.doc(`users/${member.localId}`).update({plusExpiresAt:Timestamp.fromMillis(Date.now()-1)});
 check("entitlement rechecked during download",(await call({action:"chunk",packId:preview.packId,index:0},member)).error?.status==="PERMISSION_DENIED");
 await db.doc(`users/${member.localId}`).update({plusExpiresAt:Timestamp.fromMillis(Date.now()+86400000)});
 const root=db.doc(`users/${member.localId}/offlinePacks/${preview.packId}`);
 await root.update({stageExpiresAt:Timestamp.fromMillis(Date.now()-1)});
 check("expired staging refuses old bytes",(await call({action:"chunk",packId:preview.packId,index:0},member)).error?.status==="FAILED_PRECONDITION");
 await root.update({stageExpiresAt:Timestamp.fromMillis(Date.now()+3600000),downloadBytes:50000001});
 check("oversized stored artifact refused by download API",(await call({action:"chunk",packId:preview.packId,index:0},member)).error?.status==="RESOURCE_EXHAUSTED");
 await root.update({downloadBytes:preview.downloadBytes});
 const second=(await call({action:"preview",selection:{kind:"parks",parkIds:[park.id,"city-parks_33"]}},member)).result;assert.ok(second);
 check("set-of-parks preview includes both complete guides",second.counts.parks===2);
 const area=(await call({action:"preview",selection:{kind:"area",latitude:0,longitude:0,radiusMiles:1}},member)).result;assert.ok(area);
 check("area mode includes area events plus the member's saves/plans",area.counts.parks===0&&area.counts.events>=3&&area.counts.plans>=2);
 check("per-account staging bound applies across concurrent pending previews",(await call({action:"preview",selection},member)).error?.status==="RESOURCE_EXHAUSTED");
 // Rules test is the actual client SDK, not Admin SDK simulation.
 const app=initializeApp({apiKey:"local",projectId:"connectify-19dd8",authDomain:"localhost"},`offline-${suffix}`);apps.push(app);
 const auth=getAuth(app);connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});await signInWithEmailAndPassword(auth,member.email,password);
 const store=getFirestore(app);stores.push(store);connectFirestoreEmulator(store,"127.0.0.1",8899);
 await assert.rejects(getDoc(doc(store,`users/${member.localId}/offlinePacks/${preview.packId}/chunks/0`)),e=>e.code==="permission-denied");passed++;console.log("PASS direct client SDK cannot bypass callable entitlement");
 await assert.rejects(setDoc(doc(store,`users/${member.localId}/offlinePacks/${randomUUID()}`),{status:"ready"}),e=>e.code==="permission-denied");passed++;console.log("PASS direct client SDK cannot fabricate pack artifacts");
 await db.doc(`events/${inside}`).update({imageURL:"https://images.unsplash.com/local-fixture"});
 await db.doc(`events/${mine}`).update({imageURL:"https://evil.example/unavailable"});
 await db.doc(`events/${blocked}`).update({imageURL:"https://images.unsplash.com/blocked-never-fetch"});
 const jpeg=await compressThumbnail(await sharp({create:{width:1600,height:900,channels:3,background:"green"}}).png().toBuffer());
 const fetched=[];
 const augmented=await buildOfflinePack(member.localId,selection,(await db.doc(`users/${member.localId}`).get()).data(),[],Date.now(),async(url)=>{fetched.push(url);return url.endsWith("local-fixture")?jpeg.toString("base64"):null;});
 check("assembly preserves all required snapshot collections",["guides","events","savedEventIDs","plans","places","perks","thumbnails","unavailableThumbnails"].every(k=>k in augmented));
 check("actual compressed thumbnail bytes are included and decodable",Buffer.from(augmented.thumbnails[inside],"base64").equals(jpeg)&&(await sharp(Buffer.from(augmented.thumbnails[inside],"base64")).metadata()).format==="jpeg");
 check("unavailable imagery preserves event details; blocked images never fetched",augmented.unavailableThumbnails.includes(mine)&&augmented.events.some(e=>e.id===mine)&&!fetched.some(url=>url.includes("blocked-never-fetch")));
 check("cancel deletes staged chunks and root",(await call({action:"cancel",packId:preview.packId},member)).result?.deleted===true&&!(await root.get()).exists&&(await root.collection("chunks").get()).empty);
 const expiredRoot=db.doc(`users/${member.localId}/offlinePacks/${randomUUID()}`);
 await expiredRoot.set({status:"building",stageExpiresAt:Timestamp.fromMillis(Date.now()-3600000)});
 await expiredRoot.collection("chunks").doc("0").set({data:"expired-private-fixture"});
 await cleanupExpiredPackStages();
 check("scheduled expiry removes private roots and staged chunks",!(await expiredRoot.get()).exists&&(await expiredRoot.collection("chunks").get()).empty);
 check("scheduled expiry keeps unexpired previews intact",(await db.doc(`users/${member.localId}/offlinePacks/${second.packId}`).get()).exists);
 console.log(`${passed} offline pack emulator checks passed`);
} finally {
 for(const store of stores)await terminate(store);for(const app of apps)await deleteApp(app);
 for(const id of events)await db.doc(`events/${id}`).delete();for(const id of groups)await db.doc(`groupPlans/${id}`).delete();for(const id of sessions)await db.doc(`eventPlanSessions/${id}`).delete();
 for(const id of perks)await db.doc(`partnerPerks/${id}`).delete();for(const id of partners)await db.doc(`partners/${id}`).delete();
 for(const uid of users){await db.recursiveDelete(db.doc(`users/${uid}`));for(const action of ["offlinePackGenerate","offlinePackRead","offlinePackControl"])await db.doc(`rateLimits/${uid}_${action}`).delete();await adminAuth().deleteUser(uid);}
}
