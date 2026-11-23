/* Tests for App.trimExtend SPLINE branch extracted from src/app.js. */
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
const spline = (cps, degree = 3, weights = null) => {
    const e = { type: 'SPLINE', id: 'S1', controlPoints: cps, degree: Math.min(degree, cps.length - 1), knots: G.uniformKnots(cps.length, Math.min(degree, cps.length - 1)) };
    if (weights) e.weights = weights;
    return e;
};
const verticalLine = x => ({ type: 'LINE', id: 'CUT', points: [[x, -100, 0], [x, 100, 0]] });
const evalAt = (e, t) => G.nurbs(e, t);

const results = [];
let pass = 0;
const test = (name, fn) => { try { fn(); pass++; results.push({ name, status: 'passed' }); console.log('PASS', name); } catch (e) { results.push({ name, status: 'failed', error: e.message }); console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } };

// Wavy cubic spline with 5 control points.
const CP = [[0, 0, 0], [25, 40, 0], [50, -40, 0], [75, 40, 0], [100, 0, 0]];
const S = spline(CP);

function checkPiece(p, label) {
    assert.equal(p.type, 'SPLINE', label + ': type kept');
    assert.ok(p.controlPoints.length >= 2, label + ': at least 2 control points');
    assert.ok(!Array.isArray(p.points), label + ': no raw points field');
    assert.equal(p.knots.length, p.controlPoints.length + p.degree + 1, label + ': knots length');
    assert.ok(p.knots.every((k, i) => i === 0 || k >= p.knots[i - 1] - 1e-12), label + ': knots non-decreasing');
    assert.ok(Math.abs(p.knots[p.degree] - p.knots[0]) < 1e-9, label + ': clamped start (knots[degree]=knots[0])');
    assert.ok(Math.abs(p.knots[p.controlPoints.length] - p.knots[p.knots.length - 1]) < 1e-9, label + ': clamped end (knots[cp]=last)');
    // Sampled curve stays inside the original bbox.
    for (let i = 0; i <= 10; i++) {
        const q = evalAt(p, i / 10);
        assert.ok(q[0] > -1 && q[0] < 101 && q[1] > -45 && q[1] < 45, label + ': point outside original bounds ' + q);
    }
}

test('middle interval removal leaves two spline pieces with matching joint', () => {
    const t0 = 0.3, t1 = 0.7, x0 = evalAt(S, t0)[0], x1 = evalAt(S, t1)[0];
    const app = mock([S, verticalLine(x0), verticalLine(x1)]);
    const mid = evalAt(S, 0.5);
    app.trimExtend(S, [mid[0], mid[1], 0], false, []);
    assert.deepEqual(app.removed, ['S1']);
    assert.equal(app.added.length, 2, 'two pieces expected, got ' + app.added.length);
    const [a, b] = app.added;
    checkPiece(a, 'left piece');
    checkPiece(b, 'right piece');
    // The pieces are separated by the removed interval — check each end
    // against the curve instead of piece-to-piece continuity.
    const endA = evalAt(a, 1), startB = evalAt(b, 0);
    assert.ok(V.dist(endA, evalAt(S, t0)) < 0.5, `left piece ends at ${endA}, expected near curve(t=0.3)`);
    assert.ok(V.dist(startB, evalAt(S, t1)) < 0.5, `right piece starts at ${startB}, expected near curve(t=0.7)`);
    assert.ok(V.dist(evalAt(a, 0), evalAt(S, 0)) < 1e-6, 'left piece starts at curve start');
    assert.ok(V.dist(evalAt(b, 1), evalAt(S, 1)) < 1e-6, 'right piece ends at curve end');
});

test('click in first interval keeps one piece from cut to end', () => {
    const t0 = 0.25, x0 = evalAt(S, t0)[0];
    const app = mock([S, verticalLine(x0)]);
    const near0 = evalAt(S, 0.05);
    app.trimExtend(S, [near0[0], near0[1], 0], false, []);
    assert.equal(app.added.length, 1, 'one piece expected, got ' + app.added.length);
    const p = app.added[0];
    checkPiece(p, 'tail piece');
    assert.ok(V.dist(evalAt(p, 0), evalAt(S, t0)) < 0.5, 'piece starts at the cut');
    assert.ok(V.dist(evalAt(p, 1), evalAt(S, 1)) < 1e-6, 'piece ends at curve end');
});

