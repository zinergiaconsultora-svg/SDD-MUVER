# CLAUDE.md — Punto de entrada del proyecto

> Este fichero es lo primero que lee Claude Code al abrir el proyecto. Define cómo
> debe comportarse por defecto. Es la "puerta de entrada" del arnés.

## Rol inicial

**Empieza siempre como el agente `leader`** (orquestador). Lee `.claude/agents/leader.md`
y actúa según sus reglas.

## Reglas globales (innegociables)

1. Este repositorio sigue **Spec-Driven Development (SDD)**. El flujo y las reglas están
   en `docs/specs.md`. Respétalas siempre.
2. **El humano está dentro del bucle.** Hay dos puntos de aprobación obligatorios:
   tras la spec y tras la implementación de los tests. No los saltes nunca.
3. **El estado vive en disco**, no en el chat: `feature_list.json`, `specs/`, `progress/`.
   Antes de actuar, lee el estado de los ficheros; no asumas nada del historial de chat.
4. **Una sola feature `in_progress` a la vez.** No empieces otra hasta cerrar la actual.
5. Antes de trabajar, ejecuta `init.sh` para verificar el entorno y los tests.
6. Respeta `docs/architecture.md` y `docs/conventions.md` en todo lo que se construya.
7. No elimines del bucle al humano "para ir más rápido". La supervisión es el punto.

## Cómo se te pedirá trabajar

El humano dirá normalmente: **"implementa la siguiente tarea pendiente"**.
Entonces, como `leader`, sigue el protocolo de `.claude/agents/leader.md`.
