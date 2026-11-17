#!/usr/bin/env python3
"""Extra trim scenarios: default example drawing, dense splines/polylines, preselection."""
from pathlib import Path
import os, json, traceback
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

    def run(label, body, arg=None):
        out = page.evaluate("""([body,arg])=>{
            try { return {result: eval('(' + body + ')')(arg)}; }
            catch (e) { return {error: e.message}; }
        }""", [body, arg])
        print(label, '->', json.dumps(out)[:600])
        return out

    try:
        # 1. default example drawing: trim a polyline using every entity as cutter
        run('default drawing: pick a polyline and try trimExtend', """()=>{
            const doc = kestrel.doc;
            const pl = doc.entities.find(e=>e.type==='POLYLINE' && e.points.length>3);
            if (!pl) return {skip:'no polyline in the example'};
            const g = doc.geometry(pl);
            const s = g.segments[Math.floor(g.segments.length/2)];
            const click = [(s[0][0]+s[1][0])/2,(s[0][1]+s[1][1])/2,0];
            const before = doc.entities.length, u = doc.undoStack.length;
            try { kestrel.trimExtend(pl, click, false, []); }
            catch (e) { return {error:e.message, type:pl.type, pts:pl.points.length, before, after:doc.entities.length}; }
            return {ok:true, type:pl.type, pts:pl.points.length, before, after:doc.entities.length,
                    undo:doc.undoStack.length-u, entities:doc.entities.length};
        }""")

        # 2. default example drawing: trim a SPLINE if present
        run('default drawing: trim a spline', """()=>{
            const doc = kestrel.doc;
            const sp = doc.entities.find(e=>e.type==='SPLINE');
            if (!sp) return {skip:'no spline in the example'};
            const g = doc.geometry(sp);
            const s = g.segments[Math.floor(g.segments.length/2)];
            const click = [(s[0][0]+s[1][0])/2,(s[0][1]+s[1][1])/2,0];
            const before = doc.entities.length, u = doc.undoStack.length;
            try { kestrel.trimExtend(sp, click, false, []); }
            catch (e) { return {error:e.message, cps:(sp.controlPoints||sp.points).length}; }
            return {ok:true, cps:(sp.controlPoints||sp.points).length, before, after:doc.entities.length,
                    undo:doc.undoStack.length-u};
        }""")

        # 3. dense polyline (60 vertices) crossed by two lines
        run('dense polyline 60 vertices', """()=>{
            const doc = kestrel.doc;
            doc.entities.length=0; doc.selection=new Set(); doc.reindex();
            const pts=[]; for(let i=0;i<=60;i++) pts.push([i*2, Math.sin(i/6)*8, 0]);
            const pl = doc.add({type:'POLYLINE', points:pts});
            doc.add({type:'LINE', points:[[60,-30,0],[60,30,0]]});
            doc.add({type:'LINE', points:[[100,-30,0],[100,30,0]]});
            const u = doc.undoStack.length;
            try { kestrel.trimExtend(pl, [80, 4, 0], false, []); }
            catch (e) { return {error:e.message}; }
            return {ok:true, undo:doc.undoStack.length-u, types:doc.entities.map(e=>e.type)};
        }""")

        # 4. dense spline (30 control points)
        run('dense spline 30 control points', """()=>{
            const doc = kestrel.doc;
            doc.entities.length=0; doc.selection=new Set(); doc.reindex();
            const cps=[]; for(let i=0;i<30;i++) cps.push([i*4, Math.sin(i/3)*30, 0]);
            const sp = doc.add({type:'SPLINE', degree:3, controlPoints:cps, knots:Kestrel.Geo.uniformKnots(30,3)});
            doc.add({type:'LINE', points:[[60,-60,0],[60,60,0]]});
            doc.add({type:'LINE', points:[[80,-60,0],[80,60,0]]});
            const u = doc.undoStack.length;
            const click = Kestrel.Geo.nurbs(sp, .5);
            try { kestrel.trimExtend(sp, click, false, []); }
            catch (e) { return {error:e.message, click}; }
            return {ok:true, undo:doc.undoStack.length-u, types:doc.entities.map(e=>e.type),
                    pieces:doc.entities.filter(e=>e.type==='SPLINE').map(e=>e.controlPoints.length)};
        }""")

        # 5. preselection: only the target selected (common user flow)
        run('preselect target only', """()=>{
            const doc = kestrel.doc;
            doc.entities.length=0; doc.selection=new Set(); doc.reindex();
            const sp = doc.add({type:'SPLINE', degree:3,
                controlPoints:[[0,0,0],[25,40,0],[50,-40,0],[75,40,0],[100,0,0]]});
            doc.add({type:'LINE', points:[[50,-60,0],[50,60,0]]});
            doc.selection = new Set([sp.id]);
            const u = doc.undoStack.length;
            try { kestrel.trimExtend(sp, Kestrel.Geo.nurbs(sp,.5), false, [sp.id]); }
            catch (e) { return {error:e.message}; }
            return {ok:true, undo:doc.undoStack.length-u, types:doc.entities.map(e=>e.type)};
        }""")

        # 6. cutters selected, target not: only selected lines count
        run('preselect cutters only', """()=>{
            const doc = kestrel.doc;
            doc.entities.length=0; doc.selection=new Set(); doc.reindex();
            const sp = doc.add({type:'SPLINE', degree:3,
                controlPoints:[[0,0,0],[25,40,0],[50,-40,0],[75,40,0],[100,0,0]]});
            const c1 = doc.add({type:'LINE', points:[[50,-60,0],[50,60,0]]});
            const c2 = doc.add({type:'LINE', points:[[20,-60,0],[20,60,0]]});
            doc.selection = new Set([c1.id, c2.id]);
            const u = doc.undoStack.length;
            try { kestrel.trimExtend(sp, Kestrel.Geo.nurbs(sp,.5), false, [c1.id, c2.id]); }
            catch (e) { return {error:e.message}; }
            return {ok:true, undo:doc.undoStack.length-u, types:doc.entities.map(e=>e.type)};
        }""")

        print('pageerrors:', errors[-5:])
    except Exception:
        traceback.print_exc()
    finally:
        browser.close()
