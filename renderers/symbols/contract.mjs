// The symbol contract.
//
// A symbol module owns three things that must never drift apart: the size of its
// frame, the coordinates of its ports, and the graphics drawn inside that frame.
// Keeping them in one module is the whole reason symbols are code rather than SVG
// files with a separate port manifest -- a port that has drifted off its graphic
// is invisible in review and obvious only when a line detaches from the symbol.
//
// A symbol module exports:
//
//   type          string, matching the schema's componentType enum
//   defaults      config values applied when the author did not state them; every
//                 applied default becomes a recorded assumption, never a silent one
//   geometry(cfg) { width, height, ports, labelAnchor }
//   draw(ctx)     SVG string in LOCAL coordinates (origin = frame top-left). ctx
//                 carries config, geometry (with `mirrored`), component, and
//                 style: drawing conventions chosen for the whole model
//   describe(c)   human-readable BOM description
//
// Coordinates are local to the frame. The renderer translates the whole group to
// the component's authored `pos`, so a symbol never needs to know where it sits.

/**
 * Port criticality, which drives validation severity when a port is unconnected:
 *
 *   required - the component cannot function without it (cylinder cap/rod, pump
 *              inlet/outlet). Unconnected is an ERROR.
 *   expected - normally connected, but a circuit can be legitimately drawn without
 *              it. Unconnected is a WARNING.
 *   optional - routinely plugged in a real assembly (relief remote pilot, case
 *              drain on a gear pump). Unconnected is SILENT.
 */
export const CRITICALITY = Object.freeze({
  REQUIRED: 'required',
  EXPECTED: 'expected',
  OPTIONAL: 'optional',
});

/**
 * The fluids a line can carry, in resolution order: when a connected set of
 * ports would accept several, the first one allowed wins. Oil comes first so
 * that every model written before media existed resolves exactly as it always
 * meant to.
 */
export const MEDIA = Object.freeze(['oil', 'water', 'thermal_oil', 'air', 'nitrogen', 'steam', 'flue_gas']);

/**
 * What a port may declare as its medium: one fluid, a class of fluids, an
 * explicit list of fluids, or a shaft. `any` is the default because most of the
 * library -- valves, gauges, junctions -- works in whatever fluid it sits in. A
 * list is for the narrow cases no class describes: an accumulator's gas side is
 * air or nitrogen, never steam.
 */
export const MEDIUM_CLASSES = Object.freeze({
  any: MEDIA,
  liquid: Object.freeze(['oil', 'water', 'thermal_oil']),
  gas: Object.freeze(['air', 'nitrogen', 'steam', 'flue_gas']),
});

/** A shaft port. It carries torque, not fluid, and takes only mechanical lines. */
export const MECHANICAL = 'mechanical';

/** The fluids a port's medium declaration admits, or null for a shaft. */
export function admittedMedia(medium) {
  if (medium === MECHANICAL) return null;
  if (Array.isArray(medium)) return medium;
  return MEDIUM_CLASSES[medium] ?? [medium];
}

/** A medium declaration as words: "air or nitrogen", "liquid", "any fluid". */
export function describeMedium(medium) {
  if (Array.isArray(medium)) return medium.map((item) => item.replace(/_/g, ' ')).join(' or ');
  return medium === 'any' ? 'any fluid' : medium.replace(/_/g, ' ');
}

/**
 * Declare a port.
 *
 * `medium` is what the port can carry. `group` ties ports that must share one
 * fluid: a check valve's inlet and outlet carry the same fluid, while an
 * accumulator's gas port and liquid port do not, so they sit in different
 * groups. Ports default to one shared group, which is right for everything
 * that does not separate two fluids.
 *
 * @param {string} id        port name as authored in a port reference (P1.outlet)
 * @param {number} x         local x on the frame boundary
 * @param {number} y         local y on the frame boundary
 * @param {string} side      which frame edge the line leaves through
 * @param {object} [options] criticality, display label, aliases, medium, group
 */
export function port(id, x, y, side, {
  criticality = CRITICALITY.EXPECTED,
  label,
  aliases = [],
  medium = 'any',
  group = 'main',
} = {}) {
  if (!['left', 'right', 'top', 'bottom'].includes(side)) {
    throw new Error(`symbol port ${id}: unknown side ${side}`);
  }
  const known = (item) => MEDIA.includes(item);
  const valid = medium === MECHANICAL
    || Boolean(MEDIUM_CLASSES[medium])
    || known(medium)
    || (Array.isArray(medium) && medium.length > 0 && medium.every(known));
  if (!valid) throw new Error(`symbol port ${id}: unknown medium ${medium}`);
  return { id, x, y, side, criticality, label: label ?? id.toUpperCase(), aliases, medium, group };
}

/** Merge authored config over a symbol's defaults without mutating either. */
export function withDefaults(defaults, config) {
  return { ...defaults, ...(config ?? {}) };
}

/**
 * Which config keys were defaulted rather than authored. The renderer turns these
 * into assumption records, so a default can never be applied invisibly.
 */
export function defaultedKeys(defaults, config) {
  const authored = config ?? {};
  return Object.keys(defaults).filter((key) => authored[key] === undefined);
}

/** Standard label anchor: centred under the frame. */
export function labelBelow(width, height, gap = 14) {
  return { x: width / 2, y: height + gap, anchor: 'middle' };
}

/** Standard label anchor: centred above the frame. */
export function labelAbove(width, gap = 10) {
  return { x: width / 2, y: -gap, anchor: 'middle' };
}

/** Label to the left of the frame, for symbols whose right side is taken. */
export function labelLeft(height, gap = 12) {
  return { x: -gap, y: height / 2, anchor: 'end' };
}

/**
 * Label to the right of the frame.
 *
 * Used by symbols whose ports are on the top AND bottom faces -- a pump, a
 * relief valve, a gauge. For those, a caption above or below sits in the path
 * of a line, and while captions carry a halo so they stay legible, a label that
 * never meets a line is better than one that survives meeting it.
 */
export function labelRight(width, height, gap = 12) {
  return { x: width + gap, y: height / 2, anchor: 'start' };
}
