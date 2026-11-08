import type { TpMoSegmentBorder } from '@tweakpad/ui';

/** Use the component to resolve the supplied corner paths and rounded geometry,
 * then paint those existing SVG paths from the same clock as the card composite. */
export async function prepareIntroBorders(borders: TpMoSegmentBorder[]) {
  let release: () => void = () => {};
  const finished = new Promise<void>(resolve => { release = resolve; });
  for (const border of borders) {
    border.addEventListener('tp-motion-request', event => {
      if (event.request.role === 'segments') {
        event.respondWith({ play: () => ({ finished, cancel() {} }) });
      }
    });
    border.trigger = 'always';
  }
  const paths: { path: SVGPathElement; length: number; perimeter: number; offset: number }[] = [];
  // Wait for the library's batched layout and in-view activation, not a timer.
  for (let frame = 0; frame < 60; frame++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (borders.some(border => !border.isConnected)) { release(); return { paint() { return 0; }, release }; }
    const resolved = borders.flatMap(border => [...border.shadowRoot!.querySelectorAll<SVGPathElement>('path.segment')]);
    if (resolved.length !== borders.length * 4 || resolved.some(path => !path.hasAttribute('stroke-dasharray'))) continue;
    for (const path of resolved) {
      const perimeter = path.getTotalLength();
      const length = Number(path.getAttribute('stroke-dasharray')!.split(' ')[0]) * perimeter;
      const offset = Number(path.getAttribute('stroke-dashoffset') ?? '0') * perimeter;
      // Use actual SVG lengths throughout, without pathLength normalization.
      path.removeAttribute('pathLength');
      paths.push({ path, length, perimeter, offset });
    }
    break;
  }
  if (paths.length !== borders.length * 4) { release(); throw new Error('Intro border geometry did not settle'); }
  return {
    paint(progress: number) {
      const fraction = Math.min(1, Math.max(0, progress));
      let drawn = 0;
      let total = 0;
      for (const { path, length, perimeter, offset } of paths) {
        const span = length * fraction;
        path.style.visibility = span > 0 ? 'visible' : 'hidden';
        path.style.strokeDasharray = `${span}px ${perimeter - span}px`;
        path.style.strokeDashoffset = `${offset}px`;
        drawn += span;
        total += length;
      }
      return total > 0 ? drawn / total : fraction;
    },
    release,
  };
}
