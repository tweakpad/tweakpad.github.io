# Mosaic relaxation inspector

Open `http://site.localhost/__debug/intro-grid` on the running dev server.
The homepage now uses this solver for its opening layout and new infinite-canvas batches. Existing canvas cards stay pinned during extensions.

Our grid is the default. It reads measured card bodies and intro placements,
including repeated occurrences. Each retains its preferred proportions and has
an individual resizing percentage in Card data. Initial 15% allowances are
used on the homepage with measured responsive minimum heights. Before shows the untouched seed;
Run and Step improve it within N total passes. History exposes intermediate
best-effort results. Green boundaries meet tolerance; red boundaries do not.

Every run produces a complete best-effort layout. The budget limits improvement,
not whether a grid is displayed. Gutter error, preferred-size deviation, and
boundary remainder remain visible. If cards cannot fit the requested region,
the baseline can extend beyond it; the boundary remainder reports this explicitly.
Pins and intro centers remain fixed. The flight spine stays clear.

The pure solver explores shared-edge slicing trees and directly relaxes measured
placements, including bounded card reassignment. It enforces individual size
allowances and uses optional responsive minimum-height samples. Captions occupy
the vertical gutter separately from the card body. No transform scaling is used.

Synthetic presets are separate. Ratio stress generates tall, wide and mixed shapes;
Seed makes cases reproducible. Card JSON accepts key, width/height ranges
{min, preferred, max}, optional resizePercent, captionHeight and heightFloor
samples {width, minHeight}. A supplied resizePercent derives both ranges from
that card's preferred size. All dimensions are CSS pixels.

Live cards and Capture live run remain comparison modes. The automated stress
suite covers 120 cases across six viewport aspects, checking every result's
individual resizing bounds and non-overlap, including out-of-tolerance results.
Run `node --test tests/mosaic-relaxation.test.mjs`.

After the relaxation budget is exhausted, a final presentation pass centers each
movable card between its nearest overlapping edges over up to 24 sweeps without resizing it. Caption
footprints, pinned cards, and the exact intro flight corridor remain occupied.
This distributes residual space; it does not guarantee equal gutters.

Homepage performance: opening relaxation (200 passes) and infinite-canvas
extensions run in a dedicated module worker. Extensions insert directly at the
configured gutter rather than rerunning relaxation against the whole world. The production
worker omits inspector history. Previous placements stay pinned; results apply
only to the current canvas generation. Geometry prefetch and DOM mounting use
separate guard bands. At most three pooled cards mount per frame, with at most one fresh construction, and intro card
contents are instantiated only when near the viewport. Responsive profiles use
three batched write/read measurements instead of one layout per card and width.

Run `tests/home-intro.browser.js`, `tests/home-grid-performance.browser.js`, then
`tests/canvas-coverage.browser.js` through Chrome DevTools evaluate_script. The
performance check reports handler and frame timings for 90 wheel and 90 synthetic
drag events, checks input stalls and waits for asynchronous extensions to settle.
Coverage checks wait for pending geometry/mounting before measuring all seven
positions. Frame timings include rendering and component mounting; low handler
time alone does not prove a smooth frame rate.

The homepage reuses measured originals and a bounded pool per pattern. Pool demand
is calculated from maximum simultaneous opening visibility, including the mounting
guard, and prepared before playback. Both the intro and infinite canvas use it.
Edited demos are not reused for another placement. Recycled cards remain hidden
outside the stage and their lights are off. Pointer lighting is enabled only in
manual mode; the opening and auto modes supply explicit off/flow light points.

`tests/opening-hit.browser.js` must run immediately after reload. It checks the
straight opening, stationary light at card reveal, an accelerating finish without
extra opening braking, first top-edge
strike, lift, lit border, fluid burst, and locked pointer lighting. At handoff the
initial patch geometry is published synchronously, before any async extensions,
so the autopilot can resolve the landing reference immediately. The performance
check now requires 95% of frames within 35 ms and no frame above 100 ms, rather
than treating handler timing as proof of smooth rendering.

The bounded pool is hydrated during intro preparation, before playback starts.
Wheel and drag input are coalesced through the scene frame scheduler. Assigned
mosaic footprints use layout/style/size containment, keeping child layout updates
inside a card. Unlit/offstage borders use `trigger="none"` so the library releases
its pointer-position subscription; an actual flow light or impact enables it.

Worker completion and incremental mounting also use the scene frame scheduler;
they do not render from separate requestAnimationFrame callbacks. This prevents
multiple full layout/lighting passes in a single display frame.

The renderer and fluid masks use each placement's assigned width and actual card
radius. Lift transforms share that footprint with the DOM; a global column width
must never be used as their transform origin. Run
`tests/canvas-boundaries.browser.js` after intro to compare native card, glow SVG,
and fluid-mask bounds over 35 lift frames for three different card types.

Pattern adjacency uses the nearest overlapping edge in each direction regardless
of gutter width. Collision-only reservations do not count as pattern neighbors.
Extensions retain off-batch placements in that calculation. A cached nearest-edge
index updates incrementally after insertion instead of rebuilding for every candidate. Run
`tests/canvas-patterns.browser.js` to independently audit six world positions.

After preferred-size insertion, responsive variants try the measured width and
height ranges. All insertions use the same target gutter;
existing placements remain pinned. This reclaims the departed heading area without
a layout swap. `tests/first-impulse.browser.js` checks heading centering, deep-clone
count and frame intervals during descent, then measures actual card coverage of
the departed heading region. Coverage is a best-effort measurement, not a guarantee
of equal spacing for every possible catalog.

The Astro development audit toolbar is disabled to avoid its main-thread audits
during animation measurements. The homepage tuning panel remains available.

Fast exploration prefetches geometry in the direction of travel (up to 2500 CSS
pixels ahead), mounts within a 480 px guard, and prepares at least three reusable
nodes per pattern before intro playback. Header and caption surfaces are opaque;
they no longer resample the moving canvas through backdrop blur. Manual lighting
uses one shared pointer position and enables only borders within its reach.
The sticky header aligns both columns at their top and bottom edges.

The fluid surfaces use the scene's cached viewport dimensions with VGPU automatic
layout sizing disabled. Explicit resize runs only when viewport size or DPR changes;
this avoids layoutCanvasSize reads after the grid writes transforms. Fog and dots
retain device resolution. The latest wheel stress check still exposed occasional
frame-budget failures; this is not evidence of fully resolved rendering performance.

The opening footprint accommodates the smallest measured demo, and its former
center is refilled before ordinary extensions consume the surrounding free space.
Opening bounds include caption heights. New extension batches run two local
`fitGutters` passes: they can expand a card within its measured range, while keeping
its original footprint contained and published neighbors fixed. This reduces gutter
error without reopening pockets or swapping visible cards. It still does not
promise mathematically identical gaps for arbitrary aspect ratios and size limits.
`tests/gutter-fit.test.mjs` covers measured bounds and heterogeneous inputs.
`tests/canvas-fast-scroll.browser.js` traverses 21,600 CSS pixels and checks visible
coverage on every frame, rather than waiting for generation before measuring.
