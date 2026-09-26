// What the page's export menu actually produces, measured in pixels.
//
// Exports serialize the drawing on its own, away from the page's stylesheet.
// When the schematic's rules were only in the page head, every PNG, JPEG and
// SVG came out as black-filled, unstroked shapes on a navy slab -- while every
// test that read the source stayed green. So this runs the page's own export
// in Chrome, decodes the image it produces, and counts pixels.
//
// WebP is not covered: headless Chrome's virtual time never lets a WebP encode
// above a few hundred pixels finish. It shares every step with PNG except the
// encoder call.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { analyse } from '../renderers/pipeline.mjs';
import { renderHtmlDocument } from '../renderers/render-html.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function findChrome() {
  if (process.env.HYDRAULIFY_CHROME) return process.env.HYDRAULIFY_CHROME;
  const candidates = process.platform === 'win32'
    ? [
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const chrome = findChrome();
const FORMATS = ['png', 'jpeg', 'svg'];

// Runs in the page, once the editor has started, through the same function
// the export menu calls.
const PROBE = `<script>
window.addEventListener('load', async () => {
  const out = document.createElement('pre');
  out.id = 'export-probe';
  document.body.appendChild(out);
  for (let tries = 0; tries < 200 && document.body.dataset.ready !== 'true'; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!window.hydraulify) { out.textContent = JSON.stringify({ error: 'the editor did not start' }); return; }

  const decode = (blob) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the exported ' + blob.type + ' does not decode'));
    img.src = URL.createObjectURL(blob);
  });

  const measure = (img) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let paper = 0, dark = 0, tinted = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 235 && g > 235 && b > 235) paper += 1;
      if (0.299 * r + 0.587 * g + 0.114 * b < 100) {
        dark += 1;
        if (b - r > 12) tinted += 1;
      }
    }
    const total = data.length / 4;
    return { width: canvas.width, height: canvas.height, paper: paper / total, dark: dark / total, darkTinted: tinted / total };
  };

  const results = {};
  for (const format of ${JSON.stringify(FORMATS)}) {
    try {
      const blob = await window.hydraulify.exportBlob(format);
      results[format] = { type: blob.type, ...measure(await decode(blob)) };
    } catch (error) {
      results[format] = { error: String(error && error.message || error) };
    }
  }
  out.textContent = JSON.stringify(results);
});
</script>`;

function exportInChrome(exampleName) {
  const model = JSON.parse(fs.readFileSync(path.join(root, 'examples', `${exampleName}.json`), 'utf8'));
  const html = renderHtmlDocument(model, analyse(model)).replace('</body>', `${PROBE}</body>`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydraulify-export-'));
  const file = path.join(dir, 'viewer.html');
  fs.writeFileSync(file, html, 'utf8');
  try {
    // Light scheme: the SVG export is the CLI's self-theming SVG, which inverts
    // on a dark system by design. Rasters are always light; they are measured
    // the same way either way.
    const result = spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=30000',
      '--blink-settings=preferredColorScheme=1',
      '--dump-dom', `file:///${file.replace(/\\/g, '/')}`,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
    const match = (result.stdout ?? '').match(/<pre id="export-probe">([^<]*)<\/pre>/);
    assert.ok(match && match[1], `the export probe did not report (${result.error?.message ?? result.stderr?.slice(0, 300)})`);
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const example of ['02-solenoid-cylinder', '06-caes-plant']) {
  test(`${example}: exported PNG, JPEG and SVG are an ink drawing on paper`, { skip: !chrome && 'Chrome not found' }, () => {
    const results = exportInChrome(example);
    for (const format of FORMATS) {
      const shot = results[format];
      assert.ok(!shot.error, `${format} export failed: ${shot.error}`);
      assert.ok(shot.paper > 0.85, `${format}: only ${(shot.paper * 100).toFixed(1)}% of the image is paper`);
      assert.ok(shot.dark < 0.08, `${format}: ${(shot.dark * 100).toFixed(1)}% of the image is dark, so shapes are filled or the background is not paper`);
      assert.ok(shot.dark > 0.002, `${format}: almost nothing is drawn (${(shot.dark * 100).toFixed(2)}% dark)`);
      assert.ok(shot.darkTinted < 0.001, `${format}: ${(shot.darkTinted * 100).toFixed(2)}% of the image is a dark blue, the viewer's theme leaking in`);
    }
    assert.ok(results.png.width > 1000, 'raster exports are rendered above screen resolution');
  });
}
