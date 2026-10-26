import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { encodePack, selectionInput, MAX_PACK_BYTES, PACK_LIFETIME_MS } from "../lib/offline/packs.js";
import { thumbnailURL, compressThumbnail } from "../lib/offline/media.js";
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
test("single and set selections deduplicate without losing parks", () => assert.deepEqual(selectionInput({ kind: "parks", parkIds: ["city-parks_1", "county-boundaries_1", "city-parks_1"] }).parkIds, ["city-parks_1", "county-boundaries_1"]));
for (const input of [{}, {kind:"parks",parkIds:[]}, {kind:"parks",parkIds:["../users"]}, {kind:"parks",parkIds:Array(51).fill("city-parks_1")},
  {kind:"area",latitude:"37",longitude:0,radiusMiles:1}, {kind:"area",latitude:91,longitude:0,radiusMiles:1},
  {kind:"area",latitude:37,longitude:0,radiusMiles:21}, {kind:"area",latitude:37,longitude:0,radiusMiles:0}])
  test(`malformed pack selection refused ${JSON.stringify(input).slice(0,90)}`,()=>assert.throws(()=>selectionInput(input),e=>e.code==="invalid-argument"));
test("area preserves exact coordinates and radius",()=>assert.deepEqual(selectionInput({kind:"area",latitude:37.33,longitude:-121.89,radiusMiles:3}),{kind:"area",latitude:37.33,longitude:-121.89,radiusMiles:3}));
test("multi-part non-ASCII geometry/facts round-trip with checksum",()=>{
  const value={name:"San José 🌲".repeat(60_000),geometry:{type:"Polygon",coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}};
  const encoded=encodePack(value);assert.ok(encoded.chunks.length>1);
  const bytes=Buffer.concat(encoded.chunks.map(c=>Buffer.from(c,"base64")));
  assert.deepEqual(JSON.parse(bytes.toString()),value);assert.equal(createHash("sha256").update(bytes).digest("hex"),encoded.sha256);
  assert.equal(encoded.storedBytes,bytes.length);
  assert.equal(encoded.downloadBytes,encoded.chunks.reduce((n,data,index)=>n+Buffer.byteLength(JSON.stringify({result:{index,data,sha256:encoded.sha256}})),0));
});
test("both stored payload and actual encoded download have a hard 50 MB cap",()=>{
  for(const bytes of [MAX_PACK_BYTES,38_000_000]) assert.throws(()=>encodePack({data:"x".repeat(bytes)}),e=>e.code==="resource-exhausted");
  assert.ok(encodePack({data:"x".repeat(30_000_000)}).downloadBytes<MAX_PACK_BYTES);
});
test("offline snapshot validity is exactly seven days",()=>assert.equal(PACK_LIFETIME_MS,604800000));
for(const url of ["http://images.unsplash.com/a", "https://127.0.0.1/a", "https://images.unsplash.com.evil.example/a", "https://evil.example/a", "https://user:pass@images.unsplash.com/a", "https://images.unsplash.com:444/a", "file:///tmp/a"])
  test(`thumbnail network target refused ${url}`,()=>assert.equal(thumbnailURL(url),null));
test("known public provider thumbnail URL accepted",()=>assert.equal(thumbnailURL("https://images.unsplash.com/photo-real").hostname,"images.unsplash.com"));
const jpeg=await compressThumbnail(await sharp({create:{width:2000,height:1200,channels:3,background:"green"}}).png().toBuffer());
const meta=await sharp(jpeg).metadata();
test("thumbnail is a small JPEG without original metadata",()=>{assert.equal(meta.format,"jpeg");assert.ok(meta.width<=320&&meta.height<=240);assert.ok(jpeg.length<=40000);assert.equal(meta.exif,undefined);});
await assert.rejects(()=>compressThumbnail(Buffer.alloc(2*1024*1024+1)));passed++;
await assert.rejects(()=>compressThumbnail(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'></svg>")));passed++;
console.log(`${passed} offline pack unit checks passed`);
