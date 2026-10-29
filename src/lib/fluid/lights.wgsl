import { index_of, vignette } from "./fluid-common.wgsl";

// The lights: the dye as coloured smoke, on a canvas behind the cards, so it glows between them
// and runs on out of sight behind them.
struct LightsConfig {
  output_size: vec2f,
  dye_size: vec2u,
  exposure: f32,
  opacity: f32,
  vignette: f32,
}
@group(0) @binding(0) var<uniform> config: LightsConfig;
@group(0) @binding(1) var<storage, read> dye: array<vec4f>;

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

@fragment
fn fragment_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  var uv = position.xy / config.output_size;
  uv.y = 1.0 - uv.y; // WebGPU fragment coordinates start at the top; the solver's +Y points up.
  let smoke = 1.0 - exp(-sample_dye(uv) * config.exposure);
  let amount = max(smoke.r, max(smoke.g, smoke.b));
  // Premultiplied, so the page shows through wherever the dye is thin.
  return vec4f(smoke * vignette(uv, config.vignette), amount) * config.opacity;
}
