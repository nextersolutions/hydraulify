// Counterbalance valve.
//
// The standard load-holding element: a pilot-assisted relief in one leg, holding
// an overrunning load, with a bypass check valve in the other leg giving free
// flow back toward the actuator. Both legs sit inside a dash-dot enclosure
// because they are one cartridge.
//
// Port naming reflects how it is installed:
//   inlet  - the directional valve side
//   outlet - the actuator (load) side
//   pilot  - external pilot, normally taken from the opposite actuator line
//
// Free flow runs inlet -> outlet through the check. Load-holding flow runs
// outlet -> inlet through the relief, which opens on the combination of its
// spring setting and the pilot pressure.

import { line, rect, polyline } from '../shared/svg.mjs';
import { spring, flowArrow, adjustmentArrow, ballSeat } from './glyphs.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const WIDTH = 96;
const HEIGHT = 84;
const PORT_X = 28;
const RELIEF = { x: 12, y: 24, size: 34 };
const CHECK_X = 70;

export const type = 'counterbalance_valve';

export const defaults = {
  pilot_type: 'external',
  vented: false,
};

export function geometry(config) {
  const ports = {
    inlet: port('inlet', PORT_X, HEIGHT, 'bottom', { criticality: CRITICALITY.REQUIRED, label: 'V' }),
    outlet: port('outlet', PORT_X, 0, 'top', { criticality: CRITICALITY.REQUIRED, label: 'C' }),
  };
  if (config.pilot_type !== 'internal') {
    // An external-pilot counterbalance valve that has no pilot connected cannot
    // perform its load-holding function as drawn, so this one is required.
    ports.pilot = port('pilot', 0, HEIGHT / 2, 'left', { criticality: CRITICALITY.REQUIRED, label: 'X' });
  }
  return { width: WIDTH, height: HEIGHT, ports, labelAnchor: labelBelow(WIDTH, HEIGHT, 14) };
}

export function draw({ config }) {
  const enclosure = rect(1, 1, WIDTH - 2, HEIGHT - 2, { cls: 'enclosure' });

  // Internal manifold: both legs share the inlet and outlet.
  const bottomRail = polyline([[PORT_X, HEIGHT], [PORT_X, HEIGHT - 12], [CHECK_X, HEIGHT - 12]], { cls: 'sym' });
  const topRail = polyline([[PORT_X, 0], [PORT_X, 12], [CHECK_X, 12]], { cls: 'sym' });

  // Relief leg: flow outlet -> inlet, i.e. downward in this drawing. The arrow is
  // offset from the port line because the leg is blocked until the valve opens.
  const envelope = rect(RELIEF.x, RELIEF.y, RELIEF.size, RELIEF.size, { cls: 'sym' });
  const arrowX = RELIEF.x + 11;
  const reliefArrow = flowArrow(arrowX, RELIEF.y + 4, arrowX, RELIEF.y + RELIEF.size - 4);
  const reliefStubs = line(PORT_X, 12, PORT_X, RELIEF.y, { cls: 'sym' })
    + line(PORT_X, RELIEF.y + RELIEF.size, PORT_X, HEIGHT - 12, { cls: 'sym' });

  const springGlyph = spring(RELIEF.x + RELIEF.size, RELIEF.y + RELIEF.size / 2, RELIEF.x + RELIEF.size + 16, RELIEF.y + RELIEF.size / 2, { coils: 3, amplitude: 4 });
  const adjustable = adjustmentArrow(
    RELIEF.x + RELIEF.size + 18, RELIEF.y + RELIEF.size / 2 + 12,
    RELIEF.x + RELIEF.size + 2, RELIEF.y + RELIEF.size / 2 - 12,
  );

  // Pilot: external pilot acts on the relief in parallel with the spring.
  const pilotLine = config.pilot_type === 'internal'
    ? polyline([[PORT_X, HEIGHT - 16], [6, HEIGHT - 16], [6, RELIEF.y + RELIEF.size / 2], [RELIEF.x, RELIEF.y + RELIEF.size / 2]], { cls: 'pilot-line' })
    : polyline([[0, HEIGHT / 2], [6, HEIGHT / 2], [6, RELIEF.y + RELIEF.size / 2], [RELIEF.x, RELIEF.y + RELIEF.size / 2]], { cls: 'pilot-line' });

  // Bypass check leg: free flow inlet -> outlet, i.e. upward.
  const checkRun = line(CHECK_X, HEIGHT - 12, CHECK_X, HEIGHT - 12, { cls: 'sym' });
  const ballY = HEIGHT / 2;
  const element = ballSeat(CHECK_X, ballY, { radius: 6, horizontal: false, freeFlow: 'up' });
  const checkLower = line(CHECK_X, HEIGHT - 12, CHECK_X, ballY + 7, { cls: 'sym' });
  const checkUpper = line(CHECK_X, ballY - 7, CHECK_X, 12, { cls: 'sym' });

  return enclosure + bottomRail + topRail + envelope + reliefArrow + reliefStubs
    + springGlyph + adjustable + pilotLine + checkRun + element + checkLower + checkUpper;
}

export function describe({ config }) {
  const pilot = {
    internal: 'internally piloted',
    external: 'externally piloted',
    internal_external: 'internally and externally piloted',
  }[config.pilot_type] ?? 'externally piloted';
  return `Counterbalance valve, ${pilot}`;
}
