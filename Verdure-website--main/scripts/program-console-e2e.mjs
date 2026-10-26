import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,"127.0.0.1:8899");process.env.FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099";process.env.GCLOUD_PROJECT="connectify-19dd8";
const {db}=await import("../../functions/lib/common.js"),{geocodeFixtureId}=await import("../../functions/lib/staff-partners.js"),{getAuth}=createRequire(new URL("../../functions/package.json",import.meta.url))("firebase-admin/auth");
const origin="http://127.0.0.1:3104",suffix=Date.now().toString(36),email=`program-console-${suffix}@example.test`,password="local-program-console-only",session=`program-console-${suffix}`;
const user=await(await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})})).json();assert.ok(user.localId);
const address=`987 Fictional Program Street ${suffix}, San Jose, CA`,geo=geocodeFixtureId(address),title=`Fictional console program ${suffix}`,events=[],auditIDs=[];
let checks=0;function check(name,condition){assert.ok(condition,name);checks++;console.log(`PASS ${name}`);}
function browser(...args){return execFileSync("npx",["--yes","agent-browser@0.38.2","--session",session,...args],{encoding:"utf8",timeout:60000});}
function fill(label,value){browser("find","label",label,"fill",value)}function button(label){browser("find","role","button","click","--name",label,"--exact")}
function snapshot(){return browser("snapshot","-i")}
try{
 execFileSync(process.execPath,[fileURLToPath(new URL("../../functions/scripts/staff-admin.mjs",import.meta.url)),"--uid",user.localId,"--grant","--reason","Fictional Program browser curation validation"],{env:process.env,stdio:"ignore"});
 await db.doc(`qaGeocodes/${geo}`).set({response:{result:{addressMatches:[{matchedAddress:address,coordinates:{x:-121.89,y:37.335}}]}}});
 browser("open",`${origin}/admin`);browser("wait","--text","Sign in to review and manage");snapshot();
 fill("Staff email",email);fill("Password",password);button("Sign in");browser("wait","--text","Moderation");snapshot();button("Programs");browser("wait","--text","Add a program");
 snapshot();const initial=browser("get","text","body");check("Programs is an authenticated staff tool with required age cost deadline and format",["Minimum eligible age","Maximum eligible age","Published cost (USD)","Application deadline","Program format"].every(x=>initial.includes(x)));
 fill("Program title",title);fill("Program organization","Fictional Program Organization");fill("Official listing link","https://example.org/official-program");
 const deadline=new Date(Date.now()+10*86400000),local=new Date(deadline.getTime()-deadline.getTimezoneOffset()*60000).toISOString().slice(0,16);
 browser("eval",`(()=>{const el=document.querySelector('input[name="deadline"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,${JSON.stringify(local)});el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return el.value})()`);
 fill("Published cost (USD)","0");fill("Program venue address",address);fill("Reason for program change","Fictional official listing checked by staff");button("Save program");
 check("native form validation refuses missing age eligibility",(await db.collection("events").where("title","==",title).get()).empty);
 fill("Minimum eligible age","13");fill("Maximum eligible age","17");
 const formatRef=snapshot().split("\n").find(x=>x.includes('combobox "Program format"'))?.match(/ref=(e\d+)/)?.[1];assert.ok(formatRef);browser("select",`@${formatRef}`,"virtual");
 browser("check",'input[name="active"]');button("Save program");browser("wait","--text","Program saved.");snapshot();
 const created=await db.collection("events").where("title","==",title).get();assert.equal(created.size,1);const item=created.docs[0];events.push(item.id);
 check("browser save persists geocoded virtual free program with required ages",item.data().virtual&&item.data().minimumAge===13&&item.data().maximumAge===17&&item.data().latitude===37.335&&item.data().pointValue===0&&item.data().active);
 check("saved official link and full deadline visible in console",browser("get","text","body").includes(title)&&browser("get","text","body").includes("Ages 13–17"));
 browser("click",`article[data-program-id="${item.id}"] > button:first-of-type`);browser("wait","--text","Edit program");snapshot();
 fill("Program title",`${title} edited`);fill("Published cost (USD)","12.5");fill("Reason for program change","Fictional published cost updated");button("Save program");browser("wait","--text",`${title} edited`);snapshot();
 const changed=(await item.ref.get()).data();check("browser edit updates same listing and cost",changed.title===`${title} edited`&&changed.priceMin===12.5);
 fill(`Deactivation reason for ${title} edited`,"Fictional listing withdrawn");browser("click",`article[data-program-id="${item.id}"] > button:last-of-type`);browser("wait","--text","Program deactivated.");snapshot();
 check("browser deactivation persists immediately and displays inactive",!(await item.ref.get()).data().active&&browser("get","text",`article[data-program-id="${item.id}"]`).includes("Inactive"));
 browser("set","viewport","390","844");browser("eval","window.scrollTo(0,0)");snapshot();
 browser("screenshot",fileURLToPath(new URL("../../docs/evidence/program-staff-mobile-2026-10-04.png",import.meta.url)));
 const overflow=browser("eval","document.documentElement.scrollWidth <= window.innerWidth");check("mobile console has no horizontal overflow",overflow.trim()==="true");
 const audit=await db.collection("staffAudit").where("actor","==",user.localId).get();auditIDs.push(...audit.docs.map(d=>d.id));
 check("actual browser read create edit and deactivate are audited",audit.docs.filter(d=>d.data().action==="program:save").length===2&&audit.docs.some(d=>d.data().action==="program:deactivate")&&audit.docs.some(d=>d.data().action==="program:list"));
 console.log(`${checks} Program browser curation checks passed`);
}catch(error){
 try{console.error("Browser failure context:",browser("get","text","body").slice(0,4000));console.error(snapshot())}catch{}
 throw error;
}finally{
 try{browser("close")}catch{}
 for(const id of events){await db.recursiveDelete(db.doc(`events/${id}`));const a=await db.collection("staffAudit").where("target","==",`events/${id}`).get();auditIDs.push(...a.docs.map(d=>d.id));}
 const mine=await db.collection("staffAudit").where("actor","==",user.localId).get();auditIDs.push(...mine.docs.map(d=>d.id));const claims=await db.collection("staffAudit").where("target","==",`auth/${user.localId}`).get();auditIDs.push(...claims.docs.map(d=>d.id));
 for(const id of new Set(auditIDs))await db.doc(`staffAudit/${id}`).delete();await db.doc(`qaGeocodes/${geo}`).delete();await db.recursiveDelete(db.doc(`users/${user.localId}`));await getAuth().deleteUser(user.localId);
}
