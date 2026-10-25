// Tests estáticos sobre public/index.html y public/styles.css — R26, R36, R37, F2-R37, F2-R40, F2-R42, F2-R43, F3-R51
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

test('[F2-R37][F2-R41] #session-actions arranca hidden y la CSS respeta hidden pese a display: flex', () => {
  assert.match(indexHtml, /<nav[^>]*id="session-actions"[^>]*\shidden[\s>]/, 'el contenedor de acciones del encabezado lleva hidden por defecto');
  assert.match(css, /\.topbar-actions\[hidden\]\s*\{[^}]*display:\s*none/s, 'sin esta regla, .topbar-actions { display: flex } anula el atributo hidden');
});

// ---------- Fase 3: huecos y estilos de Claude Code (F3-R51) ----------

test('[F3-R51] index.html: #claude-notice antes de #projects y #hidden-toggle después, dentro de #list-view', () => {
  const listStart = indexHtml.indexOf('id="list-view"');
  const listEnd = indexHtml.indexOf('id="detail"');
  const notice = indexHtml.indexOf('id="claude-notice"');
  const projects = indexHtml.indexOf('id="projects"');
  const toggle = indexHtml.indexOf('id="hidden-toggle"');
  const addForm = indexHtml.indexOf('id="add-project-form"');
  for (const [name, idx] of [['claude-notice', notice], ['hidden-toggle', toggle]]) {
    assert.ok(idx > listStart && idx < listEnd, `#${name} dentro de #list-view`);
  }
  assert.ok(notice < projects, '#claude-notice antes de #projects');
  assert.ok(toggle > projects, '#hidden-toggle después de #projects');
  assert.ok(toggle < addForm, '#hidden-toggle antes del formulario de alta');
  for (const name of ['name', 'path', 'appUrl', 'repoUrl', 'tags']) {
    assert.ok(indexHtml.slice(addForm).includes(`name="${name}"`), `campo ${name} del alta`);
  }
  assert.ok(indexHtml.includes('Los proyectos abiertos en Claude Code aparecen solos'), 'pie actualizado');
});

test('[F3-R51] styles.css define .badge.source-claude, .card.pinned, .card.is-hidden, .sessions y .notice', () => {
  for (const selector of ['.badge.source-claude', '.card.pinned', '.card.is-hidden', '.sessions', '.notice']) {
    const escaped = selector.replace(/\./g, '\\.');
    assert.match(css, new RegExp(`${escaped}[^{]*\\{[^}]*:`, 's'), `falta ${selector}`);
  }
  assert.match(css, /\.card\.is-hidden\s*\{[^}]*opacity:/s);
  assert.match(css, /\.btn\.icon\s*\{[^}]*min-width:\s*44px/s, 'botón de icono con 44 px');
  const base = baseCss(css);
  assert.match(base, /:root\s*\{[^}]*--claude:/s, '--claude en tema claro');
  assert.match(mediaBlock(css, '@media (prefers-color-scheme: dark)'), /--claude:/, '--claude en tema oscuro');
});

// ---------- Fase 4: vista "Trabajar", "Te necesitan" y diálogos (F4-R91) ----------

test('[F4-R91] index.html: #attention dentro de #list-view antes de #projects y diálogos <dialog> de confirmación y contraseña', () => {
  const listStart = indexHtml.indexOf('id="list-view"');
  const listEnd = indexHtml.indexOf('id="detail"');
  const attention = indexHtml.indexOf('id="attention"');
  const projects = indexHtml.indexOf('id="projects"');
  assert.ok(attention > listStart && attention < listEnd, '#attention dentro de #list-view');
  assert.ok(attention < projects, '#attention antes de #projects');
  assert.match(indexHtml, /<section[^>]*id="attention"[^>]*class="attention"[^>]*hidden|<section[^>]*class="attention"[^>]*id="attention"[^>]*hidden/, '#attention es una sección .attention oculta al principio');
  assert.match(indexHtml, /<dialog[^>]*id="confirm-dialog"/);
  assert.match(indexHtml, /<dialog[^>]*id="reauth-dialog"/);
  const reauth = indexHtml.slice(indexHtml.indexOf('id="reauth-dialog"'), indexHtml.indexOf('</dialog>', indexHtml.indexOf('id="reauth-dialog"')));
  assert.ok(reauth.includes('type="password"'), 'campo de contraseña');
  assert.ok(reauth.includes('role="alert"'), 'mensaje de error accesible');
  assert.ok(reauth.includes('Confirmar') && reauth.includes('Cancelar'));
  const confirm = indexHtml.slice(indexHtml.indexOf('id="confirm-dialog"'), indexHtml.indexOf('</dialog>', indexHtml.indexOf('id="confirm-dialog"')));
  assert.ok(confirm.includes('Confirmar') && confirm.includes('Cancelar'));
});

