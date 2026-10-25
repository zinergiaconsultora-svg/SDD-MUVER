// Tests de lib/project-summary.js (feature 13, design.md §5.1): resumen automático sin coste a partir de
// package.json, README y CLAUDE.md — F13-R1 a F13-R7. Solo directorios temporales; nunca se escribe en un proyecto real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AUTO_SUMMARY_MAX_CHARS,
  MAX_READ_BYTES,
  SUMMARY_CACHE_TTL_MS,
  BOILERPLATE_PATTERNS,
  README_NAMES,
  readHead,
  firstSentence,
  clipAtWord,
  toOneSentence,
  extractFirstParagraph,
  readPackageDescription,
  findReadme,
  readAutoSummary,
  resolveSummary,
  createSummaryReader,
} from '../lib/project-summary.js';
import { makeTempDir, removeDir, makeClock } from './helpers.js';

const cleanup = [];
after(async () => {
  for (const dir of cleanup) await removeDir(dir);
});

async function tempProject(files = {}) {
  const dir = await makeTempDir('muver-f13-sum-');
  cleanup.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  return dir;
}

const ELLIPSIS = '…';
const chars = (s) => [...s].length;

/** fs/promises con espía: cuenta aperturas, lecturas (y los bytes pedidos) y readdir. */
function spyFs() {
  const calls = { open: 0, read: 0, readdir: 0, requestedBytes: [] };
  const impl = {
    async open(file, flags) {
      calls.open += 1;
      const handle = await fs.open(file, flags);
      return {
        async read(buffer, offset, length, position) {
          calls.read += 1;
          calls.requestedBytes.push(length);
          return handle.read(buffer, offset, length, position);
        },
        close: () => handle.close(),
      };
    },
    async readdir(dir, opts) {
      calls.readdir += 1;
      return fs.readdir(dir, opts);
    },
  };
  return { impl, calls, total: () => calls.open + calls.read + calls.readdir };
}

// ---------- Constantes ----------

test('[F13-R2][F13-R6] constantes de design.md §5.1', () => {
  assert.equal(AUTO_SUMMARY_MAX_CHARS, 160);
  assert.equal(MAX_READ_BYTES, 16384);
  assert.equal(SUMMARY_CACHE_TTL_MS, 300000);
  assert.deepEqual(README_NAMES, ['readme.md', 'readme.markdown', 'readme.txt', 'readme', 'leeme.md']);
  assert.deepEqual(BOILERPLATE_PATTERNS, [
    'this template provides a minimal setup',
    'this project was bootstrapped with',
    'this is a next.js project bootstrapped with',
    'this file provides guidance to claude code',
    'currently, two official plugins are available',
  ]);
});

// ---------- firstSentence, clipAtWord ----------

test('[F13-R3] firstSentence: corta en . ! ? seguidos de espacio o fin; v1.2, node.js y un punto pegado a letra no cortan', () => {
  assert.equal(firstSentence('Uno. Dos. Tres.'), 'Uno.');
  assert.equal(firstSentence('¡Hola! Qué tal.'), '¡Hola!');
  assert.equal(firstSentence('¿Qué es? Un panel.'), '¿Qué es?');
  assert.equal(firstSentence('Panel v1.2 con node.js para todo. Segunda.'), 'Panel v1.2 con node.js para todo.');
  assert.equal(firstSentence('Útil p.ej.para pymes. Y más.'), 'Útil p.ej.para pymes.');
  assert.equal(firstSentence('Sin punto final'), 'Sin punto final');
  assert.equal(firstSentence('Acaba en punto.'), 'Acaba en punto.');
});

test('[F13-R2][F13-R3] clipAtWord corta en el último espacio sin añadir «…»', () => {
  assert.equal(clipAtWord('corto', 160), 'corto');
  const long = 'palabra '.repeat(50).trim(); // 399 caracteres
  const clipped = clipAtWord(long, 160);
  assert.ok(chars(clipped) <= 160);
  assert.ok(!clipped.includes(ELLIPSIS));
  assert.ok(clipped.endsWith('palabra'), 'acaba en palabra entera');
  assert.ok(long.startsWith(clipped));
  assert.equal(clipAtWord('x'.repeat(200), 160), 'x'.repeat(160), 'sin espacios: los 160 primeros');
  assert.equal(toOneSentence('Primera frase. Segunda frase.', 160), 'Primera frase.');
});

