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
//   draw(ctx)     SVG string in LOCAL coordinates (origin = frame top-left)
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
 * Declare a port.
 *
 * @param {string} id        port name as authored in a port reference (P1.outlet)
 * @param {number} x         local x on the frame boundary
 * @param {number} y         local y on the frame boundary
 * @param {string} side      which frame edge the line leaves through
 * @param {object} [options] criticality, display label, aliases
 */
export function port(id, x, y, side, { criticality = CRITICALITY.EXPECTED, label, aliases = [] } = {}) {
  if (!['left', 'right', 'top', 'bottom'].includes(side)) {
    throw new Error(`symbol port ${id}: unknown side ${side}`);
  }
  return { id, x, y, side, criticality, label: label ?? id.toUpperCase(), aliases };
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
export function labelAbove(width, gap = 8) {
  return { x: width / 2, y: -gap, anchor: 'middle' };
}
