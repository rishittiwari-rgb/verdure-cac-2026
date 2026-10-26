/** Read-only source inventory. Unknown query syntax fails closed, never disappears
 * from the audit. TypeScript bindings resolve local aliases, conditional builder
 * assignments, finite collection names and Query-parameter helper call sites. */
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SOURCE_ROOTS = ['functions/src', 'Verdure/Verdure', 'Verdure-website--main/src'];
export const TOOL_SOURCES = ['backfill-classify.mjs', 'list-low-confidence.mjs', 'coverage-check.mjs', 'audit-volunteer-supply-local.mjs', 'baseline.mjs', 'backfill-annotate.mjs', 'demo-investor-local.mjs', 'outdoor-supply.mjs'];
const builders = new Set(['where', 'orderBy']);
const passthrough = new Set(['limit', 'limitToLast', 'offset', 'select', 'startAt', 'startAfter', 'endAt', 'endBefore', 'count', 'get']);
const distinct = (values) => [...new Map(values.map((v) => [JSON.stringify(v), v])).values()];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const empty = (collectionGroup, queryScope) => ({ collectionGroup, queryScope, filters: [], orderBy: [] });
export const shapeKey = (q) => JSON.stringify({ collectionGroup: q.collectionGroup, queryScope: q.queryScope,
  filters: [...q.filters].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))), orderBy: q.orderBy });
const fail = (file, line, message) => { throw new Error(`${file}:${line}: ${message}`); };

