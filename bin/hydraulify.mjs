#!/usr/bin/env node
// hydraulify CLI.
//
// Every verb funnels through the same pipeline, so validate, render and deliver
// can never disagree about whether a circuit is acceptable. The hard gate is
// enforced here once: when validation reports an error, no drawing is written
// and any previous artifact is left untouched.
//
// Exit codes:
//   0  success
//   1  the circuit failed validation, or a check found a problem
//   2  the command itself was wrong (bad arguments, unreadable file)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { analyse, renderSvg, report } from '../renderers/pipeline.mjs';
import { renderHtmlDocument, collectModules } from '../renderers/render-html.mjs';
import { renderValidationReport } from '../validate/report.mjs';
import { buildBom, renderBomMarkdown, renderBomJson } from '../validate/bom.mjs';
import { scaffoldModel } from '../scaffold/index.mjs';
import { formatDiagnostics } from '../renderers/shared/diagnostics.mjs';
import { SUPPORTED_TYPES } from '../renderers/symbols/index.mjs';

const skillRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return `hydraulify - ISO 1219-style hydraulic schematics from a validated circuit model

Usage:
  hydraulify scaffold <in.json> [out.json]          fill in missing positions (provisional)
  hydraulify validate <model.json> [--json]         validate; writes nothing
  hydraulify render <model.json> [out.svg] [--units si|imperial] [--html <out.html>]
  hydraulify deliver <model.json> <out.svg> [--html <out.html>] [--report <out.md>]
                                                    [--bom <out.md>] [--json] [--units si|imperial]
  hydraulify bom <model.json> [out.md] [--json-out <out.json>] [--units si|imperial]
  hydraulify inspect <model.json>                   layout report: anchors, sides, routes
  hydraulify preview <model.json> [out.html]        render HTML and open it locally
  hydraulify check <artifact.svg|html>              structural checks on a produced artifact
  hydraulify visual-check <artifact.html> [--png <out.png>] [--json]
                                                    load it in local Chrome and report what happened
  hydraulify examples                               list the worked examples
  hydraulify demo [out-dir]                         render every example into a directory
  hydraulify doctor                                 check the environment

Notes:
  A hard error means no drawing is produced. A non-zero exit is never a success.
  Components: ${SUPPORTED_TYPES.join(', ')}
`;
}

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function readModel(file) {
  if (!file) fail(usage());
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail(`Cannot read ${file}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
  }
  return null;
}

/** Split flags from positional arguments without a dependency. */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inlineValue] = arg.slice(2).split('=');
    const takesValue = ['units', 'html', 'report', 'bom', 'json-out', 'png'].includes(name);
    if (!takesValue) {
      flags[name] = true;
      continue;
    }
    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith('--')) fail(`--${name} requires a value.`);
    flags[name] = value;
    if (inlineValue === undefined) index += 1;
  }
  return { positional, flags };
}

function resolveUnits(model, flags) {
  const units = flags.units ?? model.meta?.units ?? 'si';
  if (units !== 'si' && units !== 'imperial') fail('--units accepts si or imperial.');
  return units;
}

/**
 * Write a file only after everything that could fail has succeeded.
 * A half-written set of artifacts is worse than none: the SVG and the report
 * would disagree, and the disagreement would not be obvious.
 */
function writeAll(entries) {
  for (const [file] of entries) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  for (const [file, content] of entries) fs.writeFileSync(file, content, 'utf8');
  return entries.map(([file]) => file);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function printDiagnostics(analysis) {
  if (!analysis.diagnostics.length) return;
  process.stderr.write(`${formatDiagnostics(analysis.diagnostics)}\n`);
}

function reportFailure(analysis, file) {
  process.stderr.write(`\nSTATUS: ${analysis.status} - ${file}\n`);
  printDiagnostics(analysis);
  process.stderr.write('\nNo drawing was produced. An invalid circuit is not rendered, '
    + 'because a schematic that looks finished is indistinguishable from one that is.\n');
}

// --- verbs ------------------------------------------------------------------

function cmdValidate(argv) {
  const { positional, flags } = parseArgs(argv);
  const file = positional[0];
  const model = readModel(file);
  const analysis = analyse(model);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({
      status: analysis.status,
      ok: analysis.ok,
      stage: analysis.stage,
      counts: analysis.counts,
      diagnostics: analysis.diagnostics,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(renderValidationReport(model, analysis));
  }
  process.exit(analysis.ok ? 0 : 1);
}

function cmdRender(argv) {
  const { positional, flags } = parseArgs(argv);
  const [file, outputArg] = positional;
  const model = readModel(file);
  model.meta.units = resolveUnits(model, flags);

  const analysis = analyse(model);
  if (!analysis.ok) {
    reportFailure(analysis, file);
    process.exit(1);
  }

  const output = outputArg ?? model.meta.output ?? file.replace(/\.json$/, '.svg');
  const entries = [[output, renderSvg(model, analysis)]];
  if (flags.html) entries.push([flags.html, renderHtmlDocument(model, analysis, { sourceName: path.basename(file) })]);

  for (const written of writeAll(entries)) process.stdout.write(`${written}\n`);
  if (analysis.counts.warning || analysis.counts.info) printDiagnostics(analysis);
  process.exit(0);
}

function cmdDeliver(argv) {
  const { positional, flags } = parseArgs(argv);
  const [file, outputArg] = positional;
  const model = readModel(file);
  model.meta.units = resolveUnits(model, flags);

  const analysis = analyse(model);
  if (!analysis.ok) {
    reportFailure(analysis, file);
    process.exit(1);
  }
  if (!outputArg) fail('deliver requires an output path for the schematic.\n\n' + usage());

  const specification = `${JSON.stringify(model, null, 2)}\n`;
  const svg = renderSvg(model, analysis);
  const entries = [[outputArg, svg]];

  const html = flags.html ? renderHtmlDocument(model, analysis, { sourceName: path.basename(file) }) : null;
  if (html) entries.push([flags.html, html]);

  const validation = renderValidationReport(model, analysis);
  if (flags.report) entries.push([flags.report, validation]);

  const bom = buildBom(model, analysis, { units: model.meta.units });
  if (flags.bom) entries.push([flags.bom, renderBomMarkdown(model, bom)]);

  const written = writeAll(entries);

  const receipt = {
    status: analysis.status,
    units: model.meta.units,
    counts: analysis.counts,
    specification: { bytes: Buffer.byteLength(specification), sha256: sha256(specification) },
    artifacts: written.map((fileName, index) => ({
      path: fileName,
      bytes: Buffer.byteLength(entries[index][1]),
      sha256: sha256(entries[index][1]),
    })),
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } else {
    process.stdout.write(`STATUS: ${analysis.status}\n`);
    for (const artifact of receipt.artifacts) {
      process.stdout.write(`${artifact.path}  ${artifact.bytes} bytes  sha256:${artifact.sha256.slice(0, 16)}\n`);
    }
    process.stdout.write(`specification sha256:${receipt.specification.sha256.slice(0, 16)}\n`);
    if (analysis.counts.warning || analysis.counts.info) printDiagnostics(analysis);
  }
  process.exit(0);
}

function cmdBom(argv) {
  const { positional, flags } = parseArgs(argv);
  const [file, outputArg] = positional;
  const model = readModel(file);
  const units = resolveUnits(model, flags);
  const analysis = analyse(model);

  if (!analysis.resolved) {
    reportFailure(analysis, file);
    process.exit(1);
  }

  const bom = buildBom(model, analysis, { units });
  const markdown = renderBomMarkdown(model, bom);
  const entries = [];
  if (outputArg) entries.push([outputArg, markdown]);
  if (flags['json-out']) entries.push([flags['json-out'], renderBomJson(model, bom)]);

  if (entries.length) {
    for (const written of writeAll(entries)) process.stdout.write(`${written}\n`);
  } else {
    process.stdout.write(markdown);
  }
  // A BOM can be extracted from a circuit with warnings; only a hard error,
  // which means the model could not be resolved, blocks it.
  process.exit(analysis.stage === 'schema' ? 1 : 0);
}

function cmdInspect(argv) {
  const { positional } = parseArgs(argv);
  const file = positional[0];
  const model = readModel(file);
  const analysis = analyse(model);
  if (!analysis.layout) {
    reportFailure(analysis, file);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(report(model, analysis), null, 2)}\n`);
  process.exit(0);
}

