// Symbol registry.
//
// The schema's componentType enum and this registry must agree exactly: a type
// the schema accepts but the registry cannot draw would reach the renderer and
// fail late, and a symbol with no schema entry is unreachable. test/symbols.test.mjs
// asserts the two sets are identical.

import * as reservoir from './reservoir.mjs';
import * as pump from './pump.mjs';
import * as motor from './motor.mjs';
import * as cylinder from './cylinder.mjs';
import * as directionalControlValve from './directional-control-valve.mjs';
import * as reliefValve from './relief-valve.mjs';
import * as checkValve from './check-valve.mjs';
import * as pilotOperatedCheckValve from './pilot-operated-check-valve.mjs';
import * as counterbalanceValve from './counterbalance-valve.mjs';
import * as flowControlValve from './flow-control-valve.mjs';
import * as filter from './filter.mjs';
import * as pressureGauge from './pressure-gauge.mjs';
import * as accumulator from './accumulator.mjs';
import * as junction from './junction.mjs';
import * as turbine from './turbine.mjs';
import * as compressor from './compressor.mjs';
import * as electricalMachine from './electrical-machine.mjs';
import * as heatExchanger from './heat-exchanger.mjs';
import * as airReceiver from './air-receiver.mjs';
import * as pressureRegulator from './pressure-regulator.mjs';
import * as shutOffValve from './shut-off-valve.mjs';
import * as silencer from './silencer.mjs';
import * as boundary from './boundary.mjs';

import { withDefaults, defaultedKeys } from './contract.mjs';

const MODULES = [
  reservoir,
  pump,
  motor,
  cylinder,
  directionalControlValve,
  reliefValve,
  checkValve,
  pilotOperatedCheckValve,
  counterbalanceValve,
  flowControlValve,
  filter,
  pressureGauge,
  accumulator,
  junction,
  turbine,
  compressor,
  electricalMachine,
  heatExchanger,
  airReceiver,
  pressureRegulator,
  shutOffValve,
  silencer,
  boundary,
];

export const SYMBOLS = new Map(MODULES.map((module) => [module.type, module]));

export const SUPPORTED_TYPES = MODULES.map((module) => module.type).sort();

export function getSymbol(type) {
  const symbol = SYMBOLS.get(type);
  if (!symbol) {
    throw new Error(
      `Unsupported component type "${type}". hydraulify draws: ${SUPPORTED_TYPES.join(', ')}. `
      + 'An unsupported type is refused rather than drawn as a labelled box, because a box '
      + 'that looks authoritative but communicates nothing is worse than an honest error.',
    );
  }
  return symbol;
}

/**
 * Resolve a component against its symbol: merged config, geometry, port table,
 * and the list of config keys that came from defaults rather than the author.
 */
const MIRRORED_SIDE = { left: 'right', right: 'left', top: 'top', bottom: 'bottom' };

/**
 * Mirror a port table horizontally.
 *
 * Needed by any in-line component that has to pass flow right-to-left -- a
 * return filter sitting between the circuit and a reservoir drawn on the left,
 * for instance. Without it the drawing would show oil entering through the
 * outlet, which states the wrong thing about the component.
 */
function mirrorPorts(ports, width) {
  const mirrored = {};
  for (const [name, definition] of Object.entries(ports)) {
    mirrored[name] = {
      ...definition,
      x: width - definition.x,
      side: MIRRORED_SIDE[definition.side],
    };
  }
  return mirrored;
}

export function resolveComponent(component) {
  const symbol = getSymbol(component.type);
  const config = withDefaults(symbol.defaults, component.config);
  const baseGeometry = symbol.geometry(config);
  const defaulted = defaultedKeys(symbol.defaults, component.config);
  const mirrored = component.mirror === true;

  const geometry = mirrored
    ? {
      ...baseGeometry,
      ports: mirrorPorts(baseGeometry.ports, baseGeometry.width),
      labelAnchor: baseGeometry.labelAnchor
        ? {
          ...baseGeometry.labelAnchor,
          x: baseGeometry.width - baseGeometry.labelAnchor.x,
          anchor: baseGeometry.labelAnchor.anchor === 'start'
            ? 'end'
            : (baseGeometry.labelAnchor.anchor === 'end' ? 'start' : 'middle'),
        }
        : baseGeometry.labelAnchor,
    }
    : baseGeometry;

  // Authored per-port overrides (plugged, label) are merged onto the symbol's
  // port table so downstream code reads one object.
  const ports = {};
  for (const [name, definition] of Object.entries(geometry.ports)) {
    const override = component.ports?.[name] ?? {};
    ports[name] = {
      ...definition,
      plugged: override.plugged === true,
      label: override.label ?? definition.label,
    };
  }

  return { symbol, config, geometry: { ...geometry, ports, mirrored }, ports, defaulted };
}

/**
 * Port lookup honouring aliases, so `C1.A` resolves to the cylinder's `cap` port.
 * Returns null when the name is unknown, which the validator reports with the
 * list of names the component actually has.
 */
export function findPort(ports, name) {
  if (ports[name]) return ports[name];
  for (const definition of Object.values(ports)) {
    if (definition.aliases?.includes(name)) return definition;
  }
  return null;
}
