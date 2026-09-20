// Filter / strainer.
//
// ISO 1219: a square standing on one corner, with a dashed line across it
// perpendicular to the flow path representing the element.
//
// `config.position` records whether the author intended suction, return or
// pressure filtration. It is declared rather than inferred, and the domain
// validator cross-checks it against the line types actually connected -- a
// "suction filter" wired into a pressure line is a real mistake worth reporting.

import { line, polygon } from '../shared/svg.mjs';
import { ballSeat } from './glyphs.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const WIDTH = 54;
const HEIGHT = 54;
const CENTRE = 27;
const HALF = 23;

export const type = 'filter';

export const defaults = {
  with_bypass: false,
  with_indicator: false,
};

export function geometry() {
  return {
    width: WIDTH,
    height: HEIGHT,
    ports: {
      inlet: port('inlet', 0, CENTRE, 'left', { criticality: CRITICALITY.REQUIRED, label: 'A' }),
      outlet: port('outlet', WIDTH, CENTRE, 'right', { criticality: CRITICALITY.REQUIRED, label: 'B' }),
    },
    labelAnchor: labelBelow(WIDTH, HEIGHT, 12),
  };
}

export function draw({ config }) {
  const body = polygon(
    [[CENTRE, CENTRE - HALF], [CENTRE + HALF, CENTRE], [CENTRE, CENTRE + HALF], [CENTRE - HALF, CENTRE]],
    { cls: 'sym' },
  );
  // Element: dashed, perpendicular to the horizontal flow path.
  const element = line(CENTRE, CENTRE - 14, CENTRE, CENTRE + 14, { cls: 'sym element-dash' });
  const inletStub = line(0, CENTRE, CENTRE - HALF, CENTRE, { cls: 'sym' });
  const outletStub = line(CENTRE + HALF, CENTRE, WIDTH, CENTRE, { cls: 'sym' });

  // Bypass check across the element, opening when the element clogs.
  const bypass = config.with_bypass
    ? line(CENTRE - HALF + 4, CENTRE - 18, CENTRE - 6, CENTRE - 18, { cls: 'sym' })
      + ballSeat(CENTRE, CENTRE - 18, { radius: 5, horizontal: true, freeFlow: 'right' })
      + line(CENTRE + 6, CENTRE - 18, CENTRE + HALF - 4, CENTRE - 18, { cls: 'sym' })
      + line(CENTRE - HALF + 4, CENTRE - 18, CENTRE - HALF + 4, CENTRE, { cls: 'sym' })
      + line(CENTRE + HALF - 4, CENTRE - 18, CENTRE + HALF - 4, CENTRE, { cls: 'sym' })
    : '';

  return body + element + inletStub + outletStub + bypass;
}

export function describe({ config }) {
  const position = {
    suction: 'Suction filter',
    return: 'Return-line filter',
    pressure: 'Pressure-line filter',
  }[config.position] ?? 'Hydraulic filter';
  const extras = [
    config.with_bypass ? 'bypass valve' : null,
    config.with_indicator ? 'clogging indicator' : null,
  ].filter(Boolean);
  return extras.length ? `${position} with ${extras.join(' and ')}` : position;
}
