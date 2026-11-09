// @ts-nocheck
// Run through Chrome DevTools evaluate_script just after loading the homepage.
async () => {
  const home = document.querySelector('.home');
  const canvas = home.querySelector('[data-canvas]');
  const world = home.querySelector('[data-world]');
  const header = home.querySelector('.intro');
  let handoffDelta;
  let contextDelta;
  let preservedContexts;
  if (home.dataset.experience === 'intro') home.addEventListener('introhandoff', event => {
    if (!event.detail) return;
    const nodes=[...world.querySelectorAll('[data-intro-clone]')].filter(node=>{const r=node.getBoundingClientRect();return r.right>0 && r.left<innerWidth && r.bottom>0 && r.top<innerHeight;});
    const before=nodes.map(node=>node.getBoundingClientRect());
    const target=world.querySelector('[data-item]:not([data-intro-item]):not([data-intro-clone]):not([data-clone]) .canvas__composition').firstElementChild;
    const targetBefore=target.getBoundingClientRect();
    queueMicrotask(()=>{
      const after=target.getBoundingClientRect();
      handoffDelta=Math.max(...['x','y','width','height'].map(key=>Math.abs(after[key]-targetBefore[key])));
      contextDelta=Math.max(0,...nodes.flatMap((node,i)=>['x','y','width','height'].map(key=>Math.abs(node.getBoundingClientRect()[key]-before[i][key]))));
      preservedContexts=nodes.every(node=>node.isConnected && getComputedStyle(node).opacity==='1' && getComputedStyle(node).visibility!=='hidden');
    });
  }, { capture:true, once:true });
  if (home.dataset.intro) {
    assertGrid();
  }
  function assertGrid() {
    if (!header.closest('[data-world] [data-intro-item]')) throw new Error('Initial intro must occupy a grid slot');
    if (home.querySelectorAll('[data-intro-item]').length !== 1) throw new Error('Intro slot must not be cloned');
  }
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let gridFrames = 0;
  let fullOpacity = false;
  const deadline = Date.now() + 20000;
  while (home.dataset.experience === 'intro' && Date.now() < deadline) {
    if (world.contains(header)) {
      const item = home.querySelector('[data-intro-item]');
      assert(Math.abs(header.getBoundingClientRect().top - item.getBoundingClientRect().top) < 1, 'Card must ride the grid without an independent vertical offset');
      fullOpacity ||= +getComputedStyle(header).opacity >= .999;
      gridFrames++;
    } else {
      const boundary = document.querySelector('.site-header').getBoundingClientRect().bottom;
      assert(Math.abs(header.getBoundingClientRect().top - boundary) < 1, 'Docking must pin to the sticky boundary immediately');
    }
    await wait(20);
  }
  if (gridFrames > 2 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    assert(fullOpacity, 'Intro card must reach full opacity before docking');
  }
  assert(home.dataset.experience === 'auto', 'Intro must finish in auto');
  assert(world.inert, 'Demo controls must be inert in auto');
  assert(header.parentElement === home && !world.contains(header), 'Docked header must leave the grid');
  assert(home.querySelectorAll('#intro-title').length === 1, 'Docking must preserve one heading');
  assert(world.querySelector('[data-intro-item]').style.visibility === 'hidden', 'The finite intro cell must not occupy an endless canvas slot');
  await wait(350);
  if(contextDelta!==undefined) {
    assert(contextDelta<1,'Every intro context card must retain its position at handoff');
    assert(preservedContexts,'Context cards must persist without a crossfade');
  }
  if (handoffDelta !== undefined) assert(handoffDelta < 1, 'Landing card must not jump or resize during handoff');
  let scene;
  for (const url of performance.getEntriesByType('resource').map(e=>e.name).filter(u=>u.includes('/src/lib/scene.ts'))) {
    const { sceneOf } = await import(url);
    const candidate = sceneOf(canvas.parentElement);
    if(candidate.layout)scene=candidate;
  }
  assert(scene.layout.patch?.items.some(item=>item.card.w>0),'Visible intro cards must remain in the world after landing');
  for(const column of scene.layout.columns) {
    const rows=column.items;
    assert(rows.every(item=>item.card.w===0),'There must be no second grid below the packed world');
  }
  assert([...world.querySelectorAll('[data-item]')].every(item => !item.style.height), 'Cards must retain their natural heights');
  const cards = [...world.querySelectorAll('.canvas__composition > *')].filter(e=>getComputedStyle(e).visibility!=='hidden').map(e => e.getBoundingClientRect())
    .filter(r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j];
    assert(Math.min(a.right,b.right)-Math.max(a.left,b.left) <= 1 || Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top) <= 1, 'Rendered compositions must not overlap');
  }
  for (const type of ['pointermove', 'pointerover', 'pointerdown']) {
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse' }));
    assert(home.dataset.experience === 'auto', `${type} must not unlock`);
  }
  const top = header.getBoundingClientRect().top;
  canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -300 }));
  assert(home.dataset.experience === 'manual' && !world.inert, 'Wheel must unlock controls');
  assert(header.getBoundingClientRect().top === top && header.hasAttribute('data-docked'), 'Upward scroll must not undock');
  const idleDeadline=Date.now()+12000;
  while(home.dataset.experience!=='auto' && Date.now()<idleDeadline)await wait(100);
  assert(home.dataset.experience === 'auto' && world.inert, 'Idle must resume auto and lock controls');
  canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }));
  assert(home.dataset.experience === 'manual', 'Canvas arrow key must unlock');
  const description = home.querySelector('.intro__lede').getBoundingClientRect();
  assert(description.right <= innerWidth + 1, 'Description must fit viewport');
  assert(home.querySelectorAll('.eyebrow').length === 1, 'Version must not be duplicated');
  // Return through the opening after the flight; transient intro geometry must
  // not reserve an empty island where the heading used to be.
  canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:scene.pan[0]-scene.size[0]/2,deltaY:scene.pan[1]-scene.size[1]/2}));
  const model=await import('/src/lib/autopilot/model.ts');
  const nearOpening=model.cardsNear(scene.layout,[0,0],scene.layout.columnWidth*2);
  assert(nearOpening.length>0,'Returning to the opening must reveal packed canvas cards');
  assert(header.hasAttribute('data-docked'),'Returning to the opening must keep the header docked');
  return { passed: true, viewport: [innerWidth, innerHeight] };
}
