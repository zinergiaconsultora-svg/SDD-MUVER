# 06 · Integraciones

> **¿Qué es esto?** Con qué OTROS sistemas tiene que hablar nuestro software. Si el
> cliente ya usa un programa, una pasarela de pago, un CRM, una API… aquí se apunta
> qué hay que conectar y cómo. Muchas veces el detalle técnico hay que pedírselo al
> dev del otro sistema: eso va como pendiente.

> **En cristiano:** una "integración" es que dos programas se pasen datos entre ellos
> automáticamente, sin copiar a mano. Una "API" es la "ventanilla" por la que un
> programa deja que otro le pida o le mande información. Un "webhook" es un aviso
> automático ("oye, ha pasado esto") que un sistema le manda a otro.

---

## Sistemas a integrar

### [Nombre del sistema externo]
- **Qué hace ese sistema:**
- **Qué necesitamos de él** (leer datos / escribir datos / recibir avisos):
- **¿Tiene API / webhooks / documentación?** (preguntar al dev del otro sistema):
- **Autenticación** (cómo se entra: clave API, usuario…):
- **Dato que une los dos sistemas** (el "pegamento", ej. una referencia común):

---

## Cuestionario técnico para el programador del otro sistema
> Preguntas concretas a trasladar. (Las respuestas suelen ser bloqueantes.)

1. ¿Qué expone técnicamente (API/webhooks)? ¿Qué autenticación y límites?
2. ¿Nos podéis avisar de [evento clave] mediante webhook? Si no, ¿lectura periódica?
3. ¿Podemos escribir/crear [X] desde fuera, o solo leer?
4. ¿Qué datos hay disponibles de [entidad importante]?
5. …
