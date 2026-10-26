import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventory, scanSources, scanSwift, shapeKey, SOURCE_ROOTS, TOOL_SOURCES } from './firestore-query-inventory.mjs';
import { checkDocument, indexFor, indexKey, neededFields, renderDocument, validateConfig } from './check-firestore-indexes.mjs';

let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
const scan = (source, file = 'fixture.ts') => scanSources([{ file, source }]);
const shape = (filters, orderBy = [], queryScope = 'COLLECTION', collectionGroup = 'events') => ({ file: 'fixture.ts', line: 1, collectionGroup, queryScope, filters, orderBy });
const eq = (field) => ({ field, op: '==' });
const order = (field, direction = 'ASCENDING') => ({ field, direction });
function configFor(rows) {
  const config = { indexes: [], fieldOverrides: [] }, seen = new Set();
  for (const q of rows) {
    const fields = neededFields(q), key = indexKey({ ...q, fields });
    if (fields.length > 1 && !seen.has(key)) config.indexes.push({ collectionGroup: q.collectionGroup, queryScope: q.queryScope, fields });
    else if (fields.length === 1 && q.queryScope === 'COLLECTION_GROUP' && !seen.has(key)) config.fieldOverrides.push({ collectionGroup: q.collectionGroup, fieldPath: fields[0].fieldPath,
      indexes: [{ queryScope: q.queryScope, order: fields[0].order }] });
    seen.add(key);
  }
  return config;
}
const base = 'db.collection("events").where("active", "==", true).where("date", ">=", now).orderBy("date").get();';
const rows = scan(base), config = configFor(rows), doc = renderDocument(rows, config);
test('direct compound source maps exact fields', () => assert.deepEqual(neededFields(rows[0]), [{ fieldPath: 'active', order: 'ASCENDING' }, { fieldPath: 'date', order: 'ASCENDING' }]));
test('unchanged source/document/config pass', () => assert.equal(checkDocument(rows, config, doc).queries, 1));
test('new undocumented compound query fails', () => assert.throws(() => checkDocument(scan(base + '\ndb.collection("posts").where("hidden","==",false).orderBy("createdAt","desc").get();'), configFor(scan(base + '\ndb.collection("posts").where("hidden","==",false).orderBy("createdAt","desc").get();')), doc), /Undocumented/));
test('removed index fails even with unchanged documentation', () => assert.throws(() => checkDocument(rows, { ...config, indexes: [] }, doc), /missing composite/));
test('wrong ordered direction fails', () => { const c = structuredClone(config); c.indexes[0].fields[1].order = 'DESCENDING'; assert.throws(() => checkDocument(rows, c, doc), /missing composite/); });
test('wrong collection scope fails', () => { const c = structuredClone(config); c.indexes[0].queryScope = 'COLLECTION_GROUP'; assert.throws(() => checkDocument(rows, c, doc), /missing composite/); });
test('extra indexed field is not a valid substitute', () => { const c = structuredClone(config); c.indexes[0].fields.push({ fieldPath: 'unrelated', order: 'ASCENDING' }); assert.throws(() => indexFor(rows[0], c), /missing composite/); });
test('equality prefix permutation and direction accepted', () => { const q = shape([eq('a'), eq('b'), { field: 'date', op: '>' }], [order('date')]); const c = configFor([q]); c.indexes[0].fields.splice(0, 2, { fieldPath: 'b', order: 'DESCENDING' }, { fieldPath: 'a', order: 'ASCENDING' }); assert.ok(indexFor(q, c)); });
test('unordered compound range has implicit ascending field', () => assert.deepEqual(neededFields(shape([eq('organizerId'), { field: 'date', op: '>=' }])), [{ fieldPath: 'organizerId', order: 'ASCENDING' }, { fieldPath: 'date', order: 'ASCENDING' }]));
test('same-field two-sided range is indexed once', () => assert.equal(neededFields(shape([eq('active'), { field: 'date', op: '>=' }, { field: 'date', op: '<' }], [order('date')])).length, 2));
test('array filter requires CONTAINS mode', () => { const q = shape([eq('active'), { field: 'members', op: 'array-contains' }]); const c = configFor([q]); c.indexes[0].fields[1] = { fieldPath: 'members', order: 'ASCENDING' }; assert.throws(() => indexFor(q, c), /missing composite/); });
test('array equality is not array-contains', () => assert.equal(neededFields(shape([eq('source'), eq('errors')], [order('runAt', 'DESCENDING')]))[0].order, 'ASCENDING'));
test('collection-group single field needs override', () => assert.throws(() => indexFor(shape([eq('uid')], [], 'COLLECTION_GROUP', 'friends'), { indexes: [], fieldOverrides: [] }), /missing single-field/));
test('correct group override passes', () => { const q = shape([eq('uid')], [], 'COLLECTION_GROUP', 'friends'); assert.match(indexFor(q, configFor([q])), /fieldOverrides/); });
test('collection-only override cannot satisfy group query', () => { const q = shape([eq('uid')], [], 'COLLECTION_GROUP', 'friends'), c = configFor([q]); c.fieldOverrides[0].indexes[0].queryScope = 'COLLECTION'; assert.throws(() => indexFor(q, c), /missing single-field/); });
test('automatic field exemption is respected', () => assert.throws(() => indexFor(shape([eq('uid')], [], 'COLLECTION', 'users'), { indexes: [], fieldOverrides: [{ collectionGroup: 'users', fieldPath: 'uid', indexes: [] }] }), /missing single-field/));
test('duplicate definition fails', () => assert.throws(() => validateConfig({ ...config, indexes: [...config.indexes, ...config.indexes] }), /Duplicate/));
test('array/order simultaneously fails', () => { const c = structuredClone(config); c.indexes[0].fields[0].arrayConfig = 'CONTAINS'; assert.throws(() => validateConfig(c), /Invalid index/); });
test('local query alias carries prior filters', () => { const r = scan('const q=db.collection("events").where("active","==",true); q.orderBy("date").get();'); assert.ok(r.some((q) => q.filters[0]?.field === 'active' && q.orderBy[0]?.field === 'date')); });
test('conditional reassignment inventories both paths', () => { const r = scan('let q=db.collection("events").where("active","==",true); if(category) q=q.where("category","==",category); q=q.orderBy("date"); q.get();'); assert.deepEqual(r.filter((q) => q.orderBy.length).map((q) => q.filters.length).sort(), [1, 2]); });
test('ternary status == and in variants survive', () => { const r = scan('let q = resolved ? db.collection("queue").where("status","in", statuses) : db.collection("queue").where("status","==",status); q.orderBy("createdAt").get();'); assert.deepEqual(new Set(r.filter((q) => q.orderBy.length).map((q) => q.filters[0].op)), new Set(['in', '=='])); });
test('collection discriminators rule out impossible branches', () => { const r = scan('let q = db.collection(kind === "partners" ? "partners" : "partnerPerks"); if(kind === "perks" && id) q = q.where("partnerId","==",id); q=q.orderBy("__name__");'); assert.ok(r.some((q) => q.collectionGroup === 'partnerPerks' && q.filters.length)); assert.ok(!r.some((q) => q.collectionGroup === 'partners' && q.filters.length)); });
test('for-of finite collection names all inventoried', () => assert.deepEqual(new Set(scan('for (const c of ["one","two"]) { db.collection(c).where("createdAt","<", now).get(); }').map((q) => q.collectionGroup)), new Set(['one', 'two'])));
test('template subcollection uses final collection ID', () => assert.equal(scan('db.collection(`users/${uid}/invites`).where("status","==","pending").get();')[0].collectionGroup, 'invites'));
test('Query parameter helper appends its own ordering', () => { const r = scan('async function allRows(query: FirebaseFirestore.Query) { return query.orderBy("__name__").get(); } allRows(db.collection("plans").where("memberUIDs","array-contains", uid));'); assert.ok(r.some((q) => q.orderBy.length && q.filters[0].op === 'array-contains')); });
test('detached Query helper cannot hide caller transforms', () => assert.throws(() => scan('function allRows(query: FirebaseFirestore.Query) { return query.orderBy("date").get(); } allRows(db.collection("events").where("active","==",true)); const fetch = allRows; fetch(db.collection("events").where("category","==","Program"));'), /Detached query helper/));
test('same offsets in different files do not suppress queries', () => assert.equal(scanSources([{ file: 'a.ts', source: base }, { file: 'b.ts', source: base }]).length, 2));
test('literal comments/strings do not create TS queries', () => assert.equal(scan('// db.collection("bad").where("x","==",1)\nconst s = \'db.collection("bad").where("x","==",1)\';').length, 0));
test('dynamic field fails closed', () => assert.throws(() => scan('db.collection("events").where(field,"==",1).get();'), /Dynamic\/unsupported query field/));
test('dynamic direction fails closed', () => assert.throws(() => scan('db.collection("events").orderBy("date", direction).get();'), /direction/));
test('unresolved receiver fails closed', () => assert.throws(() => scan('externalQuery.where("a","==",1).where("b","==",2).get();'), /receiver/));
test('computed where method fails closed', () => assert.throws(() => scan('const q=db.collection("events"); q["where"]("a","==",1);'), /Computed query/));
test('detached where method fails closed', () => assert.throws(() => scan('const q=db.collection("events"); const filter=q.where; filter("a","==",1);'), /Detached query/));
test('modular Web query requires resolver extension', () => assert.throws(() => scan('import {query, where} from "firebase/firestore"; query(ref,where("a","==",1));'), /Modular Firestore/));
test('new equality-only compound query requires mapping', () => { const r = scan('db.collection("events").where("a","==",1).where("b","==",2).get();'); assert.throws(() => indexFor(r[0], { indexes: [], fieldOverrides: [] }), /missing composite/); });
const swift = { file: 'Fixture.swift', source: 'let q = db.collection("events")\n .whereField("hidden", isEqualTo: false)\n .whereField("date", isGreaterThanOrEqualTo: Timestamp(date: Date()))\n .order(by: "date", descending: true)\n .getDocuments()' };
test('Swift balanced multiline arguments parsed', () => assert.deepEqual(scanSwift(swift)[0].orderBy, [order('date', 'DESCENDING')]));
test('Swift nested subcollection chosen over parent', () => assert.equal(scanSwift({ file: 'Fixture.swift', source: 'db.collection("users").document(uid).collection("invites").order(by: "createdAt").getDocuments()' })[0].collectionGroup, 'invites'));
test('Swift comments and quoted fake methods ignored', () => assert.equal(scanSwift({ file: 'Fixture.swift', source: '// db.collection("bad").whereField("x", isEqualTo: 1)\nlet s = "whereField(\\"x\\", isEqualTo: 1)"' }).length, 0));
test('Swift detached alias fails closed', () => assert.throws(() => scanSwift({ file: 'Fixture.swift', source: 'q.whereField("a", isEqualTo: 1).whereField("b", isEqualTo: 2)' }), /Unresolved Swift/));
test('Swift detached method fails closed', () => assert.throws(() => scanSwift({ file: 'Fixture.swift', source: 'let filter = db.collection("events").whereField\nfilter("a", 1)' }), /Detached Swift/));
test('Swift unsupported predicate fails closed', () => assert.throws(() => scanSwift({ file: 'Fixture.swift', source: 'db.collection("events").whereFilter(Filter.andFilter([]))' }), /Unresolved Swift/));
test('Swift source change invalidates documentation', () => { const old = scanSources([swift]), c = configFor(old), d = renderDocument(old, c); const changed = scanSources([{ ...swift, source: swift.source.replace('"hidden"', '"active"') }]); assert.throws(() => checkDocument(changed, configFor(changed), d), /Undocumented/); });
test('filter values and limit changes preserve index shape', () => assert.equal(shapeKey(scan(base)[0]), shapeKey(scan(base.replace('true', 'false').replace('.get()', '.limit(10).get()'))[0])));

