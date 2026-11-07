import { createTimeline, eases } from 'animejs';
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
  const sidebar = home.querySelector<HTMLElement>('.intro')!;
  const texts = [...sidebar.querySelectorAll<TpMoTextStroke | TpMoTextSplit>('tp-mo-text-stroke, tp-mo-text-split')];
  const textDriver = introTextDriver(texts);
  const canvas = home.querySelector<HTMLElement>('[data-canvas]')!;
  const params = { ...initialParams };
  let timeline: ReturnType<typeof createTimeline> | undefined;
  let disposed = false;
  let generation = 0;
  let overlays: HTMLElement[] = [];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const finish = () => {
    generation++;
    timeline?.pause();
    overlays.forEach(el => el.remove()); overlays = [];
    delete home.dataset.intro;
    home.inert = false;
    home.querySelectorAll<HTMLElement>('.canvas__world, tp-card > *, .canvas__caption, [data-fluid="lights"], [data-fluid="fog"]').forEach(el => el.style.removeProperty('opacity'));
    sidebar.style.removeProperty('transform');
    sidebar.style.removeProperty('opacity');
    for (const child of sidebar.children) {
      if (!(child instanceof HTMLElement)) continue;
      child.style.removeProperty('opacity');
      child.style.removeProperty('transform');
    }
    texts.forEach(text => { text.revealHold = false; });
    textDriver.release();
    home.dispatchEvent(new Event('introcomplete', { bubbles: true }));
  };
  const ready = async (token: number) => {
    await document.fonts.ready;
    let previous = '';
    let stable = 0;
    while (!disposed && token === generation) {
      const elements = [...home.querySelectorAll<HTMLElement>('*')].filter(el => el.localName.startsWith('tp-'));
      await Promise.all(elements.map(async el => {
        await customElements.whenDefined(el.localName);
        await (el as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
      }));
      await Promise.all([...home.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
      await frame();
      const geometry = [...home.querySelectorAll('[data-item], .home-intro-shells tp-mo-segment-border')].map(el => {
        const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].join(',');
      }).join(';');
      stable = geometry === previous ? stable + 1 : 0;
      previous = geometry;
      if (stable >= 4 && canvas.dataset.layoutSettled !== undefined && stage.dataset.fluidReady !== undefined) return;
    }
  };
  const play = async () => {
    finish();
    if (disposed) return;
    const token = ++generation;
    home.dataset.intro = 'loading'; home.inert = true;
    texts.forEach(text => { text.revealHold = true; });
    textDriver.reset();
    home.dispatchEvent(new Event('introstart'));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([ready(token), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Intro readiness timeout')), 8000); })]);
      if (disposed || token !== generation) return;
      if (motion.matches) { finish(); return; }
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
      const sidebarStart = fadeStart + params.cards * scale;
      const sidebarDuration = params.sidebar * scale * params.sidebarScale;
      const contentStart = sidebarStart + sidebarDuration;
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
            ctx.globalAlpha = flash * reveal;
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
      for (const card of home.querySelectorAll('tp-card')) {
        const r = card.getBoundingClientRect();
        if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
        const shell = createBorder(params.border * scale);
        shell.style.cssText += `position:absolute;left:${r.left-origin.left}px;top:${r.top-origin.top}px;width:${r.width}px;height:${r.height}px`;
        const surface = shell.querySelector<HTMLElement>('[data-intro-surface]')!;
        surface.style.cssText = `width:100%;height:100%;box-sizing:border-box;border:1px solid var(--tp-border);border-radius:${getComputedStyle(card).borderTopLeftRadius};background:transparent;opacity:0`;
        shellLayer.append(shell); shells.push(shell);
      }
      await Promise.all(shells.map(shell => shell.updateComplete));
      await Promise.race([ready(token), new Promise<never>((_, reject) => { clearTimeout(timeout); timeout = setTimeout(() => reject(new Error('Intro preparation timeout')), 8000); })]);
      await frame();
      if (disposed || token !== generation) return;
      home.dataset.intro = 'playing';
      const radial = { radius: 0 };
      timeline = createTimeline({ autoplay: false, onComplete: finish })
        .label('grid', 0)
        .label('grid-visible-end', visibleGridEnd)
        .add(radial, { radius: maxRadius, duration: gridEnd, ease: params.ease, onRender: () => {
          paintDots(radial.radius);
        } }, 'grid')
        .label('borders', borderStart)
        .call(() => {
          shellLayer.style.visibility = 'visible';
          shells.forEach(shell => { shell.trigger = 'always'; });
        }, 'borders')
        .label('backgrounds', Math.max(borderStart, fadeStart - params.cards * scale))
        .add(home.querySelectorAll('.canvas__world, [data-fluid="fog"]'), {
          opacity: [0, 1], duration: Math.min(params.cards, params.border) * scale, ease: params.ease,
        }, 'backgrounds')
        .label('border-settle', fadeStart)
        .add(shellLayer, { opacity: [1, 0], duration: params.cards * scale, ease: params.ease }, 'border-settle')
        .label('content', contentStart)
        .add(home.querySelectorAll('tp-card > *'), {
          opacity: [0, 1], duration: params.cardContent * scale, ease: params.ease,
        }, 'content')
        .add(home.querySelectorAll('.canvas__caption'), {
          opacity: [0, 0.7], duration: params.cardContent * scale, ease: params.ease,
        }, 'content')
        .label('sidebar', sidebarStart)
        .add(sidebar, {
          ...(matchMedia('(width < 48rem)').matches
            ? { translateY: ['-25%', '0%'] }
            : { translateX: ['-25%', '0%'] }),
          opacity: [0, 1], duration: sidebarDuration, ease: params.ease,
        }, 'sidebar');
      const children = [...sidebar.children].filter((child): child is HTMLElement =>
        child instanceof HTMLElement && getComputedStyle(child).display !== 'none');
      const textScale = scale * params.sidebarScale * params.sidebarTextScale;
      // Slow the reveals without stretching the gaps between components.
      // Each component gets the full duration, so neighboring reveals overlap.
      const duration = params.sidebarContent * textScale;
      const stagger = params.sidebarStagger * scale;
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
      if (!disposed && token === generation) { console.warn('Home intro skipped.', error); finish(); }
    } finally { clearTimeout(timeout); }
  };
  const interrupt = () => { if (home.dataset.intro === 'playing') finish(); };
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
