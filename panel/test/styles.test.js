// Tests estáticos sobre public/index.html y public/styles.css — R26, R36, R37, F2-R37, F2-R40, F2-R42, F2-R43
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PUBLIC_DIR } from './helpers.js';

const indexHtml = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const css = await fs.readFile(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');

/** Devuelve el contenido de un bloque @media (hasta su llave de cierre). */
function mediaBlock(source, query) {
  const start = source.indexOf(query);
  if (start < 0) return null;
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** CSS fuera de cualquier @media (reglas base). */
function baseCss(source) {
  let out = source;
  let idx;
  while ((idx = out.indexOf('@media')) >= 0) {
    const block = mediaBlock(out, out.slice(idx, out.indexOf('{', idx)).trim());
    out = out.slice(0, idx) + out.slice(idx + block.length);
  }
  return out;
}

test('[R26] index.html declara manifest, viewport y el módulo app.js', () => {
  assert.ok(indexHtml.includes('<link rel="manifest" href="/manifest.webmanifest">'));
  assert.ok(indexHtml.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
  assert.ok(indexHtml.includes('<script type="module" src="/app.js">'));
  assert.ok(indexHtml.includes('<html lang="es">'));
  assert.ok(indexHtml.includes('Puesto de Mando MUVER'));
});

test('[R28][R31] index.html tiene los contenedores y el formulario de alta con sus 5 campos', () => {
  assert.ok(indexHtml.includes('class="projects"') || indexHtml.includes('class="projects '));
  assert.ok(indexHtml.includes('id="last-updated"'));
  assert.ok(indexHtml.includes('id="add-project-form"'));
  for (const name of ['name', 'path', 'appUrl', 'repoUrl', 'tags']) {
    assert.ok(indexHtml.includes(`name="${name}"`), `campo ${name}`);
  }
  assert.ok(indexHtml.includes('id="form-error"'));
  assert.ok(indexHtml.includes('id="detail"'));
});

test('[R36] .projects es de una columna en la regla base y multicolumna desde 601 px', () => {
  const base = baseCss(css);
  assert.match(base, /\.projects\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*1fr;/s);
  const wide = mediaBlock(css, '@media (min-width: 601px)');
  assert.ok(wide, 'falta @media (min-width: 601px)');
  assert.match(wide, /\.projects\s*\{[^}]*grid-template-columns:\s*repeat\(/s);
});

test('[R36] ningún width/min-width en píxeles supera 360', () => {
  // Se excluyen las condiciones de @media (son breakpoints, no anchos de elementos).
  const declarationsOnly = css.replace(/@media[^{]*\{/g, '{');
  const matches = [...declarationsOnly.matchAll(/(?:^|[^-\w])(?:min-)?width\s*:\s*(\d+(?:\.\d+)?)px/g)];
  for (const m of matches) {
    assert.ok(Number(m[1]) <= 360, `valor de ancho fijo demasiado grande: ${m[0].trim()}`);
  }
  assert.ok(css.includes('padding: 0 16px') || css.includes('padding-inline: 16px') || /padding:\s*\d+px 16px/.test(css), 'margen lateral de 16 px');
});

test('[R37] tema oscuro redefine --bg y --fg en @media (prefers-color-scheme: dark)', () => {
  const base = baseCss(css);
  assert.match(base, /:root\s*\{[^}]*--bg:[^}]*--fg:/s, 'variables base en :root');
  const dark = mediaBlock(css, '@media (prefers-color-scheme: dark)');
  assert.ok(dark, 'falta @media (prefers-color-scheme: dark)');
  assert.match(dark, /:root\s*\{[^}]*--bg:/s);
  assert.match(dark, /:root\s*\{[^}]*--fg:/s);
});

test('[R37] las cinco clases status-* definen un color', () => {
  for (const status of ['atencion', 'en_curso', 'inactivo', 'ok', 'no_encontrado']) {
    const rule = css.match(new RegExp(`\\.status-${status}[^{]*\\{([^}]*)\\}`, 's'));
    assert.ok(rule, `falta la clase .status-${status}`);
    assert.match(rule[1], /(background|color|border)[^;]*:/, `.status-${status} sin color`);
    assert.ok(css.includes(`--status-${status}:`), `falta la variable --status-${status}`);
  }
});

test('[R36] botones con área táctil mínima de 44 px', () => {
  assert.match(css, /\.btn[^{]*\{[^}]*min-height:\s*44px/s);
});

// ---------- Fase 2: autenticación en index.html y styles.css ----------

test('[F2-R37] index.html tiene #auth-view, #change-password-view, #session-actions y los botones Salir / Cambiar contraseña', () => {
  assert.ok(indexHtml.includes('id="auth-view"'));
  assert.ok(indexHtml.includes('id="change-password-view"'));
  assert.ok(indexHtml.includes('id="session-actions"'));
  assert.match(indexHtml, /<button[^>]*id="logout-button"[^>]*>\s*Salir\s*<\/button>/);
  assert.match(indexHtml, /<button[^>]*id="change-password-button"[^>]*>\s*Cambiar contraseña\s*<\/button>/);
  assert.match(indexHtml, /<section[^>]*id="list-view"[^>]*\shidden/, '#list-view arranca oculto');
  assert.ok(indexHtml.includes('<script type="module" src="/app.js">'));
});

test('[F2-R40] el pie de index.html ya no habla de "sin autenticación"', () => {
  assert.ok(!indexHtml.includes('sin autenticación'));
  assert.ok(indexHtml.includes('Acceso protegido por contraseña'));
});

test('[F2-R42] index.html tiene el hueco #public-url en el encabezado', () => {
  assert.ok(indexHtml.includes('id="public-url"'));
  const topbar = indexHtml.slice(indexHtml.indexOf('<header class="topbar">'), indexHtml.indexOf('</header>'));
  assert.ok(topbar.includes('id="public-url"'), 'dentro del encabezado');
  assert.match(css, /\.public-url\s*\{[^}]*word-break:\s*break-all/s);
});

test('[F2-R43] .auth-card ocupa el ancho completo con inputs al 100 %, max-width en rem y botones .btn en el encabezado', () => {
  const base = baseCss(css);
  assert.match(base, /\.auth-card\s*\{[^}]*width:\s*100%/s);
  assert.match(base, /\.auth-card input\s*\{[^}]*width:\s*100%/s);
  // Puede haber varios bloques @media (min-width: 601px): basta con que uno defina el max-width en rem.
  assert.match(css, /@media \(min-width: 601px\)\s*\{[^@]*\.auth-card\s*\{[^}]*max-width:\s*[\d.]+rem/s);
  assert.match(css, /\.topbar-actions\s*\{[^}]*display:\s*flex/s);
  const logout = indexHtml.match(/<button[^>]*id="logout-button"[^>]*>/)[0];
  const change = indexHtml.match(/<button[^>]*id="change-password-button"[^>]*>/)[0];
  assert.match(logout, /class="btn[" ]/);
  assert.match(change, /class="btn[" ]/);
});
