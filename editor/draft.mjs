// Draft analysis: the pipeline the editor runs on every edit.
//
// The CLI refuses to draw a circuit with errors, and it should: a delivered
// artifact that looks normal but is not valid is worse than none. The editor has
// to draw one anyway -- a pump that has just been placed is unconnected, and so
// an error, until the next click connects it. So this runs the same validator
// and the same layout, and draws everything that resolves, with the errors
// alongside. It never produces a delivered artifact; `deliver` keeps the gate.

import { validateModel, validateTopology } from '../validate/index.mjs';
import { layoutCircuit } from '../renderers/layout.mjs';
import { countBySeverity, sortDiagnostics, hasErrors } from '../renderers/shared/diagnostics.mjs';

/**
 * @returns {{ ok, status, diagnostics, counts, resolved, connections, layout, drawable }}
 *   drawable is false only when nothing could be laid out at all.
 */
export function analyseDraft(model) {
  const validation = validateModel(model);

  let { resolved, connections } = validation;
  let diagnostics = validation.diagnostics;

  // A schema failure stops the CLI before topology, so its findings do not
  // cascade. The editor still wants a picture of everything else: a blank
  // title or a half-typed parameter must not make the drawing vanish. Topology
  // is tried on the draft anyway, and if the model is too malformed for that,
  // there is nothing to draw.
  if (validation.stage === 'schema') {
    try {
      const topology = validateTopology(model);
      resolved = topology.resolved;
      connections = topology.connections;
    } catch {
      return {
        ...validation,
        layout: null,
        drawable: false,
      };
    }
  }

  let layout;
  try {
    layout = layoutCircuit(model, resolved, connections);
  } catch {
    return { ...validation, resolved, connections, layout: null, drawable: false };
  }

  diagnostics = sortDiagnostics([...diagnostics, ...layout.diagnostics]);
  const counts = countBySeverity(diagnostics);
  const failed = hasErrors(diagnostics);
  return {
    ok: !failed,
    status: failed ? 'INVALID' : (counts.warning > 0 ? 'PASS WITH WARNINGS' : 'PASS'),
    stage: validation.stage,
    diagnostics,
    counts,
    resolved,
    connections,
    layout,
    drawable: true,
  };
}
