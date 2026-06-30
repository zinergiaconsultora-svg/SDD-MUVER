# AGENTS.md — Mapa de agentes

> Este fichero es un MAPA (divulgación progresiva): da una visión general de los
> agentes y dónde está cada cosa, sin abrumar. Cada agente tiene su fichero detallado
> en `.claude/agents/`.

## Los cuatro agentes

| Agente | Fichero | Trabajo | Nunca hace |
|--------|---------|---------|------------|
| **leader** | `.claude/agents/leader.md` | Orquesta: mira el estado y lanza al agente que toca | Escribir código |
| **spec_author** | `.claude/agents/spec_author.md` | Redacta las 3 specs (requirements, design, tasks) | Implementar |
| **implementer** | `.claude/agents/implementer.md` | Escribe el código siguiendo `tasks.md` | Auto-aprobarse |
| **reviewer** | `.claude/agents/reviewer.md` | Valida specs ↔ tests, convenciones y checkpoints | Modificar código |

**Separación de responsabilidades:** ningún agente aprueba su propio trabajo. Esto
evita el conflicto de interés y mantiene la calidad.

## Dónde vive cada cosa

- **Estado de features:** `feature_list.json`
- **Especificaciones:** `specs/<feature>/{requirements,design,tasks}.md`
- **Progreso en curso:** `progress/current.md`
- **Historial (solo añadir):** `progress/history.md`
- **Cimientos del proyecto:** `docs/architecture.md`, `docs/conventions.md`, `docs/specs.md`, `docs/verification.md`
- **Criterios de "terminado":** `CHECKPOINTS.md`
- **Verificación del entorno:** `init.sh`

## Principio anti-"teléfono escacharrado"

Los agentes **escriben sus resultados en ficheros** y se pasan entre sí solo
referencias ligeras, no el chat entero. Así el contexto no se degrada al pasar de
un agente a otro.
