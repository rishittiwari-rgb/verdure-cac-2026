import assert from "node:assert/strict";
process.env.GCLOUD_PROJECT = "connectify-19dd8";
const { Timestamp } = await import("firebase-admin/firestore");
const { programEligible, validateProgram } = await import("../lib/programs.js");
let passed = 0; function check(label, fn) { fn(); passed++; console.log(`PASS ${label}`); }
const now = Date.UTC(2026,9,4), listing = { category:"Program", active:true, hidden:false, broadcast:true, minimumAge:13, maximumAge:17, applicationDeadline:Timestamp.fromMillis(now+1000) };
const teen={birthYear:2011,ageBand:"minor"}, adult={birthYear:2000,ageBand:"adult"};
check("fifteen-year-old can see published thirteen-to-seventeen program",()=>assert.ok(programEligible(listing,teen,now)));
check("fifteen-year-old cannot see eighteen-plus program",()=>assert.equal(programEligible({...listing,minimumAge:18,maximumAge:30},teen,now),false));
check("adult outside maximum age excluded",()=>assert.equal(programEligible(listing,adult,now),false));
check("eligible adult included",()=>assert.ok(programEligible({...listing,minimumAge:18,maximumAge:110},adult,now)));
for(const patch of [{active:false},{hidden:true},{broadcast:false},{removed:true},{applicationDeadline:Timestamp.fromMillis(now)},{minimumAge:null},{maximumAge:null},{minimumAge:20},{maximumAge:12}])
 check(`invalid/expired eligibility ${JSON.stringify(patch)}`,()=>assert.equal(programEligible({...listing,...patch},teen,now),false));
for(const profile of [{},{birthYear:2020,ageBand:"minor"},{birthYear:2000,ageBand:"minor"}])
 check(`unknown/underage/inconsistent age ${JSON.stringify(profile)}`,()=>assert.equal(programEligible({...listing,minimumAge:18,maximumAge:110},profile,now),false));
check("ordinary events unaffected by program policy",()=>assert.ok(programEligible({category:"Workshop"},{},now)));
const raw={title:"Fictional program",organization:"Fictional organizer",officialURL:"https://example.org/program",deadlineMs:now+86400000,minimumAge:13,maximumAge:17,cost:0,format:"virtual",address:"123 Fixture St",active:true};
check("valid free virtual program retains published fields",()=>{const d=validateProgram(raw,now);assert.equal(d.virtual,true);assert.equal(d.priceMin,0);assert.equal(d.minimumAge,13)});
for(const patch of [{minimumAge:undefined},{maximumAge:undefined},{maximumAge:12},{deadlineMs:now},{deadlineMs:now+3*366*86400000},{cost:undefined},{cost:-1},{cost:"0"},{format:"remote"},{address:""},{active:"yes"},{officialURL:"javascript:alert(1)"},{officialURL:"http://example.org/program"},{officialURL:"https://user:pass@example.org/"},{officialURL:"https://127.0.0.1/program"},{latitude:37}])
 check(`curation rejects ${JSON.stringify(patch)}`,()=>assert.throws(()=>validateProgram({...raw,...patch},now)));
console.log(`${passed} program unit checks passed`);
