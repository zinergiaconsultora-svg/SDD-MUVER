# Requisitos — Feature: Alta de cliente (EJEMPLO)

> Esta carpeta `_ejemplo-feature/` es solo una MUESTRA para que veas el formato.
> El `spec_author` creará una carpeta por cada feature real. Bórrala cuando quieras.

## Requisitos (EARS)

- **R1.** Cuando el usuario rellena el formulario de alta y pulsa "Guardar" con todos
  los campos obligatorios, el sistema debe crear el cliente y mostrarlo en el listado.
  - *Cómo se prueba:* test que envía datos válidos y comprueba que el cliente aparece.

- **R2.** Si el usuario intenta guardar sin email, entonces el sistema debe rechazar el
  guardado y mostrar el error junto al campo email.
  - *Cómo se prueba:* test que envía datos sin email y comprueba que no se crea y sale el error.

- **R3.** Si el email ya existe en otro cliente, entonces el sistema debe rechazar el
  guardado y avisar de que está duplicado.
  - *Cómo se prueba:* test que crea un cliente y luego intenta otro con el mismo email.
