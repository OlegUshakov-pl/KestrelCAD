#!/usr/bin/env python3
"""Manufacturing drafting UI: repeat, tolerances, roughness, callouts, rotate by points."""
from pathlib import Path
import os, json, traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tests/results'
OUT.mkdir(exist_ok=True)
results = []
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1600, 'height': 1000}, accept_downloads=True)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_default_timeout(10000)
    url = os.environ.get('KESTREL_TEST_URL')
    if url:
        page.goto(url, wait_until='domcontentloaded')
    else:
        page.set_content((ROOT / 'Kestrel-CAD.html').read_text(), wait_until='domcontentloaded')
    page.wait_for_function('document.documentElement.dataset.ready==="true"', timeout=30000)

    def test(name, fn):
        before = len(errors)
        try:
            fn()
            assert len(errors) == before, errors[before:]
            results.append({'name': name, 'status': 'passed'})
            print('PASS', name, flush=True)
        except Exception as e:
            traceback.print_exc()
            results.append({'name': name, 'status': 'failed', 'error': str(e)})
            page.screenshot(path=str(OUT / 'manufacturing-failure.png'))
            page.evaluate('kestrel.closeDialog();kestrel.cancel(false)')

    def fresh():
        page.evaluate("async()=>{kestrel.closeDialog();kestrel.docs=[kestrel.doc];await kestrel.run('new');"
                      "kestrel.settings.osnap=false;kestrel.settings.snap=false;kestrel.settings.ortho=false;kestrel.settings.polar=false;}")

    def action(x):
        page.evaluate('(id)=>kestrel.run(id)', x)

    def command(x):
        page.locator('#command-input').fill(x)
        page.locator('#command-input').press('Enter')
        page.wait_for_timeout(80)

    def eq(expr, value):
        actual = page.evaluate(expr)
        assert actual == value, (expr, actual, value)

    def screen(point):
        q = page.evaluate('(p)=>kestrel.camera.project(p)', point)
        r = page.locator('#viewport').bounding_box()
        return (r['x'] + q[0], r['y'] + q[1])

    def click_world(point):
        page.mouse.click(*screen(point))
        page.wait_for_timeout(80)

    def right_click(point):
        page.mouse.click(*screen(point), button='right')
        page.wait_for_timeout(80)

    def submit(fields=None, checks=None):
        for k, v in (fields or {}).items():
            el = page.locator('#modal [name="' + k + '"]')
            if el.evaluate('(e)=>e.tagName') == 'SELECT':
                el.select_option(str(v))
            else:
                el.fill(str(v))
        for k, v in (checks or {}).items():
            page.locator('#modal [name="' + k + '"]').set_checked(v)
        page.locator('#modal-submit').click()
        page.wait_for_timeout(100)
        assert not page.locator('#modal-error').is_visible(), page.locator('#modal-error').inner_text()

    def add_line(a=(0, 0, 0), b=(100, 0, 0)):
        page.evaluate('([a,b])=>{const d=kestrel.doc;d.transaction("Test line",()=>d.add({type:"LINE",points:[a,b]}));}', [list(a), list(b)])

    def select(*indices):
        page.evaluate('(ids)=>{kestrel.doc.selection=new Set(ids);kestrel.selectionChanged();}',
                      page.evaluate('(ix)=>ix.map(i=>kestrel.doc.entities[i].id)', list(indices)))

    def menu():
        return page.locator('#context-menu button[data-action]')

    def repeat():
        fresh()
        command('L 0,0 50,0 ENTER')
        right_click([200, 200, 0])
        assert menu().count() > 0
        assert menu().first.get_attribute('data-action') == 'repeat-last'
        assert 'Repeat:' in menu().first.inner_text()
        menu().first.click()
        page.wait_for_timeout(80)
        eq('kestrel.tool?.id', 'line')
        page.keyboard.press('Escape')

    test('right-click menu starts with Repeat and repeats the last command', repeat)

    def tolerance():
        fresh()
        add_line()
        page.evaluate('()=>{const d=kestrel.doc;d.transaction("Dimension",()=>d.add({type:"DIMENSION",kind:"linear",points:[[0,0,0],[40,0,0]],measureAxis:[1,0,0],offset:-10,textHeight:10,precision:0}));}')
        select(1)
        right_click([20, -10, 0])
        assert 'dimension-tolerance' in [menu().nth(i).get_attribute('data-action') for i in range(menu().count())]
        page.locator('#context-menu [data-action="dimension-tolerance"]').click()
        submit({'tolerance': 'H7', 'position': 'parentheses'})
        eq('kestrel.doc.entities[1].tolerance', 'H7')
        eq('kestrel.doc.geometry(kestrel.doc.entities[1]).texts[0].text', '40 (H7)')
        page.keyboard.press('Control+z')
        eq('kestrel.doc.entities[1].tolerance', None)

    test('tolerance edits from right-click and undo restores it', tolerance)

    def roughness():
        fresh()
        add_line()
        action('fit')
        action('roughness-32')
        click_world([50, 0, 0])
        eq('kestrel.doc.entities.filter(e=>e.type==="ROUGHNESS").length', 1)
        eq('kestrel.doc.entities[1].text', 'Ra 3.2')
        eq('kestrel.doc.geometry(kestrel.doc.entities[1]).texts[0].normal', [0, 0, 1])
        eq('kestrel.doc.geometry(kestrel.doc.entities[1]).texts[0].direction', [1, 0, 0])
        eq('kestrel.tool.id', 'roughness')
        click_world([80, 0, 0])
        eq('kestrel.doc.entities.filter(e=>e.type==="ROUGHNESS").length', 2)
        command('F')
        eq('kestrel.tool.params.flipped', True)
        page.keyboard.press('Escape')
        eq('kestrel.tool', None)
        select(1)
        action('roughness-settings')
        submit({'style': 'no-removal'}, {'flipped': True})
        eq('kestrel.doc.entities[1].style', 'no-removal')
        eq('kestrel.doc.entities[1].flipped', True)

    test('roughness placement, mirroring, repetition and inspector settings', roughness)

    def callout():
        fresh()
        action('position')
        submit({'form': 'circle', 'end': 'dot', 'number': '5'})
        eq('kestrel.tool.id', 'position')
        click_world([10, 10, 0])
        click_world([40, 40, 0])
        eq('kestrel.doc.entities.filter(e=>e.type==="POSITION").length', 1)
        eq('kestrel.doc.entities[0].text', '5')
        eq('kestrel.doc.entities[0].form', 'circle')
        eq('kestrel.doc.entities[0].end', 'dot')
        inside = page.evaluate('''()=>{const e=kestrel.doc.entities[0],b=e.points[1],r=e.textHeight*.95;
            return kestrel.doc.geometry(e).segments.filter(s=>Math.min(
                Math.hypot(s[0][0]-b[0],s[0][1]-b[1]),Math.hypot(s[1][0]-b[0],s[1][1]-b[1]))<r*.5).length;}''')
        assert inside == 0, inside
        page.evaluate('kestrel.doc.selection.clear();kestrel.selectionChanged()')
        right_click([200, 200, 0])
        assert menu().first.get_attribute('data-action') == 'repeat-last'
        assert 'Position callout' in menu().first.inner_text()
        menu().first.click()
        page.wait_for_timeout(80)
        click_world([20, 10, 0])
        click_world([50, 40, 0])
        eq('kestrel.doc.entities.filter(e=>e.type==="POSITION").length', 2)
        eq('kestrel.doc.entities[1].text', '6')

    test('position callout creation and repeat with auto-incremented number', callout)

    def rotate_by_points():
        def run(mode):
            fresh()
            add_line((5, 0, 0), (10, 0, 0))
            action('fit')
            select(0)
            if mode == 'points':
                action('rotate-reference')
                click_world([0, 0, 0])
                click_world([10, 0, 0])
                click_world([0, 10, 0])
            else:
                action('rotate')
                click_world([0, 0, 0])
                command('90')
            return page.evaluate('kestrel.doc.entities[0].points')
        a = run('points')
        b = run('angle')
        for p, q in zip(a, b):
            for x, y in zip(p, q):
                assert abs(x - y) < 1e-6, (a, b)

    test('rotate by reference matches the typed rotation angle', rotate_by_points)

    def callout_grips():
        fresh()
        page.evaluate("""()=>{const d=kestrel.doc;d.transaction('Callout',()=>d.add({
            type:'POSITION',points:[[0,0,0],[40,30,0]],text:'1',form:'circle',end:'arrow',textHeight:10}));}""")
        select(0)
        grips = page.evaluate('kestrel.entityGrips(kestrel.doc.entities[0]).map(g=>[g.kind,g.index])')
        assert ['point', 0] in grips and ['point', 1] in grips, grips
        assert ['translate', None] in grips or any(g[0] == 'translate' for g in grips), grips
        page.evaluate("""()=>{const e=kestrel.doc.entities[0],g=kestrel.entityGrips(e).find(g=>g.kind==='point'&&g.index===1);
            const moved=kestrel.moveGrip(e,g,[80,60,0]);kestrel.doc.transaction('Move callout grip',()=>kestrel.doc.replace(e.id,moved));}""")
        eq('kestrel.doc.entities[0].points[1]', [80, 60, 0])
        eq('kestrel.doc.entities[0].points[0]', [0, 0, 0])
        page.evaluate("""()=>{const d=kestrel.doc;d.transaction('Vertical callout',()=>d.add({
            type:'POSITION',points:[[0,0,0],[0,50,0]],text:'2',form:'line',end:'dot',textHeight:10}));}""")
        eq('kestrel.doc.geometry(kestrel.doc.entities[1]).texts[0].direction', [1, 0, 0])
        shelf = page.evaluate('kestrel.doc.geometry(kestrel.doc.entities[1]).segments.at(-1)')
        assert abs(shelf[0][0] - shelf[1][0]) > 0 and abs(shelf[0][1] - shelf[1][1]) < 1e-9, shelf

    test('position callout has movable grips at both ends', callout_grips)

    def clipboard():
        fresh()
        page.evaluate("""()=>{const d=kestrel.doc;d.transaction('Manufacturing fixture',()=>{
            d.add({type:'LINE',points:[[0,0,0],[100,0,0]]});
            d.add({type:'ROUGHNESS',position:[50,0,0],normal:[0,1,0],tangent:[1,0,0],text:'Ra 1.6',style:'plain',flipped:false,height:8});
            d.add({type:'POSITION',points:[[20,20,0],[40,40,0]],text:'7',form:'circle',end:'arrow',textHeight:10});
        });}""")
        action('fit')
        select(0, 1, 2)
        page.locator('#viewport').focus()
        page.keyboard.press('Control+c')
        page.wait_for_timeout(60)
        page.keyboard.press('Control+v')
        page.wait_for_timeout(60)
        eq('kestrel.tool?.id', 'paste')
        command('300,300')
        eq('kestrel.doc.entities.length', 6)
        eq('kestrel.doc.entities.filter(e=>e.type==="ROUGHNESS").length', 2)
        eq('kestrel.doc.entities.filter(e=>e.type==="POSITION").length', 2)
        ids = page.evaluate('kestrel.doc.entities.map(e=>e.id)')
        assert len(set(ids)) == len(ids), ids

    test('new entities copy and paste with fresh identities', clipboard)

    def ribbon():
        page.locator('#app-menu-button').click()
        page.keyboard.press('Escape')
        page.evaluate("kestrel.setRibbon('Drafting')")
        labels = page.locator('#ribbon button').all_inner_texts()
        for text in ['Ra 1.6', 'Ra 3.2', 'Ra 6.3', 'Ra 12.5', 'Position callout', 'Rotate by points']:
            assert any(text in label for label in labels), (text, labels)

    test('Drafting ribbon exposes surface finish and callout tools', ribbon)

    page.evaluate('kestrel.closeDialog();kestrel.cancel(false)')
    browser.close()

report = OUT / 'manufacturing-browser-results.json'
failed = sum(1 for r in results if r['status'] == 'failed')
report.write_text(json.dumps({'suite': 'manufacturing UI', 'passed': len(results) - failed, 'failed': failed,
                              'javascript_errors': errors, 'tests': results}, indent=2))
print(f"{len(results)-failed}/{len(results)} passed; JS errors: {errors}")
raise SystemExit(1 if failed or errors else 0)
