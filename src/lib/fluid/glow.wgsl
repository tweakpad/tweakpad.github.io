import { Grid, index_of } from "./fluid-common.wgsl";

// The light the water gives off, per solver cell, from its pressure: the push ahead of a moving
// or rising card, and, as far as `suction` says, the pull behind it. The pressure is smoothed in
// space, so the checkerboard the solver leaves in it never shows, and the light in time, so it
// swells and fades rather than flickering as a card crosses the cells.
struct GlowParams {
  gain: f32,
  suction: f32,
  attack: f32, // the share of the way to a brighter light taken each step
  release: f32, // the share of the way to a dimmer one
}
@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<uniform> params: GlowParams;
@group(0) @binding(2) var<storage, read> pressure: array<f32>;
// Read and written in place: each cell reads only its own previous light.
@group(0) @binding(3) var<storage, read_write> glow: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let p = vec2i(id.xy);
  // A 5 × 5 binomial filter; index_of clamps, so the stage's edges repeat their last cell.
  var weights = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);
  var sum = 0.0;
  for (var y = 0; y < 5; y++) {
    for (var x = 0; x < 5; x++) {
      sum += weights[x] * weights[y] * pressure[index_of(p + vec2i(x - 2, y - 2), grid.size)];
    }
  }
  let smoothed = sum / 256.0 * params.gain;
  let light = max(smoothed, 0.0) + params.suction * max(-smoothed, 0.0);
  let i = index_of(p, grid.size);
  let previous = glow[i];
  glow[i] = mix(previous, light, select(params.release, params.attack, light > previous));
}