test('rational spline (weights) trims consistently', () => {
    const W = [1, 2, 1, 2, 1];
    const rs = spline(CP, 3, W);
    const t0 = 0.4, t1 = 0.7;
    const app = mock([rs, verticalLine(evalAt(rs, t0)[0]), verticalLine(evalAt(rs, t1)[0])]);
    const mid = evalAt(rs, 0.55);
    app.trimExtend(rs, [mid[0], mid[1], 0], false, []);
    assert.equal(app.added.length, 2, 'two pieces expected, got ' + app.added.length);
    const [a, b] = app.added;
    assert.ok(Array.isArray(b.weights) && b.weights.length === b.controlPoints.length, 'weights carried over');
    checkPiece(a, 'rational left');
    checkPiece(b, 'rational right');
    assert.ok(V.dist(evalAt(a, 0), evalAt(rs, 0)) < 1e-6, 'left piece starts at curve start');
    assert.ok(V.dist(evalAt(a, 1), evalAt(rs, t0)) < 0.5, `left piece ends at ${evalAt(a, 1)}, expected near ${evalAt(rs, t0)}`);
    assert.ok(V.dist(evalAt(b, 0), evalAt(rs, t1)) < 0.5, 'right piece starts at the cut');
    assert.ok(V.dist(evalAt(b, 1), evalAt(rs, 1)) < 1e-6, 'right piece ends at curve end');
    // Sampled rational piece follows the original curve exactly between cuts.
    for (const [piece, lo] of [[a, 0], [b, t1]]) {
        let worst = 0;
        for (let i = 1; i < 20; i++) {
            const q = evalAt(piece, i / 20);
            let best = Infinity;
            for (let j = 0; j <= 200; j++) {
                const d = V.dist(evalAt(rs, j / 200), q);
                if (d < best) best = d;
            }
            worst = Math.max(worst, best);
        }
        assert.ok(worst < 0.3, 'rational piece follows the original curve, worst dev ' + worst.toFixed(4));
    }
});

test('no cutters throws the explanatory error', () => {
    const app = mock([S]);
    assert.throws(() => app.trimExtend(S, [50, 0, 0], false, []), /No cutting intersections/);
});

test('cutters containing the spline itself do not hide the real cutter', () => {
    // Reproduces the bug: TRIM started while the spline was selected, so
    // selectedIds = [spline] and the crossing line was ignored.
    const t0 = 0.35, x0 = evalAt(S, t0)[0];
    const app = mock([S, verticalLine(x0)]);
    const mid = evalAt(S, 0.8);
    app.trimExtend(S, [mid[0], mid[1], 0], false, ['S1']);
    assert.equal(app.added.length, 1, 'one piece expected, got ' + app.added.length);
    checkPiece(app.added[0], 'head piece');
    assert.ok(V.dist(evalAt(app.added[0], 0), evalAt(S, 0)) < 1e-6, 'piece starts at curve start');
    assert.ok(V.dist(evalAt(app.added[0], 1), evalAt(S, t0)) < 0.5, 'piece ends at the cut');
});

test('quadratic spline trims too', () => {
    const q = spline([[0, 0, 0], [50, 30, 0], [100, 0, 0]], 2);
    const t0 = 0.5, x0 = evalAt(q, t0)[0];
    const app = mock([q, verticalLine(x0)]);
    const near0 = evalAt(q, 0.1);
    app.trimExtend(q, [near0[0], near0[1], 0], false, []);
    assert.equal(app.added.length, 1, 'one piece expected, got ' + app.added.length);
    checkPiece(app.added[0], 'quadratic piece');
    assert.equal(app.added[0].degree, 2, 'degree kept');
});

// Imported splines often carry knots outside [0,1] (DXF group 40 is verbatim).
// Sample indices are normalized parameters, so the split must convert them
// back to the spline's actual knot domain before inserting knots.
const knotDomainCases = [
    ['scaled 0..10', G.uniformKnots(5, 3).map(k => k * 10), 0, 10],
    ['shifted 5..15', G.uniformKnots(5, 3).map(k => k * 10 + 5), 5, 15],
];
for (const [label, knots, lo, hi] of knotDomainCases) {
    test(label + ' knot domain trims at the clicked interval', () => {
        const s = { ...S, knots: knots.slice() };
        const t0 = 0.3, t1 = 0.7;
        const app = mock([s, verticalLine(evalAt(s, t0)[0]), verticalLine(evalAt(s, t1)[0])]);
        const mid = evalAt(s, 0.5);
        app.trimExtend(s, [mid[0], mid[1], 0], false, []);
        assert.equal(app.added.length, 2, 'two pieces expected');
        const [a, b] = app.added;
        for (const p of [a, b]) {
            assert.equal(p.type, 'SPLINE');
            assert.equal(p.knots.length, p.controlPoints.length + p.degree + 1);
            assert.ok(p.knots.every((k, i) => i === 0 || k >= p.knots[i - 1] - 1e-9), 'knots monotone: ' + p.knots);
            assert.ok(p.knots[0] >= lo - 1e-9 && p.knots[p.knots.length - 1] <= hi + 1e-9,
                'knots stay in the original domain: ' + p.knots);
        }
        assert.ok(V.dist(evalAt(a, 1), evalAt(s, t0)) < 0.5, 'left piece ends at the first cut');
        assert.ok(V.dist(evalAt(b, 0), evalAt(s, t1)) < 0.5, 'right piece starts at the second cut');
        assert.ok(V.dist(evalAt(a, 0), evalAt(s, 0)) < 1e-6, 'left piece keeps spline start');
        assert.ok(V.dist(evalAt(b, 1), evalAt(s, 1)) < 1e-6, 'right piece keeps spline end');
    });
}

