// Flow control valve.
//
// Four forms, because the difference between them changes circuit behaviour:
//   fixed_throttle        - a plain restriction
//   variable_throttle     - adjustable restriction
//   one_way               - adjustable restriction bypassed by a check valve, so
//                           it meters in one direction and passes freely in the other
//   pressure_compensated  - restriction held at constant pressure drop
//
// Whether the valve meters into or out of an actuator is a property of where it
// is placed in the circuit, not of the component, so it is never encoded here.

import { line, rect, polyline } from '../shared/svg.mjs';
import { restriction, adjustmentArrow, ballSeat } from './glyphs.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const PLAIN = { width: 58, height: 44 };
const BOXED = { width: 72, height: 66 };

export const type = 'flow_control_valve';

export const defaults = {
  flow_control_type: 'variable_throttle',
  free_flow_direction: 'outlet_to_inlet',
};

function frameFor(config) {
  return config.flow_control_type === 'one_way' || config.flow_control_type === 'pressure_compensated'
    ? BOXED
    : PLAIN;
}

export function geometry(config) {
  const frame = frameFor(config);
  const flowY = config.flow_control_type === 'one_way' ? 20 : frame.height / 2;
  return {
    width: frame.width,
    height: frame.height,
    ports: {
      inlet: port('inlet', 0, flowY, 'left', { criticality: CRITICALITY.REQUIRED, label: 'A' }),
      outlet: port('outlet', frame.width, flowY, 'right', { criticality: CRITICALITY.REQUIRED, label: 'B' }),
    },
    labelAnchor: labelBelow(frame.width, frame.height, 14),
  };
}

export function draw({ config }) {
  const frame = frameFor(config);
  const kind = config.flow_control_type;

  if (kind === 'fixed_throttle' || kind === 'variable_throttle') {
    const centreY = frame.height / 2;
    const centreX = frame.width / 2;
    const run = line(0, centreY, frame.width, centreY, { cls: 'sym' });
    const pinch = restriction(centreX, centreY, { width: 16, height: 11 });
    const adjustable = kind === 'variable_throttle'
      ? adjustmentArrow(centreX - 16, centreY + 16, centreX + 14, centreY - 16)
      : '';
    return run + pinch + adjustable;
  }

  if (kind === 'pressure_compensated') {
    const centreY = frame.height / 2;
    const centreX = frame.width / 2;
    const enclosure = rect(1, 1, frame.width - 2, frame.height - 2, { cls: 'enclosure' });
    const run = line(0, centreY, frame.width, centreY, { cls: 'sym' });
    const pinch = restriction(centreX, centreY, { width: 16, height: 11 });
    const adjustable = adjustmentArrow(centreX - 16, centreY + 18, centreX + 14, centreY - 18);
    // Compensator: a pressure-sensing line acting to hold the drop constant.
    const compensator = polyline(
      [[centreX + 20, centreY], [centreX + 20, frame.height - 10], [centreX - 20, frame.height - 10], [centreX - 20, centreY]],
      { cls: 'pilot-line' },
    );
    return enclosure + run + pinch + adjustable + compensator;
  }

  // one_way: metered leg on top, free-flow check leg below.
  const enclosure = rect(1, 1, frame.width - 2, frame.height - 2, { cls: 'enclosure' });
  const meterY = 20;
  const bypassY = 48;
  const centreX = frame.width / 2;
  const freeFlowRight = config.free_flow_direction === 'inlet_to_outlet';

  const inletRail = polyline([[0, meterY], [8, meterY], [8, bypassY], [18, bypassY]], { cls: 'sym' });
  const outletRail = polyline([[frame.width, meterY], [frame.width - 8, meterY], [frame.width - 8, bypassY], [frame.width - 18, bypassY]], { cls: 'sym' });
  const meterRun = line(8, meterY, frame.width - 8, meterY, { cls: 'sym' });
  const pinch = restriction(centreX, meterY, { width: 14, height: 9 });
  const adjustable = adjustmentArrow(centreX - 14, meterY + 13, centreX + 12, meterY - 13);

  const element = ballSeat(centreX, bypassY, {
    radius: 6,
    horizontal: true,
    freeFlow: freeFlowRight ? 'right' : 'left',
  });
  const bypassLeft = line(18, bypassY, centreX - 7, bypassY, { cls: 'sym' });
  const bypassRight = line(centreX + 7, bypassY, frame.width - 18, bypassY, { cls: 'sym' });

  return enclosure + inletRail + outletRail + meterRun + pinch + adjustable
    + element + bypassLeft + bypassRight;
}

export function describe({ config }) {
  return {
    fixed_throttle: 'Fixed throttle (flow restrictor)',
    variable_throttle: 'Variable throttle valve',
    one_way: 'One-way (meter-controlled) flow control valve with bypass check',
    pressure_compensated: 'Pressure-compensated flow control valve',
  }[config.flow_control_type] ?? 'Flow control valve';
}
