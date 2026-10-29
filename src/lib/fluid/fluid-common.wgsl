export struct Grid {
  size: vec2u,
  dye_size: vec2u,
}

export struct Input {
  pointer_active: f32,
  pointer_from: vec2f,
  pointer_to: vec2f,
  pointer_velocity: vec2f,
  pointer_color: vec4f,
  pressure_color: vec4f, // rgb, and the gain in w: dye added where the pressure rises, the wake
  keep: vec2f, // the share of velocity, then of dye, kept from one step to the next
  stroke: vec4f, // a pointer stroke's size, the share of the pointer's velocity it gives, and its dye
  swell_push: f32, // how hard a rising card pushes, in stage fractions per second squared
  // A second pointer, the autopilot's trail head (lib/scene.ts SceneStir): it stirs along its last
  // step as the pointer does, with the pointer's stroke, through water that keeps to `stir_carry`.
  stir_active: f32, // how hard it stirs, 1 as hard as the pointer
  stir_from: vec2f,
  stir_to: vec2f,
  stir_velocity: vec2f, // its velocity through the water around it, stage fractions per second, +Y up
  stir_carry: vec2f, // that water's velocity
  stir_grip: f32, // how much of the way to `stir_carry` the water at its centre goes each step
  stir_color: vec4f, // like pointer_color, from its direction
}

// Walls: a mask drawn by solids.wgsl at the resolution of the grid that reads it. r is the wall's
// strength (a submerged card is faint, a lifted one is 1), g is the swell around a rising card.
// Every wall moves with the layer, so one velocity serves them all.
export struct Motion {
  velocity: vec2f,
}

export fn wall_at(mask: texture_2d<f32>, p: vec2i) -> vec2f {
  let last = vec2i(textureDimensions(mask)) - 1;
  return textureLoad(mask, clamp(p, vec2i(0), last), 0).rg;
}

export fn wall_strength(mask: texture_2d<f32>, p: vec2i) -> f32 {
  return wall_at(mask, p).x;
}

// A hard wall, where the solver needs a yes or no: only a lifted card.
export fn is_wall(mask: texture_2d<f32>, p: vec2i) -> bool {
  return wall_strength(mask, p) > 0.5;
}

export fn index_of(p: vec2i, size: vec2u) -> u32 {
  let q = clamp(p, vec2i(0), vec2i(size) - 1);
  return u32(q.y) * size.x + u32(q.x);
}

export fn cell_uv(p: vec2i, size: vec2u) -> vec2f {
  return (vec2f(p) + 0.5) / vec2f(size);
}

export fn segment_weight(
  p: vec2f,
  a: vec2f,
  b: vec2f,
  radius_squared: f32,
  aspect: f32,
) -> f32 {
  let scale = vec2f(aspect, 1.0);
  let point = p * scale;
  let origin = a * scale;
  let delta = (b - a) * scale;
  let t = clamp(dot(point - origin, delta) / max(dot(delta, delta), 1e-7), 0.0, 1.0);
  let d = point - (origin + t * delta);
  return exp(-dot(d, d) / radius_squared);
}

// The stage darkens towards its edges; `amount` is how much, 0 for not at all.
export fn vignette(uv: vec2f, amount: f32) -> f32 {
  return 1.0 - amount + amount * pow(max(0.0, 1.0 - dot(uv - 0.5, uv - 0.5) * 1.9), 1.5);
}
