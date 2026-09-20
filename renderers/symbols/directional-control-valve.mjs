// Directional control valve.
//
// A 4/3 valve is three abutting envelopes, each containing the real flow paths of
// that spool position -- never one labelled box. An engineer reads the spool
// condition straight off those internal paths, so a wrong arrow is a wrong
// circuit, silently. That is why every path here is drawn explicitly and the
// centre conditions are enumerated rather than generated.
//
// Port placement follows the standard convention: external ports attach to the
// envelope that is aligned with them at rest. With a spring at one end, the spool
// is pushed away from that end, so the envelope next to the spring is the rest
// position; with springs at both ends (centred), it is the middle envelope.
//
// Drawing conventions fixed here and documented in references/symbols.md:
//   - P bottom-left, T bottom-right, A top-left, B top-right
//   - on multi-position valves the leftmost working envelope is PARALLEL
//     (P->A, B->T) and the rightmost is CROSSED (P->B, A->T)

import { line, polyline, rect } from '../shared/svg.mjs';
import { flowArrow, flowPath, blockedStub, actuationGlyph, actuationSpring, ACTUATION_WIDTH } from './glyphs.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const ENVELOPE = 40;
const SPRING_WIDTH = 20;

// Port offsets inside a single envelope.
const PORT_X = { P: 12, T: 28, A: 12, B: 28 };
const CENTRE_PORT_X = 20;

export const type = 'directional_control_valve';

export const defaults = {
  configuration: '4/3',
  center_condition: 'closed',
  normal_position: 'closed',
  actuation: { left: 'lever', right: 'none', spring: 'centred' },
};

function positionCount(configuration) {
  return configuration === '4/3' ? 3 : 2;
}

function portCount(configuration) {
  return configuration.startsWith('4') ? 4 : (configuration === '3/2' ? 3 : 2);
}

function actuationOf(config) {
  return { ...defaults.actuation, ...(config.actuation ?? {}) };
}

function springEnds(config) {
  const { spring } = actuationOf(config);
  return {
    left: spring === 'centred' || spring === 'left_return',
    right: spring === 'centred' || spring === 'right_return',
  };
}

function endWidths(config) {
  const actuation = actuationOf(config);
  const springs = springEnds(config);
  const width = (hasActuator, hasSpring) => (hasActuator ? ACTUATION_WIDTH : 0) + (hasSpring ? SPRING_WIDTH : 0);
  return {
    left: width(actuation.left !== 'none', springs.left),
    right: width(actuation.right !== 'none', springs.right),
  };
}

/** Index of the envelope the external ports attach to. */
function normalIndex(config) {
  const positions = positionCount(config.configuration);
  const { spring } = actuationOf(config);
  if (positions === 3) return 1;
  if (spring === 'left_return') return 0;
  if (spring === 'right_return') return positions - 1;
  return 0;
}

export function geometry(config) {
  const positions = positionCount(config.configuration);
  const ends = endWidths(config);
  const blockX = ends.left;
  const width = ends.left + positions * ENVELOPE + ends.right;
  const envelopeX = blockX + normalIndex(config) * ENVELOPE;
  const ways = portCount(config.configuration);

  const ports = {};
  if (ways === 2) {
    ports.P = port('P', envelopeX + CENTRE_PORT_X, ENVELOPE, 'bottom', { criticality: CRITICALITY.REQUIRED });
    ports.A = port('A', envelopeX + CENTRE_PORT_X, 0, 'top', { criticality: CRITICALITY.REQUIRED });
  } else if (ways === 3) {
    ports.P = port('P', envelopeX + PORT_X.P, ENVELOPE, 'bottom', { criticality: CRITICALITY.REQUIRED });
    ports.T = port('T', envelopeX + PORT_X.T, ENVELOPE, 'bottom', { criticality: CRITICALITY.REQUIRED });
    ports.A = port('A', envelopeX + CENTRE_PORT_X, 0, 'top', { criticality: CRITICALITY.REQUIRED });
  } else {
    ports.P = port('P', envelopeX + PORT_X.P, ENVELOPE, 'bottom', { criticality: CRITICALITY.REQUIRED });
    ports.T = port('T', envelopeX + PORT_X.T, ENVELOPE, 'bottom', { criticality: CRITICALITY.REQUIRED });
    // A four-way valve is sometimes deliberately used as a three-way with one
    // working port plugged, so an unconnected working port is a warning the
    // author can silence with an explicit `plugged`, not a hard error.
    ports.A = port('A', envelopeX + PORT_X.A, 0, 'top', { criticality: CRITICALITY.EXPECTED });
    ports.B = port('B', envelopeX + PORT_X.B, 0, 'top', { criticality: CRITICALITY.EXPECTED });
  }

  return {
    width,
    height: ENVELOPE,
    ports,
    portLabels: true,
    labelAnchor: labelBelow(width, ENVELOPE, 30),
  };
}