// Exercise actual directory discovery, not just a parser fed known filenames.
// These are owned temporary fixtures; production source/configuration is never
// mutated to prove a negative case.
const root = mkdtempSync(join(tmpdir(), 'verdure-index-guard-'));
try {
  for (const folder of [...SOURCE_ROOTS, 'functions/scripts']) mkdirSync(join(root, folder), { recursive: true });
  for (const file of TOOL_SOURCES) writeFileSync(join(root, 'functions/scripts', file), '');
  const initial = join(root, 'functions/src/query.ts'); writeFileSync(initial, base);
  const original = inventory(root), c = configFor(original), d = renderDocument(original, c);
  test('directory discovery finds the existing query', () => assert.equal(checkDocument(inventory(root), c, d).queries, 1));
  const added = join(root, 'functions/src/new-query.ts'); writeFileSync(added, base);
  test('new backend file with existing index still needs documentation', () => assert.throws(() => checkDocument(inventory(root), c, d), /Undocumented/));
  rmSync(added);
  const native = join(root, 'Verdure/Verdure/NewQuery.swift');
  writeFileSync(native, 'db.collection("events").whereField("active", isEqualTo: true).whereField("date", isGreaterThanOrEqualTo: now).order(by: "date").getDocuments()');
  test('new Swift file requires documentation', () => assert.throws(() => checkDocument(inventory(root), c, d), /Undocumented/));
  rmSync(native);
  const cli = join(root, 'functions/scripts/new-query.mjs'); writeFileSync(cli, base);
  test('new operational query script requires explicit inventory inclusion', () => assert.throws(() => inventory(root), /Uninventoried operational/));
  rmSync(cli);
  writeFileSync(initial, base.replace('"date"', '"startsAt"'));
  test('real file edit fails for missing corresponding index', () => assert.throws(() => checkDocument(inventory(root), c, d), /missing composite/));
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(JSON.stringify({ status: 'passed', checks }, null, 2));
