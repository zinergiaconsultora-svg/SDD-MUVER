#!/usr/bin/env node

/**
 * sdd-lint.js — Validador Semántico de Especificaciones EARS
 * Analiza specs/ en busca de requisitos vagos, mala estructura y falta de trazabilidad.
 */

const fs = require('fs');
const path = require('path');

const SPECS_DIR = path.join(process.cwd(), 'specs');

// Palabras ambiguas prohibidas en requisitos medibles
const AMBIGUOUS_WORDS = [
  'rápido', 'rapido', 'eficiente', 'fácil', 'facil', 'amigable', 'estable', 'seguro', 'a veces',
  'fast', 'efficient', 'easy', 'friendly', 'stable', 'secure', 'sometimes', 'adecuado', 'apropiado'
];

let totalErrors = 0;
let totalWarnings = 0;

console.log('\x1b[36m==========================================================\x1b[0m');
console.log('\x1b[36m   SDD LINT — Validador Semántico de Requisitos EARS      \x1b[0m');
console.log('\x1b[36m==========================================================\x1b[0m');

if (!fs.existsSync(SPECS_DIR)) {
  console.log('No se encontró la carpeta specs/. Omitiendo análisis.');
  process.exit(0);
}

// Obtener todas las subcarpetas de features
const features = fs.readdirSync(SPECS_DIR).filter(file => {
  const fullPath = path.join(SPECS_DIR, file);
  return fs.statSync(fullPath).isDirectory() && !file.startsWith('.') && !file.startsWith('_');
});

if (features.length === 0) {
  console.log('No se encontraron features para analizar en specs/.');
  process.exit(0);
}

features.forEach(feature => {
  console.log(`\nAnalyzing feature: \x1b[35m${feature}\x1b[0m`);
  const featureDir = path.join(SPECS_DIR, feature);

  const reqFile = path.join(featureDir, 'requirements.md');
  const tasksFile = path.join(featureDir, 'tasks.md');

  // 1. Validar requirements.md
  if (fs.existsSync(reqFile)) {
    validateRequirements(reqFile, feature);
  } else {
    console.log(`  \x1b[31m[ERROR]\x1b[0m Falta el archivo requirements.md`);
    totalErrors++;
  }

  // 2. Validar tasks.md
  if (fs.existsSync(tasksFile)) {
    validateTasks(tasksFile, feature, reqFile);
  } else {
    console.log(`  \x1b[31m[ERROR]\x1b[0m Falta el archivo tasks.md`);
    totalErrors++;
  }
});

console.log('\n\x1b[36m----------------------------------------------------------\x1b[0m');
console.log(`Resultados: \x1b[31m${totalErrors} Errores\x1b[0m, \x1b[33m${totalWarnings} Advertencias\x1b[0m`);
console.log('\x1b[36m==========================================================\x1b[0m');

if (totalErrors > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

function validateRequirements(filePath, feature) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  // Buscar requisitos del tipo R1, R2 o [REQ-XXX]
  const reqRegex = /(R\d+|\[REQ-\d+\])/g;
  let reqCount = 0;

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const match = line.match(reqRegex);

    if (match) {
      reqCount++;
      const reqId = match[0];

      // Verificar formato EARS: Si/Cuando ... el sistema debe ...
      const cleanLine = line.toLowerCase();
      const hasCondition = cleanLine.includes('si ') || cleanLine.includes('cuando ') || cleanLine.includes('if ') || cleanLine.includes('when ');
      const hasAction = cleanLine.includes('debe') || cleanLine.includes('shall') || cleanLine.includes('should') || cleanLine.includes('must');

      if (!hasCondition || !hasAction) {
        console.log(`  \x1b[33m[WARNING]\x1b[0m Línea ${lineNum}: El requisito ${reqId} no parece cumplir el patrón condicional EARS ("Cuando/Si... el sistema debe...")`);
        totalWarnings++;
      }

      // Buscar palabras ambiguas
      AMBIGUOUS_WORDS.forEach(word => {
        const wordRegex = new RegExp(`\\b${word}\\b`, 'i');
        if (wordRegex.test(line)) {
          console.log(`  \x1b[33m[WARNING]\x1b[0m Línea ${lineNum}: El requisito ${reqId} contiene palabra ambigua/no medible: "${word}"`);
          totalWarnings++;
        }
      });
    }
  });

  if (reqCount === 0) {
    console.log(`  \x1b[31m[ERROR]\x1b[0m No se detectaron requisitos estructurados (R1, R2, [REQ-xxx]) en requirements.md`);
    totalErrors++;
  } else {
    console.log(`  \x1b[32m[OK]\x1b[0m Detectados ${reqCount} requisitos válidos.`);
  }
}

function validateTasks(filePath, feature, reqFilePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let taskCount = 0;
  let traceWarnings = 0;

  // Extraer requisitos existentes de requirements.md si existe
  let reqIds = [];
  if (fs.existsSync(reqFilePath)) {
    const reqContent = fs.readFileSync(reqFilePath, 'utf8');
    const matches = reqContent.match(/(R\d+|REQ-\d+)/g);
    if (matches) {
      reqIds = matches.map(id => id.replace(/[\[\]]/g, ''));
    }
  }

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    // Si la línea es una tarea (- [ ] o - [x])
    if (line.trim().startsWith('- [') || line.trim().startsWith('* [')) {
      taskCount++;

      // Verificar trazabilidad: debe mencionar un R<n> o REQ-<n>
      const hasTrace = /(R\d+|REQ-\d+)/i.test(line);
      if (!hasTrace) {
        console.log(`  \x1b[33m[WARNING]\x1b[0m Línea ${lineNum} (tasks.md): La tarea no tiene trazabilidad (ej: no menciona qué [R1] o [REQ-001] resuelve)`);
        totalWarnings++;
        traceWarnings++;
      }
    }
  });

  if (taskCount === 0) {
    console.log(`  \x1b[31m[ERROR]\x1b[0m No se encontraron tareas (- [ ]) definidas en tasks.md`);
    totalErrors++;
  } else {
    console.log(`  \x1b[32m[OK]\x1b[0m Detectadas ${taskCount} tareas. (${taskCount - traceWarnings}/${taskCount} con trazabilidad activa).`);
  }
}
