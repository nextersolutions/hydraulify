// Loads the editor's embedded modules, dependencies first, then starts the
// app. Each module's source travels in #hy-modules with its imports written as
// `hy:<path>`; each becomes a Blob URL, and its imports are pointed at the
// Blob URLs of what it depends on. Kept small and free of anything clever: if
// this fails, the page still shows the drawing it was delivered with, and
// says why the editor did not start.
(async () => {
  const report = (message) => {
    const box = document.getElementById('boot-error');
    if (box) {
      box.hidden = false;
      box.textContent = message;
    }
  };
  try {
    const spec = JSON.parse(document.getElementById('hy-modules').textContent);
    const urls = {};
    for (const name of spec.order) {
      const source = spec.sources[name].replace(/(from\s*['"])hy:([^'"]+)(['"])/g,
        (match, head, target, tail) => head + urls[target] + tail);
      urls[name] = URL.createObjectURL(new Blob([`${source}\n//# sourceURL=hydraulify/${name}`], { type: 'text/javascript' }));
    }
    const app = await import(urls[spec.entry]);
    await app.start();
  } catch (error) {
    console.error(error);
    report(`The editor could not start (${(error && error.message) || error}). The drawing is the schematic as delivered.`);
  }
})();
