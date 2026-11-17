#!/usr/bin/env python3
"""Manual reproduction: TRIM on a drawn POLYLINE and a drawn SPLINE."""
from pathlib import Path
import os, traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_PATH')
    if not executable or not Path(executable).exists():
        for cand in [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
                     r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']:
            if Path(cand).exists():
                executable = cand
                break
        else:
            executable = None
    browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
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

    def command(text):
        page.locator('#command-input').fill(text)
        page.locator('#command-input').press('Enter')
        page.wait_for_timeout(90)

    def action(name):
        page.evaluate('(id)=>kestrel.run(id)', name)
        page.wait_for_timeout(80)

    def state(expr):
        return page.evaluate(expr)

    def screen(point):
        q = page.evaluate('(p)=>kestrel.camera.project(p)', point)
        r = page.locator('#viewport').bounding_box()
        return (r['x'] + q[0], r['y'] + q[1])

    def click_world(point):
        page.mouse.click(*screen(point))
        page.wait_for_timeout(90)

    def toasts():
        return state("[...document.querySelectorAll('#toast-stack .toast, .toast')].map(e=>e.textContent)")

    def fresh(snap=False):
        page.evaluate("""(snap)=>{kestrel.closeDialog();kestrel.cancel(false);kestrel.docs=[kestrel.doc];
            kestrel.run('new');kestrel.settings.osnap=snap;kestrel.settings.snap=snap;
            kestrel.settings.ortho=false;kestrel.settings.polar=false;kestrel.refresh();}""", snap)
        page.wait_for_timeout(80)

    def report(label):
        print(label)
        print('  entities:', state('kestrel.doc.entities.map(e=>e.type+(e.id?"":""))'))
        print('  count:', state('kestrel.doc.entities.length'))
        print('  toasts:', toasts())
        print('  pageerrors:', errors[-3:])

    try:
        # --- POLYLINE ---
        fresh()
        command('PLINE 0,0 50,0 100,0 ENTER')
        command('L 25,-30 25,30 ENTER')
        action('fit')
        page.wait_for_timeout(80)
        action('trim')
        print('prompt:', state('kestrel.prompt()'))
        click_world([50, 0, 0])
        report('POLYLINE trim @ (50,0), no preselection:')
        page.keyboard.press('Escape')

        # --- POLYLINE with snapping on (default user settings) ---
        fresh(snap=True)
        command('PLINE 0,0 50,0 100,0 ENTER')
        command('L 25,-30 25,30 ENTER')
        action('fit')
        page.wait_for_timeout(80)
        action('trim')
        click_world([50, 0, 0])
        report('POLYLINE trim with snap ON:')
        page.keyboard.press('Escape')

        # --- POLYLINE with the polyline preselected (common flow) ---
        fresh()
        command('PLINE 0,0 50,0 100,0 ENTER')
        command('L 25,-30 25,30 ENTER')
        action('fit')
        page.evaluate('()=>{kestrel.doc.selection=new Set([kestrel.doc.entities[0].id]);kestrel.selectionChanged();}')
        action('trim')
        click_world([50, 0, 0])
        report('POLYLINE trim with polyline preselected:')
        page.keyboard.press('Escape')

        # --- SPLINE drawn with the SPLINE command ---
        fresh()
        command('SPLINE 0,0 25,40 50,-40 75,40 100,0 ENTER')
        command('L 50,-60 50,60 ENTER')
        action('fit')
        page.wait_for_timeout(80)
        action('trim')
        mid = state('Kestrel.Geo.nurbs(kestrel.doc.entities[0],0.5)')
        print('mid:', mid, 'prompt:', state('kestrel.prompt()'))
        click_world(mid)
        report('SPLINE trim @ curve(0.5):')
        print('  spline pieces:', state("kestrel.doc.entities.filter(e=>e.type==='SPLINE').map(e=>({n:e.controlPoints.length,lo:e.knots[0],hi:e.knots[e.knots.length-1]}))"))
        page.keyboard.press('Escape')

        # --- SPLINE with snap ON ---
        fresh(snap=True)
        command('SPLINE 0,0 25,40 50,-40 75,40 100,0 ENTER')
        command('L 50,-60 50,60 ENTER')
        action('fit')
        page.wait_for_timeout(80)
        action('trim')
        mid = state('Kestrel.Geo.nurbs(kestrel.doc.entities[0],0.5)')
        click_world(mid)
        report('SPLINE trim with snap ON:')
        page.keyboard.press('Escape')

        # --- hit() diagnostics for the spline ---
        fresh()
        command('SPLINE 0,0 25,40 50,-40 75,40 100,0 ENTER')
        action('fit')
        page.wait_for_timeout(80)
        mid = state('Kestrel.Geo.nurbs(kestrel.doc.entities[0],0.5)')
        q = page.evaluate('(p)=>kestrel.camera.project(p)', mid)
        print('spline hit test:', page.evaluate('(q)=>{const h=kestrel.hit(q);return h?{type:h.e.type,d:h.distance}:null}', q))
    except Exception:
        traceback.print_exc()
    finally:
        browser.close()
