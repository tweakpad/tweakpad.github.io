import { firstVerticalLanding } from './opening-layout';
import { sceneOf, type Pilot } from './scene';
import { cardBox } from './autopilot/model';
import { DEFAULT_AUTOPILOT_PARAMS } from './autopilot/params';
import { burstFrom, smoothstep, speedAt, speedProfile } from './autopilot/motion';
import type { Path } from './autopilot/path';
import type { IntroParams } from './home-intro-params';

/** The card rides the grid until its top reaches the sticky boundary. */
export function openingFlight(home: HTMLElement, params: IntroParams, complete: (landing?: unknown) => void) {
  const header = home.querySelector<HTMLElement>('.intro')!;
  const stage = home.querySelector<HTMLElement>('.home__stage')!;
  const canvas = stage.querySelector<HTMLElement>('[data-canvas]')!;
  const scene = sceneOf(stage);
  const start = header.getBoundingClientRect();
  const title = header.querySelector<HTMLElement>('h1')!;
  const identity = header.querySelector<HTMLElement>('.intro__identity')!;
  const version = header.querySelector<HTMLElement>('.eyebrow')!;
  const titleStart = title.getBoundingClientRect();
  title.style.fontSize = getComputedStyle(title).fontSize;
  const versionStart = version.getBoundingClientRect();
  const startPadding = parseFloat(getComputedStyle(header).paddingTop);
  const startInlinePadding = parseFloat(getComputedStyle(header).paddingLeft);
  const origin: [number, number] = [start.left + start.width / 2 - scene.origin[0], start.top + start.height / 2 - scene.origin[1]];
  const pan = [...scene.pan] as [number, number];
  const stickyTop = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
  const dockDistance = Math.max(0, start.top - stickyTop);
  const lead = Math.max(40, (scene.size[1] - stickyTop - start.height) * .25);
  let docked = false, settled=false;
  let end: DOMRect;
  let versionEnd: DOMRect;
  let endPadding = 0, endInlinePadding = 0;
  let observer: ResizeObserver | undefined;
  const fit = (bottom?:number) => {
    const inset=`${(bottom??header.offsetTop+header.offsetHeight)-scene.origin[1]}px`;
    if(canvas.style.scrollPaddingBlockStart===inset)return;
    canvas.style.scrollPaddingBlockStart=inset;
    canvas.dispatchEvent(new Event('coveredchange'));
  };
  const dock = () => {
    if (docked) return;
    docked = true;
    home.append(header);
    header.style.removeProperty('min-block-size');
    header.dataset.docked = '';
    header.style.top = `${stickyTop}px`;
    header.append(version);
    end = header.getBoundingClientRect();
    versionEnd = version.getBoundingClientRect();
    endPadding = parseFloat(getComputedStyle(header).paddingTop);
    endInlinePadding = parseFloat(getComputedStyle(header).paddingLeft);
    observer = new ResizeObserver(()=>{if(settled)fit();});
    observer.observe(header);
    home.dispatchEvent(new Event('introsticky'));
  };
  const morph = (distance: number) => {
    // Layout follows scroll distance; no tween independently pulls the card upward.
    const t = Math.min(1, Math.max(0, (distance - dockDistance) / Math.max(1, start.height)));
    if (t === 1) { if(!settled)settle(); return; }
    const mix = (a: number, b: number) => a + (b - a) * t;
    header.style.transform = 'none';
    header.style.left = `${mix(start.left, end.left)}px`;
    header.style.top = `${stickyTop}px`;
    header.style.width = `${mix(start.width, end.width)}px`;
    title.style.zoom = String(mix(1, .6));
    const height=mix(start.height,end.height);
    header.style.height = `${height}px`;
    header.style.paddingBlockStart = `${mix(startPadding, endPadding)}px`;
    header.style.paddingInlineStart = `${mix(startInlinePadding, endInlinePadding)}px`;
    identity.style.transform = `translateY(${(titleStart.top-start.top-startPadding)*(1-t)}px)`;
    version.style.position = 'absolute';
    version.style.gridArea = 'auto';
    version.style.left = `${mix(versionStart.left - start.left, versionEnd.left - end.left)}px`;
    version.style.top = `${mix(versionStart.top - start.top, versionEnd.top - end.top)}px`;
    header.querySelectorAll<HTMLElement>('.intro__lede,.intro__actions,.intro__install').forEach(el => { el.style.opacity = String(t); });
    fit(stickyTop+height);
  };
  const settle = () => {
    settled=true;
    dock();
    for (const key of ['left', 'width', 'height', 'transform', 'padding-block-start', 'padding-inline-start']) header.style.removeProperty(key);
    header.style.top = `${document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0}px`;
    title.style.removeProperty('zoom');
    identity.style.removeProperty('transform');
    for (const key of ['position', 'left', 'top', 'grid-area']) version.style.removeProperty(key);
    header.querySelectorAll<HTMLElement>('.intro__lede,.intro__actions,.intro__install').forEach(el => el.style.removeProperty('opacity'));
    fit();
  };
  const layout = scene.layout;
  if (!layout || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    settle();
    home.dispatchEvent(new CustomEvent('introhandoff',{detail:null}));
    home.dispatchEvent(new Event('introdetached'));
    complete();
    document.addEventListener('astro:before-swap', () => observer?.disconnect(), { once: true });
    return () => observer?.disconnect();
  }
  const x = origin[0] - pan[0], y = origin[1] - pan[1];
  const candidates = layout.columns.flatMap((column,u)=>column.items.map(item=>{
    const ref={u,k:0,row:item.row};
    return {ref,pattern:item.pattern,box:cardBox(layout,ref)!};
  }));
  const candidate = firstVerticalLanding(candidates,x,y);
  if (!candidate) { settle(); home.dispatchEvent(new CustomEvent('introhandoff',{detail:null})); complete(); return () => observer?.disconnect(); }
  const travel = candidate.box.y - y;
  // Accelerate into the final burst without a second wind-up/braking phase.
  // The opening path has no corners or sideways weave.
  const count=Math.max(2,Math.ceil(travel/4)+1);
  const samples=Float64Array.from({length:count},(_,i)=>travel*i/(count-1));
  const path:Path={xs:new Float64Array(count),ys:samples,s:samples,radius:new Float64Array(count).fill(Infinity),ending:new Uint8Array(count).fill(1),length:travel,straightFrom:0};
  const head=DEFAULT_AUTOPILOT_PARAMS.head;
  const from=burstFrom(path,head.runUp);
  const speed=Math.min(head.speed,travel/Math.max(.001,params.headerDuration/1000));
  const profile=speedProfile(path,{speed,acceleration:head.acceleration,cornering:head.cornering,finish:{from,windup:1,impact:head.impact}},0);
  let descent=0, done=false;
  const pilot: Pilot = {
    get active() { return !done; }, get featured() { return undefined; }, get strike() { return undefined; }, interrupt() {},
    update(dt) {
      const velocity=speedAt(path,profile,descent);
      descent=Math.min(travel,descent+velocity*dt);
      const boost=1+DEFAULT_AUTOPILOT_PARAMS.trail.impact*smoothstep((descent-from)/Math.max(1,travel-from));
      const follow = Math.max(0, descent - lead);
      const next: [number, number] = [pan[0], pan[1] - follow];
      const at: [number, number] = [origin[0], origin[1] + descent - follow];
      scene.publish({ stir: { strength: boost, from: scene.stir?.to ?? origin, to: at, velocity: [0, velocity], carry: [0,0], grip: .5 } });
      if (follow >= dockDistance) { dock(); morph(follow); }
      if (descent === travel && !done) {
        done = true;
        removeEventListener('resize', resized);
        settle();
        queueMicrotask(() => {
          // Preserve the composed region when control passes to the endless pilot.
          const landing={ref:candidate.ref,contact:[x,candidate.box.y] as [number,number],pan:next};
          home.dispatchEvent(new CustomEvent('introhandoff',{detail:landing}));
          home.dispatchEvent(new Event('introdetached'));
          complete(landing);
        });
      }
      return next;
    },
  };
  scene.publish({pilot,stir:{strength:1,from:origin,to:origin,velocity:[0,0],carry:[0,0],grip:.5}});
  home.dispatchEvent(new Event('introdeparture'));
  const cancel = () => {
    done = true;
    observer?.disconnect();
    removeEventListener('resize', resized);
    if (scene.pilot === pilot) scene.publish({ pilot: null, stir: null });
  };
  const resized = () => { cancel(); settle(); home.dispatchEvent(new CustomEvent('introhandoff',{detail:null})); home.dispatchEvent(new Event('introdetached')); complete(); };
  addEventListener('resize', resized, { once: true });
  document.addEventListener('astro:before-swap', cancel, { once: true });
  return cancel;
}
