// Run from page start: wrap it as `addEventListener("DOMContentLoaded", () => window.__check = (<this>)())` in
// navigate_page's initScript, then read `await window.__check` with evaluate_script. The intro starts at
// once, so a check attached after load misses its reveal.
async () => {
  const home=document.querySelector('.home'),canvas=home.querySelector('[data-canvas]');
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  let landing,cardLight;
  const completed=new Promise(resolve=>home.addEventListener('introcomplete',event=>{landing=event.detail;resolve();},{once:true}));
  assert(home.dataset.experience==='intro','Run this check before the intro finishes');
  while(!canvas.hasAttribute('data-layout-settled'))await frame();
  let scene;
  for(const url of performance.getEntriesByType('resource').map(e=>e.name).filter(u=>u.includes('/src/lib/scene.ts'))){
    const candidate=(await import(url)).sceneOf(home.querySelector('.home__stage'));if(candidate.layout)scene=candidate;
  }
  assert(scene,'Scene must be ready');
  home.addEventListener('introcardreveal',()=>{const r=home.querySelector('.intro-card').getBoundingClientRect();cardLight={expected:[r.x+r.width/2-scene.origin[0],r.y+r.height/2-scene.origin[1]],at:[...scene.stir.to],velocity:[...scene.stir.velocity],phase:home.dataset.intro};},{once:true});
  let departure;home.addEventListener('introdeparture',()=>{const r=home.querySelector('.intro-card').getBoundingClientRect();departure={expected:[r.x+r.width/2-scene.origin[0],r.y+r.height/2-scene.origin[1]],from:[...scene.stir.from],to:[...scene.stir.to]};},{once:true});
  const samples=[];let collecting=true;
  const sample=()=>{
    if(scene.stir)samples.push({worldY:scene.stir.to[1]-scene.pan[1],x:scene.stir.to[0],speed:scene.stir.velocity[1],strength:scene.stir.strength});
    if(collecting)requestAnimationFrame(sample);
  };requestAnimationFrame(sample);
  canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:800,clientY:650,movementX:20,movementY:10}));
  for(let i=0;i<3;i++)await frame();
  assert(home.dataset.experience==='intro','Hover must not unlock the intro');
  assert([...home.querySelectorAll('tp-mo-glow-border')].every(g=>g.trackPoint!==null),'Locked glow must never follow the pointer');
  await completed;collecting=false;
  for(let i=0;i<8;i++)await frame();
  assert(cardLight && cardLight.phase==='playing' && cardLight.velocity.every(v=>v===0) && cardLight.at.every((v,i)=>Math.abs(v-cardLight.expected[i])<1),'Stationary center light must turn on during the card reveal');
  assert(departure && departure.from.every((v,i)=>Math.abs(v-departure.expected[i])<1) && departure.to.every((v,i)=>Math.abs(v-departure.expected[i])<1),'Light must begin behind the exact center of the starting card');
  assert(landing?.ref.i===scene.layout.opening.landing && landing.ref.k===0,'First arrival must hand off the landing card');
  const strike=scene.pilot?.strike,featured=scene.pilot?.featured;
  assert(strike?.item===landing.ref.i && strike.normal[1]===-1,'The first impulse must strike the landing card at its top edge');
  assert(featured?.item===landing.ref.i,'The first hit must activate that same card');
  // The landing card is the one lifted, under the impact point.
  const target=[...home.querySelectorAll('[data-world] [data-item]:not([data-pooled])')].find(el=>parseFloat(el.style.getPropertyValue('--lift'))>.2);
  assert(target?.dataset.pattern===scene.layout.items[landing.ref.i].pattern,'First card must visibly lift after impact');
  assert(target.querySelector('tp-mo-glow-border')?.hasAttribute('data-tp-lit'),'First impact must light the border');
  assert(scene.burst?.count>0,'First impact must emit a fluid burst');
  const flight=samples.filter(s=>s.speed>0);
  assert(flight.length>10,'Must sample the actual opening flight');
  assert(Math.max(...flight.map(s=>s.x))-Math.min(...flight.map(s=>s.x))<1,'First impulse must remain straight down');
  for(let i=1;i<flight.length;i++)assert(flight[i].worldY>=flight[i-1].worldY-1,'First impulse must never reverse');
  for(let i=1;i<flight.length;i++)assert(flight[i].speed>=flight[i-1].speed-1,'Opening must not brake before the slingshot');
  const finish=flight.filter(s=>landing.contact[1]-s.worldY<600);
  assert(finish.length>2 && finish.at(-1).speed>Math.min(...finish.map(s=>s.speed))*1.5,'Final run must accelerate out of the slingshot wind-up');
  assert(finish.at(-1).strength>1.5,'Fluid must strengthen over the final run');
  canvas.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse',clientX:800,clientY:650}));
  canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:800,clientY:650,movementX:10,movementY:10}));
  for(let i=0;i<3;i++)await frame();
  assert(home.dataset.experience==='auto','Hover must not unlock auto mode');
  assert([...home.querySelectorAll('tp-mo-glow-border')].every(g=>g.trackPoint!==null),'Auto-mode glow must never follow the pointer');
  return {passed:true,cardLight,departure,strike,slingshot:{windup:Math.min(...finish.map(s=>s.speed)),impact:finish.at(-1).speed},samples:flight.length};
}
