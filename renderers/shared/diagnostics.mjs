// Every failure in hydraulify carries the same machine-readable shape, so an agent
// can repair exactly the diagnosed subject instead of guessing:
//
//   { severity, code, subject, message, evidence, supportedFixes }
//
// severity is one of error | warning | info, matching the brief's three-way split:
//   error   - the topology is clearly invalid; nothing is drawn
//   warning - the circuit may be valid but something is suspicious or unspecified
//   info    - a design decision is missing but it does not prevent drawing
//
// Adapted from archify's renderers/shared/diagnostics.mjs (MIT), reduced to the
// parts hydraulify needs.

export const SEVERITY = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
});

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

export class HydraulifyError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'HydraulifyError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Build one diagnostic. `subject` names what to change (a component id, a port
 * reference, a connection id); `evidence` carries the observed facts that justify
 * the finding; `supportedFixes` lists the repairs the author may choose between.
 */
export function diagnostic({
  severity = SEVERITY.ERROR,
  code,
  subject = {},
  message,
  evidence = {},
  supportedFixes = [],
} = {}) {
  if (!code) throw new Error('diagnostic() requires a code');
  if (!message) throw new Error('diagnostic() requires a message');
  if (!SEVERITY_ORDER[severity] && SEVERITY_ORDER[severity] !== 0) {
    throw new Error(`diagnostic() got unknown severity ${JSON.stringify(severity)}`);
  }
  return { severity, code, subject, message, evidence, supportedFixes };
}

export const error = (options) => diagnostic({ ...options, severity: SEVERITY.ERROR });
export const warning = (options) => diagnostic({ ...options, severity: SEVERITY.WARNING });
export const info = (options) => diagnostic({ ...options, severity: SEVERITY.INFO });

export function countBySeverity(diagnostics = []) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const item of diagnostics) {
    if (counts[item.severity] !== undefined) counts[item.severity] += 1;
  }
  return counts;
}

export function hasErrors(diagnostics = []) {
  return diagnostics.some((item) => item.severity === SEVERITY.ERROR);
}

/**
 * Stable ordering for reports and goldens: severity first, then code, then the
 * stringified subject. Never depends on discovery order, so two runs over the same
 * model produce byte-identical reports.
 */
export function sortDiagnostics(diagnostics = []) {
  return [...diagnostics].sort((left, right) => {
    const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (bySeverity !== 0) return bySeverity;
    if (left.code !== right.code) return left.code < right.code ? -1 : 1;
    const leftSubject = JSON.stringify(left.subject ?? {});
    const rightSubject = JSON.stringify(right.subject ?? {});
    if (leftSubject !== rightSubject) return leftSubject < rightSubject ? -1 : 1;
    return left.message < right.message ? -1 : (left.message > right.message ? 1 : 0);
  });
}

const MARK = { error: 'x', warning: '!', info: 'i' };

export function formatDiagnostic(item) {
  const subject = item.subject && Object.keys(item.subject).length
    ? ` [${Object.entries(item.subject).map(([key, value]) => `${key}=${value}`).join(' ')}]`
    : '';
  return `${MARK[item.severity]} ${item.severity.toUpperCase()} ${item.code}${subject}: ${item.message}`;
}

export function formatDiagnostics(diagnostics = []) {
  return sortDiagnostics(diagnostics).map(formatDiagnostic).join('\n');
}

export function throwIfErrors(diagnostics, prefix = 'hydraulify') {
  if (!hasErrors(diagnostics)) return;
  const counts = countBySeverity(diagnostics);
  throw new HydraulifyError(
    `${prefix}: ${counts.error} error${counts.error === 1 ? '' : 's'}\n${formatDiagnostics(diagnostics)}`,
    diagnostics,
  );
}
