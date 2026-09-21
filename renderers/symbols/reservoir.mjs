// Reservoir (tank).
//
// ISO 1219 draws a vented reservoir as an open-topped vessel: three sides, no lid.
// A pressurised reservoir is a closed rectangle.
//
// The drawing convention matters hydraulically and is reproduced here: the suction
// line runs down to below the fluid level, while a return line stops above it. A
// reader uses exactly that difference to tell the two apart.
//
// A circuit may legitimately show the same physical tank more than once to avoid
// dragging return lines across the drawing. `config.same_reservoir_as` records
// that, so validation and the BOM count one vessel rather than several.
//
// `liquid` fixes what the tank holds. Unstated, it holds any liquid and takes the
// fluid of the circuit it serves -- oil, for every circuit written before media
// existed. A compressed-air store's compensation basin states water.

import { line, polyline } from '../shared/svg.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const WIDTH = 76;
const HEIGHT = 48;
const OUTLET_X = 22;
const RETURN_X = 54;

export const type = 'reservoir';

export const defaults = {
  vented: true,
};

export function geometry(config) {
  const medium = config.liquid ?? 'liquid';
  return {
    width: WIDTH,
    height: HEIGHT,
    ports: {
      // Neither port is individually required: a tank may appear purely as a
      // source or purely as a sink. The domain validator separately requires that
      // a reservoir is connected to something. Liquid only: stored air is an
      // air receiver, which has its own symbol.
      outlet: port('outlet', OUTLET_X, 0, 'top', {
        criticality: CRITICALITY.OPTIONAL,
        medium,
        label: 'S',
      }),
      return: port('return', RETURN_X, 0, 'top', {
        criticality: CRITICALITY.OPTIONAL,
        medium,
        label: 'R',
        aliases: ['ret', 'T'],
      }),
    },
    labelAnchor: labelBelow(WIDTH, HEIGHT, 16),
  };
}

export function draw({ config }) {
  const inset = 6;
  const left = inset;
  const right = WIDTH - inset;
  const top = 8;
  const bottom = HEIGHT - inset;

  const vessel = config.vented
    // Open-topped: left wall, floor, right wall.
    ? polyline([[left, top], [left, bottom], [right, bottom], [right, top]], { cls: 'sym' })
    : polyline(
      [[left, top], [left, bottom], [right, bottom], [right, top], [left, top]],
      { cls: 'sym' },
    );

  // Suction pickup reaches down into the fluid; the return stops short of it.
  const suctionDrop = line(OUTLET_X, 0, OUTLET_X, bottom - 6, { cls: 'sym' });
  const returnDrop = line(RETURN_X, 0, RETURN_X, top + 10, { cls: 'sym' });

  return vessel + suctionDrop + returnDrop;
}

export function describe({ config }) {
  const content = config.liquid === 'water' ? 'Water' : 'Hydraulic';
  return config.vented === false ? `Pressurised ${content.toLowerCase()} reservoir` : `${content} reservoir`;
}
