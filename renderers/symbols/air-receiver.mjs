// Air receiver.
//
// ISO 1219 draws a pneumatic reservoir as a horizontal capsule. It is the gas
// counterpart of the hydraulic reservoir: a store, not a line component.
//
// Two connections by default, charged through one and drawn from through the
// other, which is how a compressed-air store sits between compressor and
// turbine. `single_port` gives it one connection instead, for a bottle that is
// both filled and emptied through the same line -- a nitrogen back-up bottle on
// an oil accumulator's gas side.
//
// The gas is air or nitrogen; `gas` fixes which. A nitrogen receiver is named a
// nitrogen bottle in the parts list, because that is what gets ordered.

import { line, rect } from '../shared/svg.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const STUB = 10;
const BODY = { width: 64, height: 30 };
const WIDTH = STUB + BODY.width + STUB;
const HEIGHT = BODY.height + 4;
const CENTRE_Y = HEIGHT / 2;

export const type = 'air_receiver';

export const defaults = {};

export function geometry(config) {
  const medium = config.gas ?? ['air', 'nitrogen'];
  const ports = config.single_port
    ? { port: port('port', 0, CENTRE_Y, 'left', { criticality: CRITICALITY.REQUIRED, label: 'P', medium }) }
    : {
      inlet: port('inlet', 0, CENTRE_Y, 'left', { criticality: CRITICALITY.EXPECTED, label: 'IN', medium }),
      outlet: port('outlet', WIDTH, CENTRE_Y, 'right', { criticality: CRITICALITY.EXPECTED, label: 'OUT', medium }),
    };
  return { width: WIDTH, height: HEIGHT, ports, labelAnchor: labelBelow(WIDTH, HEIGHT) };
}

export function draw({ config }) {
  const body = rect(STUB, 2, BODY.width, BODY.height, { cls: 'sym', rx: BODY.height / 2 });
  const inletStub = line(0, CENTRE_Y, STUB, CENTRE_Y, { cls: 'sym' });
  const outletStub = config.single_port ? '' : line(STUB + BODY.width, CENTRE_Y, WIDTH, CENTRE_Y, { cls: 'sym' });
  return body + inletStub + outletStub;
}

export function describe({ config }) {
  return config.gas === 'nitrogen' ? 'Nitrogen bottle' : 'Air receiver';
}