// ---------- package.json ----------

test('[F13-R2] package.json: normal, saltos de línea, dos frases, una frase de 300, vacía, numérica y roto', async () => {
  const pkg = async (value) => readPackageDescription(await tempProject({ 'package.json': typeof value === 'string' ? value : JSON.stringify(value) }));
  assert.equal(await pkg({ description: 'CRM para pymes' }), 'CRM para pymes');
  assert.equal(await pkg({ description: '  CRM\n  para\tpymes  ' }), 'CRM para pymes');
  assert.equal(await pkg({ description: 'Gestor de facturas. Incluye informes.' }), 'Gestor de facturas.');
  const longSentence = `${'Gestiona clientes y propuestas '.repeat(10).trim()}.`; // ~300 caracteres sin punto interior
  const clipped = await pkg({ description: longSentence });
  assert.ok(chars(clipped) <= 160, clipped);
  assert.ok(!clipped.includes(ELLIPSIS));
  assert.ok(longSentence.startsWith(clipped));
  assert.ok(/\S$/.test(clipped) && longSentence[clipped.length] === ' ', 'corta en límite de palabra');
  assert.equal(await pkg({ description: '' }), null);
  assert.equal(await pkg({ description: '   ' }), null);
  assert.equal(await pkg({ description: 42 }), null);
  assert.equal(await pkg({ name: 'x' }), null);
  assert.equal(await pkg('{ "description": "Roto pero legible", '), 'Roto pero legible', 'JSON roto: se rescata por regex');
  assert.equal(await pkg('{ roto sin descripción'), null);
  assert.equal(await readPackageDescription(await tempProject({})), null, 'sin package.json');
});

test('[F13-R2][F13-R6] package.json de más de 16 KB con description en los primeros 16 KB', async () => {
  const big = `{ "description": "Panel con \\"comillas\\" escapadas", "padding": "${'x'.repeat(40000)}" }`;
  const dir = await tempProject({ 'package.json': big });
  assert.equal(await readPackageDescription(dir), 'Panel con "comillas" escapadas');
});

// ---------- extractFirstParagraph ----------

const README_BADGES = `# Mi proyecto

[![CI](https://img.example/ci.svg)](https://ci.example) [![npm](https://img.example/npm.svg)](https://npm.example)

Una herramienta para **gestionar** clientes desde el [navegador](https://example.com).
`;

const README_CENTER = `<p align="center"><img src="logo.png" alt="logo"></p>
<h1 align="center">App</h1>

Aplicación de reservas para restaurantes pequeños.
`;

const README_YAML = `---
title: Algo
description: no es el párrafo
---

Panel de control de proyectos con Claude Code.
`;

const README_COMMENT = `<!--
comentario de varias líneas
con texto que no cuenta
-->
Generador de informes semanales en PDF.
`;

const README_CODE = `\`\`\`bash
npm install
este texto no cuenta como párrafo
\`\`\`

    código indentado que tampoco cuenta

Servidor de pruebas para la API de pagos.
`;

const README_SETEXT = `Mi Proyecto
===========

Subtítulo
---------

Utilidad para sincronizar calendarios.
`;

