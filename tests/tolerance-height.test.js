'use strict';
/* Run: node tests/tolerance-height.test.js — no npm dependencies.
   The tolerance run of a dimension label is drawn at 60% of the text height. */
const assert = require('node:assert/strict');
for (const f of ['math', 'geometry', 'model', 'csg', 'exchange', 'iso286', 'production', 'fonts', 'unicode-bidi', 'mtext'])
    require('../src/' + f + '.js');
const K = globalThis.Kestrel;

const base = { type: 'DIMENSION', points: [[0, 0, 0], [40, 0, 0]], offset: -10, textHeight: 10, precision: 0, tolerance: 'H7', toleranceNumeric: true };
for (const kind of [undefined, 'aligned', 'linear']) {
    const text = K.Geo.geometry({ ...base, kind }).texts[0];
    assert.equal(text.text, '40 H7 (+0.025/0)');
    assert.ok(text.composition, 'expected a two-run composition for ' + (kind || 'aligned'));
    assert.deepEqual(text.composition.runs.map(r => r.style.height), [10, 6]);
    assert.equal(text.composition.runs[1].text.trim(), 'H7 (+0.025/0)');
}
const plain = K.Geo.geometry({ ...base, tolerance: undefined, toleranceNumeric: undefined }).texts[0];
assert.equal(plain.composition, undefined);
console.log('PASS tolerance is drawn at 60% of the dimension text height (3 kinds, plain label unchanged)');
