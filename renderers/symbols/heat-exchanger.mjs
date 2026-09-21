// Heat exchanger: preheater or cooler.
//
// ISO 1219 draws a heater and a cooler as the same diamond. The process fluid
// enters and leaves at the left and right corners. What tells them apart is the
// direction of the two triangles inside: pointing in, heat is added (a heater);
// pointing out, heat is removed (a cooler). The heating or cooling medium, when
// drawn, connects at the top and bottom corners, which is ISO 1219's "with
// indication of the flow lines of the medium".
//
// One module draws both, because they are one symbol with one thing changed.
// The process side and the utility side are separate port groups: compressed
// air on one side and flue gas on the other is the whole point of the
// component, not a conflict. `utility_medium` fixes the utility side; unstated,
// it takes the fluid of whatever it is connected to.
//
// The caption sits in the top-right corner, the one place no port line can
// reach, because all four sides carry a connection.

import { line, polygon } from '../shared/svg.mjs';
import { port, CRITICALITY } from './contract.mjs';

const HALF = 22; // half-diagonal of the diamond
const STUB = 12;
const SIZE = 2 * (HALF + STUB);
const CENTRE = SIZE / 2;

export const type = 'heat_exchanger';

export const defaults = {
  function: 'heating',
};

export function geometry(config) {
  const utility = config.utility_medium ?? 'any';
  return {
    width: SIZE,
    height: SIZE,
    ports: {
      in: port('in', 0, CENTRE, 'left', { criticality: CRITICALITY.REQUIRED, label: 'IN', group: 'process' }),
      out: port('out', SIZE, CENTRE, 'right', { criticality: CRITICALITY.REQUIRED, label: 'OUT', group: 'process' }),
      utility_in: port('utility_in', CENTRE, SIZE, 'bottom', {
        criticality: CRITICALITY.EXPECTED, label: 'U1', medium: utility, group: 'utility',
      }),
      utility_out: port('utility_out', CENTRE, 0, 'top', {
        criticality: CRITICALITY.EXPECTED, label: 'U2', medium: utility, group: 'utility',
      }),
    },
    labelAnchor: { x: CENTRE + 14, y: 8, anchor: 'start' },
  };
}

export function draw({ config }) {
  const diamond = polygon([
    [CENTRE, CENTRE - HALF],
    [CENTRE + HALF, CENTRE],
    [CENTRE, CENTRE + HALF],
    [CENTRE - HALF, CENTRE],
  ], { cls: 'sym' });

  const stubs = line(0, CENTRE, CENTRE - HALF, CENTRE, { cls: 'sym' })
    + line(CENTRE + HALF, CENTRE, SIZE, CENTRE, { cls: 'sym' })
    + line(CENTRE, 0, CENTRE, CENTRE - HALF, { cls: 'sym' })
    + line(CENTRE, CENTRE + HALF, CENTRE, SIZE, { cls: 'sym' });

  // Two solid triangles on the vertical axis. Heating: both point at the centre.
  // Cooling: both point away from it.
  const tip = 5;
  const reach = 13; // distance from the centre to the far edge of each triangle
  const inward = config.function !== 'cooling';
  const triangle = (sign) => {
    const base = CENTRE + sign * reach;
    const point = CENTRE + sign * (reach - 8);
    const [from, to] = inward ? [base, point] : [point, base];
    return polygon([[CENTRE - tip, from], [CENTRE + tip, from], [CENTRE, to]], { cls: 'sym', fill: 'currentColor' });
  };

  return diamond + stubs + triangle(-1) + triangle(1);
}

export function describe({ config }) {
  const kind = config.function === 'cooling' ? 'Cooler (heat exchanger)' : 'Preheater (heat exchanger)';
  return config.utility_medium ? `${kind}, ${config.utility_medium.replace(/_/g, ' ')} side` : kind;
}
