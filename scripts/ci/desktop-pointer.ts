import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

type Point = { x: number; y: number };
type Pointer = Point & { screenX: number; screenY: number; trusted: boolean; target: boolean };
type Observation = {
  moved: Pointer | null;
  clicked: Pointer | null;
  events: unknown[];
  ready: boolean;
};

// Read without activating or repairing focus: a changed native target must fail.
export const safariPointerIdentityScript = String.raw`
function run(argv) {
  var pid = Number(argv[0]), windowId = Number(argv[1]), tabIndex = Number(argv[2]);
  var app = Application(pid), target = app.windows.byId(windowId);
  var state = { pid: pid, windowId: target.id(), tabIndex: target.currentTab().index(),
    frontmost: app.frontmost(), frontWindowId: app.windows[0].id(),
    visible: target.visible(), minimized: target.miniaturized(), bounds: target.bounds() };
  if (!state.frontmost || state.frontWindowId !== windowId || state.windowId !== windowId ||
      state.tabIndex !== tabIndex || !state.visible || state.minimized)
    throw new Error('The owned Safari pointer target changed: ' + JSON.stringify(state));
  return JSON.stringify(state);
}`;

export type PointerBoundary = {
  evaluate<T>(expression: string): Promise<T>;
  identity(): Promise<{
    bounds: { x: number; y: number; width: number; height: number };
    [key: string]: unknown;
  }>;
  post(mode: 'move' | 'click', point: Point, evidence: Record<string, unknown>): Promise<void>;
  poll<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T>;
  record(evidence: Record<string, unknown>): Promise<void>;
};

// Observe only coordinates, trust and target membership. No text, URL or user data.
export function pointerObserver(key: string, selector: string, point: Point, screen: Point) {
  return `(() => {
    const key = ${JSON.stringify(key)}, selector = ${JSON.stringify(selector)};
    const point = ${JSON.stringify(point)}, screen = ${JSON.stringify(screen)};
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) throw new Error('The pointer target disappeared.');
    const initial = element.getBoundingClientRect();
    const geometry = () => { const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
    const state = globalThis[key] = { moved: null, clicked: null, events: [], geometry };
    state.ready = () => element.isConnected && document.querySelector(selector) === element &&
      ['x', 'y', 'width', 'height'].every(name => geometry()[name] === initial[name]) &&
      document.hasFocus() && document.visibilityState === 'visible' &&
      !!element.getClientRects().length && !element.matches(':disabled, [aria-disabled="true"]') &&
      element.contains(document.elementFromPoint(point.x, point.y));
    if (!state.ready()) throw new Error('The pointer target is obscured, unfocused or disconnected.');
    state.observe = event => {
      const value = { x: event.clientX, y: event.clientY, screenX: event.screenX, screenY: event.screenY,
        trusted: event.isTrusted, target: element.contains(event.target) };
      if (state.events.length < 16) state.events.push({ type: event.type, ...value });
      // An unrelated mousemove cannot calibrate the posted screen point.
      if (event.type === 'mousemove' && value.trusted && value.screenX === screen.x && value.screenY === screen.y)
        state.moved = value;
      if (event.type === 'mousedown' && !state.clicked) state.clicked = value;
    };
    addEventListener('mousemove', state.observe, true);
    addEventListener('mousedown', state.observe, true);
  })()`;
}

