import { Grid, Motion, index_of, wall_strength } from "./fluid-common.wgsl";

@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read> pressure: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<vec2f>;
@group(0) @binding(4) var walls: texture_2d<f32>;
@group(0) @binding(5) var<uniform> motion: Motion;

fn neighbour(p: vec2i, center: f32, edge: bool) -> f32 {
  if (edge) { return center; }
  return mix(pressure[index_of(p, grid.size)], center, wall_strength(walls, p));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let p = vec2i(id.xy);
  let last = vec2i(grid.size) - 1;
  let here = wall_strength(walls, p);
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
  // At a wall's face the flow matches the wall's normal velocity unless it is moving away from it,
  // as far as that wall is solid; a submerged card only bends the flow a little.
  let w = motion.velocity;
  if (p.x > 0) { u.x = mix(u.x, max(u.x, w.x), wall_strength(walls, p - vec2i(1, 0))); }
  if (p.x < last.x) { u.x = mix(u.x, min(u.x, w.x), wall_strength(walls, p + vec2i(1, 0))); }
  if (p.y > 0) { u.y = mix(u.y, max(u.y, w.y), wall_strength(walls, p - vec2i(0, 1))); }
  if (p.y < last.y) { u.y = mix(u.y, min(u.y, w.y), wall_strength(walls, p + vec2i(0, 1))); }
  u = mix(u, w, here);
  let s = length(u);
  if (s > 2.5) { u *= 2.5 / s; }
  dst[index_of(p, grid.size)] = u;
}
