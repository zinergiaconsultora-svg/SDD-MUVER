#!/usr/bin/env node
// Comando falso para los tests de "Ejecutar tests" (design.md §8.1).
// ok → stdout coloreado con ANSI y stderr "aviso", código 0; fail <n> → stdout "fallo", código n; sleep <ms> → espera y sale 0.
const [mode, value] = process.argv.slice(2);

if (mode === 'ok') {
  process.stdout.write('\x1b[32mtodo bien\x1b[0m\n');
  process.stderr.write('aviso\n');
  process.exitCode = 0;
} else if (mode === 'fail') {
  process.stdout.write('fallo\n');
  process.exitCode = Number.parseInt(value, 10) || 1;
} else if (mode === 'sleep') {
  setTimeout(() => {
    process.exitCode = 0;
  }, Number.parseInt(value, 10) || 0);
} else if (mode === undefined) {
  // Sin argumentos (p. ej. cuando `node --test` recorre test/): no hace nada.
  process.exitCode = 0;
} else {
  process.stderr.write(`modo desconocido: ${mode}\n`);
  process.exitCode = 9;
}
