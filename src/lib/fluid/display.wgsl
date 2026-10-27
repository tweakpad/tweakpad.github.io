import { index_of } from "./fluid-common.wgsl";

struct DisplayConfig {
  output_size: vec2f,
  dye_size: vec2u,
}
@group(0) @binding(0) var<uniform> config: DisplayConfig;
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
  let density = sample_dye(uv);
  let color = 1.0 - exp(-density * 1.35);
  let vignette = 0.68 + 0.32 * pow(max(0.0, 1.0 - dot(uv - 0.5, uv - 0.5) * 1.9), 1.5);
  // Premultiplied over the page instead of over a dark backdrop, so either theme shows through.
  let rgb = color * vignette;
  return vec4f(rgb, max(rgb.r, max(rgb.g, rgb.b)));
}
