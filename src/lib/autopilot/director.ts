/*
 * The autopilot: a pilot (lib/scene.ts) that flies the pattern canvas like a camera from card to
 * card. Every few seconds it picks a card within reach, plans a route to it that keeps clear of
 * every card on the way (route.ts), rounds it off (path.ts), and sends the trail head along it,
 * exactly on the path, so it never touches a card it passes, with the camera following
 * (motion.ts). The head stirs the water as it goes and bursts over the final straight run, so it
 * strikes the card's edge head on: the water it drives breaks against the card as the card lifts,
 * as if hovered, in the same moment. The camera then settles on the card and wanders
 * there until the next card is picked, and the head sets off again from where it struck. The
 * visitor's input hands the canvas back; once they have left it alone a while, the autopilot takes
 * over again from the card nearest the middle of the view.
 */
import type { Box, Interrupt, Pilot, Scene, WorldLayout } from '../scene';
import {
  cardBox,
  cardsNear,
  centreOf,
  columnIndex,
  itemBox,
  keyOf,
  nearestCard,
  relocate,
  sameCard,
  type CardRef,
  type Point,
} from './model';
import {
  burstFrom,
  dampingFor,
  handheld,
  Mover,
  smoothstep,
  speedAt,
  speedProfile,
  type SpeedOptions,
  type Spring,
} from './motion';
import type { AutopilotParams } from './params';
import { pointAt, project, smoothPath, type Path } from './path';
import { edgePoints, planRoute, type Departure, type EdgePoint, type Route, type RouteOptions } from './route';

type Mode = 'travelling' | 'focused' | 'paused';

/** How long a relayout settles before the route is planned again. */
const REPLAN_DELAY = 0.1;
/** How fast the stir comes in as the head sets off, and goes once it strikes, in seconds. */
const STIR_IN = 0.25;
const STIR_OUT = 0.12;
/** What leaving a card from another edge than the one the head struck costs, in pixels of route. */
const ELSEWHERE = 400;
/** The most cards a frame tries to plan a route to, so a run of cards out of reach never stalls one. */
const TRIES = 2;

