import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelaxation,heightFloor,centerAvailableSpace} from '../src/lib/mosaic-relaxation.ts';
const cards=Array.from({length:12},(_,i)=>({key:`c${i}`,width:{min:120,preferred:300,max:600},height:{min:120,preferred:300,max:600},captionHeight:44}));
const problem={cards,bounds:{x:0,y:0,w:1624,h:917},gutter:[64,64],seed:271828,limit:200,tolerance:1};
function audit(r,p){
  assert.equal(r.cells.length,p.cards.length);
  for(const a of r.cells){const c=p.cards.find(c=>c.key===a.key);assert.ok(a.w>=c.width.min-1e-6&&a.w<=c.width.max+1e-6);assert.ok(a.h>=heightFloor(c,a.w)-1e-6&&a.h<=c.height.max+1e-6);for(const b of r.cells)if(a!==b)assert.ok(a.x+a.w<=b.x+1e-6||b.x+b.w<=a.x+1e-6||a.y+a.h<=b.y+1e-6||b.y+b.h<=a.y+1e-6);}
  assert.ok(r.edges.every(e=>Math.abs(e.gap-e.target)<=p.tolerance+1e-6));
}
test('feasible mosaic converges, respects ranges and shared gutters, and is reproducible',()=>{const a=createRelaxation(problem).run(),b=createRelaxation(problem).run();assert.equal(a.status,'converged');audit(a,problem);assert.deepEqual(a,b);});
test('infeasible input stops at exact global budget',()=>{const p={...problem,limit:17,cards:cards.map(c=>({...c,width:{min:2000,preferred:2100,max:2200}}))};const s=createRelaxation(p);assert.equal(s.run().status,'best-effort');assert.equal(s.result.steps,17);assert.equal(s.history.length,17);assert.equal(s.step().steps,17);});
test('tight region still returns a complete best-effort grid and diagnostics',()=>{const before=createRelaxation(problem).run();const s=createRelaxation({...problem,limit:3,bounds:{x:0,y:0,w:1,h:1}},before);const r=s.run();assert.equal(r.status,'best-effort');assert.equal(r.cells.length,problem.cards.length);assert.ok(r.failures.length);});
test('responsive minimum height never interpolates below measured envelope',()=>{const c={...cards[0],heightFloor:[{width:120,minHeight:500},{width:300,minHeight:250},{width:600,minHeight:150}]};assert.equal(heightFloor(c,200),500);assert.equal(heightFloor(c,450),250);});
test('step and run produce identical history; zero budget performs no projections',()=>{const a=createRelaxation(problem);while(!a.done)a.step();assert.deepEqual(a.result,createRelaxation(problem).run());assert.equal(createRelaxation({...problem,limit:0}).run().steps,0);});
test('randomized sizes and catalog changes never return invalid converged geometry',()=>{let seed=91;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};let converged=0;for(let n=2;n<22;n++){const p={...problem,cards:Array.from({length:n},(_,i)=>({key:`r${i}`,width:{min:80+rand()*50,preferred:250+rand()*50,max:600+rand()*100},height:{min:80+rand()*50,preferred:250+rand()*50,max:650+rand()*150}})),seed:n};const r=createRelaxation(p).run();assert.ok(r.steps<=200);if(r.status==='converged'){converged++;audit(r,p);}}assert.ok(converged>10);});
test('fixed visible cards remain unchanged',()=>{const p={...problem,cards:cards.slice(0,5).map(c=>({...c,width:{min:80,preferred:300,max:2000},height:{min:80,preferred:300,max:2000}})),bounds:{x:0,y:0,w:1000,h:1000},pins:[{key:'c0',x:350,y:350,w:300,h:300}]};const r=createRelaxation(p).run();assert.equal(r.status,'converged');assert.deepEqual(r.cells.find(c=>c.key==='c0'),p.pins[0]);});
test('valid but unequal gutters are reported as budget exhaustion, not convergence',()=>{const c=cards.slice(0,2).map(c=>({...c,width:{min:300,preferred:300,max:300},height:{min:300,preferred:300,max:300}}));const r=createRelaxation({...problem,cards:c,bounds:{x:0,y:0,w:1000,h:300},limit:19}).run();assert.equal(r.status,'best-effort');assert.equal(r.steps,19);assert.equal(r.cells.length,2);assert.ok(r.maxError>problem.tolerance);assert.ok(Math.abs(r.cells[0].x-400/3)<.1);assert.ok(Math.abs(r.cells[1].x-1700/3)<.1);});
test('flexible intro anchors remain centered and reserve an uninterrupted straight spine',()=>{const c=cards.map(c=>({...c,width:{min:80,preferred:300,max:2000},height:{min:80,preferred:350,max:2000}}));const p={...problem,cards:c,bounds:{x:-900,y:-700,w:1800,h:3700},anchors:[{key:'c0',centerX:0,centerY:0},{key:'c1',centerX:0,centerY:1980}],flight:{from:'c0',to:'c1',width:64}};const r=createRelaxation(p).run();assert.equal(r.status,'converged');audit(r,p);const a=r.cells.find(c=>c.key==='c0'),b=r.cells.find(c=>c.key==='c1');assert.equal(a.x+a.w/2,0);assert.equal(a.y+a.h/2,0);assert.equal(b.x+b.w/2,0);for(const cell of r.cells.filter(c=>c!==a&&c!==b))if(cell.y<b.y && cell.y+cell.h>a.y+a.h)assert.ok(cell.x+cell.w<=-32||cell.x>=32);});
test('spatial seed keeps heterogeneous preferred sizes and supports bounded retries',()=>{
  const initialCells=[{key:'wide',x:0,y:0,w:500,h:180},{key:'tall',x:564,y:0,w:220,h:480},{key:'small',x:0,y:244,w:300,h:236}];
  const c=initialCells.map(r=>({key:r.key,width:{min:r.w*.85,preferred:r.w,max:r.w*1.15},height:{min:r.h*.85,preferred:r.h,max:r.h*1.15}}));
  const p={...problem,cards:c,initialCells,bounds:{x:0,y:0,w:784,h:480}};
  const r=createRelaxation(p).run();
  assert.ok(r.steps<=200);
  assert.deepEqual(p.cards.map(c=>c.width.preferred),[500,220,300]);
  if(r.status==='converged')audit(r,p);
});
test('systematic ratio stress: 120 seeds, six viewport aspects, individual resizing limits',(t)=>{
  const viewRatios=[.3,.55,1,1.8,3.3,5];
  let state=1059;const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
  let worstAspect=0,bestAspect=Infinity,nonConverged=0;
  for(let scenario=0;scenario<120;scenario++){
    const aspect=viewRatios[scenario%viewRatios.length];
    const c=Array.from({length:2+Math.floor(rand()*29)},(_,i)=>{
      const ratio=.18*Math.pow(32,rand()),h=100+rand()*500,w=h*ratio;
      bestAspect=Math.min(bestAspect,ratio);worstAspect=Math.max(worstAspect,ratio);
      return {key:`case${scenario}-${i}`,resizePercent:i%7===0?0:Math.floor(rand()*36),width:{min:w,preferred:w,max:w},height:{min:h,preferred:h,max:h}};
    });
    const p={...problem,cards:c,seed:scenario,bounds:{x:0,y:0,w:1000*Math.sqrt(aspect),h:1000/Math.sqrt(aspect)}};
    const r=createRelaxation(p).run();
    assert.ok(r.steps<=p.limit);assert.equal(r.cells.length,c.length);
    if(r.status!=='converged')nonConverged++;
    for(const a of r.cells){const card=c.find(c=>c.key===a.key),f=card.resizePercent/100;
      assert.ok(a.w>=card.width.preferred*(1-f)-1e-6 && a.w<=card.width.preferred*(1+f)+1e-6,`case ${scenario}: width allowance`);
      assert.ok(a.h>=card.height.preferred*(1-f)-1e-6 && a.h<=card.height.preferred*(1+f)+1e-6,`case ${scenario}: height allowance`);
      for(const b of r.cells)if(a!==b)assert.ok(a.x+a.w<=b.x+1e-6||b.x+b.w<=a.x+1e-6||a.y+a.h<=b.y+1e-6||b.y+b.h<=a.y+1e-6,`case ${scenario}: overlap`);
    }
    if(scenario%20===0)assert.deepEqual(r,createRelaxation(p).run());
  }
  t.diagnostic(`120 cases; card ratios ${bestAspect.toFixed(3)}–${worstAspect.toFixed(3)}; ${nonConverged} best-effort results outside tolerance`);
  assert.ok(bestAspect<.2 && worstAspect>5);assert.ok(nonConverged>0,'Include and validate hard best-effort cases, not just solved grids');
});
test('measured-grid relaxation changes geometry without worsening its best-effort objective',()=>{
  const initialCells=[{key:'a',x:0,y:0,w:400,h:220},{key:'b',x:480,y:0,w:400,h:220},{key:'c',x:0,y:350,w:400,h:220},{key:'d',x:480,y:350,w:400,h:220}];
  const c=initialCells.map(r=>({key:r.key,resizePercent:15,width:{min:r.w,preferred:r.w,max:r.w},height:{min:r.h,preferred:r.h,max:r.h}}));
  const s=createRelaxation({...problem,cards:c,initialCells,bounds:{x:0,y:0,w:880,h:570}}),r=s.run();
  assert.equal(r.cells.length,4);
  assert.ok(Math.max(r.maxError,r.boundaryError??0)<=Math.max(s.initial.maxError,s.initial.boundaryError??0));
});
test('flight reservation has no clearance before the heading or beyond the first target',async()=>{
  const {flightCorridor,blocksFlight}=await import('../src/lib/mosaic-relaxation.ts');
  const p={flight:{from:'heading',to:'target',width:64}};
  const cells=[{key:'heading',x:40,y:100,w:400,h:200},{key:'target',x:90,y:1200,w:300,h:350}];
  assert.deepEqual(flightCorridor(p,cells),{x:208,y:300,w:64,h:900});
  assert.equal(blocksFlight(p,cells,{key:'above',x:210,y:-100,w:50,h:100}),false);
  assert.equal(blocksFlight(p,cells,{key:'below',x:210,y:1600,w:50,h:200}),false);
  assert.equal(blocksFlight(p,cells,{key:'before',x:210,y:250,w:50,h:50}),false);
  assert.equal(blocksFlight(p,cells,{key:'past',x:210,y:1200,w:50,h:50}),false);
  assert.equal(blocksFlight(p,cells,{key:'inside',x:210,y:500,w:50,h:100}),true);
  assert.equal(blocksFlight(p,cells,{key:'side',x:272,y:500,w:50,h:100}),false);
});
test('packing outside flight endpoints crosses the former center seam',async()=>{
  const {releaseOutsideFlight}=await import('../src/lib/mosaic-relaxation.ts');
  const cells=[{key:'heading',x:-200,y:0,w:400,h:200},{key:'target',x:-200,y:1000,w:400,h:200},
    {key:'above-left',x:-400,y:-500,w:300,h:240},{key:'above-right',x:100,y:-500,w:300,h:240},
    {key:'below-left',x:-400,y:1400,w:300,h:240},{key:'below-right',x:100,y:1400,w:300,h:240},
    {key:'bank',x:-400,y:450,w:300,h:240}];
  const cards=cells.map(c=>({key:c.key,width:{min:c.w,preferred:c.w,max:c.w},height:{min:c.h,preferred:c.h,max:c.h}}));
  const p={...problem,cards,bounds:{x:-700,y:-800,w:1400,h:2600},anchors:[{key:'heading',centerX:0,centerY:100},{key:'target',centerX:0,centerY:1100}],flight:{from:'heading',to:'target',width:64}};
  const out=releaseOutsideFlight(p,cells);
  assert.ok(out.some(c=>c.y+c.h<=0 && c.x<0 && c.x+c.w>0),'Actual card must cross the center above the intro');
  assert.ok(out.some(c=>c.y>=1200 && c.x<0 && c.x+c.w>0),'Actual card must cross the center below the target');
  for(const key of ['heading','target','bank'])assert.deepEqual(out.find(c=>c.key===key),cells.find(c=>c.key===key));
  for(const a of out){const original=cells.find(c=>c.key===a.key);assert.equal(a.w,original.w);assert.equal(a.h,original.h);for(const b of out)if(a!==b)assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);}
});
test('pocket audit detects empty spaces smaller than a whole card',async()=>{
  const {measurePockets}=await import('../src/lib/mosaic-relaxation.ts');
  const cells=[{key:'top',x:0,y:0,w:600,h:200},{key:'left',x:0,y:264,w:200,h:200},{key:'right',x:400,y:264,w:200,h:200},{key:'bottom',x:0,y:528,w:600,h:200}];
  const p={...problem,bounds:{x:0,y:0,w:600,h:728}};
  const pockets=measurePockets(cells,p);
  assert.ok(pockets.some(r=>r.x===232&&r.y===232&&r.w===136&&r.h===264));
});
test('a shared-edge mosaic has no residual pocket after accounting for target gutters',async()=>{
  const {measurePockets}=await import('../src/lib/mosaic-relaxation.ts');
  const cells=[{key:'a',x:0,y:0,w:200,h:200},{key:'b',x:264,y:0,w:200,h:200},{key:'c',x:0,y:264,w:200,h:200},{key:'d',x:264,y:264,w:200,h:200}];
  assert.deepEqual(measurePockets(cells,{...problem,bounds:{x:0,y:0,w:464,h:464}}),[]);
});

