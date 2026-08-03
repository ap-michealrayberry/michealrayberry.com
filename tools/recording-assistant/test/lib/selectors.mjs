/* Selector integrity: the classes the JS queries must exist in the template,
   and every class the template carries must be referenced by CSS or JS.
   This is the mechanical check for two real bug classes from the history of
   this file: a helper querying markup that an edit removed (dangling
   selector), and listeners attached to elements an edit removed (dead
   handlers) — both of which threw at runtime and took initialisation down. */

// class="a b c" occurrences in an HTML template string.
export function templateClasses(html) {
  const out = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].trim().split(/\s+/)) out.add(c);
  }
  return out;
}

// .class tokens in a CSS string.
export function cssClasses(css) {
  const out = new Set();
  for (const m of css.matchAll(/\.([A-Za-z_][\w-]*)/g)) out.add(m[1]);
  return out;
}

// Class tokens inside string selectors passed to $()/querySelector()/closest(),
// plus any '.ra-…' selector literal handed around indirectly (helpers like
// `mark('.ra-ck-w', …)` forward the selector to querySelector).
export function queriedClasses(jsSource) {
  const out = new Set();
  const patterns = [
    /\$\(\s*['"`]([^'"`]+)['"`]/g,
    /querySelector(?:All)?\(\s*['"`]([^'"`]+)['"`]/g,
    /closest\(\s*['"`]([^'"`]+)['"`]/g,
  ];
  for (const re of patterns) {
    for (const m of jsSource.matchAll(re)) {
      for (const c of m[1].matchAll(/\.([A-Za-z_][\w-]*)/g)) out.add(c[1]);
    }
  }
  for (const m of jsSource.matchAll(/['"`]\.(ra-[\w-]+)['"`]/g)) out.add(m[1]);
  return out;
}

// Class tokens the JS toggles or assigns directly.
export function classRefClasses(jsSource) {
  const out = new Set();
  for (const m of jsSource.matchAll(/classList\.(?:add|remove|toggle)\(\s*['"]([\w-]+)['"]/g)) out.add(m[1]);
  for (const m of jsSource.matchAll(/className\s*=\s*['"]([^'"]+)['"]/g)) {
    for (const c of m[1].trim().split(/\s+/)) out.add(c);
  }
  return out;
}

/* Returns { missing, unreferenced, cssOrphans }:
   - missing:      queried in JS but absent from the template (crashes waiting
                   to happen — `null.textContent`, `null.addEventListener`)
   - unreferenced: in the template but neither styled nor touched by JS
                   (orphaned markup, or a feature whose wiring is missing)
   - cssOrphans:   styled in CSS but neither in the template nor created by JS */
export function checkSelectorIntegrity({ html, css, sources }) {
  const tpl = templateClasses(html);
  const styled = cssClasses(css);
  const queried = new Set();
  const touched = new Set();
  for (const src of sources) {
    for (const c of queriedClasses(src)) queried.add(c);
    for (const c of classRefClasses(src)) touched.add(c);
  }
  const missing = [...queried].filter((c) => !tpl.has(c)).sort();
  const unreferenced = [...tpl].filter((c) => !styled.has(c) && !queried.has(c) && !touched.has(c)).sort();
  const cssOrphans = [...styled].filter((c) => !tpl.has(c) && !touched.has(c)).sort();
  return { missing, unreferenced, cssOrphans };
}
