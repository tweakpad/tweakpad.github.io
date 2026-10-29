import { Grid, Input, index_of, cell_uv, segment_weight, is_wall } from "./fluid-common.wgsl";

@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<uniform> input: Input;
@group(0) @binding(2) var<storage, read> src: array<vec4f>;
@group(0) @binding(3) var<storage, read> velocity: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> dst: array<vec4f>;
// The walls at the dye's own resolution, so the dye stops at the finer edge.
@group(0) @binding(5) var walls: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> pressure: array<f32>;

// Only a lifted card stops the dye; it streams over a submerged one.
fn solid_at(p: vec2f) -> bool {
  return is_wall(walls, vec2i(floor(p * vec2f(grid.dye_size))));
}

fn sample_pressure(p: vec2f) -> f32 {
  let coord = clamp(p * vec2f(grid.size) - 0.5, vec2f(0), vec2f(grid.size) - 1.0);
  let cell = vec2i(floor(coord));
  let f = fract(coord);
  let bottom = mix(pressure[index_of(cell, grid.size)], pressure[index_of(cell + vec2i(1, 0), grid.size)], f.x);
  let top = mix(pressure[index_of(cell + vec2i(0, 1), grid.size)], pressure[index_of(cell + vec2i(1, 1), grid.size)], f.x);
  return mix(bottom, top, f.y);
}

fn sample_dye(p: vec2f) -> vec4f {
  let coord = clamp(p * vec2f(grid.dye_size) - 0.5, vec2f(0), vec2f(grid.dye_size) - 1.0);
  let cell = vec2i(floor(coord));
  let f = fract(coord);
  let bottom = mix(src[index_of(cell, grid.dye_size)], src[index_of(cell + vec2i(1, 0), grid.dye_size)], f.x);
  let top = mix(
    src[index_of(cell + vec2i(0, 1), grid.dye_size)],
    src[index_of(cell + vec2i(1, 1), grid.dye_size)],
    f.x,
  );
  return mix(bottom, top, f.y);
}

fn sample_velocity(p: vec2f) -> vec2f {
  let coord = clamp(p * vec2f(grid.size) - 0.5, vec2f(0), vec2f(grid.size) - 1.0);
  let cell = vec2i(floor(coord));
  let f = fract(coord);
  let bottom = mix(velocity[index_of(cell, grid.size)], velocity[index_of(cell + vec2i(1, 0), grid.size)], f.x);
  let top = mix(
    velocity[index_of(cell + vec2i(0, 1), grid.size)],
    velocity[index_of(cell + vec2i(1, 1), grid.size)],
    f.x,
  );
  return mix(bottom, top, f.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.dye_size)) { return; }
  let cell = vec2i(id.xy);
  let p = cell_uv(cell, grid.dye_size);
  let aspect = f32(grid.size.x) / f32(grid.size.y);
  if (solid_at(p)) {
    dst[index_of(cell, grid.dye_size)] = vec4f(0);
    return;
  }
  var backtrace = clamp(p - sample_velocity(p) / 60.0, 0.5 / vec2f(grid.dye_size), 1.0 - 0.5 / vec2f(grid.dye_size));
  if (solid_at(backtrace)) { backtrace = p; }
  var color = input.keep.y * sample_dye(backtrace);

  if (input.pointer_active > 0.0) {
    let weight = segment_weight(p, input.pointer_from, input.pointer_to, input.stroke.x, aspect);
    color += input.pointer_color * weight * input.stroke.z;
  }
  // Where the flow is squeezed, ahead of a moving or rising card, the pressure rises and leaves a
  // lit wake in the water.
  color += vec4f(input.pressure_color.rgb, 1.0) * max(0.0, sample_pressure(p)) * input.pressure_color.w;

  dst[index_of(cell, grid.dye_size)] = clamp(color, vec4f(0), vec4f(4));
}
