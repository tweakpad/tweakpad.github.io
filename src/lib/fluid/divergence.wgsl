import { Grid, Motion, index_of, is_wall } from "./fluid-common.wgsl";

@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<storage, read> velocity: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> divergence: array<f32>;
@group(0) @binding(3) var walls: texture_2d<f32>;
@group(0) @binding(4) var<uniform> motion: Motion;

// The neighbour's normal velocity: a wall's own, a fluid cell's, zero past the domain edge.
fn face(p: vec2i, axis: u32, edge: bool) -> f32 {
  if (edge) { return 0.0; }
  return select(velocity[index_of(p, grid.size)][axis], motion.velocity[axis], is_wall(walls, p));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let p = vec2i(id.xy);
  let last = vec2i(grid.size) - 1;
  if (is_wall(walls, p)) {
    divergence[index_of(p, grid.size)] = 0.0;
    return;
  }
  let l = face(p - vec2i(1, 0), 0u, p.x == 0);
  let r = face(p + vec2i(1, 0), 0u, p.x == last.x);
  let b = face(p - vec2i(0, 1), 1u, p.y == 0);
  let t = face(p + vec2i(0, 1), 1u, p.y == last.y);
  divergence[index_of(p, grid.size)] =
    (r - l)*.5*f32(grid.size.x) + (t - b)*.5*f32(grid.size.y);
}
