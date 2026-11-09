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

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The first impulse: the head drops from the intro card straight down the opening gutter onto the
 * landing card (the canvas packs both, lib/mosaic.ts), the camera following. The intro card rides
 * the grid until its top reaches the sticky boundary, then turns into the docked header as the
 * camera scrolls on. The morph is measured once, at docking, and then drawn with transforms,
 * opacity and one contained surface box, so a frame never lays the page out again.
 */
export function openingFlight(home: HTMLElement, params: IntroParams, complete: (landing?: Landing) => void) {
  const header = home.querySelector<HTMLElement>('.intro')!;
  const stage = home.querySelector<HTMLElement>('.home__stage')!;
  const canvas = stage.querySelector<HTMLElement>('[data-canvas]')!;
  const scene = sceneOf(stage);
  const title = header.querySelector<HTMLElement>('h1')!;
  const identity = header.querySelector<HTMLElement>('.intro__identity')!;
  const version = header.querySelector<HTMLElement>('.eyebrow')!;
  const fading = [...header.querySelectorAll<HTMLElement>('.intro__lede,.intro__actions,.intro__install')];
  const stickyTop = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
  const start = header.getBoundingClientRect();
  const pan = [...scene.pan] as [number, number];
  const dockDistance = Math.max(0, start.top - stickyTop);
  const lead = Math.max(40, (scene.size[1] - stickyTop - start.height) * 0.25);
  let docked = false;
  let settled = false;
  let observer: ResizeObserver | undefined;
  let surface: HTMLElement | undefined;
  /** The morph, measured once at docking: where each part starts and ends, in the viewport. */
  let morph: ((t: number) => void) | undefined;

  /** The canvas's covered top, once the header has its final size: one read, then one event. */
  const fit = () => {
    const inset = `${header.offsetTop + header.offsetHeight - scene.origin[1]}px`;
    if (canvas.style.scrollPaddingBlockStart === inset) return;
    canvas.style.scrollPaddingBlockStart = inset;
    canvas.dispatchEvent(new Event('coveredchange'));
  };

  const dock = () => {
    if (docked) return;
    docked = true;
    const from = header.getBoundingClientRect();
    const titleFrom = title.getBoundingClientRect();
    const versionFrom = version.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(header).borderTopLeftRadius) || 0;
    home.append(header);
    header.dataset.docked = '';
    header.style.top = `${stickyTop}px`;
    header.append(version);
    home.dispatchEvent(new Event('introsticky'));
    const to = header.getBoundingClientRect();
    const titleTo = title.getBoundingClientRect();
    const versionTo = version.getBoundingClientRect();
    // The header's surface is drawn by a box of its own while it morphs; the header's own
    // background and border wait for it to arrive.
    surface = document.createElement('div');
    surface.className = 'intro__surface';
    header.prepend(surface);
    header.dataset.morphing = '';
    const scale = titleFrom.height / Math.max(1, titleTo.height);
    identity.style.transformOrigin = `${titleTo.left - identity.getBoundingClientRect().left}px ${titleTo.top - identity.getBoundingClientRect().top}px`;
    const moved = surface;
    morph = (t) => {
      // The card arrives at the sticky boundary as it was, then grows into the header.
      const left = mix(from.left, to.left, t) - to.left;
      const top = mix(from.top, to.top, t) - to.top;
      moved.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      moved.style.width = `${mix(from.width, to.width, t)}px`;
      moved.style.height = `${mix(from.height, to.height, t)}px`;
      moved.style.borderRadius = `${mix(radius, 0, t)}px`;
      const s = mix(scale, 1, t);
      identity.style.transform = `translate3d(${(titleFrom.left - titleTo.left) * (1 - t)}px, ${(titleFrom.top - titleTo.top) * (1 - t)}px, 0) scale(${s})`;
      version.style.transform = `translate3d(${(versionFrom.left - versionTo.left) * (1 - t)}px, ${(versionFrom.top - versionTo.top) * (1 - t)}px, 0)`;
      for (const element of fading) element.style.opacity = String(t);
      scene.publish({ inset: [0, mix(from.bottom, to.bottom, t) - scene.origin[1]] });
    };
    morph(0);
    observer = new ResizeObserver(() => {
      if (settled) fit();
    });
    observer.observe(header);
  };

  const settle = () => {
    settled = true;
    dock();
    surface?.remove();
    surface = undefined;
    delete header.dataset.morphing;
    header.style.top = `${stickyTop}px`;
    for (const element of [identity, version]) {
      element.style.removeProperty('transform');
      element.style.removeProperty('transform-origin');
    }
    for (const element of fading) element.style.removeProperty('opacity');
    fit();
  };

  const layout = scene.layout;
  const opening = layout?.opening;
  const detach = () => document.addEventListener('astro:before-swap', () => observer?.disconnect(), { once: true });
  if (!layout || !opening || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    settle();
    complete();
    detach();
    return () => observer?.disconnect();
  }
  const hero = itemBox(layout, { i: opening.hero, k: 0 })!;
  const ref: CardRef = { i: opening.landing, k: 0 };
  const target = cardBox(layout, ref)!;
  // The head starts at the intro card's centre, in the world, and drops straight down its gutter.
  const x = hero.x + hero.w / 2;
  const y = hero.y + hero.h / 2;
  const origin: [number, number] = [x + pan[0], y + pan[1]];
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
      if (follow >= dockDistance) {
        dock();
        if (!settled) {
          const t = Math.min(1, (follow - dockDistance) / Math.max(1, start.height));
          if (t >= 1) settle();
          else morph?.(t);
        }
      }
      if (descent === travel && !done) {
        done = true;
        removeEventListener('resize', resized);
        settle();
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
    observer?.disconnect();
    removeEventListener('resize', resized);
    if (scene.pilot === pilot) scene.publish({ pilot: null, stir: null });
  };
  const resized = () => {
    cancel();
    settle();
    complete();
  };
  addEventListener('resize', resized, { once: true });
  document.addEventListener('astro:before-swap', cancel, { once: true });
  return cancel;
}
