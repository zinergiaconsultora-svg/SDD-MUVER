#!/usr/bin/env bash
# init.sh — El "guardián" del arnés.
# El leader está OBLIGADO a ejecutarlo antes de empezar a trabajar y al verificar.
# Comprueba que el entorno está bien, que existen los ficheros necesarios y que los
# tests pasan. Adáptalo a la tecnología real del proyecto (Node, Python, etc.).

set -e

echo "==> [init] Verificando estructura del proyecto..."

# 1. Comprobar ficheros y carpetas imprescindibles del arnés
for f in feature_list.json CLAUDE.md AGENTS.md CHECKPOINTS.md docs specs progress; do
  if [ ! -e "$f" ]; then
    echo "ERROR: falta '$f' en la raíz del proyecto."
    exit 1
  fi
done
echo "    OK: estructura del arnés presente."

# 2. Comprobar que no hay más de UNA feature in_progress
in_progress=$(grep -o '"status": *"in_progress"' feature_list.json | wc -l | tr -d ' ')
if [ "$in_progress" -gt 1 ]; then
  echo "ERROR: hay $in_progress features 'in_progress'. Solo se permite UNA a la vez."
  exit 1
fi
echo "    OK: como mucho una feature in_progress ($in_progress)."

# 3. Ejecutar los tests del proyecto
#    >>> DESCOMENTA / ADAPTA la línea de tu tecnología <<<
echo "==> [init] Ejecutando tests..."
# npm test            # Node / JavaScript
# pytest -q           # Python
# go test ./...       # Go
echo "    (Configura aquí el comando de tests de tu proyecto.)"

# 4. Verificación de disciplina TDD
if [ "$in_progress" -eq 1 ]; then
  echo "==> [init] Verificando disciplina TDD..."
  # Buscar si hay archivos de test nuevos o modificados en git
  test_changes=$(git status --porcelain 2>/dev/null | grep -E "test|spec" || true)
  if [ -z "$test_changes" ]; then
    echo "    WARNING [TDD]: No se detectan cambios locales en archivos de test (*test*, *spec*)."
    echo "    Recuerda: En SDD se implementan los tests ANTES que el código de producción."
  else
    echo "    OK [TDD]: Se detectan cambios/nuevos archivos de test activos."
  fi
fi

# 5. Ejecutar Validador Semántico (Linter de Specs)
if [ -f "sdd-lint.js" ]; then
  echo "==> [init] Ejecutando linter de especificaciones (sdd-lint)..."
  node sdd-lint.js || {
    echo "ERROR [LINT]: Las especificaciones tienen errores graves. Corrígelas antes de continuar."
    exit 1
  }
fi

echo "==> [init] Entorno verificado correctamente."