test('final centering balances available space without resizing, moving pins, or overlapping captions',()=>{
  const cells=[{key:'left',x:0,y:0,w:100,h:300},{key:'right',x:600,y:0,w:100,h:300},{key:'middle',x:120,y:20,w:200,h:100}];
  const p={bounds:{x:0,y:0,w:700,h:300},gutter:[20,20],seed:1,cards:cells.map(c=>({key:c.key,width:{min:c.w,preferred:c.w,max:c.w},height:{min:c.h,preferred:c.h,max:c.h},captionHeight:c.key==='middle'?40:0})),pins:cells.slice(0,2)};
  const out=centerAvailableSpace(cells,p);
  assert.deepEqual(out.slice(0,2),cells.slice(0,2));
  assert.deepEqual(out[2],{key:'middle',x:250,y:80,w:200,h:100});
  assert.deepEqual(cells[2],{key:'middle',x:120,y:20,w:200,h:100});
  const exhausted=createRelaxation({...p,initialCells:cells,limit:0}).run();
  assert.equal(exhausted.status,'best-effort');assert.deepEqual(exhausted.cells,out);
});
test('final centering preserves the exact straight flight lane and its endpoints',()=>{
  const cells=[{key:'intro',x:150,y:0,w:100,h:100},{key:'target',x:150,y:500,w:100,h:100},{key:'side',x:0,y:160,w:100,h:100}];
  const p={bounds:{x:0,y:0,w:400,h:600},gutter:[20,20],seed:1,cards:cells.map(c=>({key:c.key,width:{min:c.w,preferred:c.w,max:c.w},height:{min:c.h,preferred:c.h,max:c.h}})),pins:cells.slice(0,2),flight:{from:'intro',to:'target',width:40}};
  const out=centerAvailableSpace(cells,p);
  assert.deepEqual(out.slice(0,2),cells.slice(0,2));
  assert.ok(out[2].x+out[2].w<=180 || out[2].x>=220);
});

test('production may discard inspector history without changing the solved grid',()=>{
  const expected=createRelaxation(problem).run();
  const solver=createRelaxation({...problem,recordHistory:false});
  assert.deepEqual(solver.run(),expected);assert.equal(solver.history.length,0);
});
test('centering is balanced against the final positions of both neighboring cards',()=>{
  const cells=[{key:'a',x:0,y:0,w:200,h:100},{key:'b',x:300,y:0,w:200,h:100}];
  const p={bounds:{x:0,y:0,w:1000,h:200},gutter:[64,64],seed:1,cards:cells.map(c=>({key:c.key,width:{min:c.w,preferred:c.w,max:c.w},height:{min:c.h,preferred:c.h,max:c.h}}))};
  const out=centerAvailableSpace(cells,p);
  assert.ok(Math.abs(out[0].x-200)<.1);assert.ok(Math.abs(out[1].x-600)<.1);
  assert.equal(out[0].y,50);assert.equal(out[1].y,50);
});
