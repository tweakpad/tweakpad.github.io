// Draws the walls into a mask texture: one instanced quad per wall over its bounding box, so each
// wall touches only its own texels and no cell ever looks at every wall. Walls arrive as rounded
// rectangles in stage pixels (+Y down); the mask is at the resolution of whichever grid reads it,
// so the position math never depends on the grid. A texel is a wall only when the whole of it,
// corners included, lies inside the rounded rectangle: the stepped edge of the mask always stays
// hidden under the card that is the wall.

struct Wall {
  rect: vec4f, // x, y, width, height in stage pixels
  radius: f32,
}

struct Raster {
  size: vec2f,  // the stage, in pixels
  cells: vec2f, // the mask, in texels
}

@group(0) @binding(0) var<uniform> raster: Raster;
// A uniform rather than a storage buffer: the vertex stage may read uniforms on every WebGPU tier,
// compatibility mode included. Its length is MAX_WALLS in simulation.ts.
@group(0) @binding(1) var<uniform> rects: array<Wall, 64>;

struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) rect: vec4f,
  @location(1) @interpolate(flat) radius: f32,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Vertex {
  var corners = array<vec2f, 6>(
    vec2f(0, 0), vec2f(1, 0), vec2f(0, 1),
    vec2f(1, 0), vec2f(1, 1), vec2f(0, 1),
  );
  let wall = rects[instance];
  // The quad is a texel bigger than the wall on every side, so its edge texels are tested too.
  let texel = raster.size / raster.cells;
  let low = wall.rect.xy - texel;
  let high = wall.rect.xy + wall.rect.zw + texel;
  let point = mix(low, high, corners[vertex]);
  // Texel row 0 is the solver's bottom row, so the stage's bottom maps to the top of the mask.
  var out: Vertex;
  out.position = vec4f(point / raster.size * 2.0 - 1.0, 0.0, 1.0);
  out.rect = wall.rect;
  out.radius = wall.radius;
  return out;
}

@fragment
fn fs_main(in: Vertex) -> @location(0) vec4f {
  let texel = raster.size / raster.cells;
  let centre = vec2f(in.position.x / raster.cells.x, 1.0 - in.position.y / raster.cells.y) * raster.size;
  let half = in.rect.zw * 0.5;
  let radius = min(in.radius, min(half.x, half.y));
  let q = abs(centre - (in.rect.xy + half)) - (half - radius);
  let distance = length(max(q, vec2f(0))) + min(max(q.x, q.y), 0.0) - radius;
  if (distance > -0.5 * length(texel)) { discard; }
  return vec4f(1.0);
}