// --- internal flow path sets -------------------------------------------------
// Each returns SVG for one envelope, in that envelope's local coordinates.

function pathsParallel() {
  return flowArrow(PORT_X.P, ENVELOPE, PORT_X.A, 0)
    + flowArrow(PORT_X.B, 0, PORT_X.T, ENVELOPE);
}

function pathsCrossed() {
  return flowArrow(PORT_X.P, ENVELOPE, PORT_X.B, 0)
    + flowArrow(PORT_X.A, 0, PORT_X.T, ENVELOPE);
}

function centreClosed() {
  return blockedStub(PORT_X.P, ENVELOPE, 'bottom')
    + blockedStub(PORT_X.T, ENVELOPE, 'bottom')
    + blockedStub(PORT_X.A, 0, 'top')
    + blockedStub(PORT_X.B, 0, 'top');
}

function centreOpen() {
  // All four ports interconnected.
  const mid = ENVELOPE / 2;
  return line(PORT_X.P, ENVELOPE, PORT_X.A, 0, { cls: 'sym' })
    + line(PORT_X.T, ENVELOPE, PORT_X.B, 0, { cls: 'sym' })
    + line(PORT_X.P, mid, PORT_X.T, mid, { cls: 'sym' });
}

function centreTandem() {
  // P connected to T; both working ports blocked.
  const mid = ENVELOPE / 2 + 6;
  return flowPath([[PORT_X.P, ENVELOPE], [PORT_X.P, mid], [PORT_X.T, mid], [PORT_X.T, ENVELOPE]])
    + blockedStub(PORT_X.A, 0, 'top')
    + blockedStub(PORT_X.B, 0, 'top');
}

function centreFloat() {
  // A, B and T interconnected; P blocked.
  const mid = ENVELOPE / 2 - 4;
  return polyline([[PORT_X.A, 0], [PORT_X.A, mid], [PORT_X.B, mid], [PORT_X.B, 0]], { cls: 'sym' })
    + flowPath([[PORT_X.B, mid], [PORT_X.T, ENVELOPE]])
    + blockedStub(PORT_X.P, ENVELOPE, 'bottom');
}

const CENTRES = {
  closed: centreClosed,
  open: centreOpen,
  tandem: centreTandem,
  float: centreFloat,
};

function threeWayFlowing() {
  // P -> A, tank blocked.
  const mid = ENVELOPE / 2;
  return flowPath([[PORT_X.P, ENVELOPE], [PORT_X.P, mid], [CENTRE_PORT_X, mid], [CENTRE_PORT_X, 0]])
    + blockedStub(PORT_X.T, ENVELOPE, 'bottom');
}

function threeWayVenting() {
  // A -> T, pressure blocked.
  const mid = ENVELOPE / 2;
  return flowPath([[CENTRE_PORT_X, 0], [CENTRE_PORT_X, mid], [PORT_X.T, mid], [PORT_X.T, ENVELOPE]])
    + blockedStub(PORT_X.P, ENVELOPE, 'bottom');
}

