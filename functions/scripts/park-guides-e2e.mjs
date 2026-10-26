// Public/free guide and geometry/event visibility through actual local HTTP
// callables. Fictional fixtures are restored/deleted; no production writes.
import assert from "node:assert/strict";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { Timestamp } = await import("firebase-admin/firestore");
const { getAuth } = await import("firebase-admin/auth");
const { SOURCE_SPECS } = await import("../lib/parks/sources.js");
const { runPlaceIngest, loadParkIndex } = await import("../lib/parks/store.js");
const suffix = Date.now().toString(36), eventIDs = [], runs = [], userIDs = [];
const manifest = db.doc("parkCatalog/current"), before = await manifest.get();
const health = await db.getAll(...SOURCE_SPECS.map(s=>db.doc(`placeSourceHealth/${s.id}`)));
const polygon = {type:"Polygon",coordinates:[
 [[-121.90,37.33],[-121.88,37.33],[-121.88,37.35],[-121.90,37.35],[-121.90,37.33]],
 [[-121.893,37.337],[-121.887,37.337],[-121.887,37.343],[-121.893,37.343],[-121.893,37.337]]
]};
let passed = 0;
function check(name, condition) { assert.ok(condition,name); passed++; console.log(`PASS ${name}`); }
async function call(name, data, user) {
 const response = await fetch(`http://127.0.0.1:5002/connectify-19dd8/us-central1/${name}`, {
  method:"POST",headers:{"content-type":"application/json",...(user?{authorization:`Bearer ${user.idToken}`}:{})},body:JSON.stringify({data})});
 return response.json();
}
async function account() {
 const response = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local",{method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({email:`park-minor-${suffix}@example.test`,password:"local-park-guide-test",returnSecureToken:true})});
 const user=await response.json();assert.ok(user.idToken);userIDs.push(user.localId);
 await db.doc(`users/${user.localId}`).set({birthYear:2011,ageBand:"minor"});return user;
}
function request(url) {
 const s=SOURCE_SPECS.find(s=>url.startsWith(s.layerURL)||url===s.metadataURL);assert.ok(s);
 if(url===s.metadataURL)return s.countyItem?{id:s.countyItem,owner:"sccprk",access:"public",licenseInfo:null,url:s.layerURL.replace(/\/\d+$/,"")}:
  {success:true,result:{license_id:"cc-by",license_url:s.credit.licenseURL,resources:[{url:s.layerURL}]}};
 if(url===`${s.layerURL}?f=json`)return {fields:["OBJECTID",...s.fields].map(name=>({name}))};
 const params=new URL(url).searchParams;
 if(params.get("returnIdsOnly"))return {objectIds:s.id==="city-parks"?Array.from({length:110},(_,i)=>i+1):[1]};
 return {type:"FeatureCollection",features:params.get("objectIds").split(",").map(Number).map(id=>({type:"Feature",properties:{
  OBJECTID:id,NAME:"Fictional guide fixture",name:"Different amenity name",park_name:"Fictional county guide",CURRENTSTATUS:id===2?"Closed":"Open",
  AMENITYSTATUS:"Open",AMENITYTYPE:"PLAYTOT",type:"RESTROOM",distribution:"Public",status:"open",public_use:"hiking",dog_use:"on leash",drinking_water:"yes",restroom:"yes",miles:0.2},
  geometry:s.id==="county-poi"?{type:"Point",coordinates:[-121.89,37.334]}:s.id==="county-trails"?{type:"LineString",coordinates:[[-121.91,37.334],[-121.87,37.334]]}:polygon}))};
}
async function event(label, patch={}) {
 const id=`park-guide-${suffix}-${label}`;eventIDs.push(id);
 await db.doc(`events/${id}`).set({title:`Fictional ${label}`,organizer:"Fixture",locationName:"An unrelated venue name",description:"Fictional public fixture",
  category:"Workshop",latitude:37.334,longitude:-121.89,date:Timestamp.fromMillis(Date.now()+3*86400000),active:true,hidden:false,broadcast:true,minimumAge:0,...patch});
 return id;
}
try {
 const run=await runPlaceIngest({request:async url=>request(url)});runs.push(run.runId);assert.ok(run.published);
 const index=await loadParkIndex(run.runId);
 check("compact index includes every source park",index.length===111);
 check("open source park has confirmed toddler/restroom/water/dog facts",Object.values(index.find(p=>p.id==="city-parks_1").flags).every(Boolean));
 check("closed source park passes no available-amenity filter",Object.values(index.find(p=>p.id==="city-parks_2").flags).every(v=>v===false));
 const browseInput={latitude:37.334,longitude:-121.89,radiusMiles:1};
 const page1=(await call("nearbyParkGuides",browseInput)).result;
 check("signed-out free browsing returns first complete page",page1.parks.length===100&&typeof page1.nextCursor==="string");
 const page2=(await call("nearbyParkGuides",{...browseInput,cursor:page1.nextCursor})).result;
 check("second page completes all parks without duplicates",page2.parks.length===11&&page2.nextCursor===null&&new Set([...page1.parks,...page2.parks].map(p=>p.id)).size===111);
 check("coordinate match includes differently named overlapping sources",(await call("parksAtCoordinate",browseInput)).result.parks.length===111);
 check("polygon hole excludes a place despite overlapping boxes",(await call("parksAtCoordinate",{latitude:37.34,longitude:-121.89})).result.parks.length===0);
 check("coordinates outside boundary cannot join by the same name",(await call("parksAtCoordinate",{latitude:37.334,longitude:-121.85,name:"Fictional guide fixture"})).result.parks.length===0);
 for(const [name,input] of [["nearbyParkGuides",{...browseInput,radiusMiles:51}],["nearbyParkGuides",{...browseInput,cursor:"{"}],
  ["parksAtCoordinate",{latitude:"37",longitude:0}],["parkGuide",{parkId:"../users/private"}]]) {
  check(`${name} rejects malformed input`,(await call(name,input)).error?.status==="INVALID_ARGUMENT");
 }
 check("cursor cannot cross a catalog generation",(await call("nearbyParkGuides",{...browseInput,cursor:JSON.stringify({generation:"old",after:"city-parks_1"})})).error?.status==="FAILED_PRECONDITION");
 check("unknown park is an explicit not-found",(await call("parkGuide",{parkId:"city-parks_9999999"})).error?.status==="NOT_FOUND");
 // Put >500 nonmatching events before a matching event to expose page clipping.
 for(let offset=0;offset<501;offset+=100){const batch=db.batch();for(let i=offset;i<Math.min(offset+100,501);i++){
  const id=`park-guide-${suffix}-outside-${i}`;eventIDs.push(id);batch.set(db.doc(`events/${id}`),{title:"Fictional guide fixture",organizer:"Fixture",locationName:"Fictional guide fixture",
   category:"Workshop",date:Timestamp.fromMillis(Date.now()+86400000+i),latitude:37.334,longitude:-121.85,active:true,hidden:false,broadcast:true});}await batch.commit();}
 const publicID=await event("inside"), childID=await event("children",{minimumAge:2,maximumAge:5}), teenID=await event("teen-program",{category:"Program",minimumAge:13,maximumAge:17}),
  holeID=await event("hole",{latitude:37.34}), adultID=await event("adult",{category:"Program",minimumAge:18}),
  hiddenID=await event("hidden",{hidden:true}), privateID=await event("private",{broadcast:false}), virtualID=await event("virtual",{virtual:true}),
  expiredID=await event("expired",{applicationDeadline:Timestamp.fromMillis(Date.now()-1)}), lateID=await event("later",{date:Timestamp.fromMillis(Date.now()+8*86400000)});
 const blockedCreator=`park-blocked-${suffix}`, blockedID=await event("blocked",{creatorID:blockedCreator});
 const minor=await account();await db.doc(`users/${minor.localId}/blocks/${blockedCreator}`).set({uid:blockedCreator});
 const guest=(await call("parkGuide",{parkId:"city-parks_1"})).result;assert.ok(guest);
 const ids=new Set(guest.events.map(e=>e.id));
 check("guest sees all-ages event after >500 nonmatching events",ids.has(publicID));
 check("children's activities remain discoverable while Programs require known eligibility",ids.has(childID)&&!ids.has(teenID));
 check("event coordinates exclude same-name locations and polygon holes",!ids.has(holeID)&&!guest.events.some(e=>e.id.startsWith(`park-guide-${suffix}-outside`)));
 check("private/hidden/virtual/expired/out-of-week/age-ineligible events stay absent",[adultID,hiddenID,privateID,virtualID,expiredID,lateID].every(id=>!ids.has(id)));
 check("guide supplies lossless boundary",JSON.stringify(guest.park.geometry)===JSON.stringify(polygon));
 check("guide supplies confirmed playground ages and connected trail",guest.park.ages[0].join("-")==="2-5"&&guest.trails.length===1);
 check("guide credits all four contributing datasets, excluding unrelated parent",guest.credits.length===4&&guest.credits.every(c=>c.datasetURL));
 check("source-absent hours and story remain unknown",guest.hours===null&&guest.story===null);
 check("every trail includes required notice and official HTTPS site",guest.trails.every(t=>t.notice.includes("Follow posted signs")&&t.officialURL.startsWith("https://www.sanjoseca.gov/")));
 const signed=(await call("parkGuide",{parkId:"city-parks_1"},minor)).result;
 check("minor guide respects age and personal block list",signed.events.some(e=>e.id===publicID)&&!signed.events.some(e=>e.id===adultID||e.id===blockedID));
 check("free signed-in minor can see an eligible teen Program",signed.events.some(e=>e.id===teenID));
 check("guest public guide can include public organizer before a personal block",ids.has(blockedID));
 await manifest.update({latestOutcome:"failed",latestError:"PRIVATE diagnostic fixture"});
 const delayed=(await call("parkGuide",{parkId:"city-parks_2"})).result;
 check("failed refresh retains closed status and exposes no private diagnostic",delayed.refreshDelayed&&delayed.park.status==="closed"&&!JSON.stringify(delayed).includes("PRIVATE diagnostic"));
 const chunk=db.doc(`parkGenerations/${run.runId}/index/0`), saved=await chunk.get();
 await chunk.set({data:"corrupt"});await assert.rejects(loadParkIndex(run.runId));await chunk.set(saved.data());
 check("compact index refuses corrupted storage",true);
 await db.doc(`rateLimits/${minor.localId}_parkBrowse`).set({uid:minor.localId,action:"parkBrowse",count:240,windowStart:Timestamp.now()});
 check("authenticated public browsing enforces its server request budget",(await call("parkGuide",{parkId:"city-parks_1"},minor)).error?.status==="RESOURCE_EXHAUSTED");
 console.log(`${passed} park guide callable checks passed`);
} finally {
 if(before.exists)await manifest.set(before.data());else await manifest.delete();
 for(const h of health){if(h.exists)await h.ref.set(h.data());else await h.ref.delete();}
 for(const id of runs){await db.recursiveDelete(db.doc(`parkGenerations/${id}`));await db.doc(`placeIngestRuns/${id}`).delete();}
 for(let offset=0;offset<eventIDs.length;offset+=200){const batch=db.batch();for(const id of eventIDs.slice(offset,offset+200))batch.delete(db.doc(`events/${id}`));await batch.commit();}
 for(const uid of userIDs){await db.recursiveDelete(db.doc(`users/${uid}`));await db.doc(`rateLimits/${uid}_parkBrowse`).delete();await getAuth().deleteUser(uid);}
}
process.exit(0);
