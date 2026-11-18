/* Tests for App.trimExtend POLYLINE branch extracted from src/app.js. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
for (const f of ['math', 'geometry', 'model', 'production']) require(path.join(__dirname, '..', 'src', f + '.js'));
const K = globalThis.Kestrel, { V, segmentDistance, lineIntersection, EPS, TAU } = K.Math, G = K.Geo;

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const start = src.indexOf('        trimExtend(entity');
const end = src.indexOf('        entityGrips(');
const body = src.slice(start, end);
const App = new Function('K', 'G', 'V', 'segmentDistance', 'lineIntersection', 'EPS', 'TAU',
    '"use strict";\n    return class { ' + body + ' }')(K, G, V, segmentDistance, lineIntersection, EPS, TAU);

const near = (a, b, d = 1e-6) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < d, `point ${a} vs ${b}`);

function mock(entities = []) {
    const inst = new App();
    inst.doc = {
        entities,
        visible: () => true,
        geometry: e => e.g || G.geometry(e),
        transaction: (name, fn) => { inst.ops.push(name); fn(); },
        remove: ids => { inst.removed.push(...ids); },
        add: e => { inst.added.push(e); },
    };
    inst.ops = []; inst.removed = []; inst.added = [];
    return inst;
}
const verticalLine = x => ({ type: 'LINE', id: 'CUT', points: [[x, -50, 0], [x, 150, 0]] });

let pass = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('PASS', name); } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } };

test('L-shaped open polyline splits into two pieces between two cutters', () => {
    const pl = { type: 'POLYLINE', id: 'P1', points: [[0, 0, 0], [100, 0, 0], [100, 100, 0]], closed: false };
    const app = mock([pl, verticalLine(30), verticalLine(60)]);
    app.trimExtend(pl, [45, 0, 0], false, []);
    assert.deepEqual(app.removed, ['P1']);
    assert.equal(app.added.length, 2, 'two pieces expected');
    const a = app.added[0].points, b = app.added[1].points;
    assert.equal(a.length, 2);
    near(a[0], [0, 0]); near(a[1], [30, 0]);
    assert.equal(b.length, 3);
    near(b[0], [60, 0]); near(b[1], [100, 0]); near(b[2], [100, 100]);
    assert.equal(app.added.every(e => e.type === 'POLYLINE' && !e.closed), true);
    assert.ok(app.ops.includes('Trim polyline'));
});

test('single cut on the clicked segment removes the span up to the end', () => {
    const pl = { type: 'POLYLINE', id: 'P1', points: [[0, 0, 0], [100, 0, 0], [100, 100, 0]], closed: false };
    const app = mock([pl, verticalLine(50)]);
    // Click at t=0.8 on segment 0: span [0.5, 2] is removed, [(0,0),(50,0)] remains.
    app.trimExtend(pl, [80, 0, 0], false, []);
    assert.deepEqual(app.removed, ['P1']);
    assert.equal(app.added.length, 1, 'one piece expected');
    const a = app.added[0].points;
    assert.equal(a.length, 2);
    near(a[0], [0, 0]); near(a[1], [50, 0]);
});

test('closed rectangle splits into one open piece around the removed span', () => {
    const pl = { type: 'POLYLINE', id: 'P1', closed: true, points: [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]] };
    const app = mock([pl, verticalLine(50)]);
    // Click the top edge (between vertex 2 and 3), near (80, 100).
    app.trimExtend(pl, [80, 100, 0], false, []);
    assert.deepEqual(app.removed, ['P1']);
    assert.equal(app.added.length, 1, 'one open piece expected');
    const pts = app.added[0].points;
    assert.equal(app.added[0].closed, false);
    // Walk from (50,100) -> (0,100) -> (0,0) -> (50,0).
    near(pts[0], [50, 100]);
    const last = pts[pts.length - 1];
    near(last, [50, 0]);
    assert.ok(pts.some(q => Math.abs(q[0]) < 1e-6 && Math.abs(q[1]) < 1e-6), 'corner (0,0) kept');
});

test('no cutters throws the explanatory error', () => {
    const pl = { type: 'POLYLINE', id: 'P1', points: [[0, 0, 0], [100, 0, 0], [100, 100, 0]], closed: false };
    const app = mock([pl]);
    assert.throws(() => app.trimExtend(pl, [50, 0, 0], false, []), /No cutting intersections/);
});

test('cutters containing the polyline itself do not hide the real cutter', () => {
    const pl = { type: 'POLYLINE', id: 'P1', points: [[0, 0, 0], [100, 0, 0], [100, 100, 0]], closed: false };
    const app = mock([pl, verticalLine(30), verticalLine(60)]);
    app.trimExtend(pl, [45, 0, 0], false, ['P1']);
    assert.equal(app.added.length, 2, 'two pieces expected');
});

test('click outside every removed interval keeps a single piece', () => {
    const pl = { type: 'POLYLINE', id: 'P1', points: [[0, 0, 0], [100, 0, 0], [100, 100, 0]], closed: false };
    const app = mock([pl, verticalLine(30), verticalLine(60)]);
    app.trimExtend(pl, [95, 0, 0], false, []);
    assert.ok(app.added.length >= 1, 'at least one piece remains');
});

test('bulged polyline trim does not crash and produces pieces', () => {
    const pl = {
        type: 'POLYLINE', id: 'P1', closed: false,
        points: [[0, 0, 0], [100, 0, 0], [100, 100, 0]], bulges: [1, 0, 0],
    };
    const app = mock([pl, verticalLine(50)]);
    app.trimExtend(pl, [50, 40, 0], false, []);
    assert.ok(app.added.length >= 1, 'pieces expected');
});

// A curve that crosses itself is its own cutting edge (AutoCAD behaviour);
// the entity must not be skipped as a cutter just because it is the target.
const bowTie = { type: 'POLYLINE', id: 'P1', closed: false, points: [[0, 0, 0], [100, 100, 0], [100, 0, 0], [0, 100, 0]] };

test('self-intersecting polyline trims against its own crossing', () => {
    const app = mock([bowTie]);
    app.trimExtend(bowTie, [100, 50, 0], false, []);
    assert.equal(app.added.length, 2, 'two pieces expected, got ' + app.added.length);
    const [a, b] = app.added.map(e => e.points);
    near(a[0], [0, 0]); near(a[1], [50, 50]);
    near(b[0], [50, 50]); near(b[1], [0, 100]);
    assert.ok(app.ops.includes('Trim polyline'));
});

test('self-intersecting polyline selected as its own cutting edge trims', () => {
    const app = mock([bowTie]);
    app.trimExtend(bowTie, [100, 50, 0], false, ['P1']);
    assert.equal(app.added.length, 2, 'two pieces expected, got ' + app.added.length);
});

test('closed self-intersecting ring keeps the span around the crossing', () => {
    const pl = { ...bowTie, closed: true };
    const app = mock([pl]);
    app.trimExtend(pl, [100, 50, 0], false, []);
    assert.equal(app.added.length, 1, 'one piece expected, got ' + app.added.length);
    const pts = app.added[0].points;
    near(pts[0], [50, 50]);
    near(pts[pts.length - 1], [50, 50]);
    assert.ok(pts.some(q => Math.abs(q[0]) < 1e-6 && Math.abs(q[1]) < 1e-6), 'corner (0,0) kept');
});

test('explicit foreign cutter still wins when the target crosses itself', () => {
    // Only the vertical line was chosen as a cutting edge, so the bow-tie's
    // own crossing must not add a cut of its own: both pieces end on the
    // line (30,30)/(30,70), never on the self-crossing (50,50).
    const app = mock([bowTie, verticalLine(30)]);
    app.trimExtend(bowTie, [40, 40, 0], false, ['CUT']);
    assert.equal(app.added.length, 2, 'two pieces expected, got ' + app.added.length);
    const [a, b] = app.added.map(e => e.points);
    near(a[0], [0, 0]); near(a[1], [30, 30]);
    near(b[0], [30, 70]); near(b[1], [0, 100]);
});

console.log('\ntrim polyline: ' + pass + ' passed');