function twoWayOpen() {
  return flowArrow(CENTRE_PORT_X, ENVELOPE, CENTRE_PORT_X, 0);
}

function twoWayClosed() {
  return blockedStub(CENTRE_PORT_X, ENVELOPE, 'bottom')
    + blockedStub(CENTRE_PORT_X, 0, 'top');
}

/**
 * The flow-path set for each envelope, left to right.
 * The envelope at normalIndex carries the rest condition.
 */
function envelopeContents(config) {
  const positions = positionCount(config.configuration);
  const ways = portCount(config.configuration);
  const rest = normalIndex(config);

  if (ways === 2) {
    const normalIsOpen = config.normal_position === 'open';
    return Array.from({ length: positions }, (_unused, index) => (
      (index === rest) === normalIsOpen ? twoWayOpen : twoWayClosed
    ));
  }

  if (ways === 3) {
    const normalIsOpen = config.normal_position === 'open';
    return Array.from({ length: positions }, (_unused, index) => (
      (index === rest) === normalIsOpen ? threeWayFlowing : threeWayVenting
    ));
  }

  if (positions === 2) {
    // Rest envelope parallel, actuated envelope crossed.
    return Array.from({ length: 2 }, (_unused, index) => (index === rest ? pathsParallel : pathsCrossed));
  }

  return [pathsParallel, CENTRES[config.center_condition] ?? centreClosed, pathsCrossed];
}

export function draw({ config }) {
  const positions = positionCount(config.configuration);
  const ends = endWidths(config);
  const blockX = ends.left;
  const actuation = actuationOf(config);
  const springs = springEnds(config);

  const frames = [];
  const contents = envelopeContents(config);
  for (let index = 0; index < positions; index += 1) {
    const x = blockX + index * ENVELOPE;
    frames.push(rect(x, 0, ENVELOPE, ENVELOPE, { cls: 'sym' }));
    // Each envelope's paths are drawn in envelope-local coordinates and then
    // translated, so a path set never needs to know which position it occupies.
    frames.push(`<g transform="translate(${x} 0)">${contents[index]()}</g>`);
  }

  const ends_ = [];
  if (actuation.left !== 'none') {
    ends_.push(actuationGlyph(actuation.left, 0, 0, ENVELOPE, 'right'));
  }
  if (springs.left) {
    const springX = actuation.left !== 'none' ? ACTUATION_WIDTH : 0;
    ends_.push(actuationSpring(springX, 0, ENVELOPE, 'left'));
  }
  const rightEndX = blockX + positions * ENVELOPE;
  if (springs.right) {
    ends_.push(actuationSpring(rightEndX, 0, ENVELOPE, 'right'));
  }
  if (actuation.right !== 'none') {
    const actuatorX = rightEndX + (springs.right ? SPRING_WIDTH : 0);
    ends_.push(actuationGlyph(actuation.right, actuatorX, 0, ENVELOPE, 'left'));
  }

  return frames.join('') + ends_.join('');
}

export function describe({ config }) {
  const actuation = actuationOf(config);
  const readable = {
    solenoid: 'solenoid operated',
    solenoid_pilot: 'solenoid pilot operated',
    lever: 'lever operated',
    push_button: 'push-button operated',
    pedal: 'pedal operated',
    mechanical: 'mechanically operated',
    pilot: 'hydraulically piloted',
    pneumatic_pilot: 'pneumatically piloted',
    none: null,
  };
  const operators = [readable[actuation.left], readable[actuation.right]].filter(Boolean);
  const double = operators.length === 2 && operators[0] === operators[1]
    ? [`double ${operators[0]}`]
    : operators;
  const springText = {
    centred: 'spring centred',
    left_return: 'spring return',
    right_return: 'spring return',
    none: null,
  }[actuation.spring];

  const centre = config.configuration === '4/3' ? `${config.center_condition} centre, ` : '';
  const qualifiers = [...new Set([...double, springText].filter(Boolean))].join(', ');
  return `${config.configuration} directional control valve, ${centre}${qualifiers}`.replace(/, $/, '');
}
