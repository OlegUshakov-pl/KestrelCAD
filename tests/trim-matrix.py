#!/usr/bin/env python3
"""Matrix: TRIM target entity type x cutting-edge entity type (direct trimExtend calls)."""
from pathlib import Path
import os, json, traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

TARGETS = {
    'LINE':      {'type': 'LINE', 'points': [[0, 0, 0], [100, 0, 0]]},
    'POLYLINE':  {'type': 'POLYLINE', 'points': [[0, 0, 0], [50, 0, 0], [100, 0, 0]]},
    'POLYLINE closed': {'type': 'POLYLINE', 'closed': True,
                        'points': [[0, 0, 0], [100, 0, 0], [100, 50, 0], [0, 50, 0]]},
    'POLYLINE bulged': {'type': 'POLYLINE', 'points': [[0, 0, 0], [50, 0, 0], [100, 0, 0]],
                        'bulges': [0.5, 0]},
    'SPLINE':    {'type': 'SPLINE', 'degree': 3,
                  'controlPoints': [[0, 0, 0], [25, 40, 0], [50, -40, 0], [75, 40, 0], [100, 0, 0]]},
    'SPLINE 4cp': {'type': 'SPLINE', 'degree': 3,
                   'controlPoints': [[0, 0, 0], [30, 40, 0], [70, -40, 0], [100, 0, 0]]},
    'SPLINE 2cp': {'type': 'SPLINE', 'degree': 1,
                   'controlPoints': [[0, 0, 0], [100, 0, 0]]},
    'CIRCLE':    {'type': 'CIRCLE', 'center': [50, 0, 0], 'radius': 30},
    'ARC':       {'type': 'ARC', 'center': [50, 0, 0], 'radius': 30,
                  'startAngle': 0, 'endAngle': 3.141592653589793},
}

CUTTERS = {
    'LINE':   [{'type': 'LINE', 'points': [[30, -60, 0], [30, 60, 0]]},
               {'type': 'LINE', 'points': [[70, -60, 0], [70, 60, 0]]}],
    'POLYLINE': [{'type': 'POLYLINE', 'points': [[30, -60, 0], [30, 0, 0], [30, 60, 0]]},
                 {'type': 'POLYLINE', 'points': [[70, -60, 0], [70, 0, 0], [70, 60, 0]]}],
    'SPLINE':  [{'type': 'SPLINE', 'degree': 3,
                 'controlPoints': [[30, -60, 0], [34, -20, 0], [26, 20, 0], [30, 60, 0]]},
                {'type': 'SPLINE', 'degree': 3,
                 'controlPoints': [[70, -60, 0], [74, -20, 0], [66, 20, 0], [70, 60, 0]]}],
    'CIRCLE':  [{'type': 'CIRCLE', 'center': [30, 0, 0], 'radius': 40},
                {'type': 'CIRCLE', 'center': [70, 0, 0], 'radius': 40}],
}

# click point on the target, strictly between the two cuts
CLICKS = {
    'LINE': [50, 0, 0], 'POLYLINE': [50, 0, 0], 'POLYLINE closed': [100, 25, 0],
    'POLYLINE bulged': [50, 10, 0], 'SPLINE': None, 'SPLINE 4cp': None,
    'SPLINE 2cp': [50, 0, 0], 'CIRCLE': [50, 30, 0], 'ARC': [50, 30, 0],
}

with sync_playwright() as p:
    for cand in [os.environ.get('CHROMIUM_PATH'), r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe']:
        if cand and Path(cand).exists():
            break
    else:
        cand = None
    browser = p.chromium.launch(executable_path=cand, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1600, 'height': 1000}, device_scale_factor=1)
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    url = os.environ.get('KESTREL_TEST_URL')
    if url:
        page.goto(url, wait_until='domcontentloaded')
    else:
        page.set_content((ROOT / 'Kestrel-CAD.html').read_text(), wait_until='domcontentloaded')
    page.wait_for_function('document.documentElement.dataset.ready === "true"', timeout=30000)

    page.evaluate("""()=>{kestrel.closeDialog();kestrel.cancel(false);kestrel.docs=[kestrel.doc];
        kestrel.run('new');kestrel.settings.osnap=false;kestrel.settings.snap=false;
        kestrel.settings.ortho=false;kestrel.settings.polar=false;kestrel.refresh();}""")
    page.wait_for_timeout(80)

    for tname, tdef in TARGETS.items():
        for cname, cdefs in CUTTERS.items():
            setup = {'target': tdef, 'cutters': cdefs, 'click': CLICKS[tname]}
            out = page.evaluate("""(cfg)=>{
                kestrel.cancel(false);
                const doc = kestrel.doc;
                doc.entities.length = 0; doc.selection = new Set(); doc.reindex();
                const t = doc.add({...cfg.target});
                const cutters = cfg.cutters.map(c=>doc.add({...c}));
                let click = cfg.click;
                if (!click) { const g = Kestrel.Geo.geometry(t, .5); click = g.segments[Math.floor(g.segments.length/2)][0]; }
                const before = doc.entities.length, undos = doc.undoStack.length;
                try {
                    kestrel.trimExtend(t, click, false, []);
                    return {status:'ok', before, after:doc.entities.length, undo:doc.undoStack.length-undos,
                            types:doc.entities.map(e=>e.type)};
                } catch (e) { return {status:'error', error:e.message, before, after:doc.entities.length,
                            undo:doc.undoStack.length-undos}; }
            }""", setup)
            flag = 'OK  ' if out['status'] == 'ok' and out.get('undo') else 'FAIL'
            print(f"{flag} target={tname:16s} cutter={cname:9s} {json.dumps(out)}")
    print('pageerrors:', errors[-5:])
    browser.close()