function filesIn(root, folder) {
  return readdirSync(join(root, folder), { withFileTypes: true }).flatMap((d) => d.isDirectory() ? filesIn(root, `${folder}/${d.name}`)
    : /\.(ts|tsx|js|jsx|mjs|swift)$/.test(d.name) ? [`${folder}/${d.name}`] : []);
}
export function inventory(root) {
  const files = SOURCE_ROOTS.flatMap((dir) => filesIn(root, dir));
  // Operational scripts are also audited; fixture/unit/E2E scripts are not app
  // queries. A newly added operational query script must enter TOOL_SOURCES.
  for (const name of readdirSync(join(root, 'functions/scripts'))) {
    if (!name.endsWith('.mjs') || /(?:-unit|-e2e|-test|^e2e-|^redteam|^seed-|^local-corpus-)/.test(name) ||
      ['firestore-query-inventory.mjs', 'check-firestore-indexes.mjs'].includes(name)) continue;
    const source = readFileSync(join(root, 'functions/scripts', name), 'utf8');
    if (/\.(?:where|orderBy|collectionGroup)\s*\(/.test(source) && !TOOL_SOURCES.includes(name)) throw new Error(`Uninventoried operational query script: ${name}`);
  }
  files.push(...TOOL_SOURCES.map((name) => `functions/scripts/${name}`));
  const inputs = files.map((file) => ({ file, source: readFileSync(join(root, file), 'utf8') }));
  return scanSources(inputs);
}

export function scanSources(inputs) {
  const js = inputs.filter((f) => !f.file.endsWith('.swift'));
  const sources = new Map(js.map(({ file, source }) => [file, source]));
  const options = { allowJs: true, noResolve: true, noLib: true, target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve };
  const host = ts.createCompilerHost(options);
  const originalGet = host.getSourceFile.bind(host);
  host.getSourceFile = (file, lang) => sources.has(file) ? ts.createSourceFile(file, sources.get(file), lang, true) : originalGet(file, lang);
  host.fileExists = (file) => sources.has(file);
  host.readFile = (file) => sources.get(file);
  const program = ts.createProgram([...sources.keys()], options, host), checker = program.getTypeChecker();
  const calls = [], assignments = [], queryHelpers = new Set();
  const visit = (node) => {
    if (ts.isCallExpression(node)) calls.push(node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) assignments.push(node);
    if (ts.isFunctionDeclaration(node) && node.name && node.parameters.some((p) => /\bQuery\b/.test(p.type?.getText() ?? ''))) queryHelpers.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  for (const file of js) {
    const parsed = program.getSourceFile(file.file);
    if (parsed.parseDiagnostics.length) throw new Error(`${file.file}: query source must parse before its indexes can be audited.`);
    visit(parsed);
  }
  const location = (node) => ({ file: node.getSourceFile().fileName, line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  const error = (node, message) => { const p = location(node); fail(p.file, p.line, message); };
  const symbol = (node) => checker.getSymbolAtLocation(node);
  const bindingKey = (node) => { const d = symbol(node)?.valueDeclaration; return d ? `${d.getSourceFile().fileName}:${d.pos}` : node.text; };
  const method = (node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;
  function unwrap(node) {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
    return node;
  }
  function literals(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return [];
    const next = new Set([...seen, node]);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node)) return distinct([...literals(node.whenTrue, next), ...literals(node.whenFalse, next)]);
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((v) => literals(v, next));
    if (ts.isIdentifier(node)) {
      const decl = symbol(node)?.valueDeclaration;
      if (decl && ts.isVariableDeclaration(decl)) {
        if (decl.initializer) return literals(decl.initializer, next);
        if (ts.isVariableDeclarationList(decl.parent) && ts.isForOfStatement(decl.parent.parent)) return literals(decl.parent.parent.expression, next);
      }
    }
    return [];
  }
  function field(node) {
    if (method(node) === 'documentId') return '__name__';
    const values = literals(node);
    if (values.length !== 1) error(node, 'Dynamic/unsupported query field: explicitly extend the inventory resolver.');
    return values[0];
  }
  function condition(node, negate = false) {
    node = unwrap(node);
    if (!ts.isBinaryExpression(node)) return [];
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && !negate) return [...condition(node.left), ...condition(node.right)];
    if (![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) return [];
    const name = ts.isIdentifier(node.left) ? node.left : ts.isIdentifier(node.right) ? node.right : null;
    const value = name === node.left ? node.right : node.left;
    if (!name || !ts.isStringLiteral(value)) return [];
    return [{ binding: bindingKey(name), value: value.text, equal: (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) !== negate }];
  }
  function restrict(shapes, node) {
    const constraints = [];
    for (let child = node, p = node.parent; p && !ts.isFunctionLike(p); child = p, p = p.parent) {
      if (ts.isIfStatement(p)) constraints.push(...condition(p.expression, child === p.elseStatement));
    }
    return shapes.filter((q) => constraints.every((c) => (q.conditions ?? []).every((a) => a.binding !== c.binding ||
      (a.equal && c.equal ? a.value === c.value : a.value !== c.value || a.equal === c.equal))));
  }
  function optionalAssignment(node, decl) {
    for (let parent = node.parent; parent && parent !== decl.parent; parent = parent.parent) {
      if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent) || ts.isSwitchStatement(parent) || ts.isIterationStatement(parent, false)) return true;
      if (ts.isFunctionLike(parent)) break;
    }
    return false;
  }
  function resolve(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) error(node, 'Cyclic or unresolved query binding.');
    const next = new Set([...seen, node]);
    if (ts.isConditionalExpression(node)) return distinct([...resolve(node.whenTrue, next), ...resolve(node.whenFalse, next)]);
    if (ts.isIdentifier(node)) {
      const binding = symbol(node), decl = binding?.valueDeclaration;
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
        let shapes = resolve(decl.initializer, next);
        for (const assignment of assignments.filter((a) => symbol(a.left) === binding && a.getSourceFile() === node.getSourceFile() && a.end <= node.getStart()).sort((a, b) => a.pos - b.pos)) {
          const added = resolve(assignment.right, next);
          shapes = optionalAssignment(assignment, decl) ? distinct([...shapes, ...added]) : added;
        }
        return shapes;
      }
      if (decl && ts.isParameter(decl) && ts.isFunctionDeclaration(decl.parent) && decl.parent.name) {
        const index = decl.parent.parameters.indexOf(decl), name = decl.parent.name.text;
        const callers = calls.filter((c) => ts.isIdentifier(c.expression) && c.expression.text === name);
        if (!callers.length) error(node, `Query helper ${name} has no resolvable call sites.`);
        return distinct(callers.flatMap((c) => resolve(c.arguments[index], next)));
      }
      error(node, 'Unresolved query receiver/alias.');
    }
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) error(node, 'Unsupported query builder.');
    const name = method(node), args = node.arguments;
    if (name === 'collection' || name === 'collectionGroup') {
      let names = literals(args[0]);
      if (ts.isTemplateExpression(args[0])) {
        const tail = args[0].templateSpans.at(-1).literal.text;
        if (tail.startsWith('/') && !tail.slice(1).includes('/')) names = [tail.slice(1)];
      }
      if (!names.length || names.some((n) => !n.split('/').at(-1))) error(node, 'Unresolved dynamic collection.');
      const scope = name === 'collectionGroup' ? 'COLLECTION_GROUP' : 'COLLECTION';
      if (ts.isConditionalExpression(args[0])) {
        return distinct([...[args[0].whenTrue].flatMap((v) => literals(v).map((n) => ({ ...empty(n.split('/').at(-1), scope), conditions: condition(args[0].condition) }))),
          ...[args[0].whenFalse].flatMap((v) => literals(v).map((n) => ({ ...empty(n.split('/').at(-1), scope), conditions: condition(args[0].condition, true) })))]);
      }
      return distinct(names.map((n) => empty(n.split('/').at(-1), scope)));
    }
    if (!builders.has(name) && !passthrough.has(name)) error(node, `Unsupported query method ${name}.`);
    const base = restrict(resolve(node.expression.expression, next), node);
    if (name === 'where') {
      const ops = literals(args[1]);
      if (ops.length !== 1 || !['==', 'in', '!=', 'not-in', '<', '<=', '>', '>=', 'array-contains', 'array-contains-any'].includes(ops[0])) error(node, 'Unsupported query filter/operator.');
      return base.map((q) => ({ ...q, filters: [...q.filters, { field: field(args[0]), op: ops[0] }] }));
    }
    if (name === 'orderBy') {
      const dirs = args[1] ? literals(args[1]) : ['asc'];
      if (dirs.length !== 1 || !['asc', 'desc'].includes(dirs[0])) error(node, 'Dynamic/unsupported query direction.');
      return base.map((q) => ({ ...q, orderBy: [...q.orderBy, { field: field(args[0]), direction: dirs[0] === 'asc' ? 'ASCENDING' : 'DESCENDING' }] }));
    }
    return base;
  }
  const rows = [];
  const knownQuery = (node) => { try { return resolve(node).length > 0; } catch { return false; } };
  for (const file of js) {
    const source = program.getSourceFile(file.file);
    const inspectImport = (node) => {
      if (ts.isImportDeclaration(node) && /firebase\/firestore/.test(node.moduleSpecifier.text)) error(node, 'Modular Firestore imports require an explicit resolver extension; do not silently skip Web queries.');
      if (ts.isPropertyAccessExpression(node) && builders.has(node.name.text) && (!ts.isCallExpression(node.parent) || node.parent.expression !== node) && knownQuery(node.expression)) error(node, 'Detached query method needs a resolver extension.');
      if (ts.isElementAccessExpression(node) && literals(node.argumentExpression).some((name) => builders.has(name))) error(node, 'Computed query methods need a resolver extension.');
      if (ts.isBindingElement(node) && (builders.has(node.name.getText()) || builders.has(node.propertyName?.getText()))) error(node, 'Destructured query method needs a resolver extension.');
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && literals(node.arguments[0]).some((name) => /firebase\/firestore/.test(name))) error(node, 'Dynamic modular Firestore imports need a resolver extension.');
      if (ts.isIdentifier(node) && queryHelpers.has(node.text) && !ts.isFunctionDeclaration(node.parent) && !ts.isImportSpecifier(node.parent) &&
        !(ts.isCallExpression(node.parent) && node.parent.expression === node)) error(node, 'Detached query helper requires a resolver extension.');
      if (ts.isImportSpecifier(node) && queryHelpers.has(node.propertyName?.text) && node.name.text !== node.propertyName.text) error(node, 'Renamed query helper requires a resolver extension.');
      ts.forEachChild(node, inspectImport);
    };
    inspectImport(source);
  }
  for (const call of calls) {
    if (!builders.has(method(call))) continue;
    // The outermost call in a receiver chain includes all inline clauses. An
    // alias initializer is inventoried too: conservative prefixes are explicit.
    let top = call;
    let laterBuilder = false;
    while (ts.isPropertyAccessExpression(top.parent) && ts.isCallExpression(top.parent.parent) && top.parent.expression === top) {
      top = top.parent.parent;
      if (builders.has(method(top))) laterBuilder = true;
    }
    if (laterBuilder) continue;
    for (const q of distinct(resolve(top))) rows.push({ ...location(call.expression.name), collectionGroup: q.collectionGroup,
      queryScope: q.queryScope, filters: q.filters, orderBy: q.orderBy });
  }
  for (const file of inputs.filter((f) => f.file.endsWith('.swift'))) rows.push(...scanSwift(file));
  return distinct(rows).sort((a, b) => compare(a.file, b.file) || a.line - b.line || compare(shapeKey(a), shapeKey(b)));
}

