// Junction (tee).
//
// Everything that branches off a line does so through one of these. Keeping the
// junction explicit is what lets connections stay strictly port-to-port: three
// lines meeting at a pump outlet would otherwise make the model ambiguous about
// where the tee physically is, and the renderer would have to invent a position
// for the dot.
//
// All four ports sit at the same point -- the dot itself. They differ only in the
// side a line approaches from, which is why they are named after those sides:
// J1.left, J1.right, J1.top, J1.bottom. Every port is optional individually; the
// domain validator instead checks that the junction's degree matches `config.way`.
//
// A junction is drawing topology, not a specified component, so it is excluded
// from the BOM. The validation report notes how many tee fittings the circuit
// implies rather than inventing part entries for them.

import { junctionDot } from './glyphs.mjs';
import { port, CRITICALITY } from './contract.mjs';

const SIZE = 8;
const CENTRE = SIZE / 2;

export const type = 'junction';

export const defaults = {
  way: 3,
};

export function geometry() {
  return {
    width: SIZE,
    height: SIZE,
    ports: {
      left: port('left', CENTRE, CENTRE, 'left', { criticality: CRITICALITY.OPTIONAL, label: '' }),
      right: port('right', CENTRE, CENTRE, 'right', { criticality: CRITICALITY.OPTIONAL, label: '' }),
      top: port('top', CENTRE, CENTRE, 'top', { criticality: CRITICALITY.OPTIONAL, label: '' }),
      bottom: port('bottom', CENTRE, CENTRE, 'bottom', { criticality: CRITICALITY.OPTIONAL, label: '' }),
    },
    // A junction carries no label: an identifier floating beside a dot is noise
    // on an engineering drawing.
    labelAnchor: null,
    excludeFromBom: true,
  };
}

export function draw() {
  return junctionDot(CENTRE, CENTRE);
}

export function describe({ config }) {
  return `${config.way}-way junction`;
}
