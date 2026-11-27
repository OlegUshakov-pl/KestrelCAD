'use strict';
/* Run: node tests/tolerance-height.test.js — no npm dependencies.
   Numeric limit deviations are drawn at 60% of the text height; the tolerance
   letter/grade stays at the full dimension text height. */
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
    assert.equal(text.composition.runs[0].text.trim(), '40 H7');
    assert.equal(text.composition.runs[1].text.trim(), '(+0.025/0)');
}
const noNumbers = K.Geo.geometry({ ...base, toleranceNumeric: false }).texts[0];
assert.equal(noNumbers.text, '40 H7');
assert.equal(noNumbers.composition, undefined);
const plain = K.Geo.geometry({ ...base, tolerance: undefined, toleranceNumeric: undefined }).texts[0];
assert.equal(plain.composition, undefined);
console.log('PASS numeric deviations at 60%, tolerance letter at full height (3 kinds, plain label unchanged)');
