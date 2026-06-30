# docs/specs.md — Reglas del proceso SDD y formato de specs

> **¿Qué es esto?** Aquí se define CÓMO se escriben las specs en este proyecto. Es la
> referencia que usa el `spec_author`. Normalmente se deja tal cual viene en la plantilla.

## El flujo SDD (resumen)

```
pending → (spec_author: 3 ficheros) → spec_ready → 🧍 humano aprueba →
in_progress → (implementer) → 🧍 humano revisa tests → (reviewer) → done
```

- Dos puertas de aprobación humana: tras la spec y tras los tests.
- Una feature `in_progress` a la vez.
- Cada feature tiene `sdd: true/false`; solo `true` pasa por todo el ritual.

## Los tres ficheros de cada spec (en `specs/<feature>/`)

1. **`requirements.md`** — QUÉ. Requisitos en notación EARS, numerados R1, R2…
2. **`design.md`** — CÓMO. Decisiones técnicas, ficheros a tocar y a NO tocar.
3. **`tasks.md`** — PASOS. Tareas T1, T2… marcables, en orden.

## Notación de requisitos: EARS

Usamos **EARS** porque cada requisito se traduce directo a un test.

| Tipo | Patrón |
|------|--------|
| Evento | "Cuando [evento], el sistema debe [respuesta]." |
| Estado | "Mientras [estado], el sistema debe [respuesta]." |
| Condición/error | "Si [condición], entonces el sistema debe [respuesta]." |
| Ubicuo | "El sistema debe [respuesta]." |

Ejemplo: *"Cuando el usuario guarda un cliente sin email, el sistema debe rechazar el guardado y mostrar el error junto al campo email."*

> Si prefieres historias de usuario o lenguaje natural en algún proyecto, cámbialo
> aquí. El arnés se adapta a lo que pongas en este fichero.

## Regla de trazabilidad

Cada requisito R<n> debe poder mapearse a **al menos un test**. El reviewer rechaza
cualquier feature sin ese mapeo.