test('[F4-R91] app.js importa work.js', async () => {
  const appJs = await fs.readFile(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  assert.match(appJs, /from '\.\/work\.js'/);
  assert.ok(appJs.includes('EventSource'), 'salida en vivo con EventSource');
});

test('[F4-R91] styles.css define los selectores de la fase 4 con colores en variables para claro y oscuro', () => {
  for (const selector of ['.run-log', '.diff .add', '.diff .del', '.diff .hunk', '.diff .meta', '.attention', '.work-actions', '.ev-text', '.ev-tool', '.ev-error', '.ev-output', '.ev-notice']) {
    const escaped = selector.replace(/\./g, '\\.').replace(/ /g, '\\s+');
    assert.match(css, new RegExp(`${escaped}[^{]*\\{[^}]*:`, 's'), `falta ${selector}`);
  }
  for (const state of ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timeout', 'needs_permission']) {
    assert.match(css, new RegExp(`\\.state-${state}[^{]*\\{[^}]*:`, 's'), `falta .state-${state}`);
  }
  assert.match(css, /\.run-log\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.run-log\s*\{[^}]*max-height:\s*60vh/s);
  assert.match(css, /\.run-log\s*\{[^}]*monospace/s);
  assert.match(css, /dialog\s*\{[^}]*min\(92vw,\s*34rem\)/s);
  const base = baseCss(css);
  const dark = mediaBlock(css, '@media (prefers-color-scheme: dark)');
  for (const variable of ['--diff-add', '--diff-del', '--state-needs_permission']) {
    assert.match(base, new RegExp(`:root\\s*\\{[^}]*${variable}:`, 's'), `${variable} en tema claro`);
    assert.ok(dark.includes(`${variable}:`), `${variable} en tema oscuro`);
  }
  assert.match(css, /\.prompt-form textarea[^{]*\{[^}]*width:\s*100%/s, 'caja de mensaje a todo el ancho');
});

// ---------- Feature 13: lista compacta sin recortes, barra de la lista y estado del lote (F13-R50, F13-R51) ----------

/** Todas las reglas { selector, body } de un fragmento de CSS (sin anidar @media). */
function rules(source) {
  const out = [];
  for (const m of source.replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

/** Todos los bloques @media con esa condición (puede haber varios). */
function mediaBlocks(source, query) {
  const out = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(query, from);
    if (start < 0) return out;
    const block = mediaBlock(source.slice(start), query);
    out.push(block);
    from = start + block.length;
  }
}

const selectorMentions = (selector, cls) => new RegExp(`\\.${cls}(?![\\w-])`).test(selector);

test('[F13-R50] regla "nada recortado": sin text-overflow ni line-clamp, y sin max-height en fila, nombre, resumen, chips y tarjeta', () => {
  assert.ok(!/text-overflow/.test(css), 'text-overflow no aparece en styles.css');
  assert.ok(!/line-clamp/.test(css), 'line-clamp no aparece en styles.css');
  for (const cls of ['project-row', 'row-main', 'row-name', 'row-summary', 'row-chips', 'card', 'card-summary']) {
    const matching = rules(css).filter((r) => selectorMentions(r.selector, cls));
    assert.ok(matching.length > 0, `hay reglas para .${cls}`);
    for (const r of matching) {
      assert.ok(!/max-height/.test(r.body), `.${cls} sin max-height (${r.selector})`);
      if (['project-row', 'row-name', 'row-summary', 'row-chips'].includes(cls)) assert.ok(!/overflow:\s*hidden/.test(r.body), `.${cls} sin overflow: hidden (${r.selector})`);
    }
  }
  const base = baseCss(css);
  assert.match(base, /\.row-name\s*\{[^}]*line-height:\s*20px/s);
  assert.match(base, /\.row-name\s*\{[^}]*white-space:\s*normal/s);
  assert.match(base, /\.row-summary\s*\{[^}]*line-height:\s*18px/s);
  assert.match(base, /\.row-summary\s*\{[^}]*white-space:\s*normal/s);
  assert.match(base, /\.row-chips\s*\{[^}]*flex-wrap:\s*wrap/s, 'los chips pasan de línea');
  assert.match(base, /\.row-main\s*\{[^}]*min-height:\s*44px/s);
  const wide = mediaBlocks(css, '@media (min-width: 601px)').join('\n');
  assert.match(wide, /\.row-main\s*\{[^}]*padding:\s*10px\s/s, 'relleno vertical de 10 px desde 601 px');
  assert.match(wide, /\.cards\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(260px,\s*1fr\)\)/s);
});

test('[F13-R50] botón "⋯" y selector de modelo con 44 px, menú y colores de chips en claro y oscuro', () => {
  assert.match(css, /\.row-menu-button\s*\{[^}]*min-width:\s*44px/s);
  assert.match(css, /\.row-menu-button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /#work-model\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.row-menu-list\s*\{[^}]*position:\s*absolute/s);
  assert.ok(rules(css).some((r) => selectorMentions(r.selector, 'filter') && selectorMentions(r.selector, 'view') && /min-height:\s*44px/.test(r.body)), '.filter y .view con 44 px');
  assert.match(css, /\.old-projects\s*>\s*summary\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.run-model\s*\{[^}]*:/s);
  const base = baseCss(css);
  const dark = mediaBlock(css, '@media (prefers-color-scheme: dark)');
  for (const variable of ['--chip-bg', '--chip-fg', '--chip-approval', '--chip-worktrees', '--row-hover']) {
    assert.match(base, new RegExp(`:root\\s*\\{[^}]*${variable}:`, 's'), `${variable} en tema claro`);
    assert.ok(dark.includes(`${variable}:`), `${variable} en tema oscuro`);
  }
  assert.match(css, /#projects\.view-list[^{]*\{[^}]*display:\s*block/s, 'la lista anula la rejilla');
});

test('[F13-R51] index.html: barra de la lista con buscador, filtros, vista, tareas sueltas, Generar resúmenes y #batch-status', async () => {
  const attention = indexHtml.indexOf('id="attention"');
  const toolbar = indexHtml.indexOf('id="list-toolbar"');
  const projects = indexHtml.indexOf('id="projects"');
  assert.ok(attention < toolbar && toolbar < projects, 'la barra va entre #attention y #projects');
  assert.match(indexHtml, /<div class="list-toolbar" id="list-toolbar">/);
  assert.match(indexHtml, /<label for="project-search" class="visually-hidden">Buscar proyectos<\/label>/);
  assert.match(indexHtml, /<input id="project-search" type="search" autocomplete="off" placeholder="Buscar por nombre, resumen o etiqueta">/);
  assert.match(indexHtml, /<div class="filters" role="group" aria-label="Filtrar proyectos">/);
  for (const [filter, label, pressed] of [['all', 'Todos', 'true'], ['active', 'Activos', 'false'], ['pinned', 'Fijados', 'false'], ['attention', 'Te necesitan', 'false']]) {
    assert.ok(indexHtml.includes(`<button type="button" class="filter" data-filter="${filter}" aria-pressed="${pressed}">${label}</button>`), filter);
  }
  assert.match(indexHtml, /<div class="view-toggle" role="group" aria-label="Vista">/);
  assert.ok(indexHtml.includes('<button type="button" class="view" data-view="list" aria-pressed="true">Lista</button>'));
  assert.ok(indexHtml.includes('<button type="button" class="view" data-view="cards" aria-pressed="false">Tarjetas</button>'));
  assert.ok(indexHtml.includes('<label class="loose-toggle"><input type="checkbox" id="loose-toggle"> Mostrar tareas sueltas</label>'));
  assert.ok(indexHtml.includes('<button type="button" class="btn" id="generate-summaries">Generar resúmenes</button>'));
  assert.ok(indexHtml.includes('<div id="batch-status" class="batch-status" hidden aria-live="polite"></div>'));
  const appJs = await fs.readFile(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  assert.match(appJs, /from '\.\/list\.js'/, 'app.js usa list.js');
});
