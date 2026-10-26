#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { inventory, shapeKey, SOURCE_ROOTS, TOOL_SOURCES } from './firestore-query-inventory.mjs';

export function neededFields(q) {
  const orders = q.orderBy.map(({ field, direction }) => ({ fieldPath: field, order: direction }));
  const inequalities = [...new Set(q.filters.filter((f) => !['==', 'in', 'array-contains', 'array-contains-any'].includes(f.op)).map((f) => f.field))].sort();
  const direction = orders.at(-1)?.order ?? 'ASCENDING';
  for (const field of inequalities) if (!orders.some((o) => o.fieldPath === field)) orders.push({ fieldPath: field, order: direction });
  const equality = [...new Set(q.filters.filter((f) => ['==', 'in'].includes(f.op)).map((f) => f.field))].sort()
    .filter((field) => !orders.some((o) => o.fieldPath === field)).map((fieldPath) => ({ fieldPath, order: 'ASCENDING' }));
  const arrays = [...new Set(q.filters.filter((f) => ['array-contains', 'array-contains-any'].includes(f.op)).map((f) => f.field))].sort()
    .map((fieldPath) => ({ fieldPath, arrayConfig: 'CONTAINS' }));
  if (arrays.length > 1) throw new Error('Multiple array fields need a reviewed resolver/index strategy.');
  return [...equality, ...arrays, ...orders];
}
const mode = (field) => field.arrayConfig ?? field.order;
export const indexKey = (index) => `${index.queryScope}/${index.collectionGroup}/${index.fields.map((f) => `${f.fieldPath}:${mode(f)}`).join(',')}`;
const eqFields = (q) => new Set(q.filters.filter((f) => ['==', 'in'].includes(f.op)).map((f) => f.field));
export function matchingIndex(q, config) {
  const needed = neededFields(q), eq = eqFields(q);
  return config.indexes.find((index) => {
    if (index.collectionGroup !== q.collectionGroup || index.queryScope !== q.queryScope || index.fields.length !== needed.length) return false;
    // Equality prefix order and ASC/DESC do not change a query's correctness.
    const prefix = needed.filter((f) => eq.has(f.fieldPath) && !q.orderBy.some((o) => o.field === f.fieldPath));
    if (!prefix.every((f) => index.fields.slice(0, prefix.length).some((candidate) => candidate.fieldPath === f.fieldPath && ['ASCENDING', 'DESCENDING'].includes(candidate.order)))) return false;
    return needed.slice(prefix.length).every((f, i) => {
      const candidate = index.fields[prefix.length + i];
      return candidate.fieldPath === f.fieldPath && mode(candidate) === mode(f);
    });
  });
}
export function indexFor(q, config) {
  const fields = neededFields(q);
  // Explicit __name__ ordering is included in compound mappings, even where a
  // default single-field index could supply the same tie-breaker. This is a
  // conservative, version-controlled sprint policy rather than index merging.
  if (fields.length > 1) {
    const found = matchingIndex(q, config);
    if (!found) throw new Error(`${q.file}:${q.line}: missing composite index ${indexKey({ ...q, fields })}`);
    return indexKey(found);
  }
  const field = fields[0];
  if (!field || field.fieldPath === '__name__') return 'Built-in document-name index';
  const overrides = config.fieldOverrides.filter((o) => o.collectionGroup === q.collectionGroup && [field.fieldPath, '*'].includes(o.fieldPath));
  const override = overrides.find((o) => o.fieldPath === field.fieldPath) ?? overrides.find((o) => o.fieldPath === '*');
  if (q.queryScope === 'COLLECTION_GROUP' || override) {
    if (!override?.indexes.some((i) => i.queryScope === q.queryScope && mode(i) === mode(field))) throw new Error(`${q.file}:${q.line}: missing single-field override ${q.queryScope}/${q.collectionGroup}/${field.fieldPath}:${mode(field)}`);
    return `fieldOverrides: ${q.queryScope}/${q.collectionGroup}/${field.fieldPath}:${mode(field)}`;
  }
  return `Automatic collection index: ${field.fieldPath}:${mode(field)}`;
}

export function validateConfig(config) {
  if (!Array.isArray(config.indexes) || !Array.isArray(config.fieldOverrides)) throw new Error('Expected indexes and fieldOverrides arrays.');
  const seen = new Set();
  for (const index of config.indexes) {
    if (!index.collectionGroup || !['COLLECTION', 'COLLECTION_GROUP'].includes(index.queryScope) || index.fields.length < 2) throw new Error('Invalid composite index collection, scope or field count.');
    if (new Set(index.fields.map((f) => f.fieldPath)).size !== index.fields.length || index.fields.filter((f) => f.arrayConfig).length > 1) throw new Error(`Invalid/repeated fields: ${indexKey(index)}`);
    for (const f of index.fields) if (!f.fieldPath || !!f.order === !!f.arrayConfig || !['ASCENDING', 'DESCENDING', 'CONTAINS'].includes(mode(f))) throw new Error('Invalid index field mode.');
    const name = index.fields.findIndex((f) => f.fieldPath === '__name__');
    if (name >= 0 && name !== index.fields.length - 1) throw new Error('__name__ must be the last index field.');
    const key = indexKey(index);
    if (seen.has(key)) throw new Error(`Duplicate index: ${key}`);
    seen.add(key);
  }
  const overrides = new Set();
  for (const o of config.fieldOverrides) {
    const key = `${o.collectionGroup}/${o.fieldPath}`;
    if (overrides.has(key) || !o.collectionGroup || !o.fieldPath || !Array.isArray(o.indexes)) throw new Error(`Invalid/duplicate field override: ${key}`);
    overrides.add(key);
    for (const i of o.indexes) if (!['COLLECTION', 'COLLECTION_GROUP'].includes(i.queryScope) || !!i.order === !!i.arrayConfig || !['ASCENDING', 'DESCENDING', 'CONTAINS'].includes(mode(i))) throw new Error(`Invalid field override mode: ${key}`);
  }
}

