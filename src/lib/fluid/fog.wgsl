import { vignette } from "./fluid-common.wgsl";

// The fog: a veil of the page's own colour, on a canvas over the cards. It lies over a resting
// card, with a hole cut where a card has risen through it, and, as thinly as `background` says,
// over the stage between the cards, lights included.
struct FogConfig {
  output_size: vec2f,
  fog_color: vec3f,
  cards: f32,
  background: f32,
  vignette: f32,
}
@group(0) @binding(0) var<uniform> config: FogConfig;
// The cards at output resolution, drawn by solids.wgsl: r is a card, g the part of it that has
// risen; row 0 is the bottom, like the solver.
@group(0) @binding(1) var cards: texture_2d<f32>;

@fragment
fn fragment_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  var uv = position.xy / config.output_size;
  uv.y = 1.0 - uv.y; // WebGPU fragment coordinates start at the top; the solver's +Y points up.
  let mask = textureLoad(cards, vec2i(i32(position.x), i32(config.output_size.y) - 1 - i32(position.y)), 0).rg;
  let card = mask.r;
  let risen = min(mask.g, card);
  let density = config.cards * (card - risen) + config.background * (1.0 - card);
  let fog = density * (0.9 + 0.1 * vignette(uv, config.vignette));
  // A faint rim where the surface breaks: round a risen card, and over the whole card as it rises.
  let rim = 0.18 * smoothstep(0.02, 0.5, risen) * (1.0 - smoothstep(0.5, 0.98, risen));
  // Premultiplied, so the page shows through what is left.
  return vec4f(config.fog_color * fog + vec3f(rim), min(1.0, fog + rim));
}
