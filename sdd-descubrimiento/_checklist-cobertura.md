# Checklist de cobertura de requisitos (motor anti-olvidos)

> **¿Qué es esto?** La herramienta que usa el Analista (la IA) para **garantizar que no
> se olvida nada** al sacar los requisitos. La completitud no depende de la memoria de
> Javi: depende de recorrer esta checklist sí o sí.

> **Cómo se usa:** la IA NO pregunta "dame el requisito 1". Conduce la conversación con
> las técnicas de abajo, **deriva los requisitos en EARS**, se los devuelve a Javi para
> que confirme/corrija, y va recorriendo las categorías. Cuando Javi diga "dame más
> cobertura", la IA tira del **banco de preguntas** del final y sigue.

---

## El método de trabajo (siempre así)

1. **Javi cuenta historias y procesos**, no requisitos. ("Cuando entra un lead, hacemos…")
2. **La IA deriva el requisito en EARS** y lo devuelve para confirmar.
   *Reconocer es más fácil que recordar.*
3. **La IA hace el barrido de excepciones** ("¿qué pasa si…?") sobre cada acción.
4. **La IA recorre las categorías transversales** (más abajo) una a una.
5. **Repaso final:** la IA devuelve la lista y pregunta "¿falta algo? ¿qué excepción rara?".
6. **Bucle bajo demanda:** si Javi pide más, la IA saca más preguntas del banco. No se
   "acaba" hasta que el repaso queda en seco o se decide aparcar el resto como pendiente.

> **Profundidad por capas:** primero lo **esencial para arrancar** (camino feliz + errores
> que rompen el negocio). Lo demás se ofrece como segunda pasada o se anota en
> `07-pendientes-cliente.md`. Así nunca bloquea, pero nunca se pierde.

---

## Técnica 1 · Recorrido del proceso (camino feliz)

Para cada proceso de `03-procesos-y-flujos.md`, la IA pregunta:
- "Cuéntame paso a paso, desde que [empieza] hasta que [termina]."
- Por cada paso: ¿quién lo hace? ¿qué datos entran? ¿qué decide? ¿qué pasa después?

De aquí sale el grueso de los requisitos "normales".

---

## Técnica 2 · Barrido "¿qué pasa si…?" (sobre cada acción)

Por **cada acción** que el usuario pueda hacer, la IA recorre estas excepciones:

| Excepción | Pregunta tipo |
|-----------|---------------|
| Dato faltante | ¿Y si este campo viene vacío? ¿Es obligatorio? |
| Dato inválido | ¿Y si está mal puesto (email raro, fecha imposible)? |
| Duplicado | ¿Y si ya existe? ¿Se detecta, se reutiliza, se rechaza? |
| Permiso | ¿Quién puede hacer esto y quién no? |
| Límite | ¿Hay un máximo/mínimo? ¿Y si es 0, negativo, o muchísimos? |
| Fallo externo | ¿Y si el otro sistema (pago, API) falla o no responde? |
| Fuera de orden | ¿Y si se intenta editar/borrar algo ya cerrado o usado? |
| Tiempo | ¿Caduca? ¿Y si la fecha es pasada/futura? |
| Deshacer | ¿Se puede cancelar/revertir? ¿Quién y hasta cuándo? |
| Visibilidad | ¿Qué se ve y qué se oculta, y para quién? |

---

## Técnica 3 · Las 5 operaciones por entidad

Por **cada "cosa"** del sistema (cliente, presupuesto, contrato, multa…), repasar:

- [ ] **Crear** — alta, con qué datos y validaciones.
- [ ] **Ver** — ficha de detalle, qué muestra.
- [ ] **Buscar / Listar** — cómo se encuentra entre muchos (filtros, orden). *(El más olvidado.)*
- [ ] **Editar** — qué se puede cambiar y qué no.
- [ ] **Borrar / Archivar** — ¿se borra de verdad o se archiva? ¿quién puede?

---

## Técnica 4 · Categorías transversales (recorrer una a una)

La IA pregunta por cada categoría que aplique al proyecto:

