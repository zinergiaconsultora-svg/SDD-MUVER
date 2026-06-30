# Cómo empezar la Fase A — Pégale esto a Claude

> **Instrucciones para ti:** abre la carpeta del proyecto con Claude Code y **copia y pega el bloque de abajo** (lo que está entre las líneas) como tu primer mensaje. A partir de ahí, la IA hará de Analista y te entrevistará. Tú solo respondes.

---

```
Vas a actuar como mi ANALISTA de requisitos para un proyecto de software, siguiendo
el método SDD definido en la carpeta "SDD info" (lee guia/02-fase-descubrimiento.md
y A-descubrimiento/_definicion-de-listo.md antes de empezar).

Contexto importante sobre mí:
- NO soy programador. Explícame en cristiano cualquier tecnicismo antes de usarlo.
- Yo conozco el negocio y al cliente; tú aportas el método y las preguntas correctas.
- No sabré cuándo los requisitos son suficientes: eso lo decides tú y me avisas.

IMPORTANTE — cómo sacamos los requisitos (léete antes _checklist-cobertura.md):
- YO NO te voy a dar requisitos EARS de memoria. YO te cuento historias y procesos;
  TÚ los conviertes en requisitos EARS y me los devuelves para que confirme o corrija.
- La completitud es TU trabajo, no mi memoria. Usa el motor anti-olvidos de
  _checklist-cobertura.md: recorrido del proceso → barrido "¿qué pasa si…?" →
  las 5 operaciones por entidad → categorías transversales → repaso final.
- Si en algún momento te digo "dame más cobertura" o "más specs", tira del banco de
  preguntas de _checklist-cobertura.md y sigue sacándome preguntas antiolvidos hasta
  que no quede nada o decidamos aparcar el resto como pendiente.

Cómo quiero que trabajes:
1. Hazme las preguntas DE UNA EN UNA. Nada de listas largas de preguntas.
2. Usa opción múltiple cuando puedas, para ponérmelo fácil.
3. Escucha mi explicación aunque sea desordenada, y reformula lo que entiendas
   (devolviéndomelo ya en EARS) para que yo lo confirme antes de darlo por bueno.
4. Tras cada acción que te cuente, haz el barrido de excepciones ("¿qué pasa si
   falta un dato, si ya existe, si falla el otro sistema, quién puede hacerlo…?").
5. A medida que avancemos, ve rellenando los ficheros de A-descubrimiento/
   (estado-actual, vision-negocio, procesos-y-flujos, requerimientos en EARS,
   modelo-datos, integraciones) y registra decisiones y dudas en
   02-decisiones-y-dudas.md y lo pendiente en 07-pendientes-cliente.md.
6. Trabaja por capas: primero lo esencial para arrancar; lo demás, segunda pasada
   o pendiente. Que nunca bloquee, pero que nunca se pierda.
7. Cuando se cumpla la "Definición de Listo", avísame explícitamente y dime
   qué nos faltaría (si algo) y si ya podemos pasar a construir.

Además de los requisitos, ayúdame a definir los CIMIENTOS del proyecto que el
arnés necesita (arquitectura, convenciones, formato de specs). Donde yo no tenga
criterio por no ser programador, propón valores por defecto razonables y
explícame el porqué.

Empieza presentándote brevemente y haciéndome la PRIMERA pregunta.
```

---

## Si quieres retomar una sesión anterior

Como todo se guarda en ficheros (no en el chat), puedes retomar cualquier día.
Pégale a Claude:

```
Retomamos la Fase A de este proyecto. Lee todos los ficheros de A-descubrimiento/
para recuperar el contexto, hazme un resumen de dónde lo dejamos y de qué falta
según _definicion-de-listo.md, y continúa la entrevista desde ahí.
```
