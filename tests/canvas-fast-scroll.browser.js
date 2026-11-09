// Run after intro through Chrome DevTools. Count coverage during traversal,
// rather than only after waiting for the worker to catch up.
async()=>{
 const canvas=document.querySelector('[data-canvas]');let empty=0,min=Infinity,last=performance.now();const frames=[];
 for(let i=0;i<120;i++){
  canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:45,deltaY:180}));
  const now=await new Promise(r=>requestAnimationFrame(r));frames.push(now-last);last=now;
  let count=0;
  for(const e of canvas.querySelectorAll('[data-mosaic-size]')){if(e.style.visibility==='hidden')continue;const b=e.getBoundingClientRect();if(b.bottom>320&&b.top<innerHeight&&b.right>0&&b.left<innerWidth)count++;}
  min=Math.min(min,count);if(!count)empty++;
 }
 const p95=[...frames].sort((a,b)=>a-b)[114],max=Math.max(...frames);
 if(empty)throw Error(`${empty} frames showed an empty viewport`);
 if(p95>35||max>100)throw Error(`Fast traversal exceeded frame budget: ${p95}/${max}`);
 return {passed:true,minVisible:min,emptyFrames:empty,p95,max};
}
