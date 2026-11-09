import '@tweakpad/ui/register';
import { createRelaxation, resizeAllowance, flightCorridor, type MosaicCard, type Result, type Problem } from '../lib/mosaic-relaxation';
import { freePackingRects } from '../lib/rect-packing';
import { introComposition, type IntroCardSize, type IntroPlacement } from '../lib/intro-composition';

type MeasuredCard = IntroCardSize & {solidHeight?:number};
type Measurements = {cards:MeasuredCard[];hero:IntroCardSize;titleCenter:number;stickyTop:number;viewportWidth:number;viewportHeight:number;gap:[number,number];distanceCards:number};
const input=(id:string)=>document.getElementById(id) as HTMLInputElement;
const canvas=document.getElementById('scene') as HTMLCanvasElement;
const ctx=canvas.getContext('2d')!;
const info=document.getElementById('info')!;
const status=document.getElementById('status')!;
const catalog=document.getElementById('catalog') as HTMLTextAreaElement;
const individualRanges=new Map<string,number>();
let measured:Measurements|undefined;
let solver:ReturnType<typeof createRelaxation>|undefined;
let solverResult:Result|undefined;
let solverProblem:Problem|undefined;
let poses:IntroPlacement[]=[];
let selected=-1;
let scale=.25, tx=0, ty=0;
let width=0,height=0;
let probe:HTMLIFrameElement|undefined;
let stable:ReturnType<typeof setTimeout>|undefined;
let randomAfterMeasure=true;
let runtime: {pan:[number,number];size:[number,number];phase:string;virtualized:number;catalog:MeasuredCard[];gap:[number,number]}|undefined;
let captureRuntime=false;
let loadDeadline:ReturnType<typeof setTimeout>|undefined;
const number=(id:string)=>Number(input(id).value);
const gap=()=>[number('gap-x'),number('gap-y')] as const;