export async function clickSafariPointer(
  boundary: PointerBoundary,
  selector: string,
  point: Point,
) {
  const key = `__spinelPointer_${randomUUID().replaceAll('-', '')}`;
  const quoted = JSON.stringify(key);
  const evidence: Record<string, unknown> = {
    time: new Date().toISOString(),
    point,
    phase: 'identity',
  };
  let failure: unknown;
  let installed = false;
  const read = () =>
    boundary.evaluate<Observation>(`(() => {
    const state = globalThis[${quoted}];
    if (!state) throw new Error('The pointer observer document changed.');
    return { moved: state.moved, clicked: state.clicked, events: state.events, geometry: state.geometry(), ready: state.ready() };
  })()`);
  try {
    const identity = await boundary.identity();
    evidence.identity = identity;
    const { x, y, width, height } = identity.bounds;
    assert.ok([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0);
    const screen = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
    evidence.calibration = screen;
    evidence.phase = 'observer-install';
    // Cleanup also runs when installation fails after publishing the page marker.
    installed = true;
    await boundary.evaluate(pointerObserver(key, selector, point, screen));
    evidence.phase = 'move-post';
    const movePost = {};
    evidence.movePost = movePost;
    await boundary.post('move', screen, movePost);
    evidence.phase = 'move-observation';
    const movedState = await boundary.poll(
      read,
      (value) => !!value.moved,
      'Safari did not receive matching native pointer movement',
    );
    evidence.movement = movedState;
    const moved = movedState.moved!;
    assert.ok(moved.trusted);
    const click = { x: screen.x + point.x - moved.x, y: screen.y + point.y - moved.y };
    assert.ok([click.x, click.y].every(Number.isFinite));
    evidence.click = click;
    evidence.phase = 'target-revalidation';
    evidence.beforeClick = await boundary.identity();
    assert.deepEqual(evidence.beforeClick, identity, 'The owned Safari pointer window changed.');
    const beforeClick = await read();
    evidence.target = beforeClick;
    assert.ok(beforeClick.ready, 'The pointer target is no longer visible, focused or unobscured.');
    assert.equal(beforeClick.clicked, null, 'Unexpected input arrived before the native click.');
    evidence.phase = 'click-post';
    const clickPost = {};
    evidence.clickPost = clickPost;
    await boundary.post('click', click, clickPost);
    evidence.phase = 'click-observation';
    const clickedState = await boundary.poll(
      read,
      (value) => !!value.clicked,
      'Safari did not receive the native pointer click',
    );
    evidence.clickObservation = clickedState;
    const clicked = clickedState.clicked!;
    assert.ok(clicked.trusted && clicked.target, 'The native click did not reach the target.');
    assert.ok(
      Math.abs(clicked.x - point.x) <= 1 && Math.abs(clicked.y - point.y) <= 1,
      'The native click reached the wrong page coordinates.',
    );
    assert.ok(
      Math.abs(clicked.screenX - click.x) <= 1 && Math.abs(clicked.screenY - click.y) <= 1,
      'The observed click does not match the posted screen coordinates.',
    );
    evidence.phase = 'identity-revalidation';
    evidence.afterClick = await boundary.identity();
    assert.deepEqual(evidence.afterClick, identity, 'The owned Safari pointer window changed.');
    evidence.phase = 'delivered';
  } catch (error) {
    failure = error;
    evidence.error = String(error).slice(0, 2000);
  } finally {
    if (installed) {
      try {
        evidence.finalObservation = await read();
      } catch (error) {
        evidence.observationError = String(error).slice(0, 2000);
        failure ??= error;
      }
      try {
        await boundary.evaluate(`(() => {
          const state = globalThis[${quoted}];
          if (state) {
            removeEventListener('mousemove', state.observe, true);
            removeEventListener('mousedown', state.observe, true);
            delete globalThis[${quoted}];
          }
        })()`);
        evidence.observerRemoved = true;
      } catch (error) {
        evidence.cleanupError = String(error).slice(0, 2000);
        failure ??= error;
      }
    }
    evidence.status = failure ? 'failed' : 'passed';
    try {
      await boundary.record(evidence);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

// Quartz sends real native input; each short-lived helper owns at most two events.
// Do not CFRelease through JXA: a prior native crash followed a successful post.
export const safariPointerPostScript = String.raw`
        console.log('pointer: importing frameworks');
        ObjC.import('CoreGraphics');
        console.log('pointer: frameworks imported');
        function run(argv) {
          var point = { x: Number(argv[1]), y: Number(argv[2]) };
          console.log('pointer: preflight');
          if (typeof $.CGPreflightPostEventAccess !== 'function')
            ObjC.bindFunction('CGPreflightPostEventAccess', ['bool', []]);
          var permitted = $.CGPreflightPostEventAccess();
          console.log('pointer: post-event access ' + permitted);
          if (!permitted) throw new Error('The native input host is not permitted to post pointer events.');
          var types = argv[0] === 'move' ? [$.kCGEventMouseMoved] : [$.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp];
          types.forEach(function(type) {
            console.log('pointer: creating event ' + type);
            var event = $.CGEventCreateMouseEvent($(), type, point, $.kCGMouseButtonLeft);
            console.log('pointer: validating event ' + type);
            // CGEventRef is an opaque C pointer; JXA can expose Ref without ObjC's isNil.
            if (!event || (typeof event.isNil === 'function' && event.isNil()))
              throw new Error('Quartz did not return a nonnil bridged event: ' + Automation.getDisplayString(event, true));
            var actualType = Number($.CGEventGetType(event));
            if (actualType !== Number(type))
              throw new Error('Quartz event type differs: expected ' + type + ', received ' + actualType);
            var location = $.CGEventGetLocation(event);
            var actualPoint = { x: Number(location.x), y: Number(location.y) };
            console.log('pointer: validated event ' + actualType + ' at ' + JSON.stringify(actualPoint));
            if (actualPoint.x !== point.x || actualPoint.y !== point.y)
              throw new Error('Quartz event location differs: expected ' + JSON.stringify(point) + ', received ' + JSON.stringify(actualPoint));
            console.log('pointer: posting event ' + type);
            $.CGEventPost($.kCGHIDEventTap, event);
            console.log('pointer: posted event ' + type);
          });
          return JSON.stringify({ mode: argv[0], point: point, posted: types.length });
        }
`;
