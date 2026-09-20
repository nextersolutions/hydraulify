// Accumulator.
//
// A capsule standing on its port. The separating element distinguishes the type,
// and the type matters: a bladder and a spring accumulator behave differently and
// are specified differently, so the symbol says which one the author meant.

import { line, rect, path, polyline } from '../shared/svg.mjs';
import { spring } from './glyphs.mjs';
import { port, labelRight, CRITICALITY } from './contract.mjs';

const WIDTH = 46;
const HEIGHT = 68;
const BODY = { x: 5, y: 2, width: 36, height: 54 };
const CENTRE_X = 23;

export const type = 'accumulator';

export const defaults = {
  accumulator_type: 'bladder',
};

export function geometry() {
  return {
    width: WIDTH,
    height: HEIGHT,
    ports: {
      inlet: port('inlet', CENTRE_X, HEIGHT, 'bottom', { criticality: CRITICALITY.REQUIRED, label: 'A' }),
    },
    labelAnchor: labelRight(WIDTH, HEIGHT),
  };
}

function separator(kind) {
  const left = BODY.x + 3;
  const right = BODY.x + BODY.width - 3;
  switch (kind) {
    case 'bladder':
      // Gas bladder: a closed curve in the upper part of the shell.
      return path(
        `M ${left} ${BODY.y + 24} Q ${CENTRE_X} ${BODY.y + 2} ${right} ${BODY.y + 24} Q ${CENTRE_X} ${BODY.y + 34} ${left} ${BODY.y + 24} Z`,
        { cls: 'sym' },
      );
    case 'diaphragm':
      return path(
        `M ${left} ${BODY.y + 24} Q ${CENTRE_X} ${BODY.y + 6} ${right} ${BODY.y + 24}`,
        { cls: 'sym' },
      );
    case 'piston':
      return rect(left, BODY.y + 20, right - left, 7, { cls: 'sym' });
    case 'spring':
      return spring(CENTRE_X, BODY.y + 6, CENTRE_X, BODY.y + 26, { coils: 3, amplitude: 7 })
        + line(left, BODY.y + 27, right, BODY.y + 27, { cls: 'sym' });
    case 'weight':
      return rect(CENTRE_X - 10, BODY.y + 4, 20, 10, { cls: 'sym', fill: 'currentColor' })
        + line(left, BODY.y + 22, right, BODY.y + 22, { cls: 'sym' });
    default:
      return '';
  }
}

export function draw({ config }) {
  const shell = rect(BODY.x, BODY.y, BODY.width, BODY.height, { cls: 'sym', rx: 18 });
  const stem = line(CENTRE_X, BODY.y + BODY.height, CENTRE_X, HEIGHT, { cls: 'sym' });
  return shell + separator(config.accumulator_type) + stem;
}

export function describe({ config }) {
  const kind = {
    bladder: 'Bladder',
    piston: 'Piston',
    diaphragm: 'Diaphragm',
    spring: 'Spring-loaded',
    weight: 'Weight-loaded',
  }[config.accumulator_type] ?? 'Hydraulic';
  return `${kind} accumulator`;
}

export { polyline };
