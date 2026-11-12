// @ts-nocheck
// Run through Chrome DevTools evaluate_script just after loading the homepage.
async () => {
  const home = document.querySelector('.home');
  const canvas = home.querySelector('[data-canvas]');
  const world = home.querySelector('[data-world]');
  const header = home.querySelector('.intro');
  const card = home.querySelector('.intro-card');
  if (home.dataset.intro) {
    assertGrid();
  }
  function assertGrid() {
    if (!card.closest('[data-world] [data-intro-item]')) throw new Error('The opening card must occupy a grid slot');
    if (home.querySelectorAll('[data-intro-item]').length !== 1) throw new Error('Intro slot must not be cloned');
  }
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let gridFrames = 0;
  let fullOpacity = false;
  const deadline = Date.now() + 20000;
  const boundary = document.querySelector('.site-header').getBoundingClientRect().bottom;
  while (home.dataset.experience === 'intro' && Date.now() < deadline) {
    const item = home.querySelector('[data-intro-item]');
    if (!item.hasAttribute('data-pooled')) {
      const r = card.getBoundingClientRect();
      assert(Math.abs(r.top - item.getBoundingClientRect().top) < 1 && !card.style.transform, 'The card must ride the grid, never transformed');
      fullOpacity ||= +getComputedStyle(card).opacity >= .999;
      gridFrames++;
      // Sticky: the header shows only once the card has left the view, under the site header.
      // It may take over a little early (stickyOffset), but only over the card: never beside a visible part of it.
      if (header.hasAttribute('data-shown')) assert(r.bottom <= header.getBoundingClientRect().bottom + 1, 'The header must not show while the card is visible below it');
    }
    assert(Math.abs(header.getBoundingClientRect().top - boundary) < 1, 'The header sits under the site header');
    await wait(20);
  }
  if (gridFrames > 2 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    assert(fullOpacity, 'Intro card must reach full opacity before docking');
  }
  assert(home.dataset.experience === 'auto', 'Intro must finish in auto');
  assert(world.inert, 'Demo controls must be inert in auto');
  // The header takes over at the strike, as the intro hands over; its content then opens from the
  // centre over the opening's duration (lib/home-opening.ts COLUMNS).
  const openBy = Date.now() + 1000;
  while (!header.hasAttribute('data-revealed') && Date.now() < openBy) await wait(20);
  assert(header.hasAttribute('data-revealed') && getComputedStyle(header).visibility === 'visible', 'The header must be open once the impulse lands');
  assert(home.querySelectorAll('h1').length === 1 && header.querySelector('h1#intro-title'), 'One heading, in the header');
  assert(card.getAttribute('aria-hidden') === 'true', 'The opening card is a picture of the heading');
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
  assert(header.getBoundingClientRect().top === top && header.hasAttribute('data-revealed'), 'Upward scroll must not hide the header');
  const idleDeadline=Date.now()+12000;
  while(home.dataset.experience!=='auto' && Date.now()<idleDeadline)await wait(100);
  assert(home.dataset.experience === 'auto' && world.inert, 'Idle must resume auto and lock controls');
  canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }));
  assert(home.dataset.experience === 'manual', 'Canvas arrow key must unlock');
  const description = home.querySelector('.intro__lede').getBoundingClientRect();
  assert(description.right <= innerWidth + 1, 'Description must fit viewport');
  if (matchMedia('(width >= 48rem)').matches) {
    // The heading is split at the centre, one line each side; the description is centred on that seam.
    const box = header.getBoundingClientRect(), centre = box.left + box.width / 2;
    const [start, end] = ['.intro__start', '.intro__end'].map(side => header.querySelector(`.intro__title ${side}`).getBoundingClientRect());
    assert(Math.abs(centre - start.right - (end.left - centre)) <= 1 && start.right < centre && end.left > centre, 'The heading must be split at the centre');
    assert(start.height === end.height && start.height <= parseFloat(getComputedStyle(header.querySelector('.intro__title')).lineHeight) + 1, 'The heading must keep one line each side');
    const lede = header.querySelector('.intro__lede').getBoundingClientRect();
    assert(Math.abs(lede.left + lede.width / 2 - centre) <= 1, 'The description must be centred on the seam');
    assert(header.querySelector('.intro__lede tp-mo-text-mirror')?.hasAttribute('data-tp-at-rest'), 'The description must have opened');
  }
  // Return through the opening after the flight: the intro's slot holds a card again.
  canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:scene.pan[0]-scene.size[0]/2,deltaY:scene.pan[1]-scene.size[1]/2}));
  const model=await import('/src/lib/autopilot/model.ts');
  const nearOpening=model.cardsNear(scene.layout,[0,0],scene.layout.cardWidth*2);
  assert(nearOpening.length>0,'Returning to the opening must reveal packed canvas cards');
  assert(header.hasAttribute('data-revealed'),'Returning to the opening keeps the header');
  for(let i=0;i<20;i++)await new Promise(resolve=>requestAnimationFrame(resolve));
  assert(home.querySelector('[data-intro-item]').hasAttribute('data-pooled'),'Once the header is sticky, the opening card never shows again: its slot shows its own card');
  return { passed: true, viewport: [innerWidth, innerHeight] };
}
