#!/usr/bin/env python3
"""Debug: why TRIM on a polyline does nothing in the running app."""
from pathlib import Path
import os, traceback, json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

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

    def logs():
        return state("[...document.querySelectorAll('#log-list li, .log-entry, #event-log li')].slice(-6).map(e=>e.textContent)")

    try:
        page.evaluate("""()=>{kestrel.closeDialog();kestrel.cancel(false);kestrel.docs=[kestrel.doc];
            kestrel.run('new');kestrel.settings.osnap=false;kestrel.settings.snap=false;
            kestrel.settings.ortho=false;kestrel.settings.polar=false;kestrel.refresh();}""")
        page.wait_for_timeout(80)
        command('PLINE 0,0 50,0 100,0 ENTER')
        command('L 25,-30 25,30 ENTER')
        action('fit')

        # 1. direct call, bypassing the click pipeline
        res = page.evaluate("""()=>{
            const pl = kestrel.doc.entities.find(e=>e.type==='POLYLINE');
            const before = kestrel.doc.entities.length;
            try {
                kestrel.trimExtend(pl, [50,0,0], false, []);
                return {ok:true, before, after:kestrel.doc.entities.length,
                        types:kestrel.doc.entities.map(e=>e.type)};
            } catch (e) { return {ok:false, error:e.message, before, after:kestrel.doc.entities.length}; }
        }""")
        print('direct trimExtend:', json.dumps(res))

        # restore
        page.evaluate("""()=>{kestrel.run('new');kestrel.refresh();}""")
        page.wait_for_timeout(80)
        command('PLINE 0,0 50,0 100,0 ENTER')
        command('L 25,-30 25,30 ENTER')
        action('fit')

        # 2. what does hit() say at the click position?
        q = page.evaluate('(p)=>kestrel.camera.project(p)', [50, 0, 0])
        print('projected:', q, 'viewport box:', page.locator('#viewport').bounding_box())
        print('hit:', page.evaluate('(q)=>{const h=kestrel.hit(q);return h?{type:h.e.type,d:h.distance}:null}', q))

        # 3. full click pipeline
        r = page.locator('#viewport').bounding_box()
        page.mouse.move(r['x'] + q[0], r['y'] + q[1])
        page.wait_for_timeout(60)
        print('hoverId after move:', state('kestrel.hoverId'))
        page.mouse.down()
        page.wait_for_timeout(40)
        page.mouse.up()
        page.wait_for_timeout(120)
        print('tool after click:', state('kestrel.tool && {id:kestrel.tool.id, stage:kestrel.tool.stage, n:kestrel.tool.points.length}'))
        print('entities after click:', state('kestrel.doc.entities.map(e=>e.type)'))
        print('toasts:', state("[...document.querySelectorAll('#toast-stack .toast')].map(e=>e.textContent)"))
        print('logs:', logs())
        print('pageerrors:', errors[-3:])
    except Exception:
        traceback.print_exc()
    finally:
        browser.close()