test('rational spline with non-unit knot domain keeps weights consistent', () => {
    const knots = G.uniformKnots(5, 3).map(k => k * 20 + 3);
    const s = { ...S, knots, weights: [1, 2, 1, 2, 1] };
    const t0 = 0.4, t1 = 0.7;
    const app = mock([s, verticalLine(evalAt(s, t0)[0]), verticalLine(evalAt(s, t1)[0])]);
    const mid = evalAt(s, 0.55);
    app.trimExtend(s, [mid[0], mid[1], 0], false, []);
    assert.equal(app.added.length, 2, 'two pieces expected');
    for (const p of app.added) {
        assert.equal(p.weights.length, p.controlPoints.length, 'weights carried over');
        assert.ok(p.weights.every(w => Number.isFinite(w) && w > 0), 'positive weights');
    }
    assert.ok(V.dist(evalAt(app.added[0], 1), evalAt(s, t0)) < 0.5, 'left piece ends at the cut');
    assert.ok(V.dist(evalAt(app.added[1], 0), evalAt(s, t1)) < 0.5, 'right piece starts at the cut');
});

// A curve crossing itself is its own cutting edge: the target entity must
// not be skipped as a cutter just because it is the entity being trimmed.
const plainSplineChecks = (p, label) => {
    assert.equal(p.type, 'SPLINE', label + ': type kept');
    assert.ok(p.controlPoints.length >= 2, label + ': at least 2 control points');
    assert.equal(p.knots.length, p.controlPoints.length + p.degree + 1, label + ': knots length');
    assert.ok(p.knots.every((k, i) => i === 0 || k >= p.knots[i - 1] - 1e-12), label + ': knots monotone');
};

test('self-intersecting spline trims against its own crossing', () => {
    const bow = spline([[0, 0, 0], [100, 100, 0], [100, 0, 0], [0, 100, 0]], 1);
    const app = mock([bow]);
    app.trimExtend(bow, [100, 50, 0], false, []);
    assert.equal(app.added.length, 2, 'two pieces expected, got ' + app.added.length);
    const ends = [];
    for (const p of app.added) {
        plainSplineChecks(p, 'self-crossed piece');
        ends.push(evalAt(p, 0), evalAt(p, 1));
    }
    assert.ok(ends.some(q => V.dist(q, [0, 0, 0]) < 1e-6), 'curve start kept');
    assert.ok(ends.some(q => V.dist(q, [0, 100, 0]) < 1e-6), 'curve end kept');
    assert.ok(ends.some(q => V.dist(q, [50, 50, 0]) < 1),
        'a cut lands on the self-crossing (50,50), ends=' + JSON.stringify(ends));
});

test('cubic spline loop trims at its own crossing', () => {
    const s = spline([[0, 0, 0], [120, 60, 0], [60, 120, 0], [0, 60, 0], [60, 0, 0]]);
    const dense = G.path(s, .5);
    let crossing = null;
    for (let i = 0; i < dense.length - 1 && !crossing; i++)
        for (let j = i + 2; j < dense.length - 1; j++) {
            const h = lineIntersection(dense[i], dense[i + 1], dense[j], dense[j + 1]);
            if (h && h.t > 1e-6 && h.t < 1 - 1e-6 && h.u > 1e-6 && h.u < 1 - 1e-6) {
                crossing = V.lerp(dense[i], dense[i + 1], h.t);
                break;
            }
        }
    assert.ok(crossing, 'the fixture spline must actually cross itself');
    const app = mock([s]);
    app.trimExtend(s, dense[0], false, []);
    assert.equal(app.added.length, 1, 'one piece expected, got ' + app.added.length);
    const p = app.added[0];
    plainSplineChecks(p, 'loop piece');
    assert.ok(V.dist(evalAt(p, 0), crossing) < 1,
        'piece starts at the crossing: ' + evalAt(p, 0) + ' vs ' + crossing);
    assert.ok(V.dist(evalAt(p, 1), evalAt(s, 1)) < 1e-6, 'piece keeps the curve end');
});

test('explicit foreign cutter ignores the spline self-crossing', () => {
    const bow = spline([[0, 0, 0], [100, 100, 0], [100, 0, 0], [0, 100, 0]], 1);
    const line = verticalLine(30);
    const app = mock([bow, line]);
    app.trimExtend(bow, [40, 40, 0], false, ['CUT']);
    // Cuts come from the line only: (30,30) and (30,70), never (50,50).
    assert.equal(app.added.length, 2, 'two pieces expected, got ' + app.added.length);
    const ends = app.added.flatMap(p => [evalAt(p, 0), evalAt(p, 1)]);
    assert.ok(ends.some(q => V.dist(q, [30, 30, 0]) < 1e-6), 'cut on the line at (30,30)');
    assert.ok(ends.some(q => V.dist(q, [30, 70, 0]) < 1e-6), 'cut on the line at (30,70)');
    assert.ok(ends.every(q => V.dist(q, [50, 50, 0]) > 1), 'no cut on the ignored self-crossing');
});

const failed = results.filter(r => r.status === 'failed').length;
fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'results', 'trim-spline-results.json'), JSON.stringify({ suite: 'trim-spline regression tests', passed: results.length - failed, failed, tests: results }, null, 2));
console.log('\ntrim spline: ' + pass + ' passed');