test('[F13-R3] extractFirstParagraph salta títulos, insignias, HTML, YAML, comentarios, código y setext', () => {
  assert.equal(extractFirstParagraph(README_BADGES), 'Una herramienta para gestionar clientes desde el navegador.');
  assert.equal(extractFirstParagraph(README_CENTER), 'Aplicación de reservas para restaurantes pequeños.');
  assert.equal(extractFirstParagraph(README_YAML), 'Panel de control de proyectos con Claude Code.');
  assert.equal(extractFirstParagraph(README_COMMENT), 'Generador de informes semanales en PDF.');
  assert.equal(extractFirstParagraph(README_CODE), 'Servidor de pruebas para la API de pagos.');
  assert.equal(extractFirstParagraph(README_SETEXT), 'Utilidad para sincronizar calendarios.');
  assert.equal(extractFirstParagraph('# T\r\n\r\n> Cita con `código` y __énfasis__ y *cursiva* en snake_case.\r\n'), 'Cita con código y énfasis y cursiva en snake_case.');
  assert.equal(extractFirstParagraph('# T\n\n| a | b |\n|---|---|\n\n- uno\n- dos\n\n1. tres\n\nTexto [ref][1] final aquí.'), 'Texto ref final aquí.');
});

test('[F13-R3] extractFirstParagraph: primera frase, 400 caracteres sin «…», puntos sin espacio y solo títulos/listas', () => {
  assert.equal(extractFirstParagraph('Primera frase del párrafo. Segunda frase. Tercera frase.'), 'Primera frase del párrafo.');
  const long = `${'Este proyecto gestiona muchas cosas distintas '.repeat(9).trim()}.`;
  assert.ok(chars(long) >= 400);
  const clipped = extractFirstParagraph(long);
  assert.ok(chars(clipped) <= 160);
  assert.ok(!clipped.includes(ELLIPSIS));
  assert.ok(long.startsWith(clipped) && long[clipped.length] === ' ', 'acaba en palabra entera');
  assert.equal(extractFirstParagraph('Versión v1.2 del panel en node.js para pymes. Otra.'), 'Versión v1.2 del panel en node.js para pymes.');
  assert.equal(extractFirstParagraph('# Título\n\n## Otro\n\n- lista\n- más\n\n* y otra\n'), null);
  assert.equal(extractFirstParagraph('Corto.'), null, 'menos de 12 caracteres');
  assert.equal(extractFirstParagraph('123456789012345 !!!'), null, 'sin letras');
  assert.equal(extractFirstParagraph(''), null);
});

test('[F13-R5] extractFirstParagraph descarta las plantillas (Vite, CRA, Next.js, CLAUDE.md, plugins)', () => {
  const vite = '# React + TypeScript + Vite\n\nThis template provides a minimal setup to get React working in Vite with HMR.\n';
  const cra = '# Getting Started\n\nThis project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).\n';
  const next = 'This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://x).\n';
  const claude = '# CLAUDE.md\n\nThis file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.\n';
  const plugins = 'Currently, two official plugins are available:\n';
  for (const md of [vite, cra, next, claude, plugins]) assert.equal(extractFirstParagraph(md), null, md);
});

// ---------- Nombres de README, orden de orígenes y CLAUDE.md ----------

test('[F13-R4] findReadme: sin distinguir mayúsculas y en el orden de README_NAMES', async () => {
  assert.equal(await findReadme(await tempProject({ 'readme.md': 'x' })), 'readme.md');
  assert.equal(await findReadme(await tempProject({ 'README.txt': 'x', 'README.md': 'y' })), 'README.md');
  assert.equal(await findReadme(await tempProject({ 'LEEME.md': 'x' })), 'LEEME.md');
  assert.equal(await findReadme(await tempProject({ 'Readme': 'x', 'README.markdown': 'y' })), 'README.markdown');
  assert.equal(await findReadme(await tempProject({})), null);
  assert.equal(await findReadme(path.join(await tempProject({}), 'no-existe')), null);
});

test('[F13-R4] readAutoSummary: README.md gana a README.txt, LEEME.md y CLAUDE.md como último origen', async () => {
  assert.deepEqual(await readAutoSummary(await tempProject({ 'README.txt': 'Texto del fichero txt de ejemplo.', 'readme.md': 'Texto del fichero md de ejemplo.' })), { summary: 'Texto del fichero md de ejemplo.', summarySource: 'readme' });
  assert.deepEqual(await readAutoSummary(await tempProject({ 'LEEME.md': '# Hola\n\nProyecto documentado en español.' })), { summary: 'Proyecto documentado en español.', summarySource: 'readme' });
  const dir = await tempProject({ 'README.md': '# Solo título\n\n- lista\n', 'CLAUDE.md': '# Guía\n\nPanel para vigilar proyectos de Claude Code.' });
  assert.deepEqual(await readAutoSummary(dir), { summary: 'Panel para vigilar proyectos de Claude Code.', summarySource: 'claude-md' });
});

