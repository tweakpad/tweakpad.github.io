import { openingFlight } from './home-opening';
import { createTimeline, cubicBezier, eases } from 'animejs';
import { prepareIntroBorders } from './home-intro-border';
import { introTextDriver } from './home-intro-text';
import { sceneOf } from './scene';
import type { TpMoSegmentBorder, TpMoTextStroke, TpMoTextSplit } from '@tweakpad/ui';

import { DEFAULT_INTRO_PARAMS, introTimelineScale, type IntroParams } from './home-intro-params';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export function setupHomeIntro(initialParams: IntroParams = DEFAULT_INTRO_PARAMS) {
  const home = document.querySelector<HTMLElement>('.home:not([data-intro-setup])');
  if (!home) return;
  home.dataset.introSetup = '';
  const stage = home.querySelector<HTMLElement>('.home__stage')!;
  const introCard = home.querySelector<HTMLElement>('.intro-card')!;
  const header = home.querySelector<HTMLElement>('.intro')!;
  const texts = [...introCard.querySelectorAll<TpMoTextStroke | TpMoTextSplit>('tp-mo-text-stroke, tp-mo-text-split')];
  const textDriver = introTextDriver(texts);
  const canvas = home.querySelector<HTMLElement>('[data-canvas]')!;
  const params = { ...initialParams };
  let timeline: ReturnType<typeof createTimeline> | undefined;
  let cancelOpening: (() => void) | undefined;
  let openingFrame=0;
  let disposed = false;
  let generation = 0;
  let overlays: HTMLElement[] = [];
  let releaseBorders: (() => void) | undefined;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  /** Cards whose glow is still held after the intro ended, released a few a frame. */
  let releasing = 0;
  const releaseGlow = (all = false) => {
    cancelAnimationFrame(releasing); releasing = 0;
    const held = [...home.querySelectorAll<HTMLElement>('[data-glow-held]')];
    for (const card of all ? held : held.slice(0, 4)) delete card.dataset.glowHeld;
    if (!all && held.length > 4) releasing = requestAnimationFrame(() => releaseGlow());
  };
  const finish = (depart = false) => {
    cancelAnimationFrame(openingFrame);openingFrame=0;
    releaseGlow(true);
    // Departing, the cards keep their glow held past the intro's end, then let it go a few a frame:
    // ending the intro then restyles little at once.
    if (depart && home.dataset.intro) {
      home.querySelectorAll<HTMLElement>('[data-world] [data-item]:not([data-pooled])').forEach(card => { card.dataset.glowHeld = ''; });
    }
    cancelOpening?.(); cancelOpening = undefined;
    generation++;
    timeline?.cancel();
    timeline = undefined;
    releaseBorders?.();
    releaseBorders = undefined;
    overlays.forEach(el => el.remove()); overlays = [];
    delete home.dataset.intro;
    delete home.dataset.introLight;
    home.inert = false;
    home.querySelectorAll<HTMLElement>('[data-card-layer], .canvas__caption, [data-fluid="lights"], [data-fluid="dots"]').forEach(el => el.style.removeProperty('opacity'));
    introCard.style.removeProperty('transform');
    introCard.style.removeProperty('opacity');
    for (const child of introCard.children) {
      if (!(child instanceof HTMLElement)) continue;
      child.style.removeProperty('opacity');
      child.style.removeProperty('transform');
    }
    texts.forEach(text => { text.revealHold = false; });
    textDriver.release();
    const complete = (landing?: unknown) => {
      home.inert = false;
      home.dataset.experience = 'auto';
      home.dispatchEvent(new CustomEvent('introcomplete', { bubbles: true, detail: landing }));
    };
    if (depart && !disposed) {
      home.inert = true;
      const token=generation;
      // Paint the final glyphs and release the border timeline before measuring
      // and launching the moving scene. Both previously forced layout together.
      openingFrame=requestAnimationFrame(()=>{
        openingFrame=0;
        if(!disposed && generation===token)cancelOpening=openingFlight(home,params,complete);
        releasing=requestAnimationFrame(()=>releaseGlow());
      });
    }
  };
  /** Resolves once `element` has `attribute`; no polling, no frames. */
  const has = (element: HTMLElement, attribute: string) => new Promise<void>(resolve => {
    if (element.hasAttribute(attribute)) return resolve();
    const observer = new MutationObserver(() => {
      if (!element.hasAttribute(attribute)) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(element, { attributes: true, attributeFilter: [attribute] });
  });
  /** The intro plays as soon as its text is rendered and the canvas has laid its cards out. */
  const ready = async () => {
    await document.fonts.ready;
    const texts = [...introCard.querySelectorAll<HTMLElement>('*')].filter(el => el.localName.startsWith('tp-'));
    await Promise.all(texts.map(async el => {
      await customElements.whenDefined(el.localName);
      await (el as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
    }));
    await Promise.all([has(canvas, 'data-layout-settled'), has(stage, 'data-fluid-ready')]);
  };
  const play = async () => {
    finish();
    home.dataset.experience = 'intro';
    // The sticky header waits, closed, for the opening card to leave the view again.
    delete header.dataset.shown;
    delete header.dataset.revealed;
    header.style.setProperty('--content', '0');
    header.querySelectorAll<HTMLElement & { revealHold: boolean }>('tp-mo-text-mirror').forEach(text => { text.revealHold = true; });
    canvas.dispatchEvent(new CustomEvent('introgridreset', { detail: { distanceCards: params.impulseDistanceCards } }));
    if (disposed) return;
    const token = ++generation;
    home.dataset.intro = 'loading'; home.inert = true;
    texts.forEach(text => { text.revealHold = true; });
    textDriver.reset();
    home.dispatchEvent(new Event('introstart'));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([ready(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Intro readiness timeout')), 8000); })]);
      if (disposed || token !== generation) return;
      if (motion.matches) { finish(true); return; }
      const scale = introTimelineScale(params);
      const gridEnd = params.grid * scale * params.gridScale;
      // Paint only dots during playback: avoid repainting two viewport-sized
      // CSS gradient masks on every frame. Geometry and colors are captured once.
      const dotCanvas = document.createElement('canvas');
      dotCanvas.className = 'home-intro-cover';
      dotCanvas.setAttribute('aria-hidden', 'true');
      const scene = sceneOf(stage);
      const spacing = scene.dots?.spacing ?? 24;
      const radius = scene.dots?.radius ?? 1;
      const offset = scene.dots?.offset ?? [0, 0];
      const stageBox = stage.getBoundingClientRect();
      const homeBox = home.getBoundingClientRect();
      const width = homeBox.width;
      const height = homeBox.height;
      const dpr = Math.min(devicePixelRatio, 2);
      dotCanvas.width = Math.ceil(width * dpr);
      dotCanvas.height = Math.ceil(height * dpr);
      dotCanvas.style.width = `${width}px`;
      dotCanvas.style.height = `${height}px`;
      const ctx = dotCanvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      const probe = document.createElement('span');
      probe.style.color = 'var(--tp-background)';
      home.append(probe);
      const background = getComputedStyle(probe).color;
      probe.style.color = 'var(--tp-foreground)';
      const foreground = getComputedStyle(probe).color;
      probe.remove();
      const dots: { x: number; y: number; distance: number }[] = [];
      const ox = offset[0] + stageBox.left - homeBox.left;
      const oy = offset[1] + stageBox.top - homeBox.top;
      const firstX = ((ox + spacing / 2) % spacing + spacing) % spacing;
      const firstY = ((oy + spacing / 2) % spacing + spacing) % spacing;
      for (let y = firstY; y < height + radius; y += spacing) {
        for (let x = firstX; x < width + radius; x += spacing) {
          dots.push({ x, y, distance: Math.hypot(x - width / 2, y - height / 2) });
        }
      }
      // The softness tail continues beyond the screen. Anchor subsequent stages
      // to the front reaching actual visible dots, not the offscreen tail end.
      const visibleRadius = Math.max(0, ...dots
        .filter(dot => dot.x >= 0 && dot.x < width && dot.y >= 0 && dot.y < height)
        .map(dot => dot.distance));
      const maxRadius = visibleRadius + Math.max(1, params.softness);
      const easing = params.ease === 'outCirc' ? eases.outCirc
        : params.ease === 'out(3)' ? eases.outCubic
        : params.ease === 'inOut(2)' ? eases.inOutQuad : eases.linear;
      const visibleFraction = visibleRadius / maxRadius;
      let low = 0, high = 1;
      for (let i = 0; i < 32; i++) {
        const middle = (low + high) / 2;
        if (easing(middle) < visibleFraction) low = middle;
        else high = middle;
      }
      const visibleGridEnd = high * gridEnd;
      const borderStart = visibleGridEnd * 0.5;
      const fadeStart = borderStart + params.border * scale;
      const introCardStart = fadeStart + params.cards * scale;
      const introCardDuration = params.introCard * scale * params.cardScale;
      const contentStart = introCardStart + introCardDuration;
      const paintDots = (front: number) => {
        ctx.globalAlpha = 1;
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
        const tail = Math.max(1, params.softness);
        for (const dot of dots) {
          const age = front - dot.distance;
          if (age <= 0) continue;
          const reveal = Math.min(1, age / Math.min(12, tail));
          const flash = Math.max(0, 1 - age / tail) ** 2;
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = foreground;
          ctx.globalAlpha = 0.1 * reveal;
          ctx.fill();
          if (flash > 0) {
            ctx.fillStyle = '#fff';
            ctx.globalAlpha = 0.5 * flash * reveal;
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      };
      paintDots(0);
      stage.prepend(dotCanvas); overlays.push(dotCanvas);
      const shellLayer = document.createElement('div'); shellLayer.className = 'home-intro-shells'; shellLayer.setAttribute('aria-hidden', 'true');
      shellLayer.style.visibility = 'hidden';
      home.append(shellLayer); overlays.push(shellLayer);
      const shells: TpMoSegmentBorder[] = [];
      let lightOrigin:[number,number]=[scene.size[0]/2,scene.size[1]/2];
      const source = home.querySelector<HTMLTemplateElement>('[data-intro-border]')!;
      const createBorder = (duration: number) => {
        const border = source.content.firstElementChild!.cloneNode(true) as TpMoSegmentBorder;
        for (const segment of border.querySelectorAll('tp-mo-border-segment')) {
          segment.duration = String(duration);
          segment.easing = 'cubic-bezier(0, 0.55, 0.45, 1)';
        }
        return border;
      };
      const origin = home.getBoundingClientRect();
      for (const card of home.querySelectorAll('tp-card, [data-intro-item] .intro-card')) {
        // Cards the canvas keeps in reserve are laid out nowhere visible.
        if (card.closest('[data-pooled]')) continue;
        const visual = card.shadowRoot?.querySelector<HTMLElement>('[part~="card"]') ?? card;
        const r = visual.getBoundingClientRect();
        if(card===introCard)lightOrigin=[r.x+r.width/2-scene.origin[0],r.y+r.height/2-scene.origin[1]];
        const cardStyle = getComputedStyle(visual);
        const radius = [cardStyle.borderTopLeftRadius, cardStyle.borderTopRightRadius,
          cardStyle.borderBottomRightRadius, cardStyle.borderBottomLeftRadius].join(' ');
        if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
        const shell = createBorder(params.border * scale);
        shell.style.cssText += `position:absolute;left:${r.left-origin.left}px;top:${r.top-origin.top}px;width:${r.width}px;height:${r.height}px`;
        const surface = shell.querySelector<HTMLElement>('[data-intro-surface]')!;
        surface.style.cssText = `width:100%;height:100%;box-sizing:border-box;border:1px solid var(--tp-border);border-radius:${radius};background:transparent;opacity:0`;
        shellLayer.append(shell); shells.push(shell);
      }
      await Promise.all(shells.map(shell => shell.updateComplete));
      await frame();
      if (disposed || token !== generation) return;
      const borderDriver = await prepareIntroBorders(shells);
      releaseBorders = borderDriver.release;
      if (disposed || token !== generation) { borderDriver.release(); return; }
      const cardLayer = home.querySelector<HTMLElement>('[data-card-layer]')!;
      const captions = [...home.querySelectorAll<HTMLElement>('.canvas__caption')];
      const reveal = { progress: 0 };
      const paintReveal = () => {
        const progress = borderDriver.paint(reveal.progress);
        const contentOpacity = Math.max(0, (progress - 0.5) * 2);
        shellLayer.style.visibility = progress > 0 ? 'visible' : 'hidden';
        cardLayer.style.opacity = String(contentOpacity);
        captions.forEach(caption => { caption.style.opacity = String(0.7 * contentOpacity); });
      };
      paintReveal();
      home.dataset.intro = 'playing';
      const fluidDots=stage.dataset.dotSurface!==undefined?stage.querySelector<HTMLElement>('[data-fluid="dots"]'):null;
      if(fluidDots)fluidDots.style.opacity='0';
      const radial = { radius: 0 };
      timeline = createTimeline({ autoplay: false, onComplete: () => finish(true) })
        .label('grid', 0)
        .label('grid-visible-end', visibleGridEnd)
        .add(radial, { radius: maxRadius, duration: gridEnd, ease: params.ease, onRender: () => {
          paintDots(radial.radius);
        } }, 'grid')
        .label('borders', borderStart)
        .add(reveal, {
          progress: 1, duration: params.border * scale,
          ease: cubicBezier(0, 0.55, 0.45, 1), onRender: paintReveal,
        }, 'borders')
        .add(shellLayer, {
          opacity: [1, 0], duration: params.cards * scale * 4, ease: 'linear',
        }, fadeStart)
        .label('content', contentStart)
        .label('introCard', introCardStart)
        .call(()=>{
          home.dataset.introLight='';
          scene.publish({stir:{strength:1,from:lightOrigin,to:lightOrigin,velocity:[0,0],carry:[0,0],grip:.5}});
          home.dispatchEvent(new Event('introcardreveal'));
        },'introCard')
        .add(introCard, { opacity: [0, 1], duration: introCardDuration, ease: params.ease }, 'introCard');
      if(fluidDots){
        timeline.add(dotCanvas,{opacity:[1,0],duration:introCardDuration,ease:'linear'},'introCard');
        timeline.add(fluidDots,{opacity:[0,1],duration:introCardDuration,ease:'linear'},'introCard');
      }
      const children = [...introCard.querySelectorAll<HTMLElement>('.eyebrow, .intro__title')];
      const textScale = scale * params.cardScale * params.cardTextScale;
      // Slow the reveals without stretching the gaps between components.
      // Each component gets the full duration, so neighboring reveals overlap.
      const duration = params.cardContent * textScale;
      const stagger = params.cardStagger * scale;
      for (const [index, child] of children.entries()) {
        const start = contentStart + index * stagger;
        const strokes = [...child.querySelectorAll<TpMoTextStroke | TpMoTextSplit>('tp-mo-text-stroke, tp-mo-text-split')];
        if (strokes.length) {
          // Prepare and claim all reveals before playback. Each piece is sampled
          // from the same timeline time, even when a callback frame is dropped.
          for (const text of strokes) {
            text.revealHold = false;
            await text.updateComplete;
            textDriver.add(timeline!, text, start,
              text.localName === 'tp-mo-text-stroke'
                ? params.headingDuration * Math.min(3, Math.max(0.1, params.timelineScale))
                : duration, params.ease, Math.min(3, Math.max(0.1, params.timelineScale)));
          }
          timeline!.call(() => {
            child.style.opacity = '1';
            child.style.transform = 'none';
          }, start);
        } else {
          timeline!.add(child, {
            opacity: [0, 1], translateY: ['1rem', '0rem'], duration, ease: params.ease,
          }, start);
        }
      }
      await frame();
      if (disposed || token !== generation) return;
      timeline.play();
    } catch (error) {
      if (!disposed && token === generation) { console.warn('Home intro skipped.', error); finish(true); }
    } finally { clearTimeout(timeout); }
  };
  const interrupt = () => { if (home.dataset.intro === 'playing') finish(true); };
  addEventListener('resize', interrupt);
  motion.addEventListener('change', interrupt);
  const theme = new MutationObserver(interrupt);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
  document.addEventListener('astro:before-swap', () => {
    disposed = true; finish(); textDriver.dispose(); theme.disconnect();
    removeEventListener('resize', interrupt); motion.removeEventListener('change', interrupt);
  }, { once: true });
  void play();
  return {
    params,
    replay() {
      canvas.dispatchEvent(new Event('introreset'));
      void play();
    },
  };
}
