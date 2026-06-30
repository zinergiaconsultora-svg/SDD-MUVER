# CHECKPOINTS.md — Criterios de "terminado"

> **¿Qué es esto?** La definición de cuándo algo está REALMENTE hecho. Lo escriben
> los humanos. El `reviewer` lo usa para aceptar o rechazar. Si construye un dev
> humano (en vez de la IA), este fichero es tu lista de criterios de aceptación.

## Una feature está "terminada" (DONE) cuando:

- [ ] Todos los requisitos (R<n>) de `requirements.md` están implementados.
- [ ] **Cada requisito tiene al menos un test** que lo comprueba (trazabilidad R ↔ test).
- [ ] Todos los tests pasan (`init.sh` en verde).
- [ ] Todas las tareas de `tasks.md` están marcadas como completadas.
- [ ] El código sigue las convenciones de `docs/conventions.md`.
- [ ] El humano ha aprobado en las dos puertas (spec y tests).
- [ ] El cambio queda registrado en `progress/history.md`.

## Criterios de calidad transversales (válidos para todo el proyecto)

> Rellena con lo específico de este proyecto. Ejemplos:

- [ ] No se rompe ninguna funcionalidad anterior.
- [ ] Los errores se gestionan (no "peta" sin más; se muestra un mensaje útil).
- [ ] Los datos sensibles no quedan expuestos.
- [ ]

## "Estado final correcto" (qué debe ser verdad al acabar)

> Describe en una frase cómo debe quedar el sistema tras esta feature. Ej:
> "El usuario puede crear un cliente y aparece en el listado, con sus datos validados."

-
