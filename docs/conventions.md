# docs/conventions.md — Convenciones del proyecto

> **¿Qué es esto, en cristiano?** Las normas de estilo: cómo se nombran las cosas y
> cómo se ordena el código, para que todo sea coherente. **Esto casi nunca lo decides
> tú**: se usan valores por defecto sensatos. Lo dejamos aquí escrito para que la IA
> los respete y todo el código se parezca, lo escriba quien lo escriba.

## Idioma
- **Código (nombres de variables, funciones):** inglés (estándar) salvo que se indique.
- **Comentarios y documentación:** español.
- **Textos visibles al usuario:** español.

## Nombres
> Valores por defecto razonables; ajústalos según la tecnología real.

- **Variables y funciones:** `camelCase`.
- **Clases / componentes:** `PascalCase`.
- **Constantes:** `MAYUSCULAS_CON_GUION_BAJO`.
- **Ficheros:** coherentes con el framework elegido.

## Estilo de código
- Usar el formateador automático del lenguaje (ej. Prettier, Black) si existe.
- Funciones cortas y con un solo propósito.
- Nombres descriptivos antes que comentarios que expliquen nombres malos.

## Gestión de errores
- No dejar que el programa "pete" sin mensaje: capturar y mostrar un error útil.
- No exponer datos sensibles en los mensajes de error.

## Tests
- Cada requisito (R<n>) → al menos un test. Ver `docs/verification.md`.

## Commits (si se usan)
- Mensajes claros y en español: "Añade validación de email en alta de cliente".

> Adapta este fichero a la tecnología concreta del proyecto cuando se decida.