function cmdScaffold(argv) {
  const { positional } = parseArgs(argv);
  const [file, outputArg] = positional;
  const input = readModel(file);
  const { model, placed } = scaffoldModel(input);
  const serialised = `${JSON.stringify(model, null, 2)}\n`;

  if (outputArg) {
    writeAll([[outputArg, serialised]]);
    process.stdout.write(`${outputArg}\n`);
  } else {
    process.stdout.write(serialised);
  }
  if (placed.length) {
    process.stderr.write(`\nPlaced ${placed.length} component${placed.length === 1 ? '' : 's'} into hydraulic bands: ${placed.join(', ')}.\n`
      + 'These positions are a starting point, not a layout. Move components so the '
      + 'pressure path reads clearly, then render.\n');
  }
  process.exit(0);
}

function cmdCheck(argv) {
  const { positional } = parseArgs(argv);
  const file = positional[0];
  if (!file) fail(usage());
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail(`Cannot read ${file}: ${error.message}`);
  }

  const problems = [];
  const isHtml = /\.html?$/i.test(file);

  // Numeric checks apply to the drawing, not to the document around it: the
  // editor's embedded modules legitimately contain the words NaN and undefined,
  // and scanning them would report a failure on every artifact.
  const drawing = isHtml
    ? (content.match(/<svg[\s\S]*?<\/svg>/) ?? [''])[0]
    : content;
  if (/NaN|undefined|Infinity/.test(drawing)) problems.push('the drawing contains a non-finite or undefined value');

  if (isHtml) {
    if (!content.includes('<svg')) problems.push('the page carries no drawing');
    if (!/class="[^"]*component-/.test(drawing)) problems.push('the drawing has no component groups');
    const embedded = (id) => {
      const match = content.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`));
      if (!match) return null;
      try {
        return JSON.parse(match[1]);
      } catch {
        return null;
      }
    };
    const model = embedded('hy-model');
    if (!model || !Array.isArray(model.components)) problems.push('the page does not carry a readable circuit model');
    const modules = embedded('hy-modules');
    if (!modules?.entry || !modules.sources?.[modules.entry]) problems.push('the editor modules are missing');
    if (/<script[^>]+src=|<link[^>]+href="http/i.test(content)) problems.push('the artifact is not self-contained');
  } else {
    if (!content.startsWith('<?xml')) problems.push('missing the XML declaration');
    if (!/<svg[^>]+viewBox=/.test(content)) problems.push('missing a viewBox');
    const opens = (content.match(/<g[\s>]/g) ?? []).length;
    const closes = (content.match(/<\/g>/g) ?? []).length;
    if (opens !== closes) problems.push(`unbalanced groups: ${opens} open, ${closes} closed`);
    if (/(?:fill|stroke)="(?!none|currentColor|var\()/.test(content)) {
      problems.push('an inline colour is present; styling must stay semantic so the drawing inverts in dark mode');
    }
  }

  if (problems.length) {
    process.stderr.write(`${file}: FAILED\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`${file}: ok (${Buffer.byteLength(content)} bytes)\n`);
  process.exit(0);
}

