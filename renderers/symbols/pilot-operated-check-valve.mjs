// Pilot-operated check valve.
//
// A check valve plus a pilot piston that can force it open (or hold it shut)
// against its normal behaviour, drawn together inside a dash-dot enclosure to
// show they are one unit.
//
// This is one of the two load-holding components in the library. The pilot port
// is REQUIRED: a pilot-operated check with no pilot connected is just a check
// valve, and drawing it as this symbol would misrepresent the circuit.

import { line, rect, polyline } from '../shared/svg.mjs';
import { ballSeat } from './glyphs.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const WIDTH = 72;
const HEIGHT = 64;
const FLOW_Y = 22;
const BALL_X = 34;
const RADIUS = 7;

export const type = 'pilot_operated_check_valve';

export const defaults = {
  pilot_action: 'pilot_to_open',
  drained: false,
};

export function geometry() {
  return {
    width: WIDTH,
    height: HEIGHT,
    ports: {
      inlet: port('inlet', 0, FLOW_Y, 'left', { criticality: CRITICALITY.REQUIRED, label: 'A' }),
      outlet: port('outlet', WIDTH, FLOW_Y, 'right', { criticality: CRITICALITY.REQUIRED, label: 'B' }),
      pilot: port('pilot', BALL_X, HEIGHT, 'bottom', { criticality: CRITICALITY.REQUIRED, label: 'X' }),
    },
    labelAnchor: labelBelow(WIDTH, HEIGHT, 14),
  };
}

export function draw({ config }) {
  const enclosure = rect(1, 1, WIDTH - 2, HEIGHT - 2, { cls: 'enclosure' });
  const seatX = BALL_X - RADIUS - 1;
  const inletRun = line(0, FLOW_Y, seatX, FLOW_Y, { cls: 'sym' });
  const element = ballSeat(BALL_X, FLOW_Y, { radius: RADIUS, horizontal: true, freeFlow: 'right' });
  const outletRun = line(BALL_X + RADIUS, FLOW_Y, WIDTH, FLOW_Y, { cls: 'sym' });

  // Pilot piston: the pilot line acts on a plunger that unseats (or seats) the
  // ball. Drawn as a small rectangle on the pilot axis.
  const piston = rect(BALL_X - 7, HEIGHT - 26, 14, 9, { cls: 'sym' });
  const pilotLine = polyline(
    [[BALL_X, HEIGHT], [BALL_X, HEIGHT - 17]],
    { cls: 'pilot-line' },
  );
  const plunger = line(BALL_X, HEIGHT - 26, BALL_X, FLOW_Y + RADIUS + 1, { cls: 'sym' });

  // Pilot-to-close acts on the ball from the free-flow side instead.
  const direction = config.pilot_action === 'pilot_to_close'
    ? line(BALL_X - 10, FLOW_Y + RADIUS + 6, BALL_X + 10, FLOW_Y + RADIUS + 6, { cls: 'sym' })
    : '';

  const drain = config.drained
    ? polyline([[WIDTH - 14, HEIGHT - 20], [WIDTH - 6, HEIGHT - 20], [WIDTH - 6, HEIGHT - 6]], { cls: 'drain-line' })
    : '';

  return enclosure + inletRun + element + outletRun + piston + pilotLine + plunger + direction + drain;
}

export function describe({ config }) {
  const action = config.pilot_action === 'pilot_to_close' ? 'pilot-to-close' : 'pilot-to-open';
  return `Pilot-operated check valve (${action})`;
}