function measure(randomSizes=false,liveRun=false) {
  captureRuntime=liveRun;runtime=undefined;
  solver=undefined;solverResult=undefined;solverProblem=undefined;
  randomAfterMeasure=randomSizes;
  probe?.remove();clearTimeout(stable);clearTimeout(loadDeadline);
  status.textContent='Measuring live homepage…';
  const frame=document.createElement('iframe');probe=frame;
  frame.id='probe';frame.width=String(number('width'));frame.height=String(number('height'));
  frame.title='Live card measurement';frame.src=liveRun ? '/?intro-grid-debug=runtime' : '/?intro-grid-debug=1';document.body.append(frame);
  loadDeadline=setTimeout(()=>{status.textContent='Measurement timed out. Check the live homepage.';frame.remove();},20000);
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin || event.source!==probe?.contentWindow)return;
  if(event.data?.type==='intro-grid-runtime' && captureRuntime) {
    const firstFrame=!runtime;
    runtime=event.data;poses=event.data.poses;selected=-1;
    clearTimeout(loadDeadline);
    status.textContent=`Runtime: ${runtime!.phase} · ${runtime!.virtualized} cards virtualized`;
    Object.assign(window,{introGridDebug:{measured,poses,runtime,audit:auditCurrent}});
    if(firstFrame)fitAll();else draw();
    return;
  }
  if(event.data?.type!=='intro-grid-measurements')return;
  measured=event.data;
  if(captureRuntime)return;
  catalog.value=JSON.stringify(measured!.cards,null,2);
  clearTimeout(stable);
  stable=setTimeout(()=>{
    clearTimeout(loadDeadline);probe?.remove();probe=undefined;
    status.textContent=`${measured!.cards.length} live cards · ${number('width')} × ${number('height')}`;
    if(randomAfterMeasure)randomize();else rebuild(true);
  },350);
});
function randomize() {
  if(!measured)return;
  resetSolver();if(solver){showSolver(solver.run());fitAll();}
}
function rebuild(fit=false) {
  if(!measured)return;
  poses=introComposition(measured.cards,measured.hero,measured.titleCenter,number('distance'),number('height'),gap(),number('width'));
  selected=-1;
  if(fit)fitAll();else draw();
  // Exposed for repeatable geometry checks in this development scene.
  Object.assign(window,{introGridDebug:{measured,poses,rebuild,fitAll}});
}
function fitAll() {
  if(!poses.length)return;
  const x=Math.min(...poses.map(p=>p.x)),y=Math.min(...poses.map(p=>p.y));
  const right=Math.max(...poses.map(p=>p.x+p.card.width)),bottom=Math.max(...poses.map(p=>p.y+p.card.height));
  scale=Math.min((width-100)/(right-x),(height-100)/(bottom-y));
  tx=width/2-(x+right)/2*scale;ty=height/2-(y+bottom)/2*scale;draw();
}
function zoom(factor:number,x=width/2,y=height/2) {
  const next=Math.max(.04,Math.min(3,scale*factor));
  tx=x-(x-tx)*next/scale;ty=y-(y-ty)*next/scale;scale=next;draw();
}
function gaps(index:number) {
  const p=poses[index];if(!p)return [];
  const overlapping=poses.map((q,i)=>({q,i})).filter(({q,i})=>i!==index && p.x<q.x+q.card.width && p.x+p.card.width>q.x);
  const above=overlapping.filter(({q})=>q.y+q.card.height<=p.y).sort((a,b)=>b.q.y+b.q.card.height-a.q.y-a.q.card.height)[0];
  const below=overlapping.filter(({q})=>q.y>=p.y+p.card.height).sort((a,b)=>a.q.y-b.q.y)[0];
  return [above && {from:above.q.y+above.q.card.height,to:p.y,value:p.y-above.q.y-above.q.card.height},below && {from:p.y+p.card.height,to:below.q.y,value:below.q.y-p.y-p.card.height}].filter(Boolean) as {from:number;to:number;value:number}[];
}
function auditCurrent() {
  if(!runtime || runtime.phase==='intro')return [];
  const bounds={x:-runtime.pan[0],y:-runtime.pan[1],w:runtime.size[0],h:runtime.size[1]};
  const cards=runtime.catalog.length ? runtime.catalog : measured!.cards;
  return freePackingRects(bounds,poses,runtime.gap).filter(rect=>cards.some(card=>card.width+runtime!.gap[0]<=rect.w && card.height+runtime!.gap[1]<=rect.h));
}
function draw() {
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.clearRect(0,0,width,height);
  ctx.save();ctx.translate(tx,ty);ctx.scale(scale,scale);
  const line=1/scale;ctx.lineWidth=line;
  if(!measured || !poses.length){ctx.restore();return;}
  const flightCells=poses.map(p=>({key:p.card.key,x:p.x,y:p.y,w:p.card.width,h:p.card.solidHeight??p.card.height}));
  const hero=poses.find(p=>p.role==='hero'),target=poses.find(p=>p.role==='landing');
  const flight=solverProblem?.flight ?? (hero&&target?{from:hero.card.key,to:target.card.key,width:gap()[0]}:undefined);
  const corridor=flightCorridor({flight},flightCells);
  if(corridor){
    ctx.fillStyle='#c869dc15';ctx.fillRect(corridor.x,corridor.y,corridor.w,corridor.h);
    ctx.strokeStyle='#c869dc';ctx.setLineDash([6/scale,6/scale]);ctx.beginPath();ctx.moveTo(corridor.x+corridor.w/2,corridor.y);ctx.lineTo(corridor.x+corridor.w/2,corridor.y+corridor.h);ctx.stroke();ctx.setLineDash([]);
  }
  for(let i=0;i<poses.length;i++) {
    const p=poses[i];const card=p.card as MeasuredCard;
    const color=p.role==='hero' ? '#edbd53' : p.role==='landing' ? '#69df9b' : '#719fe0';
    if(input('gutters').checked){ctx.fillStyle='#dd72941a';ctx.fillRect(p.x-gap()[0]/2,p.y-gap()[1]/2,p.card.width+gap()[0],p.card.height+gap()[1]);}
    ctx.strokeStyle=color;ctx.fillStyle=color+'28';
    ctx.fillRect(p.x,p.y,card.width,card.solidHeight ?? card.height);
    ctx.lineWidth=(i===selected ? 3 : 1)/scale;ctx.strokeRect(p.x,p.y,card.width,card.solidHeight ?? card.height);
    ctx.lineWidth=line;
    if(solverResult){const caption=solverProblem?.cards.find(c=>c.key===card.key)?.captionHeight;if(caption){ctx.setLineDash([4/scale,3/scale]);ctx.strokeRect(p.x,p.y+card.height,card.width,caption);ctx.setLineDash([]);}}
    if(card.solidHeight && card.solidHeight<card.height){ctx.setLineDash([4/scale,3/scale]);ctx.strokeRect(p.x,p.y+card.solidHeight,card.width,card.height-card.solidHeight);ctx.setLineDash([]);}
    ctx.fillStyle=color;ctx.font=`${Math.max(12,10/scale)}px monospace`;
    ctx.fillText(`${i} ${card.key}`,p.x+8,p.y+Math.max(20,14/scale),card.width-16);
    if(solverResult && scale>.33){const preferred=solverProblem?.cards.find(c=>c.key===card.key);if(preferred){ctx.fillStyle='#aabbd5';ctx.font=`${Math.max(10,9/scale)}px monospace`;ctx.fillText(`preferred ${preferred.width.preferred} × ${preferred.height.preferred}`,p.x+8,p.y+Math.max(60,43/scale),card.width-16);}}
    if(scale>.33)ctx.fillText(`${card.width.toFixed(1)} × ${card.height.toFixed(1)}`,p.x+8,p.y+Math.max(40,29/scale),card.width-16);
  }
  const landing=poses.find(p=>p.role==='landing');
  const titleY=-measured.hero.height/2+measured.titleCenter;
  const descent=(landing ? landing.y-titleY : 0)*number('progress')/100;
  const lead=Math.max(40,(number('height')-measured.stickyTop-measured.hero.height)*.25);
  const viewportY=runtime ? -runtime.pan[1] : -number('height')/2+Math.max(0,descent-lead);
  const viewportX=runtime ? -runtime.pan[0] : -number('width')/2;
  if(!runtime){ctx.fillStyle='#f5a9ff';ctx.beginPath();ctx.arc(0,titleY+descent,5/scale,0,Math.PI*2);ctx.fill();}
  ctx.strokeStyle='#ffffffa0';ctx.lineWidth=2/scale;ctx.setLineDash([10/scale,5/scale]);
  if(!solverResult)ctx.strokeRect(viewportX,viewportY,runtime?.size[0] ?? number('width'),runtime?.size[1] ?? number('height'));ctx.setLineDash([]);
  if(solverResult)for(const e of solverResult.edges){ctx.strokeStyle=Math.abs(e.gap-e.target)>number('solver-tolerance')?'#ff5376':'#63e8a0';ctx.lineWidth=2/scale;ctx.beginPath();if(e.axis==='x'){ctx.moveTo(e.position+e.gap/2,e.start);ctx.lineTo(e.position+e.gap/2,e.end);}else{ctx.moveTo(e.start,e.position+e.gap/2);ctx.lineTo(e.end,e.position+e.gap/2);}ctx.stroke();}
  if(solverResult?.pockets)for(const pocket of solverResult.pockets){ctx.fillStyle='#f45e7830';ctx.fillRect(pocket.x,pocket.y,pocket.w,pocket.h);}
  const holes=auditCurrent();
  for(const rect of holes){ctx.fillStyle='#f45e7880';ctx.fillRect(rect.x,rect.y,rect.w,rect.h);}

  if(selected>=0){
    const p=poses[selected];const dimensions=gaps(selected);
    const center=p.y+((p.card as MeasuredCard).solidHeight ?? p.card.height)/2;
    ctx.strokeStyle='#edbd5380';ctx.setLineDash([6/scale,5/scale]);ctx.beginPath();ctx.moveTo((-tx)/scale,center);ctx.lineTo((width-tx)/scale,center);ctx.stroke();ctx.setLineDash([]);
    for(const g of dimensions){const x=p.x+p.card.width/2;ctx.strokeStyle=g.value>gap()[1]+1 ? '#ff7189' : '#80e4b0';ctx.beginPath();ctx.moveTo(x,g.from);ctx.lineTo(x,g.to);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.font=`${12/scale}px monospace`;ctx.fillText(`${g.value.toFixed(1)} px`,x+8/scale,(g.from+g.to)/2);}
    info.textContent=`${selected}: ${p.card.key} (${p.role})\nWorld: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}\nNatural footprint: ${p.card.width} × ${p.card.height}\n${dimensions.map(g=>`Vertical gap: ${g.value.toFixed(1)} px`).join('\n')}`;
  }else info.textContent=runtime ? `Actual rendered world: ${runtime.phase}\n${poses.length} rendered · ${runtime.virtualized} virtualized\nUsable card-sized holes in viewport: ${holes.length}\nWhite frame: current runtime viewport\nReturn to opening tests the departed heading area.\nFreeze capture to inspect a frame.` : `${poses.length} rectangles · live dimensions\nPink line: straight initial flight\nWhite frame: preview viewport\nDrag to pan · wheel to zoom · click a rectangle\nThe dashed area below a solid is its caption footprint.`;
  if(solverResult){info.textContent=solverSummary(solverResult);const p=poses[selected],c=p&&solverProblem?.cards.find(c=>c.key===p.card.key);if(c)info.textContent+=`\n\n${c.key}\nWidth ${c.width.min} / ${c.width.preferred} / ${c.width.max}\nHeight ${c.height.min} / ${c.height.preferred} / ${c.height.max}\nAssigned ${p.card.width.toFixed(1)} × ${p.card.height.toFixed(1)}`;}
  ctx.restore();document.getElementById('zoom')!.textContent=`${Math.round(scale*100)}%`;
}
new ResizeObserver(()=>{const r=canvas.getBoundingClientRect();width=r.width;height=r.height;canvas.width=width*devicePixelRatio;canvas.height=height*devicePixelRatio;if(poses.length)fitAll();else draw();}).observe(canvas);
canvas.addEventListener('wheel',event=>{event.preventDefault();const r=canvas.getBoundingClientRect();zoom(Math.exp(-event.deltaY*.001),event.clientX-r.left,event.clientY-r.top);},{passive:false});
let drag:{x:number;y:number;tx:number;ty:number}|undefined;
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,tx,ty};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!drag)return;tx=drag.tx+e.clientX-drag.x;ty=drag.ty+e.clientY-drag.y;draw();});
canvas.addEventListener('pointerup',e=>{if(drag && Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<4){const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left-tx)/scale,y=(e.clientY-r.top-ty)/scale;selected=poses.findIndex(p=>x>=p.x && x<=p.x+p.card.width && y>=p.y && y<=p.y+p.card.height);draw();}drag=undefined;});
document.getElementById('runtime')!.addEventListener('click',()=>measure(false,true));
document.getElementById('return')!.addEventListener('click',()=>probe?.contentWindow?.postMessage({type:'intro-grid-return'},location.origin));
document.getElementById('freeze')!.addEventListener('click',()=>{probe?.remove();probe=undefined;captureRuntime=false;status.textContent+=' · frozen';});
document.getElementById('measure')!.addEventListener('click',()=>measure(false));
document.getElementById('randomize')!.addEventListener('click',()=>{input('seed').value=String(crypto.getRandomValues(new Uint32Array(1))[0]);randomize();});
for(const id of ['seed','count'])input(id).addEventListener('change',randomize);
document.getElementById('fit')!.addEventListener('click',fitAll);
for(const [id,role] of [['heading','hero'],['landing','landing']])document.getElementById(id)!.addEventListener('click',()=>{
  selected=poses.findIndex(p=>p.role===role);const p=poses[selected];if(!p)return;
  scale=.6;tx=width/2-(p.x+p.card.width/2)*scale;ty=height/2-(p.y+p.card.height/2)*scale;draw();
});
document.getElementById('out')!.addEventListener('click',()=>zoom(1/1.25));
document.getElementById('in')!.addEventListener('click',()=>zoom(1.25));
for(const id of ['distance','gap-x','gap-y'])input(id).addEventListener('change',()=>{if(solverResult)resetSolver(true);else rebuild(true);});
for(const id of ['width','height'])input(id).addEventListener('change',()=>{if(solverResult)resetSolver(true);else measure(status.textContent?.includes('randomized') ?? false);});
for(const id of ['progress','gutters'])input(id).addEventListener('input',draw);
document.getElementById('apply')!.addEventListener('click',()=>{try{const cards=JSON.parse(catalog.value);if(Array.isArray(cards)&&typeof cards[0]?.width==='object'){resetSolver(true);return;}if(!Array.isArray(cards)||!cards.every(c=>typeof c.key==='string' && Number.isFinite(c.width) && c.width>0 && Number.isFinite(c.height) && c.height>0))throw Error('Each card needs a key and positive width / height.');if(measured){measured.cards=cards;rebuild(true);status.textContent=`${cards.length} edited cards`;}}catch(error){status.textContent=String(error);}});
function solverSummary(r:Result){return `${r.status==='converged'?'best effort · within gutter tolerance':r.status} · step ${r.steps}/${number('solver-limit')}
Max gutter error: ${Number.isFinite(r.maxError)?r.maxError.toFixed(2)+' px':'not solved'}
RMS gutter error: ${Number.isFinite(r.rmsError)?r.rmsError.toFixed(2)+' px':'not solved'}
Largest pocket: ${r.pockets?.[0]?r.pockets[0].w.toFixed(1)+' × '+r.pockets[0].h.toFixed(1)+' px':'none'}
Pocket area: ${(r.pocketArea??0).toFixed(0)} px²
Boundary remainder: ${(r.boundaryError??0).toFixed(1)} px
Preferred-size deviation: ${Number.isFinite(r.deviation)?r.deviation.toFixed(3):'not solved'}
${r.failures.length?'Rejected topology diagnostics:\n'+r.failures.slice(0,8).join('\n'):''}
${solverProblem?.initialCells?'Measured card proportions · experimental ranges':'Synthetic ranges · not production card limits'}`;}
function showSolver(r:Result){
  solverResult=r;
  poses=r.cells.map(c=>({role:c.key.startsWith('heading')?'hero':c.key.startsWith('landing')?'landing':'context',x:c.x,y:c.y,card:{key:c.key,width:c.w,height:c.h}}));
  info.textContent=solverSummary(r);
  status.textContent=solverSummary(r).split('\n').slice(0,2).join(' · ');
  input('solver-history').max=String(Math.max(0,(solver?.history.length??1)-1));input('solver-history').value=input('solver-history').max;
  Object.assign(window,{mosaicDebug:{solver,problem:solverProblem,result:r}});draw();
}
function resetSolver(fromJSON=false){
  if(!measured)return;
  probe?.remove();probe=undefined;runtime=undefined;captureRuntime=false;
  let seed=number('seed')>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const preset=(document.getElementById('solver-preset') as HTMLSelectElement).value;
  let cards:MosaicCard[]=Array.from({length:Math.max(2,Math.min(60,number('count')))},(_,i)=>{const w=240+Math.round(random()*180),h=200+Math.round(random()*260);const tight=preset==='Tight'? .03:.45;
    return {key:`card-${i+1}`,width:{min:Math.round(w*(1-tight)),preferred:w,max:Math.round(w*(1+tight))},height:{min:Math.round(h*(1-tight)),preferred:h,max:Math.round(h*(1+tight))},captionHeight:44};});
  if(preset==='Overconstrained')cards.forEach(c=>{c.width={min:2000,preferred:2100,max:2200};});
  if(preset==='Ratio stress')cards=cards.map((c,i)=>{const h=100+random()*500,w=h*.18*Math.pow(32,random());return resizeAllowance({...c,width:{min:w,preferred:w,max:w},height:{min:h,preferred:h,max:h}},i%7===0?0:Math.floor(random()*36));});
  if(preset==='Tall/narrow')cards.forEach(c=>{c.width={min:140,preferred:200,max:300};c.height={min:350,preferred:550,max:850};});
  if(preset==='Responsive height')cards.forEach(c=>c.heightFloor=[{width:c.width.min,minHeight:c.height.max*.9},{width:c.width.preferred,minHeight:c.height.min*1.2},{width:c.width.max,minHeight:c.height.min}]);
  if(fromJSON)cards=JSON.parse(catalog.value);
  const pins=[] as NonNullable<Problem['pins']>;
  let bounds={x:0,y:0,w:number('width'),h:number('height')};
  if(preset==='Intro constraints'){
    bounds={x:-900,y:-700,w:1800,h:3700};
    cards.forEach(c=>{c.width={min:80,preferred:300,max:2000};c.height={min:80,preferred:350,max:2000};});
    cards[0]={key:'heading',width:{min:360,preferred:440,max:520},height:{min:200,preferred:280,max:420}};
    cards[1]={key:'landing',width:{min:320,preferred:400,max:520},height:{min:260,preferred:360,max:520}};

    // Central flight spine is excluded from both side regions through fixed bounds.
  }
  if(preset==='Pinned extension')cards.forEach(c=>{c.width={min:80,preferred:300,max:2000};c.height={min:80,preferred:350,max:2000};});
  if(preset==='Pinned extension')pins.push({key:cards[0].key,x:bounds.w/2-cards[0].width.preferred/2,y:bounds.h/2-cards[0].height.preferred/2,w:cards[0].width.preferred,h:cards[0].height.preferred});
  solverProblem={cards,bounds,gutter:[...gap()],seed:number('seed'),limit:number('solver-limit'),tolerance:number('solver-tolerance'),pins,...(preset==='Intro constraints'?{anchors:[{key:'heading',centerX:0,centerY:0},{key:'landing',centerX:0,centerY:1980}],flight:{from:'heading',to:'landing',width:gap()[0]}}:{})};
  if(preset==='Our grid'){
    const original=introComposition(measured.cards,measured.hero,measured.titleCenter,number('distance'),number('height'),gap(),number('width'));
    const spreadW=.15,spreadH=.15;
    const initialCells=original.map((pose,i)=>({key:`${pose.role==='hero'?'heading':pose.role==='landing'?'landing':pose.card.key}#${i}`,x:pose.x,y:pose.y,w:pose.card.width,h:pose.card.solidHeight??pose.card.height}));
    cards=initialCells.map((c,i)=>({key:c.key,width:{min:c.w*(1-spreadW),preferred:c.w,max:c.w*(1+spreadW)},height:{min:c.h*(1-spreadH),preferred:c.h,max:c.h*(1+spreadH)},captionHeight:original[i].role==='hero'?0:Math.max(0,original[i].card.height-c.h)}));
    cards=cards.map(c=>resizeAllowance(c,individualRanges.get(c.key)??15));
    if(fromJSON){cards=JSON.parse(catalog.value);cards.forEach(c=>{if(c.resizePercent!==undefined)individualRanges.set(c.key,c.resizePercent);});}
    const panel=document.getElementById('individual-ranges')!;panel.replaceChildren();
    for(const key of [...new Set(cards.map(c=>c.key))]){
      const label=document.createElement('label');label.textContent=key+' ± ';
      const control=document.createElement('input');control.type='number';control.min='0';control.max='99';control.step='1';control.value=String(individualRanges.get(key)??15);control.setAttribute('aria-label',key+' resizing percentage');
      control.addEventListener('change',()=>{individualRanges.set(key,Math.max(0,Math.min(99,Number(control.value))));resetSolver();if(solver)showSolver(solver.run());});
      label.append(control,document.createTextNode('%'));panel.append(label);
    }
    const x=Math.min(...initialCells.map(c=>c.x)),y=Math.min(...initialCells.map(c=>c.y));
    const right=Math.max(...initialCells.map(c=>c.x+c.w)),bottom=Math.max(...initialCells.map(c=>c.y+c.h));
    solverProblem={...solverProblem,cards,bounds:{x,y,w:right-x,h:bottom-y},initialCells,anchors:initialCells.filter((_,i)=>original[i].role!=='context').map(c=>({key:c.key,centerX:c.x+c.w/2,centerY:c.y+c.h/2})),flight:{from:initialCells.find(c=>c.key.startsWith('heading#'))!.key,to:initialCells.find(c=>c.key.startsWith('landing#'))!.key,width:gap()[0]}};
  }
  if(preset!=='Our grid'){
    const panel=document.getElementById('individual-ranges')!;panel.replaceChildren();
    for(const card of cards){const label=document.createElement('label');label.textContent=card.key+' ± ';const control=document.createElement('input');control.type='number';control.min='0';control.max='99';control.value=String(card.resizePercent??Math.round((card.width.max/card.width.preferred-1)*100));control.addEventListener('change',()=>{if(!solverProblem)return;solverProblem.cards=solverProblem.cards.map(c=>c.key===card.key?resizeAllowance(c,Number(control.value)):c);catalog.value=JSON.stringify(solverProblem.cards,null,2);solver=createRelaxation(solverProblem);showSolver(solver.run());});label.append(control,document.createTextNode('%'));panel.append(label);}
  }
  const previous=solverProblem.initialCells?{cells:solverProblem.initialCells,edges:[],status:'best-effort' as const,steps:0,maxError:Infinity,rmsError:Infinity,deviation:0,failures:[]}:solverResult;solver=createRelaxation(solverProblem,previous?.cells.length?previous:undefined);solverResult=undefined;
  catalog.value=JSON.stringify(cards,null,2);status.textContent=solverProblem.initialCells?'Solver reset · measured grid, experimental ranges':'Solver reset · synthetic size ranges';
  Object.assign(window,{mosaicDebug:{solver,problem:solverProblem}});
}
document.getElementById('solver-before')!.addEventListener('click',()=>{if(!solver)return;showSolver(solver.initial);status.textContent='Before relaxation · measured preferred sizes';fitAll();});
for(const id of ['solver-limit','solver-tolerance'])input(id).addEventListener('change',()=>resetSolver(true));
document.getElementById('solver-reset')!.addEventListener('click',()=>resetSolver());
document.getElementById('solver-step')!.addEventListener('click',()=>{if(!solver)resetSolver();if(solver)showSolver(solver.step());});
document.getElementById('solver-run')!.addEventListener('click',()=>{if(!solver)resetSolver();if(solver){showSolver(solver.run());fitAll();}});
document.getElementById('solver-apply')!.addEventListener('click',()=>{try{resetSolver(true);}catch(e){status.textContent=String(e);}});
input('solver-history').addEventListener('input',()=>{const r=solver?.history[number('solver-history')];if(r){showSolver(r);input('solver-history').value=String(r.steps-1);}});
(document.getElementById('solver-preset') as HTMLSelectElement).addEventListener('change',()=>resetSolver());
measure(true);
