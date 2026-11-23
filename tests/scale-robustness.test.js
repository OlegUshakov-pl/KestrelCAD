/* Run: node tests/scale-robustness.test.js — no npm dependencies.
 * Regression coverage for scale-dependent numerical failures (tiny features). */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
for (const f of ['math', 'geometry', 'model']) require('../src/' + f + '.js');
const K = globalThis.Kestrel, { V, M } = K.Math, G = K.Geo;
const results = []; let failures = 0;
function test(name, fn) {
    try { fn(); results.push({ name, status: 'passed' }); console.log('PASS', name); }
    catch (error) { failures++; results.push({ name, status: 'failed', error: error.message }); console.error('FAIL', name, '\n ', error.stack); }
}
function near(a, b, epsilon = 1e-9, label = '') {
    assert.ok(Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b)),
        `${label} ${a} != ${b} (relative tolerance ${epsilon})`);
}
function vec(a, b, eps = 1e-9) { assert.equal(a.length, b.length); a.forEach((v, i) => near(v, b[i], eps)); }
function square(s) { return [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0]]; }
function areaOf(points, indices) { return indices.reduce((sum, t) => sum + Math.abs(K.Math.polygonArea(t.map(i => points[i]))), 0); }

// --- triangulation must not depend on the absolute size of the polygon ---
test('concave polygon triangulation is scale invariant', () => {
    const base = [[0, 0, 0], [10, 0, 0], [10, 4, 0], [4, 4, 0], [4, 10, 0], [0, 10, 0]];
    const count = K.Math.triangulate(base).length;
    for (const s of [1e-2, 1e-4, 1e-6, 1e-8]) {
        const p = base.map(([x, y]) => [x * s, y * s, 0]);
        const triangles = K.Math.triangulate(p);
        assert.equal(triangles.length, count, `triangle count at scale ${s}`);
        near(areaOf(p, triangles), 64 * s * s, 1e-9, `area at scale ${s}`);
    }
});
test('sub-micron square triangulates into two full triangles', () => {
    for (const s of [1e-4, 1e-5, 1e-6]) {
        const p = square(s), triangles = K.Math.triangulate(p);
        assert.equal(triangles.length, 2, `triangle count at scale ${s}`);
        near(areaOf(p, triangles), s * s, 1e-9, `area at scale ${s}`);
    }
});
test('solid hatch of a tiny boundary fills the whole area', () => {
    const s = 1e-5, p = square(s);
    const g = G.geometry({ type: 'HATCH', points: p, pattern: 'solid' });
    assert.equal(g.triangles.length, 2);
    near(g.triangles.reduce((a, t) => a + Math.abs(K.Math.polygonArea(t.points.map(q => q.slice(0, 2)))), 0), s * s, 1e-9);
});

// --- normalized vectors and matrix inverses must work at any scale ---
test('normalizing a tiny nonzero vector preserves its direction', () => {
    for (const s of [1e-6, 1e-8, 1e-12, 1e-100]) vec(V.norm([s, 0, 0]), [1, 0, 0], 1e-12);
    vec(V.norm([1e-9, 2e-9, 2e-9]), [1 / 3, 2 / 3, 2 / 3], 1e-12);
    vec(V.norm([0, 0, 0]), [0, 0, 0]);
});
test('inverse of a uniformly scaled matrix is finite and round-trips points', () => {
    for (const s of [1e-8, 1e-16, 1e-20, 1e-30]) {
        const m = M.scale(s), inv = M.inverse(m);
        assert.ok(inv, `inverse exists at scale ${s}`);
        const p = [3, -7, 2];
        vec(M.point(inv, M.point(m, p)), p, 1e-9);
    }
});
test('inverse still rejects a genuinely singular transform', () => {
    assert.equal(M.inverse(M.scale(0)), null);
    assert.equal(M.inverse(M.scale(1, 1, 0)), null);
});

// --- analytic intersection and construction ---
test('line intersection works for short segments and still rejects parallels', () => {
    for (const s of [1e-4, 1e-8, 1e-10]) {
        const hit = K.Math.lineIntersection([0, 0], [s, s], [0, s], [s, 0]);
        assert.ok(hit, `intersection exists at scale ${s}`);
        vec(hit.point, [s / 2, s / 2, 0], 1e-9);
        near(hit.t, .5); near(hit.u, .5);
    }
    assert.equal(K.Math.lineIntersection([0, 0], [1, 0], [0, 1], [1, 1]), null);
});
test('extrusion volume scales as the cube of the profile size', () => {
    const analytic = 1000;
    for (const s of [10, 1, 1e-3, 1e-4, 1e-5]) {
        const e = G.extrude(square(s), s);
        near(G.volume(e), s * s * s, 1e-7, `volume at scale ${s}`);
        assert.equal(e.faces.length, 8);
        assert.ok(analytic > 0);
    }
});
test('degenerate extrusion is still rejected', () => {
    assert.throws(() => G.extrude([[0, 0, 0], [1, 0, 0], [2, 0, 0]], 2), /degenerate/);
    assert.throws(() => G.extrude(square(1), 0), /height cannot be zero/);
});
test('offset accepts tiny circles but rejects a non-positive radius', () => {
    for (const r of [1e-5, 1e-6, 1e-9]) near(G.offset({ type: 'CIRCLE', center: [0, 0, 0], radius: r }, r).radius, 2 * r, 1e-12);
    assert.throws(() => G.offset({ type: 'CIRCLE', center: [0, 0, 0], radius: 1e-6 }, -1e-6), /non-positive/);
});

// --- saved camera data is untrusted input as well ---
test('Camera.restore clamps out-of-range zoom values', () => {
    const c = new K.Camera();
    c.restore({ target: [0, 0, 0], zoom: -5, yaw: 0, pitch: 0 });
    assert.equal(c.zoom, 1e-7);
    c.restore({ target: [0, 0, 0], zoom: 1e12, yaw: 0, pitch: 0 });
    assert.equal(c.zoom, 1e7);
    c.restore({ target: [0, 0, 0], zoom: 2.5, yaw: 0, pitch: 0 });
    assert.equal(c.zoom, 2.5);
});
test('restored camera still projects and unprojects consistently', () => {
    const c = new K.Camera();
    c.resize(800, 600); c.setView('top');
    c.restore({ target: [10, 20, 0], zoom: 3, yaw: 0, pitch: Math.PI / 2, perspective: false });
    const p = [15, -4, 0], s = c.project(p);
    vec(c.unproject(s[0], s[1], p[2]), p, 1e-7);
});

fs.writeFileSync(path.join(__dirname, 'results', 'scale-robustness-results.json'),
    JSON.stringify({ suite: 'scale robustness regressions', passed: results.length - failures, failed: failures, tests: results }, null, 2));
console.log(`\n${results.length - failures}/${results.length} tests passed.`);
process.exitCode = failures ? 1 : 0;
