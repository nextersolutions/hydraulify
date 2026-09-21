// Shut-off valve.
//
// Two triangles meeting at their tips, with a hand-operated stem on top: the
// form hydraulic and pneumatic schematics use for an isolating valve that is
// either fully open or fully closed and is not a control element. It is not a
// directional valve, and drawing one as a lever-operated 2/2 would claim spool
// positions the component does not have.
//
// Normally open by default -- an isolator stands open in service. A normally
// closed valve fills its triangles, the long-standing convention for "closed".

import { line, polygon } from '../shared/svg.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const STUB = 10;
const TRIANGLE = 16;
const WIDTH = STUB + 2 * TRIANGLE + STUB;
const CENTRE_X = WIDTH / 2;
const CENTRE_Y = 26;
const HALF_HEIGHT = 8;
const HEIGHT = CENTRE_Y + HALF_HEIGHT + 2;

export const type = 'shut_off_valve';

export const defaults = {
  normal_position: 'open',
};

export function geometry() {
  return {
    width: WIDTH,
    height: HEIGHT,
    ports: {
      inlet: port('inlet', 0, CENTRE_Y, 'left', { criticality: CRITICALITY.REQUIRED, label: 'IN' }),
      outlet: port('outlet', WIDTH, CENTRE_Y, 'right', { criticality: CRITICALITY.REQUIRED, label: 'OUT' }),
    },
    labelAnchor: labelBelow(WIDTH, HEIGHT, 12),
  };
}

export function draw({ config }) {
  const fill = config.normal_position === 'closed' ? 'currentColor' : 'none';
  const left = polygon(
    [[STUB, CENTRE_Y - HALF_HEIGHT], [STUB, CENTRE_Y + HALF_HEIGHT], [CENTRE_X, CENTRE_Y]],
    { cls: 'sym', fill },
  );
  const right = polygon(
    [[WIDTH - STUB, CENTRE_Y - HALF_HEIGHT], [WIDTH - STUB, CENTRE_Y + HALF_HEIGHT], [CENTRE_X, CENTRE_Y]],
    { cls: 'sym', fill },
  );
  const stubs = line(0, CENTRE_Y, STUB, CENTRE_Y, { cls: 'sym' })
    + line(WIDTH - STUB, CENTRE_Y, WIDTH, CENTRE_Y, { cls: 'sym' });
  // Hand-operated stem: a T-handle standing on the seat.
  const stem = line(CENTRE_X, CENTRE_Y, CENTRE_X, 8, { cls: 'sym' })
    + line(CENTRE_X - 7, 8, CENTRE_X + 7, 8, { cls: 'sym' });
  return left + right + stubs + stem;
}

export function describe({ config }) {
  return config.normal_position === 'closed' ? 'Shut-off valve, normally closed' : 'Shut-off valve';
}
