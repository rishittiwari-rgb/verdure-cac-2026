import assert from "node:assert/strict";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,"127.0.0.1:8899");assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,"127.0.0.1:9099");process.env.GCLOUD_PROJECT="connectify-19dd8";
const {db}=await import("../lib/common.js"),{getAuth}=await import("firebase-admin/auth"),{Timestamp}=await import("firebase-admin/firestore");
const clean=process.argv.includes("--clean");
for(const label of ["adult","teen"]){const uid=`program-native-${label}`,email=`${uid}@example.test`;let existing;try{existing=await getAuth().getUser(uid)}catch(e){if(e.code!=="auth/user-not-found")throw e}if(existing)assert.equal(existing.email,email);
 await db.recursiveDelete(db.doc(`users/${uid}`));
 if(clean){if(existing)await getAuth().deleteUser(uid)}else{if(!existing)await getAuth().createUser({uid,email,password:"local-program-native-only"});await db.doc(`users/${uid}`).set({displayName:"Fictional Program Member",birthYear:label==="adult"?2000:2011,ageBand:label==="adult"?"adult":"minor",interests:["community"],pointsBalance:0});}
 for(const action of ["programListings","recommendedEvents"])await db.doc(`rateLimits/${uid}_${action}`).delete();
}
for(let i=0;i<13;i++){const ref=db.doc(`events/program-native-${i}`);if(clean){await ref.delete();continue}
 await ref.set({title:`Fictional native program ${i}`,organizer:"Fictional Program Organization",category:"Program",opportunitySubtype:"program",source:"staff-program",website:"https://example.org/official-program",active:true,hidden:false,broadcast:true,creatorID:"verdure-programs",pointValue:0,attendeeCount:0,areaId:"san-jose-ca",locationName:"Fictional Program Venue",time:"Application deadline",date:Timestamp.fromMillis(Date.now()+5*86400000),applicationDeadline:Timestamp.fromMillis(Date.now()+(i===11?-86400000:5*86400000)),minimumAge:i===10?13:18,maximumAge:i===10?17:110,priceMin:0,isFree:true,virtual:i===0,latitude:i===12?0:37.335,longitude:i===12?0:-121.89});
}
await db.doc("feedCaches/san-jose-ca").delete();
console.log(clean?"Removed fictional Program native fixtures":"Seeded fictional Program native fixtures (no real listings)");
