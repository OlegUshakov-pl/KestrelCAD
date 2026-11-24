'use strict';
/* Run: node tests/manufacturing.test.js — no npm dependencies.
   Manufacturing drafting: tolerances, surface finish, position callouts. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
for (const f of ['math', 'geometry', 'model', 'csg', 'exchange', 'production', 'constraints', 'fields', 'text-search'])
    require('../src/' + f + '.js');
const K = globalThis.Kestrel, G = K.Geo, X = K.Exchange, P = K.Production, { V } = K.Math, results = [];
function test(name, fn) { try { fn(); results.push({ name, status: 'passed' }); console.log('PASS', name); }
    catch (e) { results.push({ name, status: 'failed', error: e.stack }); console.error('FAIL', name, e); } }
function fresh() { const d = new K.Drawing('Manufacturing test'); d.currentLayer = '0'; return d; }
function dimension(tolerance, mode = 'right', extra = {}) {
    return { type: 'DIMENSION', points: [[0, 0, 0], [40, 0, 0]], offset: 10, textHeight: 10, precision: 0, tolerance, tolerancePosition: mode, ...extra };
}
const rough = (text = 'Ra 1.6', style = 'plain', flipped = false) => ({ type: 'ROUGHNESS', position: [10, 0, 0], normal: [0, 1, 0], tangent: [1, 0, 0], text, style, flipped, height: 8 });
const callout = (form = 'circle', end = 'arrow', text = '1') => ({ type: 'POSITION', points: [[0, 0, 0], [20, 30, 0]], text, form, end, textHeight: 10 });

test('tolerance validator accepts letters, grades and letter+grade', () => {
    for (const value of ['a', 'Z', '7', '12', 'H7', 'g6', 'K7'])
        assert.equal(P.tolerance(value), value);
});

test('tolerance validator rejects spaces, symbols and long values', () => {
    for (const value of ['H 7', 'H-7', '±7', 'H7 x', 'H12345', 7])
        assert.throws(() => P.tolerance(value));
});

test('tolerance appears to the right of the measured value', () => {
    const d = fresh(); d.add(dimension('H7')); d.reindex();
    assert.equal(G.geometry(d.entities[0]).texts[0].text, '40 H7');
});

test('tolerance appears in parentheses when requested', () => {
    const d = fresh(); d.add(dimension('g6', 'parentheses')); d.reindex();
    assert.equal(G.geometry(d.entities[0]).texts[0].text, '40 (g6)');
});

test('tolerance is appended to a manual dimension text override', () => {
    const d = fresh(); d.add(dimension('a', 'right', { text: 'Ø40' })); d.reindex();
    assert.equal(G.geometry(d.entities[0]).texts[0].text, 'Ø40 a');
});

test('tolerance participates in find and replace', () => {
    const d = fresh(); d.add(dimension('H7')); d.reindex();
    const plan = K.TextSearch.search(d, 'H7');
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0].target.kind, 'tolerance');
    K.TextSearch.replace(d, plan, 'g6');
    assert.equal(d.entities[0].tolerance, 'g6');
    assert.equal(G.geometry(d.entities[0]).texts[0].text, '40 g6');
});

test('invalid tolerance in a project is rejected on load', () => {
    const d = fresh(); d.add(dimension('H 7')); d.reindex();
    assert.throws(() => K.validateProject(d.serialize()), /tolerance/i);
});

test('all four standard roughness values are accepted', () => {
    for (const value of P.ROUGHNESS_VALUES) {
        const d = fresh(); d.add(rough(value)); d.reindex();
        K.validateProject(d.serialize());
        assert.equal(G.geometry(d.entities[0]).texts[0].text, value);
    }
});

test('roughness symbol orients along the surface and mirrors on flip', () => {
    const d = fresh(); d.add(rough()); d.reindex();
    const a = G.geometry(d.entities[0]), b = G.geometry({ ...d.entities[0], flipped: true });
    assert.ok(a.segments.length > 0);
    assert.ok(a.segments[0][1][1] > a.segments[0][0][1]);
    assert.ok(b.segments[0][1][1] < b.segments[0][0][1]);
});

test('roughness symbol types add the required treatment marks', () => {
    const plain = G.geometry(rough('Ra 1.6', 'plain')).segments.length;
    assert.equal(plain, G.geometry(rough('Ra 1.6', 'removal')).segments.length - 1);
    assert.ok(G.geometry(rough('Ra 1.6', 'no-removal')).segments.length > plain + 10);
});

test('position callout works in all four form/end combinations', () => {
    for (const form of ['circle', 'line']) for (const end of ['arrow', 'dot']) {
        const d = fresh(); d.add(callout(form, end, '17')); d.reindex();
        K.validateProject(d.serialize());
        const g = G.geometry(d.entities[0]);
        assert.equal(g.texts[0].text, '17');
        assert.ok(g.segments.length >= 3);
        if (end === 'dot')
            assert.ok(g.triangles.length > 0);
    }
});

test('new entities survive .kcad round trip and atomic undo/redo', () => {
    const d = fresh();
    d.transaction('Add manufacturing objects', () => {
        d.add(dimension('H7', 'parentheses'));
        d.add(rough('Ra 6.3', 'no-removal'));
        d.add(callout('line', 'dot', '3'));
    });
    const copy = K.Drawing.from(d.serialize());
    assert.deepEqual(copy.serialize().entities, d.serialize().entities);
    d.undo();
    assert.equal(d.entities.length, 0);
    d.redo();
    assert.equal(d.entities.length, 3);
});

test('new entities clone cleanly for the clipboard', () => {
    const d = fresh(); d.add(rough()); d.add(callout()); d.reindex();
    const clone = K.clone(d.entities);
    assert.deepEqual(clone, d.entities);
    assert.notEqual(clone[0], d.entities[0]);
});

test('DXF export contains only static geometry for roughness and callouts', () => {
    const d = fresh(); d.add(rough()); d.add(callout('circle', 'dot')); d.reindex();
    const dxf = X.writeDXF(d), parsed = X.parseDXF(dxf), types = new Set(parsed.data.entities.map(e => e.type));
    assert.ok(types.has('LINE'));
    assert.ok(types.has('TEXT'));
    assert.ok(!types.has('ROUGHNESS'));
    assert.ok(!types.has('POSITION'));
});

test('position number can host an associative field', () => {
    const d = fresh(), e = d.add(callout()); d.reindex();
    const b = { version: 1, target: 'text', template: '{{Value}}', sources: [{ name: 'Value', kind: 'literal', value: '42' }] };
    K.Fields.validateBinding(e, b);
    K.Fields.setBinding(d, e.id, b);
    assert.equal(d.entities[0].text, '42');
    const before = JSON.stringify({ entities: [{ id: e.id, text: '42', fieldBindings: K.clone(b) }] });
    assert.throws(() => { d.entities[0].text = '9'; K.Fields.refresh(d, before); }, /field/i);
});

test('rotate by reference reproduces the typed rotation angle', () => {
    const base = [10, 20, 0], ref = [30, 20, 0], target = [10, 40, 0], pointToRotate = [15, 20, 0];
    const reference = Math.atan2(target[1] - base[1], target[0] - base[0]) - Math.atan2(ref[1] - base[1], ref[0] - base[0]);
    const typed = 90 * Math.PI / 180;
    const a = K.Math.M.point(K.Math.M.around(base, K.Math.M.rotation(reference)), pointToRotate);
    const b = K.Math.M.point(K.Math.M.around(base, K.Math.M.rotation(typed)), pointToRotate);
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9));
});

const out = path.join(__dirname, 'results');
fs.mkdirSync(out, { recursive: true });
const failed = results.filter(r => r.status === 'failed').length;
fs.writeFileSync(path.join(out, 'manufacturing-results.json'), JSON.stringify({ suite: 'manufacturing drafting', passed: results.length - failed, failed, tests: results }, null, 2));
console.log(`${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
