// The pipeline, in one place: model -> validation -> layout -> artifacts.
//
// Every command goes through here, so `validate`, `render` and `deliver` can
// never disagree about whether a circuit is acceptable. The hard gate lives at
// this level too: when validation reports an error, no drawing is produced and
// no previous artifact is touched.

import { validateModel } from '../validate/index.mjs';
import { layoutCircuit, layoutReport } from './layout.mjs';
import { renderSvgDocument } from './render-svg.mjs';
import { countBySeverity, sortDiagnostics, hasErrors } from './shared/diagnostics.mjs';

/**
 * Validate, and if the model is sound, lay it out.
 *
 * Layout diagnostics (a route with no clean corridor, a junction side facing the
 * wrong way) are merged into the same list, because from the author's point of
 * view they are the same kind of finding.
 *
 * @returns {{
 *   ok, status, stage, diagnostics, counts, resolved, connections, groupMedia, layout
 * }}
 */
export function analyse(model) {
  const validation = validateModel(model);
  if (!validation.ok) return { ...validation, layout: null };

  const layout = layoutCircuit(model, validation.resolved, validation.connections);
  const diagnostics = sortDiagnostics([...validation.diagnostics, ...layout.diagnostics]);
  const counts = countBySeverity(diagnostics);
  const failed = hasErrors(diagnostics);

  return {
    ok: !failed,
    status: failed ? 'INVALID' : (counts.warning > 0 ? 'PASS WITH WARNINGS' : 'PASS'),
    stage: 'layout',
    diagnostics,
    counts,
    resolved: validation.resolved,
    connections: validation.connections,
    groupMedia: validation.groupMedia,
    layout,
  };
}

/**
 * Produce the SVG for a model that has already passed `analyse`.
 * Throws if called on a failed analysis: rendering an invalid circuit would put
 * a normal-looking file on disk that nobody can tell apart from a good one.
 */
export function renderSvg(model, analysis) {
  if (!analysis.ok) {
    throw new Error('renderSvg called on a circuit that failed validation; nothing is drawn for an invalid circuit.');
  }
  return renderSvgDocument(model, analysis.resolved, analysis.layout, { counts: analysis.counts });
}

export function report(model, analysis) {
  if (!analysis.layout) return null;
  return layoutReport(model, analysis.resolved, analysis.layout);
}