test('[F13-R5] una plantilla en README o en CLAUDE.md no es origen: se pasa al siguiente', async () => {
  const vite = 'This template provides a minimal setup to get React working in Vite.';
  assert.deepEqual(await readAutoSummary(await tempProject({ 'README.md': vite, 'CLAUDE.md': 'Gestor de turnos para la clínica.' })), { summary: 'Gestor de turnos para la clínica.', summarySource: 'claude-md' });
  assert.equal(await readAutoSummary(await tempProject({ 'CLAUDE.md': 'This file provides guidance to Claude Code when working here.' })), null);
  assert.equal(await readAutoSummary(await tempProject({ 'README.md': 'This project was bootstrapped with Create React App.' })), null);
});

test('[F13-R1] resolveSummary: manual → claude → package → readme → claude-md → null', async () => {
  const dir = await tempProject({
    'package.json': JSON.stringify({ description: 'Desde package.json.' }),
    'README.md': 'Desde el README del proyecto.',
    'CLAUDE.md': 'Desde el CLAUDE.md del proyecto.',
  });
  const reader = createSummaryReader({ ttlMs: 0 });
  const manual = { id: 'a', summary: 'Escrito  a mano', summarySource: 'manual', summaryAt: '2026-10-25T10:00:00.000Z' };
  const claude = { id: 'a', summary: 'De Claude', summarySource: 'claude', summaryAt: '2026-10-25T11:00:00.000Z' };
  assert.deepEqual(await resolveSummary(manual, dir, reader), { summary: 'Escrito a mano', summarySource: 'manual', summaryAt: '2026-10-25T10:00:00.000Z' });
  assert.deepEqual(await resolveSummary(claude, dir, reader), { summary: 'De Claude', summarySource: 'claude', summaryAt: '2026-10-25T11:00:00.000Z' });
  assert.deepEqual(await resolveSummary({ id: 'a', summary: 'Editado a mano sin origen' }, dir, reader), { summary: 'Editado a mano sin origen', summarySource: 'manual', summaryAt: null });
  assert.deepEqual(await resolveSummary(null, dir, reader), { summary: 'Desde package.json.', summarySource: 'package', summaryAt: null });
  assert.deepEqual(await resolveSummary({ id: 'a', summary: '' }, dir, reader), { summary: 'Desde package.json.', summarySource: 'package', summaryAt: null });
  await fs.rm(path.join(dir, 'package.json'));
  assert.deepEqual(await resolveSummary(null, dir, reader), { summary: 'Desde el README del proyecto.', summarySource: 'readme', summaryAt: null });
  await fs.rm(path.join(dir, 'README.md'));
  assert.deepEqual(await resolveSummary(null, dir, reader), { summary: 'Desde el CLAUDE.md del proyecto.', summarySource: 'claude-md', summaryAt: null });
  await fs.rm(path.join(dir, 'CLAUDE.md'));
  assert.deepEqual(await resolveSummary(null, dir, reader), { summary: null, summarySource: null, summaryAt: null });
  assert.deepEqual(await resolveSummary(null, null, reader), { summary: null, summarySource: null, summaryAt: null }, 'sin carpeta');
});

// ---------- Lectura acotada y robusta ----------

