// Chrome DevTools evaluate_script after intro. Checks the actual published world
// and rendered outline ownership after mounting/reusing cards.
async () => {
  let scene;
  for(const url of performance.getEntriesByType('resource').map(e=>e.name).filter(u=>u.includes('/src/lib/scene.ts'))){const s=(await import(url)).sceneOf(document.querySelector('.home__stage'));if(s.layout?.patch)scene=s;}
  if(!scene)throw Error('Packed world is not ready');
  const canvas=document.querySelector('[data-canvas]');
  // Independent geometric audit: nearest projected edge in each direction.
  // Deliberately does not import the insertion/repair predicate.
  const repeats=(poses)=>{
    for(const a of poses){
      const across=poses.filter(b=>b!==a && b.y<a.y+a.card.height && b.y+b.card.height>a.y);
      const down=poses.filter(b=>b!==a && b.x<a.x+a.card.width && b.x+b.card.width>a.x);
      const directions=[
        across.filter(b=>b.x+b.card.width<=a.x+.01).sort((b,c)=>c.x+c.card.width-b.x-b.card.width),
        across.filter(b=>b.x>=a.x+a.card.width-.01).sort((b,c)=>b.x-c.x),
        down.filter(b=>b.y+b.card.height<=a.y+.01).sort((b,c)=>c.y+c.card.height-b.y-b.card.height),
        down.filter(b=>b.y>=a.y+a.card.height-.01).sort((b,c)=>b.y-c.y),
      ];
      for(const neighbors of directions)if(neighbors[0]?.card.key===a.card.key)return a;
    }
  };
  const results=[];
  for(const [cx,cy] of [[0,0],[0,3000],[3500,3000],[-3500,3000],[-3500,-2500],[0,0]]){
    canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:scene.pan[0]-scene.size[0]/2+cx,deltaY:scene.pan[1]-scene.size[1]/2+cy}));
    const deadline=performance.now()+15000;
    do{await new Promise(r=>requestAnimationFrame(r));if(performance.now()>deadline)throw Error('Canvas did not settle');}while(canvas.hasAttribute('data-grid-pending')||canvas.hasAttribute('data-grid-mounting'));
    const poses=scene.layout.patch.items.map(p=>({x:p.x,y:p.y,card:{key:p.pattern,width:p.card.w,height:p.height}}));
    const repeated=repeats(poses);if(repeated)throw Error(`Adjacent repeated ${repeated.card.key} at ${repeated.x},${repeated.y}`);
    let outlines=0;
    for(const element of document.querySelectorAll('[data-world] [data-mosaic-size]')){
      if(getComputedStyle(element).visibility==='hidden')continue;
      const r=element.getBoundingClientRect();if(r.right<0||r.left>innerWidth||r.bottom<0||r.top>innerHeight)continue;
      const glow=element.querySelector('tp-mo-glow-border'),card=glow?.querySelector('tp-card');if(!glow||!card)continue;
      await glow.updateComplete;await card.updateComplete;
      const body=card.shadowRoot.querySelector('[part="card"]');
      if(!/rgba\([^)]*, 0\)$/.test(getComputedStyle(body).borderColor))throw Error('Native card border must be replaced by the glow boundary');
      if(glow.shadowRoot.querySelectorAll('[part="mo-glow-border-line"]').length!==1)throw Error('Expected one boundary line');
      if(getComputedStyle(card).boxShadow.includes('0px 1px 0px'))throw Error('A second highlight outline is still applied');
      outlines++;
    }
    results.push({center:[cx,cy],cards:poses.length,outlines});
  }
  return {passed:true,results};
}
