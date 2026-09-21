// The validation entry point: schema first, then domain rules.
//
// Schema failures stop the pass. Running topology rules against a malformed model
// would produce a cascade of findings that all restate the same structural
// problem, and the author would have to guess which one is the real cause.

import { validateModelSchema } from '../renderers/shared/validate-schema.mjs';
import { countBySeverity, sortDiagnostics, hasErrors } from '../renderers/shared/diagnostics.mjs';
import { validateTopology } from './topology.mjs';

/**
 * @returns {{
 *   ok: boolean, status: string, diagnostics: Array, counts: object,
 *   resolved: Map|null, connections: Array|null, groupMedia: Map|null,
 *   stage: 'schema'|'topology'
 * }}
 */
export function validateModel(model) {
  const schemaResult = validateModelSchema(model);
  if (!schemaResult.ok) {
    return {
      ok: false,
      status: 'INVALID',
      stage: 'schema',
      diagnostics: sortDiagnostics(schemaResult.diagnostics),
      counts: countBySeverity(schemaResult.diagnostics),
      resolved: null,
      connections: null,
      groupMedia: null,
    };
  }

  const { diagnostics, resolved, connections, groupMedia } = validateTopology(model);
  const counts = countBySeverity(diagnostics);
  const failed = hasErrors(diagnostics);

  return {
    ok: !failed,
    status: failed
      ? 'INVALID'
      : (counts.warning > 0 ? 'PASS WITH WARNINGS' : 'PASS'),
    stage: 'topology',
    diagnostics: sortDiagnostics(diagnostics),
    counts,
    resolved,
    connections,
    groupMedia,
  };
}

export { validateTopology, parsePortRef } from './topology.mjs';
