// Run with Chrome DevTools evaluate_script on the homepage after its intro.
async () => {
  let scene;
  for(const url of performance.getEntriesByType('resource').map(e=>e.name).filter(url=>url.includes('/src/lib/scene.ts'))) {
    const candidate=(await import(url)).sceneOf(document.querySelector('.home__stage'));
    if(candidate.layout?.patch)scene=candidate;
  }
  if(!scene)throw Error('Packed world not ready');
  const canvas=document.querySelector('[data-canvas]');
  const {freePackingRects}=await import('/src/lib/rect-packing.ts');
  const results=[];
  for(const [cx,cy] of [[0,0],[0,3000],[3500,3000],[3500,-2500],[-3500,-2500],[-3500,3000],[0,0]]) {
    canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:scene.pan[0]-scene.size[0]/2+cx,deltaY:scene.pan[1]-scene.size[1]/2+cy}));
    const deadline=performance.now()+10000;
    do {
      await new Promise(resolve=>requestAnimationFrame(resolve));
      if(performance.now()>deadline)throw Error('Grid preparation did not settle');
    }while(canvas.hasAttribute('data-grid-pending') || canvas.hasAttribute('data-grid-mounting'));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const catalog=[...new Map(scene.layout.patch.items.map(item=>[item.pattern,{key:item.pattern,width:item.card.w,height:item.height}])).values()];
    const poses=[...document.querySelectorAll('[data-world] [data-item]:not([data-intro-item])')]
      .filter(element=>getComputedStyle(element).visibility!=='hidden')
      .map(element=>{
        const root=element.querySelector('.canvas__composition')?.firstElementChild;
        if(!root)return;
        const card=root.getBoundingClientRect(),footprint=element.getBoundingClientRect();
        return {card:{key:element.dataset.pattern,width:card.width,height:footprint.height},x:card.x-scene.origin[0]-scene.pan[0],y:card.y-scene.origin[1]-scene.pan[1]};
      }).filter(Boolean);
    const bounds={x:-scene.pan[0],y:-scene.pan[1],w:scene.size[0],h:scene.size[1]};
    const holes=freePackingRects(bounds,poses,scene.layout.gap).filter(rect=>catalog.some(card=>card.width+scene.layout.gap[0]<=rect.w && card.height+scene.layout.gap[1]<=rect.h));
    if(holes.length)throw Error(`Viewport ${cx},${cy}: ${holes.length} usable holes: ${JSON.stringify(holes)}`);
    if(scene.layout.columns.some(column=>column.items.some(item=>item.card.w>0)))throw Error('An overlapping second grid is still active');
    results.push({center:[cx,cy],rendered:poses.length,usableHoles:holes.length});
  }
  return {passed:true,positions:results};
}
