import test from 'node:test';
import assert from 'node:assert/strict';
import { createMosaic } from '../src/lib/mosaic.ts';

const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** A synthetic catalog: tall, wide and narrow cards, each with its own resize percentage. */
function catalog(seed, count = 12, shape = 'mixed') {
  const random = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const percent = 0.05 + random() * 0.35;
    const pref = shape === 'narrow' ? 240 + random() * 80 : shape === 'wide' ? 480 + random() * 160 : 280 + random() * 300;
    const body = shape === 'tall' ? 420 + random() * 260 : 180 + random() * 360;
    const floor = [0.85, 1, 1.15].map((f) => ({ width: pref * f, minHeight: body * 0.8 / f }));
    return {
      key: `p${i % Math.max(1, count - 2)}`,
      width: { min: pref * (1 - percent), pref, max: pref * (1 + percent) },
      height: { min: body * (1 - percent), pref: body, max: body * (1 + percent) },
      floor,
      caption: { gap: 14, width: 120 + random() * 120, height: 28 },
    };
  });
}

const inflated = (item, gap, k, period) => ({
  x: item.x - gap[0] / 2 + k * period,
  y: item.y - gap[1] / 2,
  w: item.w + gap[0],
  h: item.h + gap[1],
});

function audit(mosaic, gap, top, bottom) {
  const P = mosaic.period;
  const rects = [];
  mosaic.query({ x: -gap[0], y: top - gap[1], w: P + gap[0] * 2, h: bottom - top + gap[1] * 2 }, (i, k) => {
    if (!rects.some((r) => r.i === i && r.k === k)) rects.push({ i, k, r: inflated(mosaic.items[i], gap, k, P) });
  });
  // The band [0, P) × [top, bottom] must be covered exactly once.
  let area = 0;
  for (const { r } of rects) {
    const w = Math.max(0, Math.min(r.x + r.w, P) - Math.max(r.x, 0));
    const h = Math.max(0, Math.min(r.y + r.h, bottom) - Math.max(r.y, top));
    area += w * h;
  }
  let overlaps = 0;
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const p = rects[a].r;
    const q = rects[b].r;
    const w = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
    const h = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
    if (w > 0.01 && h > 0.01) overlaps++;
  }
  return { coverage: area / (P * (bottom - top)), overlaps, count: rects.length };
}

const cases = [];
for (const shape of ['mixed', 'tall', 'wide', 'narrow'])
  for (const gap of [[32, 32], [56, 40], [24, 72]])
    for (const view of [[390, 844], [1440, 900], [2560, 1300]])
      for (const seed of [1, 7]) cases.push({ shape, gap, view, seed });

test('tiles exactly: no gaps, no overlaps, every gutter the gutter', () => {
  for (const { shape, gap, view, seed } of cases) {
    const cards = catalog(seed * 31 + view[0], 12, shape);
    const mosaic = createMosaic(cards, {
      gap, period: view[0] * 3, seed,
      hero: { width: Math.min(560, view[0] - 32), height: 260 },
      landingDepth: Math.max(view[1], 5 * 400),
    });
    const { coverage, overlaps } = audit(mosaic, gap, -2500, 4000);
    const label = `${shape} gap=${gap} view=${view} seed=${seed}`;
    assert.equal(overlaps, 0, `${label}: overlaps`);
    assert.ok(Math.abs(coverage - 1) < 1e-6, `${label}: coverage ${coverage}`);
    assert.equal(mosaic.violations, 0, `${label}: sizes outside their ranges`);
  }
});

