/* Reproduces the two-intersecting-tessellated-circles screenshot scenario. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
for (const f of ['math', 'geometry', 'model', 'production']) require(path.join(__dirname, '..', 'src', f + '.js'));
const K = globalThis.Kestrel, { V, inside, polygonArea, segmentDistance, EPS, TAU } = K.Math, G = K.Geo, P = K.Production;

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const start = src.indexOf('        enclosingBoundary(p');
const end = src.indexOf('        snapPoint(');
const body = src.slice(start, end);
const Enclosing = new Function('K', 'G', 'V', 'inside', 'polygonArea', 'segmentDistance', 'EPS', 'TAU', '"use strict";\n    return class { ' + body + ' }')(K, G, V, inside, polygonArea, segmentDistance, EPS, TAU);

// Tessellated circle as an imported polyline (like DXF LWPOLYLINE circles).
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
    inst.index = { items: new Map(entities.map(e => [e.id, { e, g: e.g || {} }])) };
    inst.doc = { editable: () => true, visible: () => true };
    return inst;
}
let pass = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('PASS', name); } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } };
const area = poly => Math.abs(polygonArea(poly));

// Screenshot geometry: big circle R=50 at (0,0); small circle R=25 at (0,-38) — intersecting.
const big = circlePolyline('BIG', [0, 0, 0], 50);
const small = circlePolyline('SMALL', [0, -38, 0], 25);
const SMALL_AREA = Math.PI * 625;

test('lone tessellated closed polyline circle returns the entity itself', () => {
    const app = mockApp([circlePolyline('C1', [0, 0, 0], 30)]);
    const got = app.enclosingBoundary([0, 0, 0]);
    assert.equal(got && got.id, 'C1', 'must keep the entity (not pseudo): ' + JSON.stringify(got && got.type));
});

test('open (not closed) tessellated ring still forms a region', () => {
    const app = mockApp([circlePolyline('C1', [0, 0, 0], 30, false)]);
    const got = app.enclosingBoundary([0, 0, 0]);
    assert.ok(got, 'region not found for open ring');
    assert.equal(got.type, 'POLYLINE');
    assert.ok(Math.abs(area(got.points) - Math.PI * 900) < 200, 'disc area expected, got ' + area(got.points).toFixed(1));
});

test('intersecting circles: pick in the upper small-circle part', () => {
    const app = mockApp([big, small]);
    const got = app.enclosingBoundary([0, -20, 0]);
    assert.ok(got, 'no region found');
    const a = area(got.type === 'POLYLINE' && got.id ? got.points || [] : got.points);
    console.log('   region type:', got.type, got.id || '(pseudo)', 'area:', a.toFixed(1));
});

test('intersecting circles: pick in the bowl (below big circle edge)', () => {
    const app = mockApp([big, small]);
    const got = app.enclosingBoundary([0, -58, 0]);
    assert.ok(got, 'no region found for bowl pick');
    const pts = got.id ? (got.points || []) : got.points;
    const a = area(pts);
    console.log('   region type:', got.type, got.id || '(pseudo)', 'area:', a.toFixed(1), 'loops:', (got.loops || []).length);
    assert.ok(a < SMALL_AREA + 50, 'must be a sub-region, not the full small circle');
});

test('hatch creation + render pipeline for a tessellated region', () => {
    const app = mockApp([big, small]);
    const got = app.enclosingBoundary([0, -58, 0]);
    const ring = G.path(got.id ? got : { type: 'POLYLINE', points: got.points, closed: true }, .5);
    assert.ok(ring.length >= 3, 'boundary path empty');
    for (const pattern of ['ANSI31', 'cross', 'solid']) {
        const h = { type: 'HATCH', points: ring, pattern, spacing: 3, angle: Math.PI / 4, normal: [0, 0, 1] };
        P.validateEntity(h);
        const g = G.geometry(h, .25);
        const segs = g.segments.length, tris = g.triangles.length;
        console.log(`   pattern ${pattern}: segments=${segs} triangles=${tris}`);
        if (pattern === 'solid')
            assert.ok(tris >= 2, 'solid hatch must produce triangles');
        else
            assert.ok(segs > ring.length, 'pattern lines missing, only boundary rendered');
    }
});

console.log('\nscreenshot scenario: ' + pass + ' passed');
