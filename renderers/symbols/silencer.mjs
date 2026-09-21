// Silencer: exhaust to atmosphere.
//
// The end of a gas line. A turbine's exhaust, a relief valve venting air, a
// blow-off: wherever gas leaves the drawing into the open, it leaves through
// one of these. It is the gas-side counterpart of the reservoir's return port,
// and the validator treats it as the sink an air line must reach.
//
// Drawn as the pneumatic silencer: a box standing on the connection, hatched
// inside, with the open end facing away from the line.

import { line, rect } from '../shared/svg.mjs';
import { port, labelRight, CRITICALITY } from './contract.mjs';

const WIDTH = 28;
const STEM = 12;
const BOX = { x: 4, y: STEM, width: 20, height: 22 };
const HEIGHT = BOX.y + BOX.height;
const CENTRE_X = WIDTH / 2;

export const type = 'silencer';

export const defaults = {};

export function geometry() {
  return {
    width: WIDTH,
    height: HEIGHT,
    ports: {
      inlet: port('inlet', CENTRE_X, 0, 'top', { criticality: CRITICALITY.REQUIRED, label: 'IN', medium: 'gas' }),
    },
    labelAnchor: labelRight(WIDTH, HEIGHT),
  };
}

export function draw() {
  const right = BOX.x + BOX.width;
  const bottom = BOX.y + BOX.height;
  return line(CENTRE_X, 0, CENTRE_X, BOX.y, { cls: 'sym' })
    + rect(BOX.x, BOX.y, BOX.width, BOX.height, { cls: 'sym' })
    // Hatching: the porous element the gas passes through.
    + line(BOX.x, bottom - 6, BOX.x + 6, bottom, { cls: 'sym' })
    + line(BOX.x, BOX.y + 8, right - 6, bottom, { cls: 'sym' })
    + line(BOX.x + 6, BOX.y, right, bottom - 8, { cls: 'sym' })
    + line(right - 6, BOX.y, right, BOX.y + 6, { cls: 'sym' });
}

export function describe() {
  return 'Silencer (exhaust to atmosphere)';
}