test('opening: the gutter under the hero stays clear down to a centred landing card', () => {
  for (const { shape, gap, view, seed } of cases) {
    const cards = catalog(seed * 17 + view[1], 12, shape);
    const hero = { width: Math.min(560, view[0] - 32), height: 260 };
    const mosaic = createMosaic(cards, { gap, period: view[0] * 3, seed, hero, landingDepth: view[1] });
    const label = `${shape} gap=${gap} view=${view} seed=${seed}`;
    const h = mosaic.items[mosaic.hero];
    const l = mosaic.items[mosaic.landing];
    assert.ok(h.w >= Math.min(hero.width, h.w) && h.h >= hero.height - 0.01, `${label}: hero slot too small`);
    assert.ok(Math.abs(h.x + h.w / 2) < 0.01 && Math.abs(h.y + h.h / 2) < 0.01, `${label}: hero not centred`);
    assert.ok(l.x <= -Math.min(0.2 * l.w, 64) + 0.01 && l.x + l.w >= Math.min(0.2 * l.w, 64) - 0.01, `${label}: landing not over the gutter`);
    assert.ok(l.y - (h.y + h.h) >= view[1] - gap[1] - 1, `${label}: landing too close`);
    assert.ok(l.y - (h.y + h.h) <= view[1] + 1200, `${label}: landing ${Math.round(l.y - h.y - h.h)} px deep`);
    const blocking = [];
    mosaic.query({ x: -gap[0] / 2 + 0.01, y: h.y + h.h + 0.01, w: gap[0] - 0.02, h: l.y - h.y - h.h - 0.02 }, (i, k) => {
      if (k === 0 && i !== mosaic.hero && i !== mosaic.landing) blocking.push(mosaic.items[i]);
    });
    assert.deepEqual(blocking, [], `${label}: cards in the opening gutter`);
  }
});

test('neighbours mostly differ', () => {
  const gap = [40, 40];
  const mosaic = createMosaic(catalog(3), { gap, period: 4000, seed: 3, hero: { width: 520, height: 260 }, landingDepth: 1800 });
  mosaic.ensure(-3000, 6000);
  let pairs = 0;
  let same = 0;
  const near = (a, b) => {
    const dx = Math.max(b.x - a.x - a.w, a.x - b.x - b.w);
    const dy = Math.max(b.y - a.y - a.h, a.y - b.y - b.h);
    return (Math.abs(dx - gap[0]) < 0.01 && dy < -0.01) || (Math.abs(dy - gap[1]) < 0.01 && dx < -0.01);
  };
  const items = mosaic.items;
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    if (!near(items[a], items[b])) continue;
    pairs++;
    if (items[a].pattern === items[b].pattern) same++;
  }
  assert.ok(pairs > 100);
  // Variety is a preference, never a reason to leave a gap: a width only neighbouring patterns fit
  // takes one of them. The catalog here also repeats two patterns.
  assert.ok(same / pairs < 0.08, `same-pattern neighbours: ${same}/${pairs}`);
});

test('fast: thousands of cards in a few milliseconds', () => {
  const mosaic = createMosaic(catalog(5), { gap: [40, 40], period: 4320, seed: 5, hero: { width: 520, height: 260 }, landingDepth: 1800 });
  const start = performance.now();
  mosaic.ensure(-60000, 60000);
  const elapsed = performance.now() - start;
  assert.ok(mosaic.items.length > 2000, `${mosaic.items.length} cards`);
  assert.ok(elapsed < 100, `${elapsed.toFixed(1)} ms for ${mosaic.items.length} cards`);
});

/** The home page's featured patterns as measured on a desktop viewport, at seven widths each. */
const home = [
  ['sign-in', [326, 384, 442], [308, 362, 416], [[326, 369], [346, 362], [442, 362]]],
  ['password-recovery', [326, 384, 442], [251, 295, 339], [[326, 295], [442, 295]]],
  ['verify-code', [326, 384, 442], [213, 251, 289], [[326, 272], [346, 251], [442, 251]]],
  ['notification-settings', [354, 416, 478], [316, 372, 428], [[354, 393], [374, 393], [395, 372], [478, 372]]],
  ['invite-team', [374, 440, 506], [377, 443, 509], [[374, 443], [440, 443], [462, 422], [506, 422]]],
  ['choose-plan', [354, 416, 478], [234, 275, 316], [[354, 275], [478, 275]]],
  ['upload-progress', [354, 416, 478], [281, 330, 379], [[354, 351], [374, 351], [395, 330], [478, 330]]],
  ['feedback', [354, 416, 478], [304, 358, 412], [[354, 358], [478, 358]]],
  ['schedule-meeting', [374, 440, 506], [375, 441, 507], [[374, 638], [396, 638], [418, 441], [506, 441]]],
  ['sound-settings', [326, 384, 442], [350, 412, 474], [[326, 434], [346, 413], [442, 413]]],
  ['profile-card', [272, 320, 368], [197, 232, 267], [[272, 232], [368, 232]]],
  ['api-key', [374, 440, 506], [270, 318, 366], [[374, 339], [396, 339], [418, 318], [462, 318], [484, 297], [506, 297]]],
].map(([key, w, h, floor]) => ({
  key,
  width: { min: w[0], pref: w[1], max: w[2] },
  height: { min: h[0], pref: h[1], max: h[2] },
  floor: floor.map(([width, minHeight]) => ({ width, minHeight })),
  caption: { gap: 14, width: 200, height: 30 },
}));

