// Chrome DevTools evaluate_script, immediately after a reload. Profiles only
// the first descent; also checks centering and the departed heading's real DOM.
async () => {
  const home=document.querySelector('.home'),canvas=home.querySelector('[data-canvas]'),header=home.querySelector('.intro');
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  let scene;
  while(!canvas.hasAttribute('data-layout-settled'))await frame();
  for(const url of performance.getEntriesByType('resource').map(e=>e.name).filter(u=>u.includes('/src/lib/scene.ts'))){const s=(await import(url)).sceneOf(home.querySelector('.home__stage'));if(s.layout)scene=s;}
  assert(home.dataset.experience==='intro'&&scene,'Run before the intro completes');
  while(home.dataset.intro!=='playing'||+getComputedStyle(header).opacity<.999)await frame();
  const r=header.getBoundingClientRect();
  const center=[r.x+r.width/2,r.y+r.height/2];
  assert(Math.abs(center[0]-innerWidth/2)<1 && Math.abs(center[1]-innerHeight/2)<1,'Initial card must be centered in the viewport');
  const others=[...home.querySelectorAll('[data-world] [data-item]')].filter(e=>!e.hasAttribute('data-intro-item')&&e.style.visibility!=='hidden'&&e.children.length).map(e=>e.getBoundingClientRect()).filter(b=>b.width>0&&b.right>r.left&&b.left<r.right);
  const above=Math.max(...others.filter(b=>b.bottom<=r.top+1).map(b=>b.bottom));
  const below=Math.min(...others.filter(b=>b.top>=r.bottom-1).map(b=>b.top));
  const clearance=[r.top-above,below-r.bottom];
  assert(Math.abs(clearance[0]-clearance[1])<2,'Initial card must balance the available vertical space');
  const worldCenter=[center[0]-scene.pan[0],center[1]-scene.pan[1]];
  let moving=false,running=false,last=0,clones=0;
  const frames=[],clone=Node.prototype.cloneNode;
  Node.prototype.cloneNode=function(deep){if(moving&&deep&&this instanceof Element&&this.hasAttribute('data-item'))clones++;return clone.call(this,deep);};
  const complete=new Promise(resolve=>home.addEventListener('introcomplete',resolve,{once:true}));
  home.addEventListener('introdeparture',()=>{moving=running=true;last=performance.now();requestAnimationFrame(function sample(t){if(!running)return;frames.push(t-last);last=t;requestAnimationFrame(sample);});},{once:true});
  home.addEventListener('introhandoff',()=>moving=false,{once:true,capture:true});
  try{await complete;}finally{running=false;Node.prototype.cloneNode=clone;}
  assert(clones===0,`First impulse constructed ${clones} live cards`);
  const sorted=[...frames].sort((a,b)=>a-b),p95=sorted[Math.floor(sorted.length*.95)],max=Math.max(...frames);
  assert(p95<=35 && max<=80,`First impulse frame budget missed: p95=${p95}, max=${max}`);
  canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:scene.pan[0]-innerWidth/2+worldCenter[0],deltaY:scene.pan[1]-innerHeight/2+worldCenter[1]}));
  const deadline=performance.now()+15000;
  do{await frame();assert(performance.now()<deadline,'Opening refill did not settle');}while(canvas.hasAttribute('data-grid-pending')||canvas.hasAttribute('data-grid-mounting'));
  const core={x:innerWidth/2-r.width*.4,y:innerHeight/2-r.height*.4,w:r.width*.8,h:r.height*.8};
  let covered=0;
  for(const element of home.querySelectorAll('[data-world] [data-mosaic-size]')){
    if(getComputedStyle(element).visibility==='hidden')continue;
    const body=element.querySelector('.canvas__composition')?.firstElementChild;if(!body)continue;
    const b=body.getBoundingClientRect();
    covered+=Math.max(0,Math.min(b.right,core.x+core.w)-Math.max(b.left,core.x))*Math.max(0,Math.min(b.bottom,core.y+core.h)-Math.max(b.top,core.y));
  }
  const coverage=covered/(core.w*core.h);
  assert(coverage>.4,`The departed heading still leaves a large visible island: ${(coverage*100).toFixed(1)}% occupied`);
  return {passed:true,frames:frames.length,p95,max,constructedCards:clones,headingClearance:clearance,departedRegionCoverage:coverage};
}
