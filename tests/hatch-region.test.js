/* Regression tests for App.enclosingBoundary extracted from src/app.js. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
for (const f of ['math', 'geometry', 'model', 'production']) require(path.join(__dirname, '..', 'src', f + '.js'));
const K = globalThis.Kestrel, { V, inside, polygonArea, segmentDistance, EPS, TAU } = K.Math, G = K.Geo;

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const start = src.indexOf('        enclosingBoundary(p');
const end = src.indexOf('        snapPoint(');
const body = src.slice(start, end);
const Enclosing = new Function('K', 'G', 'V', 'inside', 'polygonArea', 'segmentDistance', 'EPS', 'TAU', '"use strict";\n    return class { ' + body + ' }')(K, G, V, inside, polygonArea, segmentDistance, EPS, TAU);

const line = (a, b) => ({ type: 'LINE', id: 'L' + Math.random(), points: [a, b], g: { segments: [[a, b]], points: [a, b] } });
const arcEntity = (center, radius, a0, a1) => {
    const e = { type: 'ARC', center, radius, startAngle: a0, endAngle: a1 };
    return { type: 'ARC', id: 'A' + Math.random(), ...e, g: { segments: G.geometry(e).segments, points: G.geometry(e).points } };
};
const circleEntity = (id, center, radius) => {
    const e = { type: 'CIRCLE', center, radius };
    return { type: 'CIRCLE', id, center, radius, g: { segments: G.geometry(e).segments, points: G.geometry(e).points } };
};
const circlePolyline = (id, center, radius, closed = true, n = 120) => {
    const pts = Array.from({ length: n }, (_, i) => {
        const a = TAU * i / n;
        return [center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a), 0];
    });
    return { type: 'POLYLINE', id, points: pts, closed };
};
function mockApp(entities) {
    const inst = new Enclosing();
    inst.ensureIndex = () => { };
    inst.index = { items: new Map(entities.map(e => [e.id || Math.random(), { e, g: e.g || {} }])) };
    inst.doc = { editable: () => true, visible: () => true };
    return inst;
}
const P = pseudo => { assert.equal(pseudo.type, 'POLYLINE'); assert.equal(pseudo.closed, true); return pseudo.points; };
const area = poly => Math.abs(polygonArea(poly));
const HALF = Math.PI * 900 / 2;

let pass = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('PASS', name); } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } };

test('region of four lines is detected inside', () => {
    const app = mockApp([line([0, 0, 0], [100, 0, 0]), line([100, 0, 0], [100, 50, 0]), line([100, 50, 0], [0, 50, 0]), line([0, 50, 0], [0, 0, 0])]);
    assert.equal(P(app.enclosingBoundary([50, 25, 0])).length, 4);
});

test('edge pick honours allowEdge', () => {
    const app = mockApp([line([0, 0, 0], [100, 0, 0]), line([100, 0, 0], [100, 50, 0]), line([100, 50, 0], [0, 50, 0]), line([0, 50, 0], [0, 0, 0])]);
    assert.equal(app.enclosingBoundary([50, 50, 0]), null);
    assert.ok(app.enclosingBoundary([50, 50, 0], true));
});

test('slot bounded by two lines and two arcs', () => {
    const app = mockApp([line([25, 50, 0], [25, 10, 0]), line([75, 50, 0], [75, 10, 0]), arcEntity([50, 50, 0], 25, 0, Math.PI), arcEntity([50, 10, 0], 25, Math.PI, 2 * Math.PI)]);
    const got = app.enclosingBoundary([50, 30, 0]);
    assert.ok(got, 'slot not found');
    const a = area(P(got));
    assert.ok(a > 2000 && a < 4500, 'slot area ~3525, got ' + a.toFixed(1));
});

test('innermost region wins', () => {
    const outer = [line([0, 0, 0], [100, 0, 0]), line([100, 0, 0], [100, 100, 0]), line([100, 100, 0], [0, 100, 0]), line([0, 100, 0], [0, 0, 0])];
    const inner = [line([40, 40, 0], [60, 40, 0]), line([60, 40, 0], [60, 60, 0]), line([60, 60, 0], [40, 60, 0]), line([40, 60, 0], [40, 40, 0])];
    const app = mockApp([...outer, ...inner]);
    assert.ok(Math.abs(area(P(app.enclosingBoundary([50, 50, 0]))) - 400) < 1e-6);
    assert.ok(Math.abs(area(P(app.enclosingBoundary([10, 10, 0]))) - 10000) < 1e-6);
});

test('open chain of two lines yields nothing', () => {
    const app = mockApp([line([0, 0, 0], [100, 0, 0]), line([100, 0, 0], [100, 50, 0])]);
    assert.equal(app.enclosingBoundary([50, 25, 0]), null);
});

test('lone circle entity keeps its id', () => {
    const circle = circleEntity('C1', [0, 0, 0], 30);
    assert.equal(mockApp([circle]).enclosingBoundary([5, 5, 0]), circle);
});

test('circle inside line region: innermost wins', () => {
    const circle = circleEntity('C1', [50, 50, 0], 30);
    const outer = [line([0, 0, 0], [100, 0, 0]), line([100, 0, 0], [100, 100, 0]), line([100, 100, 0], [0, 100, 0]), line([0, 100, 0], [0, 0, 0])];
    const app = mockApp([...outer, circle]);
    assert.equal(app.enclosingBoundary([50, 50, 0]), circle);
    assert.notEqual(app.enclosingBoundary([5, 50, 0]), circle);
});

test('DIMENSION does not join the boundary graph', () => {
    const dim = { type: 'DIMENSION', id: 'D1', points: [[0, 0, 0], [10, 0, 0]], offset: 5, g: { segments: [[[0, 0, 0], [10, 0, 0]]], points: [] } };
    assert.equal(mockApp([dim]).enclosingBoundary([5, -2, 0]), null);
});

test('chord with endpoints on the circle gives half-discs', () => {
    const app = mockApp([circleEntity('C1', [0, 0, 0], 30), line([-30, 0, 0], [30, 0, 0])]);
    const upper = app.enclosingBoundary([0, 15, 0]);
    assert.ok(upper && upper.type === 'POLYLINE' && !upper.id, 'upper half must be a pseudo region');
    assert.ok(Math.abs(area(upper.points) - HALF) < 60, 'upper ' + area(upper.points).toFixed(1));
    const lower = app.enclosingBoundary([0, -15, 0]);
    assert.ok(Math.abs(area(lower.points) - HALF) < 60, 'lower ' + area(lower.points).toFixed(1));
    assert.ok(Math.abs(area(upper.points) + area(lower.points) - Math.PI * 900) < 120);
});

test('overshooting chord also splits the circle', () => {
    const app = mockApp([circleEntity('C1', [0, 0, 0], 30), line([-60, 0, 0], [60, 0, 0])]);
    const got = app.enclosingBoundary([0, 15, 0]);
    assert.ok(Math.abs(area(got.points) - HALF) < 60, 'got ' + area(got.points).toFixed(1));
});

test('closed tessellated polyline circle keeps its id', () => {
    const ring = circlePolyline('R1', [0, 0, 0], 30);
    assert.equal(mockApp([ring]).enclosingBoundary([0, 0, 0]).id, 'R1');
});

test('open tessellated ring (gap) still forms its disc', () => {
    const ring = circlePolyline('R1', [0, 0, 0], 30, false);
    const got = mockApp([ring]).enclosingBoundary([0, 0, 0]);
    assert.ok(got, 'no region for open ring');
    assert.ok(Math.abs(area(P(got)) - Math.PI * 900) < 200, 'area ' + area(P(got)).toFixed(1));
});

test('concentric circles: inner entity inside, ring region with island between', () => {
    const outer = circleEntity('OUT', [0, 0, 0], 50), inner = circleEntity('IN', [0, 0, 0], 20);
    const app = mockApp([outer, inner]);
    assert.equal(app.enclosingBoundary([0, 0, 0]), inner);
    const got = app.enclosingBoundary([35, 0, 0]);
    assert.equal(got.type, 'POLYLINE');
    assert.ok(Array.isArray(got.loops) && got.loops.length === 1, 'one island expected');
    const Pd = globalThis.Kestrel.Production;
    const g = Pd.hatchGeometry({ type: 'HATCH', points: got.points, loops: [got.points, ...got.loops], pattern: 'solid', spacing: 1, angle: 0, normal: [0, 0, 1] });
    const a = g.triangles.reduce((s, t) => s + V.len(V.cross(V.sub(t.points[1], t.points[0]), V.sub(t.points[2], t.points[0]))) / 2, 0);
    assert.ok(Math.abs(a - Math.PI * (2500 - 400)) < 120, `even-odd area ${a.toFixed(1)}`);
});

test('two intersecting tessellated circles: bowl region below', () => {
    const big = circlePolyline('BIG', [0, 0, 0], 50), small = circlePolyline('SMALL', [0, -38, 0], 25);
    const app = mockApp([big, small]);
    const got = app.enclosingBoundary([0, -58, 0]);
    assert.ok(got, 'bowl not found');
    const a = area(P(got));
    assert.ok(a < Math.PI * 625 + 50, 'must be a sub-region, got ' + a.toFixed(1));
    assert.ok(a > 100, 'bowl should have area, got ' + a.toFixed(1));
});

console.log('\nenclosingBoundary regression: ' + pass + ' passed');