/** What the debug overlay draws. */
export interface AutopilotView {
  mode: Mode;
  route: readonly Point[] | undefined;
  obstacles: readonly Box[] | undefined;
  impact: EdgePoint | undefined;
  path: Path | undefined;
  /** Where on the path the burst begins. */
  burst: number | undefined;
  carrot: Point | undefined;
  head: Point;
  headVelocity: Point;
  camera: Point;
  cameraTarget: Point;
  card: CardRef | undefined;
  target: CardRef | undefined;
  /** Seconds left: of the focus, or of the visitor's idle time before taking over. */
  countdown: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const along = (point: Point, normal: Point, length: number): Point => [
  point[0] + normal[0] * length,
  point[1] + normal[1] * length,
];

export function createAutopilot(scene: Scene, initial: AutopilotParams) {
  let params = initial;
  let mode: Mode = 'paused';
  let layout: WorldLayout | undefined;
  /** The card in focus, or the one the head left. */
  let card: CardRef | undefined;
  let target: CardRef | undefined;
  /** Where the head rests after striking a card: the card, the point relative to it, the edge's normal. */
  let rest: { ref: CardRef; offset: Point; normal: Point } | undefined;
  let route: Route | undefined;
  let path: Path | undefined;
  let profile: Float64Array | undefined;
  /** How far the carrot has gone along the path, and its speed. */
  let carrot = 0;
  let carrotSpeed = 0;
  let travelled = 0;
  let budget = 0;
  let dwell = 0;
  // At first the canvas drifts on its own a while, as after the visitor's input.
  let idle = 0;
  /** The camera's turn from the head (0) to the card (1), and where it is heading. */
  let focus = 0;
  let focusTo = 0;
  let stir = 0;
  let replanAt = Infinity;
  /** The autopilot's own clock, in seconds. */
  let clock = 0;
  let synced = false;
  let bag: string[] = [];
  /** Cards no route was found to since the last trip, so the next frames try others. */
  const unreachable = new Set<string>();
  /** The trail head: on the path while it travels, at rest where it struck otherwise. */
  let head: Point = [0, 0];
  let headVelocity: Point = [0, 0];
  let cameraTarget: Point = [0, 0];
  let lastHead: Point | undefined;

  const cameraSpring = (): Spring => {
    const b = smoothstep(focus);
    const frequency = lerp(params.camera.frequency, params.camera.focusFrequency, b);
    const damping = lerp(params.camera.damping, dampingFor(params.camera.overshoot), b);
    return { frequency, damping, reach: Math.max(200, (1.3 * 2 * damping * params.head.speed) / frequency) };
  };
  const camera = new Mover(() => [cameraTarget[0], cameraTarget[1]], cameraSpring);
  let drift = handheld(0, 1, () => 0);
  const rebuildDrift = () => {
    camera.agent.remove(drift);
    const { drift: amount, driftRate, focusFrequency } = params.camera;
    drift = handheld(amount * focusFrequency * focusFrequency, driftRate, () => smoothstep(focus));
    camera.agent.add(drift, { label: 'handheld' });
  };
  rebuildDrift();

  /** The middle of the part of the stage page chrome leaves clear, in stage pixels. */
  const view = (): Point => {
    const [width, height] = scene.size;
    const [left, top] = scene.inset;
    return [left + (width - left) / 2, top + (height - top) / 2];
  };

  const centre = (ref: CardRef) => {
    const box = layout && cardBox(layout, ref);
    return box ? centreOf(box) : undefined;
  };

  const routeOptions = (): RouteOptions => ({ ...params.route, runUp: params.head.runUp });

  const speedOptions = (along_: Path): SpeedOptions => {
    const { speed, acceleration, cornering, impact, runUp, windup } = params.head;
    return { speed, acceleration, cornering, finish: { from: burstFrom(along_, runUp), windup, impact } };
  };

  /** Rounds the route off again, keeping the carrot where it was, as the smoothing may change. */
  const smooth = () => {
    if (!route) return;
    const was = path && pointAt(path, carrot);
    path = smoothPath(route.points, params.endings, params.halls, params.route.clearance * 0.9, params.route.approach);
    profile = speedProfile(path, speedOptions(path), was ? carrotSpeed : 0);
    if (was) carrot = project(path, was);
  };

  /** Where the head rests on its card now, which a relayout may have moved. */
  const restPoint = (): Point | undefined => {
    const box = rest && layout && cardBox(layout, rest.ref);
    return box && rest ? [box.x + rest.offset[0], box.y + rest.offset[1]] : undefined;
  };

  /**
   * Where a route from card `from` may leave: from where the head struck it, out along the edge's
   * normal; or from anywhere else on its edges, when that saves a long way round the card.
   */
  const departures = (from: CardRef): Departure[] => {
    const away = params.route.clearance + 6;
    const resting = rest && sameCard(rest.ref, from) ? restPoint() : undefined;
    const box = layout && cardBox(layout, from);
    const elsewhere = box
      ? edgePoints(box, params.route.spread, Math.random).map(({ contact, normal }) => ({
          contact,
          out: along(contact, normal, away),
          penalty: resting ? ELSEWHERE : 0,
        }))
      : [];
    return rest && resting ? [{ contact: resting, out: along(resting, rest.normal, away) }, ...elsewhere] : elsewhere;
  };

  /** A pattern from the shuffled bag, so the camera visits them all before it repeats one. */
  const nextPatterns = (patterns: string[]) => {
    if (!bag.length) bag = [...new Set(patterns)].sort(() => Math.random() - 0.5);
    return bag;
  };

  /** How long the carrot takes along the profile. */
  const plannedTime = (along_: Path, speeds: Float64Array) => {
    let time = 0;
    for (let i = 1; i < along_.s.length; i += 1) {
      time += (along_.s[i]! - along_.s[i - 1]!) / Math.max(24, (speeds[i]! + speeds[i - 1]!) / 2);
    }
    return time;
  };

  /**
   * Picks the next card and plans the route to it: true once it has, false when this frame's
   * tries found none but more cards are left to try, undefined when none are.
   */
  const choose = (): boolean | undefined => {
    if (!layout) return undefined;
    const from = card ?? nearestCard(layout, camera.position);
    const start = from && centre(from);
    if (!from || !start) return undefined;
    const pattern = layout.columns[columnIndex(layout, from.u)]?.items[from.row]?.pattern;
    let near = cardsNear(layout, start, params.target.maxDistance).filter(
      (candidate) => distance(candidate.centre, start) >= params.target.minDistance && candidate.pattern !== pattern,
    );
    if (!near.length) near = cardsNear(layout, start, params.target.maxDistance * 2).filter((c) => c.pattern !== pattern);
    if (!near.length) return undefined;
    // In bag order, the first pattern within reach; among its copies, any.
    const order = nextPatterns(near.map((candidate) => candidate.pattern));
    near.sort((a, b) => {
      const ia = order.indexOf(a.pattern);
      const ib = order.indexOf(b.pattern);
      return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || Math.random() - 0.5;
    });
    const leaving = departures(from);
    let tries = 0;
    for (const candidate of near) {
      if (unreachable.has(keyOf(candidate.ref))) continue;
      if (tries++ >= TRIES) return false;
      const planned = planRoute(layout, leaving, candidate.ref, routeOptions());
      if (!planned) {
        unreachable.add(keyOf(candidate.ref));
        continue;
      }
      unreachable.clear();
      bag = bag.filter((entry) => entry !== candidate.pattern);
      card = from;
      target = candidate.ref;
      route = planned;
      path = undefined;
      carrot = 0;
      carrotSpeed = 0;
      smooth();
      // The head sets off from where it struck the card; anywhere else, it starts afresh there.
      const startPoint = planned.points[0]!;
      if (distance(head, startPoint) > 1) stir = 0;
      head = startPoint;
      headVelocity = [0, 0];
      lastHead = undefined;
      rest = undefined;
      travelled = 0;
      budget = 1 + 1.5 * plannedTime(path!, profile!);
      mode = 'travelling';
      focusTo = 0;
      return true;
    }
    return undefined;
  };

  /**
   * The head struck the card: it stops at the edge, its stir dies away while the water it drove
   * breaks against the card, and the card lifts, all at once. The camera settles on the card.
   */
  const strike = () => {
    if (!route || !target || !layout) return;
    const box = cardBox(layout, target);
    const { contact, normal } = route.impact;
    head = contact;
    headVelocity = [0, 0];
    if (box) rest = { ref: target, offset: [contact[0] - box.x, contact[1] - box.y], normal };
    card = target;
    target = undefined;
    mode = 'focused';
    const { interval, variance } = params.timing;
    dwell = Math.max(0.5, interval + variance * (Math.random() * 2 - 1));
    focusTo = 1;
  };

  /** Takes the canvas over from where it is: the camera at the view's middle, moving with it. */
  const takeOver = (pan: readonly [number, number], velocity: readonly [number, number]) => {
    const [vx, vy] = view();
    camera.place([vx - pan[0], vy - pan[1]], [-velocity[0], -velocity[1]]);
    card = layout && nearestCard(layout, camera.position);
    target = undefined;
    rest = undefined;
    route = undefined;
    path = undefined;
    focus = 0;
    focusTo = 0;
    synced = true;
    const chosen = choose();
    if (!chosen) {
      mode = 'focused';
      dwell = chosen === false ? 0 : 1;
    }
  };

  /** Keeps the cards it is tracking through a relayout, which may renumber their copies. */
  const followLayout = (next: WorldLayout) => {
    if (layout && next.build !== layout.build) {
      // The columns were dealt again: start over from whatever is in the middle of the view.
      layout = next;
      card = target = undefined;
      rest = undefined;
      route = path = undefined;
      synced = false;
      return;
    }
    if (layout && next.version !== layout.version) {
      const before = layout;
      const keep = (ref: CardRef | undefined) => {
        const box = ref && itemBox(before, ref);
        return ref && box ? relocate(next, ref, box.y) : undefined;
      };
      card = keep(card);
      target = keep(target);
      if (rest) {
        const ref = keep(rest.ref);
        rest = ref ? { ...rest, ref } : undefined;
      }
      if (mode === 'travelling') replanAt = Math.min(replanAt, clock + REPLAN_DELAY);
    }
    layout = next;
  };

  /** Plans the route again on the new layout, from wherever the head now is. */
  const replan = () => {
    replanAt = Infinity;
    if (!layout || !target || mode !== 'travelling') return;
    const planned = planRoute(layout, [{ contact: head, out: head }], target, routeOptions());
    if (!planned) return;
    route = planned;
    path = smoothPath(route.points, params.endings, params.halls, params.route.clearance * 0.9, params.route.approach);
    profile = speedProfile(path, speedOptions(path), carrotSpeed);
    carrot = 0;
  };

  /** Publishes the head's stir in the water, in stage pixels. */
  const publishStir = (pan: readonly [number, number], boost: number) => {
    const [width, height] = scene.size;
    const to: Point = [head[0] + pan[0], head[1] + pan[1]];
    const from: Point = lastHead ? [lastHead[0] + pan[0], lastHead[1] + pan[1]] : to;
    lastHead = head;
    const onStage = to[0] > -40 && to[1] > -40 && to[0] < width + 40 && to[1] < height + 40;
    const strength = onStage ? stir * boost : 0;
    if (strength <= 0 && !scene.stir) return;
    // The head moves through the hallway, among cards that move on the stage at the pan's
    // velocity, the reverse of the camera's. The water around it keeps to the cards' motion, so
    // the head stirs it as the pointer stirs the water on the stage, and its wake stays in the
    // hallway.
    scene.publish({
      stir:
        strength > 0
          ? {
              strength: strength * params.trail.strength,
              from,
              to,
              velocity: headVelocity,
              carry: [-camera.velocity[0], -camera.velocity[1]],
              grip: params.trail.carry,
            }
          : null,
    });
  };

  /** Hands the canvas back and waits for the visitor to leave it alone. */
  const holdOff = () => {
    idle = 0;
    if (mode === 'paused') return;
    mode = 'paused';
    target = undefined;
    rest = undefined;
    route = undefined;
    path = undefined;
    synced = false;
  };

  const pilot: Pilot = {
    get active() {
      return params.enabled && mode !== 'paused' && !!layout;
    },
    get featured() {
      return mode === 'focused' && card && layout ? { column: columnIndex(layout, card.u), row: card.row } : undefined;
    },
    interrupt(_reason: Interrupt) {
      holdOff();
    },
    update(dt, pan, velocity) {
      clock += dt;
      if (scene.layout && scene.layout !== layout) followLayout(scene.layout);
      if (!layout || !params.enabled) {
        stir = 0;
        publishStir(pan, 1);
        return undefined;
      }
      if (mode === 'paused') {
        idle += dt;
        stir = Math.max(0, stir - dt / STIR_OUT);
        publishStir(pan, 1);
        if (idle < params.timing.idle) return undefined;
        takeOver(pan, velocity);
      } else if (!synced) {
        takeOver(pan, velocity);
      }
      if (clock >= replanAt) replan();

      // Over its burst the head stirs harder, so the water strikes the card with it.
      let boost = 1;
      if (mode === 'travelling' && path && profile) {
        const from = burstFrom(path, params.head.runUp);
        const run = Math.max(1, path.length - from);
        carrotSpeed = speedAt(path, profile, carrot);
        carrot = Math.min(path.length, carrot + carrotSpeed * dt);
        // The head rides the path itself, so it keeps the clearance the route keeps.
        const ahead = pointAt(path, Math.min(path.length, carrot + 2));
        const behind = pointAt(path, Math.max(0, carrot - 2));
        const span = Math.hypot(ahead[0] - behind[0], ahead[1] - behind[1]) || 1;
        head = pointAt(path, carrot);
        headVelocity = [((ahead[0] - behind[0]) / span) * carrotSpeed, ((ahead[1] - behind[1]) / span) * carrotSpeed];
        travelled += dt;
        boost = 1 + params.trail.impact * smoothstep((carrot - from) / run);
        // The strike: the head meets the card's edge, at the end of the path.
        if (carrot >= path.length || travelled > budget) strike();
      } else if (mode === 'focused') {
        dwell -= dt;
        // A frame that found no route tries the next cards on the next frame; once every card in
        // reach has failed, it waits a moment and starts over.
        if (dwell <= 0) {
          const chosen = choose();
          if (chosen === false) dwell = 0;
          else if (chosen === undefined) {
            unreachable.clear();
            dwell = 1;
          }
        }
      }

      // The camera turns between the head and the card over the blend time.
      const blend = Math.max(0.05, params.camera.blend);
      focus = focusTo > focus ? Math.min(focusTo, focus + dt / blend) : Math.max(focusTo, focus - dt / blend);
      const spring = cameraSpring();
      const lead = (params.camera.lead * 2 * spring.damping) / spring.frequency;
      const follow: Point = [head[0] + headVelocity[0] * lead, head[1] + headVelocity[1] * lead];
      const settle = (card && centre(card)) ?? follow;
      const b = smoothstep(focus);
      cameraTarget = [lerp(follow[0], settle[0], b), lerp(follow[1], settle[1], b)];

      // A head at rest on its card stays there, as the card moves.
      if (mode !== 'travelling') {
        const resting = restPoint();
        if (resting) head = resting;
      }
      camera.advance(dt);

      stir =
        mode === 'travelling' ? Math.min(1, stir + dt / STIR_IN) : Math.max(0, stir - dt / STIR_OUT);
      const [vx, vy] = view();
      const next: [number, number] = [vx - camera.position[0], vy - camera.position[1]];
      publishStir(next, boost);
      return next;
    },
  };

  return {
    pilot,
    /** Takes a changed set of parameters; the route in progress is rounded off again. */
    setParams(next: AutopilotParams) {
      params = next;
      rebuildDrift();
      if (mode === 'travelling') smooth();
      if (!params.enabled) holdOff();
    },
    view(): AutopilotView {
      return {
        mode,
        route: route?.points,
        obstacles: route?.obstacles,
        impact: route?.impact,
        path,
        burst: path ? burstFrom(path, params.head.runUp) : undefined,
        carrot: path ? pointAt(path, carrot) : undefined,
        head,
        headVelocity,
        camera: camera.position,
        cameraTarget,
        card,
        target,
        countdown: mode === 'paused' ? Math.max(0, params.timing.idle - idle) : mode === 'focused' ? dwell : 0,
      };
    },
    dispose() {
      if (scene.pilot === pilot) scene.publish({ pilot: null, stir: null });
    },
  };
}
