import { createTimeline } from 'animejs';
import { sceneOf, type Pilot } from './scene';
import { cardBox, itemBox, type CardRef, type Point } from './autopilot/model';
import { DEFAULT_AUTOPILOT_PARAMS } from './autopilot/params';
import { burstFrom, smoothstep, speedAt, speedProfile } from './autopilot/motion';
import type { Path } from './autopilot/path';
import type { IntroParams } from './home-intro-params';

export interface Landing {
  ref: CardRef;
  contact: Point;
  pan: Point;
}

/**
 * The header's opening: its bar appears at once, and its columns slide out of a slit at the
 * centre, in ms. It starts as the head strikes.
 */
const COLUMNS = { duration: 140, ease: 'outCirc' } as const;

/**
 * The first impulse: the head drops from the opening card straight down its gutter onto the landing
 * card (the canvas packs both, lib/mosaic.ts), the camera following. The opening card is a card of
 * the canvas and scrolls away with it. The sticky header takes its place as the head strikes, its
 * content sliding out from the centre with the impact: one movement. It never shows beside the
 * card, so a card still in view then (`stickyOffset` pixels before it is quite gone) hands over as
 * it leaves. Once the header covers the card, the card's slot shows its own card. One custom
 * property changes per frame.
 */
export function openingFlight(home: HTMLElement, params: IntroParams, complete: (landing?: Landing) => void) {
  const header = home.querySelector<HTMLElement>('.intro')!;
  const stage = home.querySelector<HTMLElement>('.home__stage')!;
  const canvas = stage.querySelector<HTMLElement>('[data-canvas]')!;
  const scene = sceneOf(stage);
  const stickyTop = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
  const pan = [...scene.pan] as [number, number];
  let opened = false;
  let animation: ReturnType<typeof createTimeline> | undefined;

  /** The canvas's covered top, once the header is shown: one read, then one event. */
  const fit = () => {
    const inset = `${header.offsetTop + header.offsetHeight - scene.origin[1]}px`;
    if (canvas.style.scrollPaddingBlockStart === inset) return;
    canvas.style.scrollPaddingBlockStart = inset;
    canvas.dispatchEvent(new Event('coveredchange'));
  };
  const settle = () => {
    header.dataset.revealed = '';
    header.style.removeProperty('--content');
  };
  /** Shows the header, opening it from the centre (at once with reduced motion). */
  const open = (animated = true) => {
    if (opened) return;
    opened = true;
    header.dataset.shown = '';
    fit();
    const state = { content: 0 };
    const apply = () => header.style.setProperty('--content', state.content.toFixed(4));
    if (animated) apply();
    // The description (Text mirror) opens from the same seam, over the same time (its easing is the
    // page CSS's match for COLUMNS.ease). Its transition starts a few frames after its hold is
    // released, so the halves wait for it and start at its time: one clock. At once without one.
    const texts = [...header.querySelectorAll<HTMLElement & { revealHold: boolean }>('tp-mo-text-mirror')];
    const run = (at = 0) => {
      if (animation || stopped) return;
      animation = createTimeline({ onComplete: settle }).add(state, { content: 1, ...COLUMNS, onRender: apply }, 0);
      if (at > 0) animation.seek(at);
    };
    const start = () => {
      clearTimeout(starting);
      let frames = 0;
      // A new transition is pending until its first frame; `ready` resolves as its start time is set.
      const find = () => {
        if (animation || stopped) return;
        const transition = texts[0].getAnimations({ subtree: true })[0];
        if (transition) return void transition.ready.then(() => run(Number(transition.currentTime ?? 0)), () => run());
        if (++frames > 6) return run();
        requestAnimationFrame(find);
      };
      find();
    };
    const begin = () => {
      if (stopped) return;
      if (animated && texts.length) {
        texts[0].addEventListener('tp-reveal-change', start, { once: true });
        starting = window.setTimeout(start, 100);
      }
      for (const text of texts) {
        text.style.setProperty('--tp-mo-text-mirror-duration', `${COLUMNS.duration}ms`);
        text.revealHold = false;
      }
      if (!animated) return settle();
      if (!texts.length) run();
    };
    // The bar is up at once; its content may wait `headerDelay` to meet the strike.
    const delay = animated ? Math.max(0, params.headerDelay) : 0;
    if (delay > 0) starting = window.setTimeout(begin, delay);
    else begin();
  };
  let starting = 0;
  let stopped = false;
  /** The header replaces the card: from now on the canvas shows the card's slot as its own card. */
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    home.dispatchEvent(new Event('introsticky'));
  };
  let watching = 0;

  const layout = scene.layout;
  const world = layout?.opening;
  if (!layout || !world || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    open(false);
    swap();
    complete();
    return () => {};
  }
  const hero = itemBox(layout, { i: world.hero, k: 0 })!;
  const ref: CardRef = { i: world.landing, k: 0 };
  const target = cardBox(layout, ref)!;
  // The card's bottom in the stage at a pan, against the site header's bottom and the header's.
  const bottom = (panY: number) => hero.y + hero.h + panY + scene.origin[1];
  const headerBottom = stickyTop + header.offsetHeight;
  /** The card is leaving the view, `stickyOffset` before it is quite gone: the header takes over. */
  const leaving = (panY: number) => bottom(panY) <= stickyTop + Math.max(0, params.stickyOffset);
  /**
   * All of the card is hidden, under the site header or, once shown, the header: its slot can change
   * unseen, ahead of the strike when it can.
   */
  const covered = (panY: number) => bottom(panY) <= (opened ? headerBottom : stickyTop);
  /** The head has struck: the header may take over. */
  let struck = false;
  const track = (panY: number) => {
    if (!opened && struck && leaving(panY)) open();
    if (!swapped && covered(panY)) swap();
  };
  /** Carries on after the strike, for a card still in view then. */
  const watch = () => {
    const step = () => {
      track(scene.pan[1]);
      if (!swapped) watching = requestAnimationFrame(step);
    };
    watching = requestAnimationFrame(step);
  };

  // The head starts at the opening card's centre, in the world, and drops straight down its gutter.
  const x = hero.x + hero.w / 2;
  const y = hero.y + hero.h / 2;
  const origin: [number, number] = [x + pan[0], y + pan[1]];
  const lead = Math.max(40, (scene.size[1] - stickyTop - hero.h) * 0.25);
  const travel = target.y - y;
  // Accelerate into the final burst without a second wind-up/braking phase.
  // The opening path has no corners or sideways weave.
  const count = Math.max(2, Math.ceil(travel / 4) + 1);
  const samples = Float64Array.from({ length: count }, (_, i) => (travel * i) / (count - 1));
  const path: Path = {
    xs: new Float64Array(count),
    ys: samples,
    s: samples,
    radius: new Float64Array(count).fill(Infinity),
    ending: new Uint8Array(count).fill(1),
    length: travel,
    straightFrom: 0,
  };
  const head = DEFAULT_AUTOPILOT_PARAMS.head;
  const from = burstFrom(path, head.runUp);
  const speed = Math.min(head.speed, travel / Math.max(0.001, params.headerDuration / 1000));
  const profile = speedProfile(path, { speed, acceleration: head.acceleration, cornering: head.cornering, finish: { from, windup: 1, impact: head.impact } }, 0);
  let descent = 0;
  let done = false;
  const pilot: Pilot = {
    get active() { return !done; },
    get featured() { return undefined; },
    get strike() { return undefined; },
    interrupt() {},
    update(dt) {
      const velocity = speedAt(path, profile, descent);
      descent = Math.min(travel, descent + velocity * dt);
      const boost = 1 + DEFAULT_AUTOPILOT_PARAMS.trail.impact * smoothstep((descent - from) / Math.max(1, travel - from));
      const follow = Math.max(0, descent - lead);
      const next: [number, number] = [pan[0], pan[1] - follow];
      const at: [number, number] = [origin[0], origin[1] + descent - follow];
      scene.publish({ stir: { strength: boost, from: scene.stir?.to ?? origin, to: at, velocity: [0, velocity], carry: [0, 0], grip: 0.5 } });
      struck = descent === travel;
      track(next[1]);
      if (descent === travel && !done) {
        done = true;
        removeEventListener('resize', resized);
        // A card still in view at the strike hands over as soon as it leaves.
        if (!swapped) watch();
        const landing: Landing = { ref, contact: [x, target.y], pan: next };
        queueMicrotask(() => complete(landing));
      }
      return next;
    },
  };
  scene.publish({ pilot, stir: { strength: 1, from: origin, to: origin, velocity: [0, 0], carry: [0, 0], grip: 0.5 } });
  home.dispatchEvent(new Event('introdeparture'));
  const cancel = () => {
    done = true;
    stopped = true;
    clearTimeout(starting);
    cancelAnimationFrame(watching);
    animation?.cancel();
    removeEventListener('resize', resized);
    if (scene.pilot === pilot) scene.publish({ pilot: null, stir: null });
  };
  const resized = () => {
    cancel();
    if (!opened) open(false);
    else settle();
    swap();
    complete();
  };
  addEventListener('resize', resized, { once: true });
  document.addEventListener('astro:before-swap', cancel, { once: true });
  return cancel;
}