function resolveChrome() {
  if (process.env.HYDRAULIFY_CHROME) return process.env.HYDRAULIFY_CHROME;
  const candidates = process.platform === 'win32'
    ? [
      path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Load the delivered HTML in a real browser and report what happened.
 *
 * This is bounded evidence, not approval: it proves the viewer loaded and the
 * schematic is in the DOM after scripts ran. It says nothing about whether the
 * drawing is correct, which needs a human or an image-capable reviewer.
 */
function cmdVisualCheck(argv) {
  const { positional, flags } = parseArgs(argv);
  const file = positional[0];
  if (!file) fail(usage());
  if (!fs.existsSync(file)) fail(`Cannot read ${file}`);

  const chrome = resolveChrome();
  if (!chrome) {
    process.stderr.write('No Chrome found. Set HYDRAULIFY_CHROME to its path, or skip visual-check '
      + 'and report that browser evidence was not collected.\n');
    process.exit(2);
  }

  // Chrome loads a probed copy: the artifact with a small script that measures
  // what the browser actually paints. The source can say fill="currentColor"
  // while a stylesheet rule quietly overrides it, and only computed style shows
  // that -- which is how every arrowhead once went invisible with all tests green.
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydraulify-probe-'));
  const probeFile = path.join(probeDir, 'probe.html');
  fs.writeFileSync(probeFile, withPaintProbe(fs.readFileSync(file, 'utf8'), file), 'utf8');

  const fileUrl = `file:///${probeFile.replace(/\\/g, '/')}`;
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=5000'];
  if (flags.png) args.push(`--screenshot=${path.resolve(flags.png)}`, '--window-size=1500,1000');
  args.push('--dump-dom', fileUrl);

  const result = spawnSync(chrome, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  fs.rmSync(probeDir, { recursive: true, force: true });
  if (result.error) fail(`Chrome could not be started: ${result.error.message}`);

  const dom = result.stdout ?? '';
  const findings = [];
  // The page shows the drawing it was delivered with even if its script fails,
  // so a drawing in the DOM proves little on its own: the editor marks the
  // body once it has started, and writes into #boot-error if it could not.
  if (!dom.includes('<svg')) findings.push('the schematic is not in the rendered DOM');
  if (!/class="[^"]*component-/.test(dom)) findings.push('no component groups survived rendering');
  if (!/\.svg$/i.test(file)) {
    if (!/<body[^>]*data-ready="true"/.test(dom)) findings.push('the editor did not start');
    const bootError = dom.match(/<div id="boot-error"[^>]*>([^<]*)<\/div>/);
    if (bootError && bootError[1].trim()) findings.push(`the editor reported: ${bootError[1].trim()}`);
  }

  const paint = readPaintProbe(dom);
  if (!paint) {
    findings.push('the paint probe did not run, so what the browser painted was not measured');
  } else {
    if (paint.hollow) {
      findings.push(`${paint.hollow} of ${paint.solid} elements meant to be solid render unfilled (${paint.examples.join('; ')})`);
    }
    if (paint.invisible) {
      findings.push(`${paint.invisible} elements have neither fill nor stroke, so they are invisible`);
    }
  }

  const receipt = {
    artifact: path.resolve(file),
    chrome,
    domBytes: Buffer.byteLength(dom),
    screenshot: flags.png ? path.resolve(flags.png) : null,
    paint,
    findings,
    claim: 'The page loaded, the editor started, and the schematic is present after scripts ran. '
      + 'This is not a review of whether the drawing is correct.',
  };

  if (flags.json) process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  else {
    process.stdout.write(`${file}: loaded in Chrome, ${receipt.domBytes} bytes of DOM\n`);
    if (receipt.screenshot) process.stdout.write(`screenshot: ${receipt.screenshot}\n`);
    if (paint) process.stdout.write(`painted: ${paint.solid - paint.hollow}/${paint.solid} solid elements filled, ${paint.invisible} invisible\n`);
    for (const finding of findings) process.stdout.write(`  - ${finding}\n`);
    process.stdout.write(`${receipt.claim}\n`);
  }
  process.exit(findings.length ? 1 : 0);
}

// The browser half of visual-check lives in assets/paint-probe.js: it is page
// code, and this file is Node code that must stay free of browser APIs.
function paintProbe() {
  return `<script>${fs.readFileSync(path.join(skillRoot, 'assets', 'paint-probe.js'), 'utf8')}</script>`;
}

function withPaintProbe(source, file) {
  // A bare SVG is wrapped in a page so it can carry the script; the viewer
  // already is one, and takes the probe just before it closes.
  if (/\.svg$/i.test(file)) {
    const svg = source.replace(/^<\?xml[^>]*>\s*/, '');
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>${svg}${paintProbe()}</body></html>`;
  }
  const probe = paintProbe();
  return source.includes('</body>') ? source.replace('</body>', `${probe}</body>`) : `${source}${probe}`;
}

function readPaintProbe(dom) {
  const match = dom.match(/<pre id="hydraulify-paint-probe"[^>]*>([^<]*)<\/pre>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } catch {
    return null;
  }
}

function exampleFiles() {
  const directory = path.join(skillRoot, 'examples');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
}

function cmdExamples() {
  const files = exampleFiles();
  if (!files.length) {
    process.stdout.write('No examples are installed.\n');
    process.exit(0);
  }
  for (const name of files) {
    const model = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name), 'utf8'));
    process.stdout.write(`${name.padEnd(34)} ${model.meta?.title ?? ''}\n`);
  }
  process.exit(0);
}

function cmdDemo(argv) {
  const { positional } = parseArgs(argv);
  const outDir = positional[0] ?? 'hydraulify-demo';
  const files = exampleFiles();
  if (!files.length) fail('No examples are installed.');

  fs.mkdirSync(outDir, { recursive: true });
  let failures = 0;
  for (const name of files) {
    const model = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name), 'utf8'));
    const analysis = analyse(model);
    const base = name.replace(/\.json$/, '');
    if (!analysis.ok) {
      failures += 1;
      process.stderr.write(`${name}: ${analysis.status}\n${formatDiagnostics(analysis.diagnostics)}\n`);
      continue;
    }
    writeAll([
      [path.join(outDir, `${base}.svg`), renderSvg(model, analysis)],
      [path.join(outDir, `${base}.html`), renderHtmlDocument(model, analysis, { sourceName: name })],
      [path.join(outDir, `${base}.validation.md`), renderValidationReport(model, analysis)],
    ]);
    process.stdout.write(`${path.join(outDir, `${base}.svg`)}\n`);
  }
  process.exit(failures ? 1 : 0);
}

function cmdDoctor() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push([nodeMajor >= 18, `Node ${process.versions.node} (>= 18 required)`]);

  const validator = path.join(skillRoot, 'renderers', 'shared', 'generated-validators.mjs');
  checks.push([fs.existsSync(validator), 'committed schema validator present']);
  if (fs.existsSync(validator)) {
    const source = fs.readFileSync(validator, 'utf8');
    checks.push([!source.includes('require('), 'validator has no runtime dependency']);
  }

  checks.push([fs.existsSync(path.join(skillRoot, 'editor', 'editor.css')), 'editor stylesheet present']);
  checks.push([fs.existsSync(path.join(skillRoot, 'assets', 'paint-probe.js')), 'visual-check paint probe present']);
  try {
    const modules = collectModules();
    checks.push([true, `editor modules load (${modules.order.length} modules, browser-safe imports only)`]);
  } catch (error) {
    checks.push([false, `editor modules do not load: ${error.message}`]);
  }

  checks.push([exampleFiles().length > 0, `${exampleFiles().length} examples installed`]);

  const chrome = resolveChrome();
  checks.push([Boolean(chrome), chrome ? `Chrome found for visual-check: ${chrome}` : 'Chrome not found (visual-check unavailable; everything else works)']);

  let failed = 0;
  for (const [ok, label] of checks) {
    if (!ok && !label.startsWith('Chrome not found')) failed += 1;
    process.stdout.write(`${ok ? '[ok]' : '[--]'} ${label}\n`);
  }
  process.exit(failed ? 1 : 0);
}

function cmdPreview(argv) {
  const { positional, flags } = parseArgs(argv);
  const [file, outputArg] = positional;
  const model = readModel(file);
  model.meta.units = resolveUnits(model, flags);
  const analysis = analyse(model);
  if (!analysis.ok) {
    reportFailure(analysis, file);
    process.exit(1);
  }
  const output = outputArg ?? file.replace(/\.json$/, '.html');
  writeAll([[output, renderHtmlDocument(model, analysis, { sourceName: path.basename(file) })]]);
  process.stdout.write(`${output}\n`);

  const resolved = path.resolve(output);
  const opener = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', resolved]]
    : (process.platform === 'darwin' ? ['open', [resolved]] : ['xdg-open', [resolved]]);
  const opened = spawnSync(opener[0], opener[1], { stdio: 'ignore' });
  if (opened.error) process.stderr.write(`Could not open a browser automatically; open ${resolved} yourself.\n`);
  process.exit(0);
}

// --- dispatch ---------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);

try {
  switch (command) {
    case 'validate': cmdValidate(rest); break;
    case 'render': cmdRender(rest); break;
    case 'deliver': cmdDeliver(rest); break;
    case 'bom': cmdBom(rest); break;
    case 'inspect': cmdInspect(rest); break;
    case 'scaffold': cmdScaffold(rest); break;
    case 'check': cmdCheck(rest); break;
    case 'visual-check': cmdVisualCheck(rest); break;
    case 'preview': cmdPreview(rest); break;
    case 'examples': cmdExamples(); break;
    case 'demo': cmdDemo(rest); break;
    case 'doctor': cmdDoctor(); break;
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(usage());
      process.exit(0);
      break;
    default:
      fail(command ? `Unknown command "${command}".\n\n${usage()}` : usage());
  }
} catch (error) {
  // A thrown error is a bug or an unreadable input, never a passed circuit.
  process.stderr.write(`${error.message}\n`);
  if (process.env.HYDRAULIFY_DEBUG) process.stderr.write(`${error.stack}\n`);
  process.exit(2);
}
