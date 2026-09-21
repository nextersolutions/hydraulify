// Paint probe, injected by `hydraulify visual-check` into a copy of an artifact.
//
// Runs in the browser, after the viewer's own scripts, and measures what Chrome
// actually painted: an element can say fill="currentColor" in the source while a
// stylesheet rule overrides it, and only computed style shows that. The result
// is written into the page where --dump-dom carries it back to the CLI.
window.addEventListener('load', () => {
  const report = { solid: 0, hollow: 0, invisible: 0, examples: [] };
  const describe = (el) => (el.closest('[data-focus]')?.getAttribute('data-focus') ?? 'drawing')
    + ' ' + el.tagName.toLowerCase() + '.' + (el.getAttribute('class') ?? '').replace(/ /g, '.');
  for (const el of document.querySelectorAll('svg [fill="currentColor"]')) {
    report.solid += 1;
    if (getComputedStyle(el).fill === 'none') {
      report.hollow += 1;
      if (report.examples.length < 3) report.examples.push(describe(el));
    }
  }
  for (const el of document.querySelectorAll('svg polygon, svg circle, svg rect, svg path, svg polyline, svg line')) {
    const style = getComputedStyle(el);
    if (style.fill === 'none' && style.stroke === 'none' && style.display !== 'none') report.invisible += 1;
  }
  const out = document.createElement('pre');
  out.id = 'hydraulify-paint-probe';
  out.style.display = 'none';
  out.textContent = JSON.stringify(report);
  document.body.appendChild(out);
});
