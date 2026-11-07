import { eases, type createTimeline } from 'animejs';
import type { TpMoTextStroke, TpMoTextSplit } from '@tweakpad/ui';

type TextReveal = TpMoTextStroke | TpMoTextSplit;

/** Drive the library's existing pieces from the intro clock, including stroke and fill.
 * Claiming the reveal disables the component's independent CSS transition clock. */
export function introTextDriver(texts: TextReveal[]) {
  let settle: () => void = () => {};
  let finished = new Promise<void>(resolve => { settle = resolve; });
  let complete: (() => void)[] = [];
  const changed = new Map<HTMLElement | SVGElement, string | null>();
  const save = (el: HTMLElement | SVGElement) => {
    if (!changed.has(el)) changed.set(el, el.getAttribute('style'));
  };
  const claim = (event: HTMLElementEventMap['tp-motion-request']) => {
    if (event.request.role !== 'reveal') return;
    event.respondWith({ play: () => ({ finished, cancel() {} }) });
  };
  texts.forEach(text => text.addEventListener('tp-motion-request', claim));
  return {
    reset() {
      settle();
      for (const [el, style] of changed) {
        if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style);
      }
      changed.clear();
      complete = [];
      finished = new Promise<void>(resolve => { settle = resolve; });
    },
    release() {
      complete.forEach(paint => paint());
      settle();
    },
    dispose() {
      settle();
      texts.forEach(text => text.removeEventListener('tp-motion-request', claim));
    },
    add(timeline: ReturnType<typeof createTimeline>, text: TextReveal, start: number, duration: number, ease: string, playbackScale = 1) {
      const pieces = [...text.querySelectorAll<HTMLElement>('[data-tp-animate]')];
      const stroke = text.localName === 'tp-mo-text-stroke';
      const outlineOnly = text.classList.contains('outline');
      const color = getComputedStyle(text).color;
      const easing = ease === 'outCirc' ? eases.outCirc : ease === 'out(3)' ? eases.outCubic : ease === 'inOut(2)' ? eases.inOutQuad : eases.linear;
      const stagger = Math.max(0, Number(text.stagger) || 0) * playbackScale;
      for (const [index, piece] of pieces.entries()) {
        const outlines = [...piece.querySelectorAll<SVGElement>('[data-tp-outline]')];
        const glyphs = outlines.flatMap(svg => [...svg.querySelectorAll<SVGTextElement>('text')]);
        const length = glyphs.length ? parseFloat(getComputedStyle(glyphs[0]).strokeDasharray) || 408 : 0;
        const order = Number(piece.style.getPropertyValue('--tp-text-order') || index);
        [piece, ...outlines, ...glyphs].forEach(save);
        const progress = { value: 0 };
        const paint = () => {
          const p = progress.value;
          if (stroke) {
            const fill = outlineOnly ? 0 : easing(Math.max(0, Math.min(1, (p - 0.5) * 2)));
            piece.style.webkitTextFillColor = `color-mix(in srgb, ${color} ${fill * 100}%, transparent)`;
            for (const svg of outlines) svg.style.opacity = String(outlineOnly ? 1 : (1 - easing(Math.max(0, Math.min(1, (p - 0.75) * 4)))));
            for (const glyph of glyphs) {
              glyph.style.strokeDasharray = p >= 1 ? 'none' : `${length} ${length}`;
              glyph.style.strokeDashoffset = String(length * (1 - easing(p)));
            }
          } else {
            piece.style.opacity = String(easing(p));
            piece.style.translate = `0 ${(1 - easing(p))}rem`;
          }
        };
        paint();
        complete.push(() => { progress.value = 1; paint(); });
        // A distinct tween per library piece honors its stagger order. The final
        // character extends the parent timeline, so completion cannot cut it off.
        timeline.add(progress, { value: 1, duration, ease: 'linear', onRender: paint }, start + order * stagger);
      }
    },
  };
}
