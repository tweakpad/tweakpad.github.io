// Run through Chrome DevTools evaluate_script after the homepage intro.
// Synthetic input isolates the canvas handlers; pointer capture is bypassed
// because dispatched pointer events have no native OS pointer to capture.
async () => {
  const canvas=document.querySelector('[data-canvas]');
  const waitFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const summarize=a=>({max:Math.max(...a),p95:[...a].sort((a,b)=>a-b)[Math.floor(a.length*.95)]});
  const samples=[];
  canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:1}));
  const capture=canvas.setPointerCapture,release=canvas.releasePointerCapture;
  canvas.setPointerCapture=()=>{};canvas.releasePointerCapture=()=>{};
  try {
    for(const mode of ['wheel','drag']){
      const input=[],frames=[];let last=performance.now();
      if(mode==='drag')canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:99,pointerType:'mouse',button:0,clientX:800,clientY:700}));
      for(let i=0;i<90;i++){
        const t=performance.now();
        if(mode==='wheel')canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:60,deltaX:25}));
        else canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:99,pointerType:'mouse',buttons:1,clientX:800-(i+1)*25,clientY:700-(i+1)*60,movementX:-25,movementY:-60}));
        input.push(performance.now()-t);
        const frame=await waitFrame();frames.push(frame-last);last=frame;
      }
      if(mode==='drag')canvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:99,pointerType:'mouse',button:0}));
      const deadline=performance.now()+10000;
      while(canvas.hasAttribute('data-grid-pending') || canvas.hasAttribute('data-grid-mounting')){
        if(performance.now()>deadline)throw Error('Grid did not settle after gesture');await waitFrame();
      }
      const visible=[...document.querySelectorAll('[data-world] [data-mosaic-size]')].filter(e=>{const r=e.getBoundingClientRect();return r.bottom>320 && r.top<innerHeight && r.right>0 && r.left<innerWidth;}).length;
      if(!visible)throw Error(`${mode} left an empty canvas`);
      if(Math.max(...input)>100)throw Error(`${mode} blocked input for ${Math.max(...input).toFixed(1)}ms`);
      const frameMs=summarize(frames);
      if(frameMs.p95>35 || frameMs.max>100)throw Error(`${mode} missed the frame budget: ${JSON.stringify(frameMs)}`);
      samples.push({mode,inputMs:summarize(input),frameMs,visible});
    }
  }finally{canvas.setPointerCapture=capture;canvas.releasePointerCapture=release;}
  return {passed:true,samples};
}