1. **Validaciones de datos** — formatos, obligatorios, rangos.
2. **Estados y transiciones** — ¿qué estados tiene una cosa y cómo pasa de uno a otro? (ej. lead: nuevo→contactado→ganado/perdido). ¿Transiciones prohibidas?
3. **Permisos y roles** — ¿quién ve/hace qué? (aunque ahora sea "un solo admin", dejarlo dicho).
4. **Notificaciones y avisos** — ¿hay que avisar a alguien? ¿cómo (email, en pantalla, push)? ¿cuándo?
5. **Búsqueda, filtros y orden** — cómo se navega entre muchos registros.
6. **Listados y volumen** — ¿cuántos registros habrá? ¿paginación? ¿exportar a Excel?
7. **Informes y métricas** — ¿qué números necesita ver el negocio?
8. **Integraciones** — qué se conecta con qué (ver `06-integraciones.md`).
9. **Auditoría e historial** — ¿hace falta saber quién hizo qué y cuándo?
10. **Adjuntos / ficheros / fotos** — ¿se suben documentos o imágenes? ¿formatos, tamaño?
11. **Reglas de negocio y cálculos** — precios, descuentos, impuestos, márgenes, fianzas.
12. **Configuración / parametrización** — ¿qué debe poder cambiar el cliente sin un programador (tarifas, textos…)?
13. **Importación / migración** — ¿hay datos viejos (Excel, sistema actual) que traer?
14. **Errores y mensajes** — qué ve el usuario cuando algo falla.
15. **Privacidad / datos sensibles** — datos personales, RGPD, qué se protege.
16. **Casos límite del mundo real** — "¿alguna situación rara que pase de verdad en el día a día?"

---

## Técnica 5 · Repaso final (crítico de completitud)

Antes de dar la Fase A por lista, la IA hace estas tres preguntas:
1. "Te leo la lista de requisitos. ¿Reconoces todo tu negocio aquí o falta algo?"
2. "¿Hay alguna excepción que pase en la realidad y no hayamos cubierto?"
3. "De lo que queda en `07-pendientes-cliente.md`, ¿algo es **bloqueante** para empezar?"

---

## 🧰 Banco de preguntas antiolvidos (para "dame más cobertura")

Cuando Javi pida profundizar, la IA tira de aquí. Son disparadores; se adaptan al proyecto.

**Sobre cada formulario / alta**
- ¿Qué campos son obligatorios y cuáles opcionales?
- ¿Algún campo se calcula solo o se rellena desde otro sitio?
- ¿Hay valores por defecto?
- ¿Se valida algo contra otro sistema (ej. DNI, matrícula)?

**Sobre estados y ciclo de vida**
- ¿Qué le puede pasar a esto a lo largo del tiempo?
- ¿Quién puede cambiar de estado y cuándo?
- ¿Hay estados sin retorno (cerrado, anulado)?
- ¿Qué pasa con lo que ya estaba al cambiar de estado?

**Sobre dinero / cálculos** (si aplica)
- ¿Cómo se calcula el precio exactamente? ¿Hay tramos, descuentos, recargos?
- ¿Impuestos? ¿Fianzas? ¿Portes? ¿Extras?
- ¿Quién puede aplicar un precio manual o un descuento?
- ¿Qué pasa con redondeos y céntimos?

**Sobre personas y permisos**
- ¿Cuántos perfiles de usuario hay? ¿Qué puede hacer cada uno?
- ¿Hay acciones que requieran aprobación de otra persona?

**Sobre comunicación**
- ¿A quién hay que avisar y de qué? (cliente, equipo, proveedor)
- ¿Por qué canal y en qué momento exacto?
- ¿Recordatorios? ¿Avisos de caducidad o vencimiento?

**Sobre datos y volumen**
- ¿Cuántos registros se manejan (decenas, miles)?
- ¿Hay que importar datos que ya existen?
- ¿Se exporta algo? ¿A qué formato?

**Sobre lo que puede salir mal**
- ¿Qué es lo peor que puede pasar en este proceso?
- ¿Qué error os haría perder dinero o un cliente?
- ¿Qué hacéis hoy cuando esto falla?

**Sobre el "no funcional" (calidad)**
- ¿Tiene que funcionar bien en móvil?
- ¿Cómo de rápido debe ir?
- ¿Hay momentos de pico (muchas operaciones a la vez)?
- ¿Algo es crítico que NUNCA falle?

> Esta lista es ampliable. Si en un proyecto aparece una categoría nueva, se añade aquí.
