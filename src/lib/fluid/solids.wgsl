// Draws the walls into mask textures: one instanced quad per wall over its bounding box, so each
// wall touches only its own texels and no cell ever looks at every wall. Walls arrive as rounded
// rectangles in stage pixels (+Y down); a mask is at the resolution of whatever reads it, so the
// position math never depends on the grid. The draws blend additively onto a cleared mask, so a
// wall's swell band never erases a neighbour.
//
// Mode 0, for the solver: r is the wall's strength where the whole texel, corners included, lies
// inside the rounded rectangle, so the stepped edge always stays hidden under the card; g is the
// swell, in a band outside the rectangle, which pushes the fluid while a card rises.
// Mode 1, for the fog: r is the card with an anti-aliased edge, where the fog lies over it, and g
// is that times its lift, the hole the card has risen through.

struct Wall {
  rect: vec4f, // x, y, width, height in stage pixels
  radius: f32,
  strength: f32, // how solid: submerged cards are faint, a lifted card is 1
  swell: f32,    // how fast the card is rising, 0..1
  lift: f32,     // how far it has risen, 0..1
}

struct Raster {
  size: vec2f,  // the stage, in pixels
  cells: vec2f, // the mask, in texels
  mode: f32,
  band: f32,    // mode 0: the swell band's width, in stage pixels
}

@group(0) @binding(0) var<uniform> raster: Raster;
// A uniform rather than a storage buffer: the vertex stage may read uniforms on every WebGPU tier,
// compatibility mode included. Its length is MAX_WALLS in simulation.ts.
@group(0) @binding(1) var<uniform> rects: array<Wall, 64>;

struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) rect: vec4f,
  @location(1) @interpolate(flat) radius: f32,
  @location(2) @interpolate(flat) strength: f32,
  @location(3) @interpolate(flat) swell: f32,
  @location(4) @interpolate(flat) lift: f32,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Vertex {
  var corners = array<vec2f, 6>(
    vec2f(0, 0), vec2f(1, 0), vec2f(0, 1),
    vec2f(1, 0), vec2f(1, 1), vec2f(0, 1),
  );
  let wall = rects[instance];
  // The quad reaches a texel past the wall, or past its swell band, so every texel they touch is tested.
  let texel = raster.size / raster.cells;
  let grow = select(raster.band, 0.0, raster.mode > 0.5) + texel;
  let low = wall.rect.xy - grow;
  let high = wall.rect.xy + wall.rect.zw + grow;
  let point = mix(low, high, corners[vertex]);
  // Texel row 0 is the solver's bottom row, so the stage's bottom maps to the top of the mask.
  var out: Vertex;
  out.position = vec4f(point / raster.size * 2.0 - 1.0, 0.0, 1.0);
  out.rect = wall.rect;
  out.radius = wall.radius;
  out.strength = wall.strength;
  out.swell = wall.swell;
  out.lift = wall.lift;
  return out;
}

@fragment
fn fs_main(in: Vertex) -> @location(0) vec4f {
  let texel = raster.size / raster.cells;
  let centre = vec2f(in.position.x / raster.cells.x, 1.0 - in.position.y / raster.cells.y) * raster.size;
  let half = in.rect.zw * 0.5;
  let radius = min(in.radius, min(half.x, half.y));
  let q = abs(centre - (in.rect.xy + half)) - (half - radius);
  // Signed distance to the rounded rectangle, in stage pixels; negative inside.
  let distance = length(max(q, vec2f(0))) + min(max(q.x, q.y), 0.0) - radius;
  if (raster.mode > 0.5) {
    let coverage = 1.0 - smoothstep(-0.5 * length(texel), 0.5 * length(texel), distance);
    return vec4f(coverage, in.lift * coverage, 0.0, 0.0);
  }
  let reach = 0.5 * length(texel);
  let inside = select(0.0, in.strength, distance <= -reach);
  let band = select(0.0, 1.0 - smoothstep(0.0, raster.band, distance), distance > -reach);
  return vec4f(inside, in.swell * band, 0.0, 0.0);
}
