import { Grid, index_of, is_solid } from "./fluid-common.wgsl";

struct PressureParams {
  decay: f32,
}
@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<uniform> params: PressureParams;
@group(0) @binding(2) var<storage, read> src: array<f32>;
@group(0) @binding(3) var<storage, read> divergence: array<f32>;
@group(0) @binding(4) var<storage, read_write> dst: array<f32>;
@group(0) @binding(5) var<storage, read> solid: array<vec4f>;

fn neighbour(p: vec2i, center: f32, edge: bool) -> f32 {
  if (edge) { return center; }
  let i = index_of(p, grid.size);
  return select(src[i], center, is_solid(solid[i]));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let p = vec2i(id.xy);
  let i = index_of(p, grid.size);
  let center = src[i];
  let last = vec2i(grid.size) - 1;
  let left = neighbour(p - vec2i(1, 0), center, p.x == 0) * params.decay;
  let right = neighbour(p + vec2i(1, 0), center, p.x == last.x) * params.decay;
  let bottom = neighbour(p - vec2i(0, 1), center, p.y == 0) * params.decay;
  let top = neighbour(p + vec2i(0, 1), center, p.y == last.y) * params.decay;
  let wx = f32(grid.size.x * grid.size.x);
  let wy = f32(grid.size.y * grid.size.y);
  dst[i] = ((left + right) * wx + (bottom + top) * wy - divergence[i]) / (2.0 * wx + 2.0 * wy);
}