test('[F13-R6] README de 1 MB: se leen como mucho 16 384 bytes', async () => {
  const dir = await tempProject({ 'README.md': `Párrafo inicial del README grande.\n\n${'relleno '.repeat(131072)}` });
  const spy = spyFs();
  const result = await readAutoSummary(dir, { fsImpl: spy.impl });
  assert.deepEqual(result, { summary: 'Párrafo inicial del README grande.', summarySource: 'readme' });
  assert.ok(spy.calls.read >= 1);
  for (const n of spy.calls.requestedBytes) assert.ok(n <= MAX_READ_BYTES, `lectura de ${n} bytes`);
  const head = await readHead(path.join(dir, 'README.md'));
  assert.ok(Buffer.byteLength(head) <= MAX_READ_BYTES + 3 * 4, 'texto de la cabecera acotado');
});

test('[F13-R6] BOM, binario, README que es un directorio y carpeta inexistente: sin excepción', async () => {
  const bom = await tempProject({ 'README.md': '﻿Texto con BOM al principio del fichero.' });
  assert.equal(await readHead(path.join(bom, 'README.md')), 'Texto con BOM al principio del fichero.');
  assert.deepEqual(await readAutoSummary(bom), { summary: 'Texto con BOM al principio del fichero.', summarySource: 'readme' });
  const binary = await tempProject({ 'README.md': crypto.randomBytes(4096), 'package.json': crypto.randomBytes(512) });
  const fromBinary = await readAutoSummary(binary);
  assert.ok(fromBinary === null || typeof fromBinary.summary === 'string');
  const dirReadme = await tempProject({ 'README.md/dentro.txt': 'x', 'CLAUDE.md': 'El CLAUDE.md sí tiene un párrafo.' });
  assert.equal(await readHead(path.join(dirReadme, 'README.md')), null);
  assert.deepEqual(await readAutoSummary(dirReadme), { summary: 'El CLAUDE.md sí tiene un párrafo.', summarySource: 'claude-md' });
  const missing = path.join(await tempProject({}), 'no-existe');
  assert.equal(await readHead(path.join(missing, 'README.md')), null);
  assert.equal(await readAutoSummary(missing), null);
  assert.equal(await createSummaryReader().read(missing), null);
});

test('[F13-R7] createSummaryReader: caché de 5 min por carpeta con reloj inyectado', async () => {
  const dir = await tempProject({ 'README.md': 'Primera versión del README.' });
  const clock = makeClock(Date.parse('2026-10-25T10:00:00Z'));
  const spy = spyFs();
  const reader = createSummaryReader({ now: clock.now, fsImpl: spy.impl });
  assert.deepEqual(await reader.read(dir), { summary: 'Primera versión del README.', summarySource: 'readme' });
  const afterFirst = spy.total();
  assert.ok(afterFirst > 0);
  await fs.writeFile(path.join(dir, 'README.md'), 'Segunda versión del README.');
  clock.advance(4 * 60000);
  assert.deepEqual(await reader.read(dir), { summary: 'Primera versión del README.', summarySource: 'readme' });
  assert.equal(spy.total(), afterFirst, 'a los 4 min no se toca el disco');
  clock.advance(60000 + 1000);
  assert.deepEqual(await reader.read(dir), { summary: 'Segunda versión del README.', summarySource: 'readme' });
  assert.ok(spy.total() > afterFirst, 'a los 5 min 1 s se vuelve a leer');
  // También se guarda en caché la ausencia de resumen y se deduplican lecturas simultáneas.
  const empty = await tempProject({});
  const before = spy.total();
  const [a, b] = await Promise.all([reader.read(empty), reader.read(empty)]);
  assert.equal(a, null);
  assert.equal(b, null);
  const once = spy.total() - before;
  await reader.read(empty);
  assert.equal(spy.total() - before, once, 'null también en caché');
});

test('[F13-R1][F13-R2][F13-R3] ningún resumen automático contiene «…»', async () => {
  const long = 'x '.repeat(400);
  const dir = await tempProject({ 'package.json': JSON.stringify({ description: long }) });
  const fromPkg = await readAutoSummary(dir);
  assert.ok(!fromPkg.summary.includes(ELLIPSIS));
  assert.ok(!extractFirstParagraph(`${'texto largo '.repeat(80)}`).includes(ELLIPSIS));
});
