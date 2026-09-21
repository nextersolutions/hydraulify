// Boundary: where a line leaves the drawing.
//
// Not a part. A boundary says honestly that the drawing stops here and the line
// continues somewhere it does not show: heat from a thermal store, flue gas to
// the stack, cooling water from the plant supply, a line continued on another
// sheet. Without one, those lines would dangle, and a dangling line is
// indistinguishable from a forgotten one.
//
// Drawn as a flag with the name inside, pointed in the direction of flow:
// `from` points at its port, because the flow comes into the circuit there; `to`
// points away, because the flow leaves. The port is on the left; mirror it to
// put it on the right. A boundary may state its medium, and the validator treats
// it as a valid source or sink for that medium.
//
// It carries no tag and is left out of the parts list: nothing is bought.

import { polygon } from '../shared/svg.mjs';
import { uprightText } from './glyphs.mjs';
import { port, CRITICALITY } from './contract.mjs';

const HEIGHT = 20;
const POINT = 10;
const CHARACTER = 5.6; // average glyph advance at the caption size, for sizing
const PADDING = 12;

export const type = 'boundary';

export const defaults = {};

function widthFor(name) {
  return Math.max(56, Math.ceil((name ?? '').length * CHARACTER) + 2 * PADDING + POINT);
}

export function geometry(config) {
  const width = widthFor(config.name);
  return {
    width,
    height: HEIGHT,
    ports: {
      port: port('port', 0, HEIGHT / 2, 'left', {
        criticality: CRITICALITY.REQUIRED,
        label: '',
        medium: config.medium ?? 'any',
      }),
    },
    labelAnchor: null,
    excludeFromBom: true,
  };
}

export function draw({ config, geometry }) {
  const width = widthFor(config.name);
  const middle = HEIGHT / 2;
  const outline = config.direction === 'from'
    // Pointed at the port: flow enters the circuit here.
    ? polygon([[0, middle], [POINT, 0], [width, 0], [width, HEIGHT], [POINT, HEIGHT]], { cls: 'sym' })
    // Pointed away: flow leaves the drawing here.
    : polygon([[0, 0], [width - POINT, 0], [width, middle], [width - POINT, HEIGHT], [0, HEIGHT]], { cls: 'sym' });
  const centre = config.direction === 'from' ? (POINT + width) / 2 : (width - POINT) / 2;
  return outline + uprightText(centre, middle + 3.5, config.name ?? '', geometry?.mirrored, { cls: 'boundary-text' });
}

export function describe({ config }) {
  return `Boundary: ${config.direction === 'from' ? 'from' : 'to'} ${config.name ?? 'elsewhere'}`;
}
