#!/usr/bin/env python3
"""Click-path TRIM tests: real pointer events, various snap settings."""
from pathlib import Path
import os, json, traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

SCENARIOS = {
    'spline': {
        'draw': "kestrel.doc.add({type:'SPLINE',degree:3,controlPoints:[[0,0,0],[25,40,0],[50,-40,0],[75,40,0],[100,0,0]]});"
                "kestrel.doc.add({type:'LINE',points:[[50,-60,0],[50,60,0]]});",
        'target': 0, 'click': 'mid',
    },
    'polyline': {
        'draw': "kestrel.doc.add({type:'POLYLINE',points:[[0,0,0],[50,0,0],[100,0,0]]});"
                "kestrel.doc.add({type:'LINE',points:[[30,-30,0],[30,30,0]]});"
                "kestrel.doc.add({type:'LINE',points:[[70,-30,0],[70,30,0]]});",
        'target': 0, 'click': 'mid',
    },
    'closed polyline': {
        'draw': "kestrel.doc.add({type:'POLYLINE',closed:true,points:[[0,0,0],[100,0,0],[100,50,0],[0,50,0]]});"
                "kestrel.doc.add({type:'LINE',points:[[30,-30,0],[30,80,0]]});"
                "kestrel.doc.add({type:'LINE',points:[[70,-30,0],[70,80,0]]});",
        'target': 0, 'click': 'mid',
    },
    'spline 4cp': {
        'draw': "kestrel.doc.add({type:'SPLINE',degree:3,controlPoints:[[0,0,0],[30,40,0],[70,-40,0],[100,0,0]]});"
                "kestrel.doc.add({type:'LINE',points:[[30,-60,0],[30,60,0]]});"
                "kestrel.doc.add({type:'LINE',points:[[70,-60,0],[70,60,0]]});",
        'target': 0, 'click': 'mid',
    },
}

SNAP_MODES = {
    'all off': {'snap': False, 'osnap': False},
    'grid snap': {'snap': True, 'osnap': False},
    'osnap': {'snap': False, 'osnap': True},
    'both': {'snap': True, 'osnap': True},
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

    def setup(scenario, mode):
        page.evaluate("""([draw,mode])=>{
            kestrel.closeDialog();kestrel.cancel(false);kestrel.docs=[kestrel.doc];kestrel.run('new');
            kestrel.settings.snap=mode.snap;kestrel.settings.osnap=mode.osnap;
            kestrel.settings.ortho=false;kestrel.settings.polar=false;
            eval(draw);kestrel.refresh();kestrel.run('fit');kestrel.cancel(false);
        }""", [SCENARIOS[scenario]['draw'], mode])
        page.wait_for_timeout(120)

    def click_world(point):
        q = page.evaluate('(p)=>kestrel.camera.project(p)', point)
        r = page.locator('#viewport').bounding_box()
        page.mouse.move(r['x'] + q[0], r['y'] + q[1])
        page.wait_for_timeout(40)
        page.mouse.down()
        page.wait_for_timeout(30)
        page.mouse.up()
        page.wait_for_timeout(120)

    def result():
        return page.evaluate("""()=>{
            const toasts=[...document.querySelectorAll('#toast-stack .toast')].map(e=>e.textContent);
            return {count:kestrel.doc.entities.length,
                    undo:kestrel.doc.undoStack.length,
                    types:kestrel.doc.entities.map(e=>e.type),
                    target:kestrel.doc.entities[0] ? {type:kestrel.doc.entities[0].type,
                        pts:(kestrel.doc.entities[0].points||kestrel.doc.entities[0].controlPoints||[]).length,
                        knots:kestrel.doc.entities[0].knots||null}:null,
                    toasts, prompt:kestrel.prompt()};
        }""")

    try:
        for sname, sc in SCENARIOS.items():
            for mname, mode in SNAP_MODES.items():
                setup(sname, mode)
                before = result()
                page.evaluate("()=>kestrel.run('trim')")
                page.wait_for_timeout(80)
                mid = page.evaluate("""(i)=>{const e=kestrel.doc.entities[i];
                    return e.type==='SPLINE' ? Kestrel.Geo.nurbs(e,.5)
                         : e.type==='CIRCLE' ? [e.center[0]+e.radius,e.center[1],0]
                         : e.type==='POLYLINE' && e.closed ? [100,25,0] : [50,0,0];}""", sc['target'])
                click_world(mid)
                after = result()
                page.keyboard.press('Escape')
                changed = after['undo'] > before['undo']
                ok = changed and not after['toasts']
                print(f"{'OK  ' if ok else 'FAIL'} {sname:16s} | {mname:9s} | undo {before['undo']}->{after['undo']} "
                      f"| {before['types']} -> {after['types']} | toasts={after['toasts']}")
        print('pageerrors:', errors[-5:])
    except Exception:
        traceback.print_exc()
    finally:
        browser.close()
