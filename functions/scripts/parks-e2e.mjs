// Complete pipeline, publication rollback, permissions, geometry storage and
// staff-console failure workflow. Only loopback emulators / disposable users.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { db } = await import("../lib/common.js");
const { getAuth: adminAuth } = await import("firebase-admin/auth");
const { SOURCE_SPECS } = await import("../lib/parks/sources.js");
const { runPlaceIngest, loadCatalogFeatures, placeCatalogState, encodeGeometry, decodeGeometry, prunePlaceGenerations } = await import("../lib/parks/store.js");
const { parkIdsAt } = await import("../lib/parks/normalize.js");
const { initializeApp, deleteApp } = await import("firebase/app");
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import("firebase/auth");
const { getFirestore, connectFirestoreEmulator, getDoc, setDoc, doc, terminate } = await import("firebase/firestore");
const origin = process.env.VERDURE_PARKS_TEST_URL;
if (origin) assert.match(origin,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const suffix = Date.now().toString(36), password = "local-park-fixture-password";
let checks = 0, browser, context;
function check(name, condition) {assert.ok(condition,name);checks++;console.log(`PASS ${name}`);}
const ring = [[-121.90,37.33],[-121.88,37.33],[-121.88,37.35],[-121.90,37.35],[-121.90,37.33]];
const polygon = {type:"Polygon",coordinates:[ring]}, users=[], apps=[], stores=[], runs=[];
const manifestRef=db.doc("parkCatalog/current"), beforeManifest=await manifestRef.get();
const healthBefore=await db.getAll(...SOURCE_SPECS.map(s=>db.doc(`placeSourceHealth/${s.id}`)));
function fixtureRequest({fail,missing}={}) {
 return async url=>{
  const s=SOURCE_SPECS.find(s=>url.startsWith(s.layerURL)||url===s.metadataURL);assert.ok(s,`Unrecognised source ${url}`);
  if(fail===s.id)throw new Error("Source HTTP 503: fictional park pipeline outage");
  if(url===s.metadataURL)return s.countyItem?{id:s.countyItem,owner:"sccprk",access:"public",licenseInfo:null,url:s.layerURL.replace(/\/\d+$/,"")}:
    {success:true,result:{license_id:"cc-by",license_url:s.credit.licenseURL,resources:[{url:s.layerURL}]}};
  if(url===`${s.layerURL}?f=json`)return {fields:["OBJECTID",...s.fields].map(name=>({name}))};
  const params=new URL(url).searchParams, ids=s.id==="city-amenities"?Array.from({length:151},(_,i)=>i+1):s.id==="county-trails"?[1,2]:[1];
  if(params.get("returnIdsOnly"))return {objectIds:ids};
  let features=params.get("objectIds").split(",").map(Number).map(id=>({type:"Feature",properties:{OBJECTID:id,NAME:"Fictional geometry fixture park",park_name:"Different supplied name",
    name:"Fictional feature",CURRENTSTATUS:"Closed",AMENITYSTATUS:"Open",AMENITYTYPE:"PLAYTOT",type:"RESTROOM",distribution:"Public",status:"open",
    public_use:"hiking",dog_use:"on leash",miles:0.2,drinking_water:"yes",restroom:"yes"},
    geometry:s.id==="county-poi"?{type:"Point",coordinates:[-121.89,37.34]}:s.id==="county-trails"?(id===2?null:{type:"LineString",coordinates:[[-121.91,37.34],[-121.87,37.34]]}):polygon}));
  if(missing===s.id)features=features.slice(0,-1);
  return {type:"FeatureCollection",features};
 };
}
async function account(label,method="signUp") {
 const email=`parks-${label}-${suffix}@example.test`;
 const r=await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})});
 const u=await r.json();assert.ok(u.idToken);if(method==="signUp")users.push(u.localId);return {...u,email};
}
async function call(user) {
 const r=await fetch("http://127.0.0.1:5002/connectify-19dd8/us-central1/staffOperations",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${user.idToken}`},body:JSON.stringify({data:{areaId:"san-jose-ca"}})});return r.json();
}
async function client(user,label) {
 const a=initializeApp({apiKey:"local",projectId:"connectify-19dd8"},`park-${label}-${suffix}`);apps.push(a);
 const auth=getAuth(a);connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});await signInWithEmailAndPassword(auth,user.email,password);
 const store=getFirestore(a);connectFirestoreEmulator(store,"127.0.0.1",8899);stores.push(store);return store;
}
async function refused(work) {try{await work();return false;}catch(e){return e.code==="permission-denied";}}
try {
 const good=await runPlaceIngest({request:fixtureRequest()});runs.push(good.runId);
 check("all sources publish a complete generation",good.published&&good.errors.length===0&&good.count===155);
 const features=await loadCatalogFeatures();
 check("stored nested geometry round-trips without vertex loss",features.length===155&&JSON.stringify(features.find(f=>f.id==="city-parks_1").geometry)===JSON.stringify(polygon));
 check("151-feature amenity source is fully persisted across pages",features.filter(f=>f.source==="city-amenities").length===151);
 check("null trail geometry excluded and exposed in source run",good.runs.find(r=>r.source==="county-trails").skippedNullGeometry===1);
 check("names do not control actual place or event joins",parkIdsAt(features,[-121.89,37.34]).length===2&&parkIdsAt(features,[-121.91,37.34]).length===0&&features.find(f=>f.source==="county-poi").parkIds.length===2);
 check("closed source park stays closed in persisted catalog",features.find(f=>f.source==="city-parks").status==="closed");
 const large={type:"LineString",coordinates:Array.from({length:60000},(_,i)=>[-122+(Math.sin(i*997)*0.4),37+(Math.cos(i*577)*0.4)])};
 const encoded=encodeGeometry(large);
 check("large geometry stored as multiple bounded chunks",encoded.chunks.length>1&&encoded.chunks.every(c=>c.length<=180000));
 check("large chunked geometry decodes exactly",JSON.stringify(decodeGeometry(encoded.chunks,encoded.sha256))===JSON.stringify(large));
 assert.throws(()=>decodeGeometry(encoded.chunks,"invalid"),/checksum/);check("geometry corruption is refused",true);
 const partial=await runPlaceIngest({request:fixtureRequest({missing:"city-amenities"})});runs.push(partial.runId);
 check("truncated source page never publishes a partial replacement",!partial.published&&partial.errors.some(e=>e.includes("Incomplete"))&&(await placeCatalogState()).generation===good.runId);
 const failed=await runPlaceIngest({request:fixtureRequest({fail:"city-parks"})});runs.push(failed.runId);
 const current=await placeCatalogState(),health=(await db.doc("placeSourceHealth/city-parks").get()).data();
 check("throwing source preserves last success and records actual failure",health.lastOutcome==="failed"&&health.lastSuccessfulFeatures===1&&health.currentErrors[0].includes("503")&&health.lastSuccessfulRunAt.toMillis()===partial.startedAtMs);
 check("catalog failure exposes stale complete generation and reason",current.generation===good.runId&&current.latestOutcome==="failed"&&current.latestError.includes("fictional park pipeline outage"));
 const older=await runPlaceIngest({request:fixtureRequest(),now:good.startedAtMs-60000});runs.push(older.runId);
 check("older concurrent success cannot overwrite newer failed run",!older.published&&(await placeCatalogState()).generation===good.runId&&(await db.doc("placeSourceHealth/city-parks").get()).data().lastOutcome==="failed");
 let staff=await account("staff");const normal=await account("normal");
 execFileSync(process.execPath,[fileURLToPath(new URL("./staff-admin.mjs",import.meta.url)),"--uid",staff.localId,"--grant","--reason","Local park pipeline proof"],{env:process.env,stdio:"ignore"});
 staff=await account("staff","signInWithPassword");
 check("non-admin refused operations including park source health",(await call(normal)).error?.status==="PERMISSION_DENIED");
 const snapshot=(await call(staff)).result;
 check("staff operations exposes all five sources with actual outage",snapshot.placeSources.length===5&&snapshot.placeSources.find(s=>s.source==="city-parks").currentErrors.some(e=>e.includes("503")));
 check("staff operations distinguishes current catalog from latest failed run",snapshot.placeCatalog.generation===good.runId&&snapshot.placeCatalog.latestOutcome==="failed");
 const normalDB=await client(normal,"normal"),staffDB=await client(staff,"staff");
 for(const path of ["parkCatalog/current","placeSourceHealth/city-parks",`placeIngestRuns/${good.runId}`,`parkGenerations/${good.runId}/features/city-parks_1`]){
  check(`client cannot read private pipeline path ${path.split('/')[0]}`,await refused(()=>getDoc(doc(normalDB,path))));
  check(`even staff cannot directly mutate pipeline path ${path.split('/')[0]}`,await refused(()=>setDoc(doc(staffDB,path),{forged:true})));
 }
 // Demonstrate that abandoned writes are collected while the active catalog is
 // protected even if it is older than the retention cutoff.
 const abandoned=db.doc(`parkGenerations/abandoned-${suffix}`);await abandoned.set({createdAt:new Date(0),status:"building"});await abandoned.collection("features").doc("partial").set({incomplete:true});
 await prunePlaceGenerations();
 check("abandoned generation and nested partial records pruned",!(await abandoned.get()).exists&&!(await abandoned.collection("features").doc("partial").get()).exists);
 check("active complete generation survives pruning",(await db.doc(`parkGenerations/${good.runId}`).get()).exists);
 if(origin){
  const {chromium}=await import("../../Verdure-website--main/node_modules/playwright-core/index.mjs");
  await fetch(`${origin}/admin`); // Compile page before creating a new browser.
  browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
  context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`${origin}/admin`);await page.getByLabel("Staff email").fill(staff.email);await page.getByLabel("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByRole("button",{name:"Operations",exact:true}).click();
  const table=page.getByRole("region",{name:"Park data source health",exact:true});await table.waitFor();
  check("real browser renders pipeline outage and previous success",(await table.innerText()).includes("Source HTTP 503")&&(await table.innerText()).includes("Last success: 1")&&await page.getByText("The previous complete catalog remains available.",{exact:false}).isVisible());
  check("browser renders null-geometry warning",(await table.innerText()).includes("1 source features lack geometry"));
  check("public dataset links shown for all five sources",await table.locator('a[target="_blank"]').count()===5);
  await page.setViewportSize({width:390,height:844});
  check("mobile console fits viewport with scrollable table",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:"/tmp/verdure-parks-operations-mobile.png",fullPage:true});
  check("no browser JavaScript errors",errors.length===0);
 }
 const recovered=await runPlaceIngest({request:fixtureRequest()});runs.push(recovered.runId);
 check("recovery publishes next complete generation and clears current error",recovered.published&&(await placeCatalogState()).latestError===null&&(await db.doc("placeSourceHealth/city-parks").get()).data().currentErrors.length===0);
 check("previous outage remains available for historical review",(await db.doc("placeSourceHealth/city-parks").get()).data().lastError.includes("fictional park pipeline outage"));
 console.log(`${checks} park pipeline${origin?' and browser':''} checks passed`);
} finally {
 if(context)await context.close();if(browser)await browser.close();
 for(const store of stores)await terminate(store);for(const app of apps)await deleteApp(app);
 if(beforeManifest.exists)await manifestRef.set(beforeManifest.data());else await manifestRef.delete();
 for(const old of healthBefore){if(old.exists)await old.ref.set(old.data());else await old.ref.delete();}
 for(const id of runs){await db.recursiveDelete(db.doc(`parkGenerations/${id}`));await db.doc(`placeIngestRuns/${id}`).delete();}
 for(const uid of users)await adminAuth().deleteUser(uid);
}
process.exit(0);
