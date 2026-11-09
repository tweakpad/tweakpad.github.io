// Every packed card must show all of its content, and must not be stretched far past it: the mosaic
// resizes cards only within their measured ranges. Run through Chrome DevTools evaluate_script once
// the intro has finished; it checks the cards on the stage, then again after a rebuild (a resize).
async () => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const world = document.querySelector('[data-world]');
  const audit = () => {
    const problems = [];
    let checked = 0;
    for (const item of world.querySelectorAll('[data-item][data-mosaic-size]:not([data-pooled]):not([data-intro-item])')) {
      const card = item.querySelector('tp-card');
      const shell = card?.shadowRoot?.querySelector('[part~="card"]');
      if (!card || !shell) continue;
      checked++;
      // Content is clipped when any part scrolls, or a slotted child runs past the card's bottom.
      const parts = [...card.shadowRoot.querySelectorAll('[part]')];
      const clipped = parts.filter((p) => p.scrollHeight > p.clientHeight + 1 && getComputedStyle(p).overflowY !== 'visible');
      const bottom = shell.getBoundingClientRect().bottom;
      const spill = [...card.children].map((c) => c.getBoundingClientRect().bottom - bottom).filter((d) => d > 1);
      // Each part's content must fit: a part shorter than what it holds overflows visibly.
      const overflow = parts.filter((p) => p.scrollHeight > p.clientHeight + 1).map((p) => p.getAttribute('part'));
      // The content's own height at this width: the root laid out at auto height, then put back.
      const root = item.querySelector('.canvas__composition > form, .canvas__composition tp-card');
      const saved = [root.style.blockSize, card.style.blockSize];
      const packed = root.getBoundingClientRect().height;
      root.style.blockSize = 'auto';
      card.style.blockSize = '';
      const natural = root.getBoundingClientRect().height;
      [root.style.blockSize, card.style.blockSize] = saved;
      const stretched = packed > natural * 1.25 + 4;
      if (clipped.length || spill.length || overflow.length || stretched) problems.push({ pattern: item.dataset.pattern, size: [item.style.inlineSize, item.style.blockSize], overflow, spill, natural: Math.round(natural), packed: Math.round(packed) });
    }
    return { checked, problems };
  };
  // Several places in the world, so most patterns are seen at several packed sizes.
  const canvas = document.querySelector('[data-canvas]');
  const first = { checked: 0, problems: [] };
  for (const [dx, dy] of [[0, 0], [1800, 0], [0, 1600], [-3600, 0], [0, -3200], [2400, 2400]]) {
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: dx, deltaY: dy }));
    for (let i = 0; i < 12; i++) await frame();
    const here = audit();
    first.checked += here.checked;
    first.problems.push(...here.problems);
  }
  dispatchEvent(new Event('resize'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  for (let i = 0; i < 4; i++) await frame();
  const rebuilt = audit();
  if (!first.checked || !rebuilt.checked) throw Error('No packed cards on the stage');
  if (first.problems.length || rebuilt.problems.length) throw Error(JSON.stringify({ first: first.problems, rebuilt: rebuilt.problems }));
  return { passed: true, checked: [first.checked, rebuilt.checked] };
}
