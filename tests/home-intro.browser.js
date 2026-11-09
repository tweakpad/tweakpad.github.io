// @ts-nocheck
// Run through Chrome DevTools evaluate_script just after loading the homepage.
async () => {
  const home = document.querySelector('.home');
  const canvas = home.querySelector('[data-canvas]');
  const world = home.querySelector('[data-world]');
  const header = home.querySelector('.intro');
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
  assert(world.querySelector('[data-intro-item]').hasAttribute('data-pooled'), 'The docked intro must leave its slot to the card packed there');
  await wait(350);
  let scene;
  for (const url of performance.getEntriesByType('resource').map(e=>e.name).filter(u=>u.includes('/src/lib/scene.ts'))) {
    const { sceneOf } = await import(url);
    const candidate = sceneOf(canvas.parentElement);
    if(candidate.layout)scene=candidate;
  }
  assert(scene.layout.opening && scene.layout.items.length > 0, 'One packed world, with its opening, must remain after landing');
  const cards = [...world.querySelectorAll('[data-item]:not([data-pooled]) .canvas__composition > *')].map(e => e.getBoundingClientRect())
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
  // Return through the opening after the flight: the intro's slot holds a card again.
  canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:scene.pan[0]-scene.size[0]/2,deltaY:scene.pan[1]-scene.size[1]/2}));
  const model=await import('/src/lib/autopilot/model.ts');
  const nearOpening=model.cardsNear(scene.layout,[0,0],scene.layout.cardWidth*2);
  assert(nearOpening.length>0,'Returning to the opening must reveal packed canvas cards');
  assert(header.hasAttribute('data-docked'),'Returning to the opening must keep the header docked');
  return { passed: true, viewport: [innerWidth, innerHeight] };
}