test('the home catalog: gapless, varied, and an opening at the depth asked for', () => {
  for (const [width, height] of [[1624, 960], [1280, 720], [390, 844]]) {
    const gap = [64, 64];
    const mosaic = createMosaic(home, { gap, period: width * 3, seed: 271828, hero: { width: Math.min(440, width - 48), height: 214 }, landingDepth: Math.max(height, 2300) });
    const { coverage, overlaps } = audit(mosaic, gap, -3000, 5000);
    assert.equal(overlaps, 0);
    assert.ok(Math.abs(coverage - 1) < 1e-6, `coverage ${coverage}`);
    assert.equal(mosaic.violations, 0);
    const h = mosaic.items[mosaic.hero];
    const l = mosaic.items[mosaic.landing];
    assert.ok(Math.abs(l.x + l.w / 2) < 1, `landing centred: ${l.x + l.w / 2}`);
    assert.ok(l.y - h.y - h.h < Math.max(height, 2300) + 600, `landing ${Math.round(l.y - h.y - h.h)} px deep`);
    // The opening's stacks take what fits them; across the world, no pattern takes over.
    mosaic.ensure(-12000, 16000);
    const counts = {};
    for (const item of mosaic.items) counts[item.pattern] = (counts[item.pattern] ?? 0) + 1;
    const share = Math.max(...Object.values(counts)) / mosaic.items.length;
    // A fair share is 1/12. One pattern narrower than the rest (profile-card here) must not become
    // the filler of every narrow stretch.
    assert.ok(share < 0.15, `one pattern is ${(share * 100).toFixed(0)}% of the world`);
  }
});

/** The same patterns as measured on a phone: every card is nearly one width. */
const phone = [
  ['sign-in', 340, 362, [[289, 390], [340, 369], [391, 362]]],
  ['password-recovery', 342, 295, [[291, 295], [342, 295], [393, 295]]],
  ['verify-code', 335, 251, [[285, 272], [335, 251], [385, 251]]],
  ['notification-settings', 342, 414, [[291, 477], [342, 414], [393, 372]]],
  ['invite-team', 342, 443, [[291, 464], [342, 443], [393, 443]]],
  ['choose-plan', 342, 296, [[291, 362], [342, 296], [393, 275]]],
  ['upload-progress', 342, 351, [[291, 381], [342, 351], [393, 330]]],
  ['feedback', 342, 409, [[291, 409], [342, 409], [393, 358]]],
  ['schedule-meeting', 342, 638, [[291, 638], [342, 638], [393, 638]]],
  ['sound-settings', 342, 412, [[291, 433], [342, 412], [393, 412]]],
  ['profile-card', 342, 232, [[291, 232], [342, 232], [393, 232]]],
  ['api-key', 342, 339, [[291, 339], [342, 339], [393, 339]]],
].map(([key, w, h, floor]) => ({
  key,
  width: { min: w * 0.85, pref: w, max: w * 1.15 },
  height: { min: h * 0.85, pref: h, max: h * 1.15 },
  floor: floor.map(([width, minHeight]) => ({ width, minHeight })),
  caption: { gap: 14, width: 200, height: 30 },
}));

test('the phone catalog: an opening even when every card is one width', () => {
  const gap = [64, 64];
  const mosaic = createMosaic(phone, { gap, period: 2400, seed: 271828, hero: { width: 342, height: 190 }, landingDepth: 2350 });
  assert.equal(mosaic.violations, 0);
  const { coverage, overlaps } = audit(mosaic, gap, -3000, 5000);
  assert.equal(overlaps, 0);
  assert.ok(Math.abs(coverage - 1) < 1e-6, `coverage ${coverage}`);
  const h = mosaic.items[mosaic.hero];
  const l = mosaic.items[mosaic.landing];
  assert.ok(l, 'a landing card');
  assert.ok(h.w >= 342 && h.h >= 190, 'the hero fits its slot');
  assert.ok(l.x < -32 && l.x + l.w > 32, `landing over the gutter: ${l.x}..${l.x + l.w}`);
  assert.ok(l.y - h.y - h.h < 2350 + 600, `landing ${Math.round(l.y - h.y - h.h)} px deep`);
});
