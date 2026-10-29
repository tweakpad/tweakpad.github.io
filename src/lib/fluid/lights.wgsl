import { index_of, vignette } from "./fluid-common.wgsl";

// The lights, on a canvas behind the cards: the water lit where a card pushes it. The glow
// (glow.wgsl) is the light its pressure gives off; along a card's border it lights the rim mask
// there, and, as softly as `halo` says, the water around it. Over that lies the dye, the pointer's
// strokes and the pressure's wake, as coloured smoke.
struct LightsConfig {
  output_size: vec2f,
  dye_size: vec2u,
  grid_size: vec2u,
  exposure: f32,
  opacity: f32,
  vignette: f32,
  pressure_color: vec3f,
  // The glow's response curve: its exponent, under 1 to lift a slow push against a fast one.
  curve: f32,
  rim: f32,
  halo: f32,
}
@group(0) @binding(0) var<uniform> config: LightsConfig;
@group(0) @binding(1) var<storage, read> dye: array<vec4f>;
@group(0) @binding(2) var<storage, read> glow: array<f32>;
// The cards' rims at output resolution, drawn by solids.wgsl; row 0 is the bottom, like the solver.
@group(0) @binding(3) var rims: texture_2d<f32>;

fn sample_dye(p: vec2f) -> vec3f {
  // The dye grid follows the canvas's shape (see simulation.ts), so it is a uniform here.
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
  var uv = position.xy / config.output_size;
  uv.y = 1.0 - uv.y; // WebGPU fragment coordinates start at the top; the solver's +Y points up.
  let shade = vignette(uv, config.vignette);

  let light = sample_glow(uv);
  let push = select(0.0, pow(light, config.curve), light > 0.0);
  let rim = textureLoad(rims, vec2i(i32(position.x), i32(config.output_size.y) - 1 - i32(position.y)), 0).r;
  let shine = 1.0 - exp(-push * (config.rim * rim + config.halo));

  let smoke = 1.0 - exp(-sample_dye(uv) * config.exposure);
  let amount = max(smoke.r, max(smoke.g, smoke.b));
  // Both add light, premultiplied, so the page shows through wherever the water is dark.
  let rgb = (smoke + config.pressure_color * shine) * shade;
  return vec4f(min(rgb, vec3f(1.0)), min(1.0, amount + shine)) * config.opacity;
}
