// Independent DOM-versus-model check through the entire lift, not just border
// ownership. Narrow cards expose a stale fixed-column transform origin.
async () => {
  let scene;
  for(const url of performance.getEntriesByType('resource').map(e=>e.name).filter(u=>u.includes('/src/lib/scene.ts'))){const s=(await import(url)).sceneOf(document.querySelector('.home__stage'));if(s.layout?.patch)scene=s;}
  if(!scene)throw Error('Packed canvas not ready');
  const canvas=document.querySelector('[data-canvas]'),home=canvas.closest('.home');
  const oldPilot=scene.pilot,oldMode=home.dataset.experience;
  const results=[];
  try{
    for(const pattern of ['profile-card','sign-in','choose-plan']){
      const entries=scene.layout.patch.items.map((p,row)=>({p,row})).filter(({p})=>p.pattern===pattern).sort((a,b)=>a.p.card.w-b.p.card.w);
      const {p,row}=entries[0];
      canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:scene.pan[0]+p.x+p.card.w/2-scene.size[0]/2,deltaY:scene.pan[1]+p.y+p.card.h/2-(scene.size[1]+scene.inset[1])/2}));
      const deadline=performance.now()+15000;
      do{await new Promise(r=>requestAnimationFrame(r));if(performance.now()>deadline)throw Error('Mount did not settle');}while(canvas.hasAttribute('data-grid-pending')||canvas.hasAttribute('data-grid-mounting'));
      home.dataset.experience='auto';
      scene.publish({pilot:{active:true,featured:{column:-1,row},strike:{column:-1,row,offset:[0,20],normal:[-1,0],count:100000+row},update(_dt,pan){return pan;},interrupt(){}}});
      let worst=0,ringError=0,samples=0;
      for(let i=0;i<35;i++){
        await new Promise(r=>requestAnimationFrame(r));
        const node=[...document.querySelectorAll(`[data-pattern="${pattern}"][data-mosaic-size]`)].filter(e=>e.style.visibility!=='hidden').sort((a,b)=>{
          const x=a.getBoundingClientRect(),y=b.getBoundingClientRect(),cx=scene.size[0]/2,cy=(scene.size[1]+scene.inset[1])/2;
          return Math.hypot(x.x+x.width/2-cx,x.y+x.height/2-cy)-Math.hypot(y.x+y.width/2-cx,y.y+y.height/2-cy);
        })[0];
        const card=node?.querySelector('tp-card'),body=card?.shadowRoot?.querySelector('[part="card"]'),ring=node?.querySelector('tp-mo-glow-border')?.shadowRoot?.querySelector('.ring');
        if(!body||!ring)throw Error('Missing rendered boundary');
        const r=body.getBoundingClientRect(),rr=ring.getBoundingClientRect();
        const candidates=scene.rects.map(b=>({x:b.x+scene.origin[0],y:b.y+scene.origin[1],w:b.w,h:b.h}));
        candidates.sort((a,b)=>Math.hypot(a.x+a.w/2-r.x-r.width/2,a.y+a.h/2-r.y-r.height/2)-Math.hypot(b.x+b.w/2-r.x-r.width/2,b.y+b.h/2-r.y-r.height/2));
        const m=candidates[0];
        worst=Math.max(worst,Math.abs(m.x-r.x),Math.abs(m.y-r.y),Math.abs(m.w-r.width),Math.abs(m.h-r.height));
        ringError=Math.max(ringError,Math.abs(rr.x-r.x),Math.abs(rr.y-r.y),Math.abs(rr.width-r.width),Math.abs(rr.height-r.height));samples++;
      }
      if(worst>1)throw Error(`${pattern}: fluid boundary drifted ${worst.toFixed(2)}px from the actual card`);
      if(ringError>1)throw Error(`${pattern}: glow ring drifted ${ringError.toFixed(2)}px from the actual card`);
      results.push({pattern,width:p.card.w,samples,maskError:worst,ringError});
    }
  }finally{home.dataset.experience=oldMode;scene.publish({pilot:oldPilot});}
  return {passed:true,results};
}