export function renderDocument(rows, config) {
  validateConfig(config);
  const mappings = rows.map((q) => ({ q, index: indexFor(q, config) }));
  const compound = mappings.filter(({ q }) => neededFields(q).length > 1);
  const single = mappings.filter(({ q }) => neededFields(q).length <= 1);
  const table = (entries) => ['| Query location | Collection/scope | Filters | Explicit ordering | Matching index |', '| --- | --- | --- | --- | --- |',
    ...entries.map(({ q, index }) => `| \`${q.file}:${q.line}\` | ${q.collectionGroup} / ${q.queryScope} | ${q.filters.map((f) => `${f.field} ${f.op}`).join('; ') || '—'} | ${q.orderBy.map((o) => `${o.field} ${o.direction}`).join('; ') || 'Implicit/default'} | \`${index}\` |`)].join('\n');
  return `# Firestore query and index audit\n\n` +
    `Local source/configuration proof only. No index has been deployed by this audit. The emulator does not enforce composite indexes; green emulator tests do not prove live index readiness. After a separately authorized deployment, wait for indexes to become ready and verify representative queries on that environment.\n\n` +
    `## Reproduce and enforce\n\n` +
    `Run \`cd functions && npm run check:indexes\`. The command scans the current sources, checks every mapping against \`firestore.indexes.json\`, and rejects stale or undocumented queries. CI and \`test:units\` run it. After reviewing a source change and adding any necessary index, run \`node functions/scripts/check-firestore-indexes.mjs --write-docs\` from the repository root. This only regenerates this document; it never writes indexes or deploys.\n\n` +
    `## Coverage and interpretation\n\n` +
    `Source roots: ${SOURCE_ROOTS.map((s) => `\`${s}\``).join(', ')}. Operational scripts: ${TOOL_SOURCES.map((s) => `\`functions/scripts/${s}\``).join(', ')}. Tests and fixtures are excluded. New operational scripts containing queries are rejected until explicitly inventoried. The website console calls Firebase Functions; its Firestore queries appear under the server handlers below. Supabase SQL is outside this Firestore inventory.\n\n` +
    `TypeScript is parsed structurally, including variable aliases, conditional reassignments, finite collection names, and query helper parameters. Swift chains use a comment/string-aware balanced scanner. Unknown fields, operators, receivers, predicates, modular Web Firestore imports or dynamic directions fail closed and require a resolver extension. No whole-file hash substitutes for query inspection. Query values and pagination bounds do not alter index shape. Locations identify the last filter/order builder in a chain.\n\n` +
    `The inventory includes conservative builder prefixes and conditional variants, even if a later order is always appended before execution. Literal discriminator guards correlate the staff partner selector with its optional partnerId filter; that filter applies only to partnerPerks. The offline allRows helper's document-name order is resolved against all callers.\n\n` +
    `Every multiple-field query has an explicit matching composite, including equality-only combinations that Firestore could otherwise serve by index merging. Equality-prefix permutations/directions are accepted; ordered fields and array modes must match. A range with no explicit ordering receives its implicit ascending order. Single-field collection queries use automatic indexes; filtered/ordered collection-group queries require a matching fieldOverride. A scalar comparison against an array (ingestRuns.errors == []) uses ASCENDING, not CONTAINS. Explicit document-name order is conservatively included in composite definitions.\n\n` +
    `See [Firebase index types](https://firebase.google.com/docs/firestore/query-data/index-overview) and [index configuration schema](https://firebase.google.com/docs/reference/firestore/indexes).\n\n` +
    `## Compound mappings (${compound.length})\n\n${table(compound)}\n\n` +
    `## Single-field and document-name mappings (${single.length})\n\n${table(single)}\n`;
}
export function checkDocument(rows, config, actual) {
  const expected = renderDocument(rows, config);
  if (actual !== expected) throw new Error('Undocumented or stale Firestore query mapping. Review the source/index changes, then regenerate docs/FIRESTORE-INDEXES.md with --write-docs.');
  return { queries: rows.length, compoundMappings: rows.filter((q) => neededFields(q).length > 1).length,
    queryShapes: new Set(rows.map(shapeKey)).size, compositeDefinitions: config.indexes.length, fieldOverrides: config.fieldOverrides.length };
}
export function main(args = process.argv.slice(2)) {
  if (args.some((arg) => arg !== '--write-docs')) throw new Error('Only --write-docs is supported; no deployment or index write mode exists.');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), rows = inventory(root);
  const config = JSON.parse(readFileSync(resolve(root, 'firestore.indexes.json'), 'utf8'));
  const doc = resolve(root, 'docs/FIRESTORE-INDEXES.md');
  if (args.includes('--write-docs')) writeFileSync(doc, renderDocument(rows, config));
  const result = checkDocument(rows, config, readFileSync(doc, 'utf8'));
  console.log(JSON.stringify({ status: 'passed', ...result }, null, 2));
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
