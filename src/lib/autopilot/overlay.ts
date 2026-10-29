/*
 * The autopilot's debug overlay, a 2D canvas over the stage, drawn in the stage's draw phase so
 * it matches what the canvas laid out that frame. It shows the cards the route keeps clear of,
 * grown by the clearance, the route as planned, the path it was rounded into (endings, the
 * corners between and the head's burst apart), where the head strikes the card and the edge's
 * normal there, the carrot, the head and its velocity, the camera's aim, the view's middle, the
 * card in focus and the next one, and the autopilot's mode with its countdown. It is for
 * development only, like the tuning panel it adds its switches to: the page imports it behind
 * `import.meta.env.DEV`, so production builds leave it out, its canvas included.
 */
import type { Scene } from '../scene';
import { addSection, storedParams } from '../tuning';
import type { AutopilotView } from './director';
import { cardBox, type CardRef, type Point } from './model';

/** What the overlay shows. */
export interface DebugParams {
  enabled: boolean;
  /** The cards the route keeps clear of, grown by the clearance. */
  obstacles: boolean;
  route: boolean;
  path: boolean;
  agents: boolean;
}

export const DEFAULT_DEBUG_PARAMS: DebugParams = {
  enabled: false,
  obstacles: true,
  route: true,
  path: true,
  agents: true,
};

/** Changed whenever the switches change meaning, so an older tuning never overrides new defaults. */
const STORAGE_KEY = 'tweakpad:autopilot-debug:1';

const COLORS = {
  obstacle: 'rgba(255, 255, 255, 0.28)',
  impact: '#ff4dd2',
  route: '#ff4d4d',
  ending: '#ffb020',
  hall: '#30d5ff',
  carrot: '#ffffff',
  head: '#b48cff',
  aim: '#4dff88',
  view: 'rgba(255, 255, 255, 0.6)',
  card: '#4dff88',
  target: '#ffd84d',
  text: '#ffffff',
};

/**
 * Puts the overlay on the stage, just after `anchor`, and its switches in the tuning panel.
 * Returns its removal.
 */
export function mountOverlay(anchor: Element, scene: Scene, autopilot: { view(): AutopilotView }) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  // Over everything on the stage, the sidebar included, and never in the way.
  canvas.style.cssText = 'position:absolute;z-index:3;inset:0;inline-size:100%;block-size:100%;pointer-events:none';
  anchor.after(canvas);
  const debug = storedParams(STORAGE_KEY, DEFAULT_DEBUG_PARAMS);
  const context = canvas.getContext('2d');
  let cancel: (() => void) | undefined;
  let disposed = false;

  const draw = () => {
    cancel = undefined;
    if (disposed || !context) return;
    canvas.hidden = !debug.enabled;
    if (!debug.enabled) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const [px, py] = scene.pan;
    const layout = scene.layout;
    const view = autopilot.view();
    const at = (point: Point): Point => [point[0] + px, point[1] + py];
    const line = (points: readonly Point[], color: string, widthPx: number, dash: number[] = []) => {
      if (points.length < 2) return;
      context.strokeStyle = color;
      context.lineWidth = widthPx;
      context.setLineDash(dash);
      context.beginPath();
      points.forEach((point, i) => (i ? context.lineTo(...at(point)) : context.moveTo(...at(point))));
      context.stroke();
      context.setLineDash([]);
    };
    const dot = (point: Point, radius: number, color: string) => {
      context.fillStyle = color;
      context.beginPath();
      context.arc(...at(point), radius, 0, Math.PI * 2);
      context.fill();
    };
    const outline = (ref: CardRef | undefined, color: string) => {
      const box = ref && layout && cardBox(layout, ref);
      if (!box) return;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.strokeRect(box.x + px, box.y + py, box.w, box.h);
    };

    if (debug.obstacles && view.obstacles) {
      context.strokeStyle = COLORS.obstacle;
      context.lineWidth = 1;
      context.setLineDash([4, 6]);
      for (const box of view.obstacles) context.strokeRect(box.x + px, box.y + py, box.w, box.h);
      context.setLineDash([]);
    }
    if (debug.route && view.route) line(view.route, COLORS.route, 2);
    if (debug.path && view.path) {
      const path = view.path;
      for (let i = 1; i < path.s.length; i += 1) {
        line(
          [
            [path.xs[i - 1]!, path.ys[i - 1]!],
            [path.xs[i]!, path.ys[i]!],
          ],
          path.s[i]! > (view.burst ?? Infinity) ? COLORS.impact : path.ending[i] ? COLORS.ending : COLORS.hall,
          2.5,
        );
      }
    }
    if (debug.agents) {
      if (view.impact) {
        const { contact, normal } = view.impact;
        dot(contact, 5, COLORS.impact);
        line([contact, [contact[0] + normal[0] * 28, contact[1] + normal[1] * 28]], COLORS.impact, 2);
      }
      outline(view.card, COLORS.card);
      outline(view.target, COLORS.target);
      if (view.carrot) dot(view.carrot, 4, COLORS.carrot);
      dot(view.head, 7, COLORS.head);
      line([view.head, [view.head[0] + view.headVelocity[0] * 0.15, view.head[1] + view.headVelocity[1] * 0.15]], COLORS.head, 2);
      const [ax, ay] = at(view.cameraTarget);
      context.strokeStyle = COLORS.aim;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(ax - 9, ay - 9);
      context.lineTo(ax + 9, ay + 9);
      context.moveTo(ax + 9, ay - 9);
      context.lineTo(ax - 9, ay + 9);
      context.stroke();
      const [vx, vy] = at(view.camera);
      context.strokeStyle = COLORS.view;
      context.beginPath();
      context.arc(vx, vy, 14, 0, Math.PI * 2);
      context.moveTo(vx - 22, vy);
      context.lineTo(vx + 22, vy);
      context.moveTo(vx, vy - 22);
      context.lineTo(vx, vy + 22);
      context.stroke();
    }
    const [left, top] = scene.inset;
    context.font = '600 12px ui-monospace, monospace';
    context.fillStyle = COLORS.text;
    context.fillText(`${view.mode}  ${view.countdown > 0 ? view.countdown.toFixed(1) + 's' : ''}`, left + 16, top + 24);

    cancel = scene.requestFrame(draw, 'draw');
  };

  /** Draws again, every frame while the overlay is on. */
  const refresh = () => {
    if (!cancel && !disposed) cancel = scene.requestFrame(draw, 'draw');
  };
  const removeSection = addSection({
    key: STORAGE_KEY,
    title: 'Autopilot debug',
    params: debug,
    defaults: DEFAULT_DEBUG_PARAMS,
    literal: { name: 'DEFAULT_DEBUG_PARAMS', type: 'DebugParams' },
    apply: refresh,
    build(folder) {
      folder.addBinding(debug, 'enabled', { label: 'overlay' });
      folder.addBinding(debug, 'obstacles');
      folder.addBinding(debug, 'route');
      folder.addBinding(debug, 'path');
      folder.addBinding(debug, 'agents');
    },
  });
  refresh();

  return () => {
    disposed = true;
    cancel?.();
    removeSection();
    canvas.remove();
  };
}
