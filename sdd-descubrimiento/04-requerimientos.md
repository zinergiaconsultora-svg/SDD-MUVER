# 04 · Requerimientos (en notación EARS)

> **¿Qué es esto?** EL ENTREGABLE central de la Fase A: la lista de cosas que el
> software debe hacer, escritas de forma que **cada una se pueda probar**. Usamos la
> notación **EARS**, que es una plantilla fija muy sencilla.

> **¿Qué es EARS, en cristiano?** Una forma de escribir cada requisito con el patrón:
> **"Cuando [situación], el sistema debe [comportamiento concreto]."**
> Ejemplo: *"Cuando el usuario guarda un lead sin teléfono, el sistema debe mostrar un aviso y no guardar."*
> La gracia: cada requisito así se convierte directamente en un test (1 requisito → 1 test).

> **Lo rellena el Analista** a partir de la visión y los flujos. Tú lo revisas y dices
> si refleja lo que querías.

> **No saques los requisitos de memoria.** Tú cuentas el negocio en historias; el
> Analista los deriva en EARS y hace el barrido anti-olvidos de `_checklist-cobertura.md`
> (recorrido del proceso → "¿qué pasa si…?" → 5 operaciones por entidad → categorías
> transversales). Si quieres más cobertura, pídela: el Analista seguirá sacando preguntas.

---

## Plantillas EARS útiles

- **Normal:** "Cuando [evento], el sistema debe [respuesta]."
- **Mientras (estado continuo):** "Mientras [estado], el sistema debe [respuesta]."
- **Si (condición/error):** "Si [condición no deseada], entonces el sistema debe [respuesta]."
- **Siempre (ubicuo):** "El sistema debe [respuesta]." (reglas que valen siempre)

---

## Requisitos

> Numéralos R1, R2… Agrúpalos por funcionalidad (feature) si son muchos.

### Feature: [nombre]

- **R1.** Cuando … , el sistema debe … .
  - *Cómo se prueba:* …
- **R2.** Si … , entonces el sistema debe … .
  - *Cómo se prueba:* …

### Feature: [nombre]

- **R3.** …

---

> Cada `R` debería poder convertirse en al menos un test. Si un requisito no se puede
> probar, probablemente está mal escrito o es demasiado vago: el Analista lo afinará.
