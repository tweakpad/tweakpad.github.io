import { Grid, Input, Motion, index_of, cell_uv, segment_weight, wall_at } from "./fluid-common.wgsl";

@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<uniform> input: Input;
@group(0) @binding(2) var<storage, read> src: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> dst: array<vec2f>;
@group(0) @binding(4) var walls: texture_2d<f32>;
@group(0) @binding(5) var<uniform> motion: Motion;

fn sample_velocity(p: vec2f) -> vec2f {
  let coord = clamp(p * vec2f(grid.size) - 0.5, vec2f(0), vec2f(grid.size) - 1.0);
  let cell = vec2i(floor(coord));
  let f = fract(coord);
  let bottom = mix(src[index_of(cell, grid.size)], src[index_of(cell + vec2i(1, 0), grid.size)], f.x);
  let top = mix(src[index_of(cell + vec2i(0, 1), grid.size)], src[index_of(cell + vec2i(1, 1), grid.size)], f.x);
  return mix(bottom, top, f.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let cell = vec2i(id.xy);
  let wall = wall_at(walls, cell);
  let p = cell_uv(cell, grid.size);
  let aspect = f32(grid.size.x) / f32(grid.size.y);
  let dt = 1.0 / 60.0;
  let source_velocity = src[index_of(cell, grid.size)];
  let backtrace = clamp(p - dt * source_velocity, 0.5 / vec2f(grid.size), 1.0 - 0.5 / vec2f(grid.size));
  var velocity = input.keep.x * sample_velocity(backtrace);

  if (input.pointer_active > 0.0) {
    let weight = segment_weight(p, input.pointer_from, input.pointer_to, input.stroke.x, aspect);
    velocity += weight * input.pointer_velocity * input.stroke.y;
  }
  // The trail head pushes like the pointer, through water that keeps to the cards' motion: it
  // moves through the hallway as the pointer moves over the stage, and its wake stays there.
  if (input.stir_active > 0.0) {
    let weight = segment_weight(p, input.stir_from, input.stir_to, input.stroke.x, aspect);
    velocity = mix(velocity, input.stir_carry, min(1.0, weight * input.stir_grip * min(1.0, input.stir_active)));
    velocity += weight * input.stir_velocity * input.stroke.y * input.stir_active;
  }

  // A rising card pushes outward: the swell falls off away from the card, so down its gradient.
  if (wall.y > 0.001) {
    let gradient = vec2f(
      wall_at(walls, cell + vec2i(1, 0)).y - wall_at(walls, cell - vec2i(1, 0)).y,
      wall_at(walls, cell + vec2i(0, 1)).y - wall_at(walls, cell - vec2i(0, 1)).y,
    );
    let slope = length(gradient);
    if (slope > 1e-4) { velocity -= gradient / slope * wall.y * input.swell_push * dt; }
  }

  // Inside a wall the fluid moves with it, as far as the wall is solid.
  velocity = mix(velocity, motion.velocity, wall.x);
  let speed = length(velocity);
  if (speed > 2.5) { velocity *= 2.5 / speed; }
  dst[index_of(cell, grid.size)] = velocity;
}
