import { index_of } from "./fluid-common.wgsl";

// The dot grid, on a canvas under the water: the stage's floor, drawn as a surface that catches
// light. Each dot is a small dome. A light hangs over the floor at the pointer, or at the
// autopilot's trail head while it flies (lib/scene.ts): the dots near it brighten, swell and take a
// highlight on the side that faces it, brightest right under it. Where the autopilot's head strikes
// a card, the floor bursts: a flash at the point it hits, and a ring of light spreading out from it
// through the dots. The water's own light, its dye and the glow of its pressure, reflects in the
// dots beneath it. Positions are CSS pixels of the stage, +Y down; the grid follows the layer's pan
// at the parallax the canvas publishes.
struct DotsConfig {
  dye_size: vec2u,
  grid_size: vec2u,
  dot_color: vec3f,
  light_color: vec3f,
  pressure_color: vec3f,
  // A dot's opacity where nothing lights it, as the page's own dots were drawn.
  base: f32,
  // How far the light carries: its strength halves a little past this, and fades on from there.
  reach: f32,
  // How high it hangs over the floor: lower makes the highlight tighter and more one-sided.
  height: f32,
  shininess: f32,
  intensity: f32,
  // How much a dot right under the light grows, in CSS pixels.
  swell: f32,
  // How much of the water's light the dots reflect.
  reflect: f32,
  // A strike's burst: its brightness, how fast its ring spreads (CSS pixels per second), the ring's
  // width (CSS pixels) and how long it lasts (seconds).
  burst_intensity: f32,
  burst_speed: f32,
  burst_width: f32,
  burst_duration: f32,
  // The water's light, as lights.wgsl draws it.
  exposure: f32,
  curve: f32,
  halo: f32,
}
// What changes every frame.
struct DotsView {
  stage_size: vec2f,
  output_size: vec2f,
  // The grid's offset on the stage, its spacing and its dots' radius, in CSS pixels.
  offset: vec2f,
  spacing: f32,
  radius: f32,
  light: vec2f,
  // The light's strength, 0 (none) to 1.
  strength: f32,
  // Where the burst struck, and how long ago in seconds; negative while there is none.
  burst_at: vec2f,
  burst_age: f32,
}
@group(0) @binding(0) var<uniform> config: DotsConfig;
@group(0) @binding(1) var<uniform> view: DotsView;
@group(0) @binding(2) var<storage, read> dye: array<vec4f>;
@group(0) @binding(3) var<storage, read> glow: array<f32>;

fn sample_dye(p: vec2f) -> vec3f {
  let size = config.dye_size;
  let grid = clamp(p * vec2f(size) - 0.5, vec2f(0), vec2f(size) - 1.0);
  let cell = vec2i(floor(grid));
  let f = fract(grid);
  let bottom = mix(dye[index_of(cell, size)].rgb, dye[index_of(cell + vec2i(1, 0), size)].rgb, f.x);
  let top = mix(dye[index_of(cell + vec2i(0, 1), size)].rgb, dye[index_of(cell + vec2i(1, 1), size)].rgb, f.x);
  return mix(bottom, top, f.y);
}

fn sample_glow(p: vec2f) -> f32 {
  let size = config.grid_size;
  let grid = clamp(p * vec2f(size) - 0.5, vec2f(0), vec2f(size) - 1.0);
  let cell = vec2i(floor(grid));
  let f = fract(grid);
  let bottom = mix(glow[index_of(cell, size)], glow[index_of(cell + vec2i(1, 0), size)], f.x);
  let top = mix(glow[index_of(cell + vec2i(0, 1), size)], glow[index_of(cell + vec2i(1, 1), size)], f.x);
  return mix(bottom, top, f.y);
}

@fragment
fn fragment_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let ratio = view.output_size.x / max(view.stage_size.x, 1.0);
  let p = position.xy / ratio;
  let spacing = max(view.spacing, 1.0);
  // The centre of the dot this pixel belongs to: one in the middle of every tile, like the CSS dots.
  let centre = view.offset + (floor((p - view.offset) / spacing) + 0.5) * spacing;

  // The whole dot shares one exposure, taken at its centre, so it swells evenly.
  let reach = max(config.reach, 1.0);
  let away = length(view.light - centre) / reach;
  let falloff = view.strength / pow(1.0 + away * away, 1.5);

  // The burst: a flash on the point struck, gone in the first quarter, and a ring travelling out
  // from it, both fading over its life.
  var burst = 0.0;
  if (view.burst_age >= 0.0) {
    let t = clamp(view.burst_age / max(config.burst_duration, 1e-3), 0.0, 1.0);
    let life = (1.0 - t) * (1.0 - t);
    let width = max(config.burst_width, 1.0);
    let from_hit = length(centre - view.burst_at);
    let front = (from_hit - config.burst_speed * view.burst_age) / width;
    let ring = exp(-front * front);
    let core = from_hit / (2.0 * width);
    let flash = exp(-core * core) * max(0.0, 1.0 - 4.0 * t);
    burst = config.burst_intensity * life * max(ring, flash);
  }

  let radius = view.radius + config.swell * min(falloff + burst, 1.5);
  let local = p - centre;
  // Antialiased over one device pixel.
  let mask = clamp((radius - length(local)) * ratio + 0.5, 0.0, 1.0);
  if (mask <= 0.0) {
    return vec4f(0.0);
  }

  // A dome: its normal tilts towards the dot's edge, so the side facing the light catches it.
  let o = local / max(radius, 1e-3);
  let n = normalize(vec3f(o, sqrt(max(0.0, 1.0 - dot(o, o))) + 0.25));
  let l = normalize(vec3f(view.light - p, max(config.height, 1.0)));
  let h = normalize(l + vec3f(0.0, 0.0, 1.0));
  let diffuse = max(dot(n, l), 0.0);
  let specular = pow(max(dot(n, h), 0.0), max(config.shininess, 1.0));
  let lit = config.intensity * falloff * (0.4 * diffuse + specular);
  // The burst lights each dot from the point struck, low over the floor, so the ring's dots catch
  // it on the side facing the hit.
  let lb = normalize(vec3f(view.burst_at - p, 0.5 * max(config.height, 1.0)));
  let burst_lit = burst * (0.6 + 0.6 * max(dot(n, lb), 0.0));
  // It takes some of the water's primary colour, as the water it drove breaks against the card.
  let burst_color = mix(config.light_color, config.pressure_color, 0.35);

  // The water over the dot, lit as lights.wgsl lights it, reflected in the dome's top.
  var uv = centre / max(view.stage_size, vec2f(1.0));
  uv.y = 1.0 - uv.y; // the solver's +Y points up
  let smoke = 1.0 - exp(-sample_dye(uv) * config.exposure);
  let light = sample_glow(uv);
  let push = select(0.0, pow(light, config.curve), light > 0.0);
  let shine = 1.0 - exp(-push * config.halo);
  let water = (smoke + config.pressure_color * shine) * config.reflect * n.z;

  // Premultiplied: what nothing covers shows the page through.
  let rgb = config.dot_color * config.base + config.light_color * lit + burst_color * burst_lit + water;
  let alpha = config.base + lit + burst_lit + max(water.r, max(water.g, water.b));
  return vec4f(min(rgb, vec3f(1.0)), min(alpha, 1.0)) * mask;
}
