import { Grid, index_of, is_solid } from "./fluid-common.wgsl";

@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read> pressure: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<vec2f>;
@group(0) @binding(4) var<storage, read> solid: array<vec4f>;

fn neighbour(p: vec2i, center: f32, edge: bool) -> f32 {
  if (edge) { return center; }
  let i = index_of(p, grid.size);
  return select(pressure[i], center, is_solid(solid[i]));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let p = vec2i(id.xy);
  let last = vec2i(grid.size) - 1;
  let here = solid[index_of(p, grid.size)];
  if (is_solid(here)) {
    dst[index_of(p, grid.size)] = here.xy;
    return;
  }
  let c = pressure[index_of(p, grid.size)];
  let l = neighbour(p - vec2i(1, 0), c, p.x == 0);
  let r = neighbour(p + vec2i(1, 0), c, p.x == last.x);
  let b = neighbour(p - vec2i(0, 1), c, p.y == 0);
  let t = neighbour(p + vec2i(0, 1), c, p.y == last.y);
  var u = src[index_of(p, grid.size)] - vec2f(
    (r - l)*.5*f32(grid.size.x),
    (t - b)*.5*f32(grid.size.y),
  );
  if (p.x == 0 && u.x < 0.0) { u.x = 0.0; }
  if (p.x == last.x && u.x > 0.0) { u.x = 0.0; }
  if (p.y == 0 && u.y < 0.0) { u.y = 0.0; }
  if (p.y == last.y && u.y > 0.0) { u.y = 0.0; }
  // At a solid face the flow matches the solid's normal velocity unless it is moving away from it.
  if (p.x > 0) {
    let s = solid[index_of(p - vec2i(1, 0), grid.size)];
    if (is_solid(s)) { u.x = max(u.x, s.x); }
  }
  if (p.x < last.x) {
    let s = solid[index_of(p + vec2i(1, 0), grid.size)];
    if (is_solid(s)) { u.x = min(u.x, s.x); }
  }
  if (p.y > 0) {
    let s = solid[index_of(p - vec2i(0, 1), grid.size)];
    if (is_solid(s)) { u.y = max(u.y, s.y); }
  }
  if (p.y < last.y) {
    let s = solid[index_of(p + vec2i(0, 1), grid.size)];
    if (is_solid(s)) { u.y = min(u.y, s.y); }
  }
  let s = length(u);
  if (s > 2.5) { u *= 2.5 / s; }
  dst[index_of(p, grid.size)] = u;
}
