import { index_of } from "./fluid-common.wgsl";

// The fog: a veil of the page's own colour over everything under the canvas, carrying the dye as
// coloured smoke, with a hole cut where a card has risen through it.
struct DisplayConfig {
  output_size: vec2f,
  dye_size: vec2u,
  fog_color: vec3f,
  fog_density: f32,
}
@group(0) @binding(0) var<uniform> config: DisplayConfig;
@group(0) @binding(1) var<storage, read> dye: array<vec4f>;
// The lifted cards, at output resolution, drawn by solids.wgsl; row 0 is the bottom, like the solver.
@group(0) @binding(2) var cutout: texture_2d<f32>;

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
  let density = sample_dye(uv);
  let smoke = 1.0 - exp(-density * 1.35);
  let amount = max(smoke.r, max(smoke.g, smoke.b));
  let vignette = 0.68 + 0.32 * pow(max(0.0, 1.0 - dot(uv - 0.5, uv - 0.5) * 1.9), 1.5);

  // The dye lies over the fog; both are premultiplied, so the page shows through what is left.
  let fog = config.fog_density * (0.9 + 0.1 * vignette);
  var rgb = smoke * vignette + config.fog_color * fog * (1.0 - amount);
  var alpha = amount + fog * (1.0 - amount);

  // The hole over a lifted card, with a faint rim where the surface breaks.
  let hole = textureLoad(cutout, vec2i(i32(position.x), i32(config.output_size.y) - 1 - i32(position.y)), 0).r;
  let rim = smoothstep(0.02, 0.5, hole) * (1.0 - smoothstep(0.5, 0.98, hole));
  rgb = rgb * (1.0 - hole) + vec3f(rim * 0.18);
  alpha = alpha * (1.0 - hole) + rim * 0.18;
  return vec4f(rgb, alpha);
}