/** Swift chain scanner: lex strings/comments/balanced arguments first so a
 * nested Timestamp call, multiline query or quoted fake query cannot truncate
 * a chain. Unresolved aliases and predicate syntax are deliberately rejected. */
function swiftTokens(source) {
  const out = []; let i = 0, line = 1;
  while (i < source.length) {
    const start = i, row = line;
    if (/\s/.test(source[i])) { if (source[i++] === '\n') line++; continue; }
    if (source.startsWith('//', i)) { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (source.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) { depth++; i += 2; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; }
        else if (source[i++] === '\n') line++;
      }
      continue;
    }
    if (source[i] === '"') {
      const multi = source.startsWith('"""', i), width = multi ? 3 : 1; i += width;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source.slice(i, i + width) === '"'.repeat(width)) { i += width; break; }
        if (source[i++] === '\n') line++;
      }
      out.push({ text: source.slice(start, i), line: row, string: true }); continue;
    }
    if (/[\w$]/.test(source[i])) while (i < source.length && /[\w$]/.test(source[i])) i++;
    else i++;
    out.push({ text: source.slice(start, i), line: row });
  }
  return out;
}
export function scanSwift({ file, source }) {
  const tokens = swiftTokens(source), rows = [], covered = new Set();
  function argumentEnd(start) {
    let depth = 0;
    for (let j = start; j < tokens.length; j++) {
      if (tokens[j].text === '(') depth++;
      if (tokens[j].text === ')' && --depth === 0) return j;
    }
    fail(file, tokens[start].line, 'Unbalanced Swift query arguments.');
  }
  const literal = (token) => token?.string && /^"[^"\\]*"$/.test(token.text) ? token.text.slice(1, -1) : null;
  const ops = { isEqualTo: '==', in: 'in', isNotEqualTo: '!=', notIn: 'not-in', isLessThan: '<', isLessThanOrEqualTo: '<=', isGreaterThan: '>', isGreaterThanOrEqualTo: '>=', arrayContains: 'array-contains', arrayContainsAny: 'array-contains-any' };
  for (let i = 0; i < tokens.length; i++) {
    if (!['collection', 'collectionGroup'].includes(tokens[i].text) || tokens[i - 1]?.text !== '.' || tokens[i + 1]?.text !== '(') continue;
    const name = literal(tokens[i + 2]);
    if (!name) fail(file, tokens[i].line, 'Dynamic Swift collection needs a resolver extension.');
    let q = empty(name.split('/').at(-1), tokens[i].text === 'collectionGroup' ? 'COLLECTION_GROUP' : 'COLLECTION'), j = argumentEnd(i + 1) + 1;
    let locationLine = tokens[i].line, found = false;
    while (tokens[j]?.text === '.' && tokens[j + 2]?.text === '(') {
      const m = tokens[j + 1].text, end = argumentEnd(j + 2), args = tokens.slice(j + 3, end);
      if (m === 'collection' || m === 'collectionGroup') {
        const nested = literal(args[0]);
        if (!nested) fail(file, tokens[j].line, 'Dynamic Swift subcollection.');
        q = empty(nested.split('/').at(-1), m === 'collectionGroup' ? 'COLLECTION_GROUP' : 'COLLECTION');
      } else if (m === 'whereField') {
        const f = literal(args[0]), op = ops[args[2]?.text];
        if (!f || !op) fail(file, tokens[j].line, 'Unsupported Swift filter field/operator.');
        q.filters.push({ field: f, op }); found = true; covered.add(j + 1); locationLine = tokens[j + 1].line;
      } else if (m === 'order') {
        const f = literal(args[2]);
        const descending = args.findIndex((t) => t.text === 'descending');
        if (!f || (descending >= 0 && !['true', 'false'].includes(args[descending + 2]?.text))) fail(file, tokens[j].line, 'Unsupported Swift ordering.');
        q.orderBy.push({ field: f, direction: descending >= 0 && args[descending + 2].text === 'true' ? 'DESCENDING' : 'ASCENDING' });
        found = true; covered.add(j + 1); locationLine = tokens[j + 1].line;
      } else if (!['document', 'limit', 'limitToLast', 'start', 'end', 'getDocuments', 'addSnapshotListener'].includes(m)) {
        if (found) fail(file, tokens[j].line, `Unsupported Swift query method ${m}.`);
        break; // A document read/write is not a filtered collection query.
      }
      j = end + 1;
    }
    if (found) rows.push({ file, line: locationLine, ...q });
    i = Math.max(i, j - 1);
  }
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i - 1]?.text === '.' && ['whereField', 'whereFilter', 'order'].includes(tokens[i].text) && tokens[i + 1]?.text !== '(') fail(file, tokens[i].line, 'Detached Swift query method requires a resolver extension.');
    if (tokens[i - 1]?.text === '.' && tokens[i + 1]?.text === '(' && ['whereField', 'whereFilter', 'order'].includes(tokens[i].text) && !covered.has(i)) fail(file, tokens[i].line, 'Unresolved Swift query alias/predicate; extend the resolver before accepting it.');
  }
  return rows;
}
