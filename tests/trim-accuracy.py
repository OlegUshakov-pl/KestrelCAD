#!/usr/bin/env python3
"""Check geometric accuracy of trimmed SPLINE pieces vs the original curve."""
from pathlib import Path
import os, json
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
    url = os.environ.get('KESTREL_TEST_URL')
    if url:
        page.goto(url, wait_until='domcontentloaded')
    else:
        page.set_content((ROOT / 'Kestrel-CAD.html').read_text(), wait_until='domcontentloaded')
    page.wait_for_function('document.documentElement.dataset.ready === "true"', timeout=30000)

    out = page.evaluate("""()=>{
      const G = Kestrel.Geo, V = Kestrel.Math.V;
      const results = [];
      const cases = [
        {name:'uniform 5cp cubic', cps:[[0,0,0],[25,40,0],[50,-40,0],[75,40,0],[100,0,0]], degree:3, knots:null, weights:null},
        {name:'rational 5cp', cps:[[0,0,0],[25,40,0],[50,-40,0],[75,40,0],[100,0,0]], degree:3, knots:null, weights:[1,2,1,2,1]},
        {name:'scaled knots 0..10', cps:[[0,0,0],[25,40,0],[50,-40,0],[75,40,0],[100,0,0]], degree:3, knots:G.uniformKnots(5,3).map(k=>k*10), weights:null},
        {name:'imported 30cp', cps:Array.from({length:30},(_,i)=>[i*4,Math.sin(i/3)*30,0]), degree:3, knots:null, weights:null},
      ];
      for (const c of cases) {
        const n = c.cps.length;
        const src = {type:'SPLINE', degree:c.degree, controlPoints:c.cps,
                     knots:c.knots || G.uniformKnots(n, c.degree)};
        if (c.weights) src.weights = c.weights;
        // dense reference samples of the original curve
        const ref = Array.from({length:4001},(_,i)=>G.nurbs(src, i/4000));
        const doc = kestrel.doc;
        doc.entities.length=0; doc.selection=new Set(); doc.reindex();
        const sp = doc.add({...src});
        doc.add({type:'LINE', points:[[35,-200,0],[35,200,0]]});
        doc.add({type:'LINE', points:[[70,-200,0],[70,200,0]]});
        const click = G.nurbs(src, .5);
        let err = null;
        try { kestrel.trimExtend(sp, click, false, []); }
        catch (e) { err = e.message; }
        const pieces = doc.entities.filter(e=>e.type==='SPLINE');
        const report = {name:c.name, err, pieces:pieces.length, dev:[]};
        for (const piece of pieces) {
          let worst = 0, worstAt = null;
          for (let i=0;i<=200;i++) {
            const q = G.nurbs(piece, i/200);
            let best = Infinity, bestRef = null;
            for (const r of ref) { const d = V.dist(r,q); if (d<best){best=d;bestRef=r;} }
            if (best>worst){worst=best;worstAt=[q,bestRef];}
          }
          report.dev.push({worst:+worst.toFixed(4), at:worstAt});
        }
        // also check total length of pieces vs the reference curve length
        results.push(report);
      }
      return results;
    }""")
    print(json.dumps(out, indent=1))
    browser.close()
