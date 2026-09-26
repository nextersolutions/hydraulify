# Third-party notices

## archify

hydraulify vendors code from **archify** by tt-a1i, used under the MIT License.
Upstream: https://github.com/tt-a1i/archify

Vendored here:

| File | Origin | Change |
| --- | --- | --- |
| `renderers/shared/geometry.mjs` | `renderers/shared/geometry.mjs` and the routing helpers in `renderers/architecture/render-architecture.mjs` | reduced to what hydraulify needs, and adapted so route anchors come from symbol port definitions rather than rectangle-side midpoints; candidate generation widened |
| `scripts/generate-validators.mjs` | `scripts/generate-validators.mjs` | the technique (precompile with ajv, inline the ucs2length helper, fail if any `require` survives) reimplemented for hydraulify's single schema |

Conventions taken without code: the SKILL.md structure and gated `references/`
split, the diagnostics shape (`code`, `subject`, `evidence`, `supportedFixes`),
the deliver-and-receipt discipline, and the separation of deterministic artifact
checks from browser evidence from perceptual review.

Earlier versions also vendored archify's viewer template
(`assets/template.html`) and its i18n catalog verbatim. Both were removed when
hydraulify got its own viewer and editor; nothing of them remains in the HTML
artifact.

### MIT License (archify)

```
MIT License

Copyright (c) archify contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ajv

`ajv` is a development dependency only. It compiles
`schemas/hydraulic-circuit.schema.json` into the committed
`renderers/shared/generated-validators.mjs`, which contains ajv-generated code
and is distributed with this skill. ajv is MIT licensed.
Upstream: https://github.com/ajv-validator/ajv

The installed skill has no `node_modules` and requires nothing at runtime.
