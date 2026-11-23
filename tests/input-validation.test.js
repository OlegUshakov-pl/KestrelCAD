/* Run: node tests/input-validation.test.js — no npm dependencies.
 * Regression coverage for malformed input reaching the drawing database. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
for (const f of ['math', 'geometry', 'model']) require('../src/' + f + '.js');
const K = globalThis.Kestrel, G = K.Geo, results = []; let failures = 0;
function test(name, fn) {
    try { fn(); results.push({ name, status: 'passed' }); console.log('PASS', name); }
    catch (error) { failures++; results.push({ name, status: 'failed', error: error.message }); console.error('FAIL', name, '\n ', error.stack); }
}
function project(entity) {
    return {
        format: 'kestrel-cad', version: 2, name: 'Validation', units: 'mm',
        layers: [{ id: '0', name: '0', color: '#ffffff', visible: true, locked: false, lineweight: .25 }],
        entities: [entity]
    };
}
const spline = () => ({ id: 's1', type: 'SPLINE', layer: '0', controlPoints: [[0, 0, 0], [1, 2, 0], [3, 0, 0]], degree: 2, knots: [0, 0, 0, 1, 1, 1], weights: [1, .7, 1] });
const square = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]];

// --- entity ids must be unique and always present ---
test('add() assigns an id when a spread overwrites the generated one', () => {
    const d = new K.Drawing();
    const e = d.add({ type: 'POINT', position: [0, 0, 0], id: undefined });
    assert.equal(typeof e.id, 'string');
    assert.ok(e.id.startsWith('e_'));
    assert.equal(d.byId.get(e.id), e);
    assert.equal(d.byId.size, d.entities.length);
});
test('add() assigns ids to object-form entities without one', () => {
    const d = new K.Drawing();
    const a = d.add({ type: 'POINT', position: [0, 0, 0] });
    const b = d.add({ type: 'POINT', position: [1, 0, 0] });
    assert.notEqual(a.id, b.id);
    assert.equal(d.byId.size, 2);
    const restored = K.Drawing.from(d.serialize());
    assert.equal(restored.entities.length, 2);
    assert.equal(new Set(restored.entities.map(e => e.id)).size, 2);
});
test('add() rejects a duplicate id and the transaction rolls back', () => {
    const d = new K.Drawing();
    d.transaction('seed', () => d.add('POINT', { id: 'dup', position: [0, 0, 0] }));
    assert.throws(() => d.transaction('bad', () => d.add('POINT', { id: 'dup', position: [1, 0, 0] })), /Duplicate entity identifier/);
    assert.equal(d.entities.length, 1);
    assert.equal(d.byId.size, 1);
    assert.equal(d.undoStack.length, 1);
});

// --- knot vectors must match the control net, not be silently ignored ---
test('validate() accepts a correctly sized rational knot vector', () => {
    K.validateProject(project(spline()));
});
test('validate() accepts knots with the implicit degree of three', () => {
    const e = spline();
    delete e.degree; delete e.weights;
    e.controlPoints = [[0, 0, 0], [1, 1, 0], [2, -1, 0], [3, 0, 0]];
    e.knots = G.uniformKnots(4, 3);
    K.validateProject(project(e));
});
test('validate() rejects a knot vector of the wrong length', () => {
    for (const knots of [[0, 0, 0, 1, 1], [0, 0, 0, 1, 1, 1, 1], [0, 0, 0, .5, 1, 1, 1]]) {
        assert.throws(() => K.validateProject(project({ ...spline(), knots })), /knot sequence/, `knots ${knots.join(',')}`);
    }
});

// --- hatch spacing must not fall back to a microscopic value ---
test('negative hatch spacing falls back to the default instead of flooding', () => {
    const normal = G.geometry({ type: 'HATCH', points: square, pattern: 'cross' });
    const negative = G.geometry({ type: 'HATCH', points: square, pattern: 'cross', spacing: -1 });
    assert.deepEqual(negative.segments, normal.segments);
    assert.ok(negative.segments.length < 100);
});
test('positive hatch spacing is still honored', () => {
    const fine = G.geometry({ type: 'HATCH', points: square, pattern: 'cross', spacing: 1 });
    const coarse = G.geometry({ type: 'HATCH', points: square, pattern: 'cross', spacing: 5 });
    assert.ok(fine.segments.length > coarse.segments.length);
});

fs.writeFileSync(path.join(__dirname, 'results', 'input-validation-results.json'),
    JSON.stringify({ suite: 'input validation regressions', passed: results.length - failures, failed: failures, tests: results }, null, 2));
console.log(`\n${results.length - failures}/${results.length} tests passed.`);
process.exitCode = failures ? 1 : 0;
