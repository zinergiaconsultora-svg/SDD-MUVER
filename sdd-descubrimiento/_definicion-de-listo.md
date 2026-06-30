# Definición de Listo (Definition of Ready)

> **Para qué sirve:** esta es la checklist que decide cuándo la Fase A está "lista"
> para pasar a construir. **El Analista (la IA) la usa para avisarte** — tú no
> tienes que adivinarlo. No hace falta el 100%: hace falta que lo que quede sin
> resolver sean **detalles menores que no bloqueen** empezar.

---

## Imprescindibles (sin esto NO se pasa a construir)

- [ ] **Para qué.** Está claro el problema/dolor que el software resuelve y para quién.
- [ ] **Alcance de la primera entrega.** Sabemos qué entra en la primera versión y qué se deja para después.
- [ ] **Requisitos.** Hay una lista de requisitos en EARS y **cada uno se puede probar** (se entiende cómo comprobar que está bien).
- [ ] **Datos.** Está claro qué información maneja el sistema (las "tablas" principales y qué guarda cada una).
- [ ] **Procesos clave.** Los flujos importantes están descritos paso a paso (qué pasa desde que… hasta que…).
- [ ] **Integraciones.** Está identificado con qué sistemas externos hay que hablar (aunque falte el detalle técnico, que puede ir como pendiente).
- [ ] **Cimientos.** Hay una arquitectura a alto nivel y unas convenciones (aunque sean los valores por defecto propuestos por la IA).

## Deseables (mejoran, pero no bloquean)

- [ ] Mockups o ejemplos visuales de las pantallas principales.
- [ ] Prioridad de las features (qué es más urgente).
- [ ] Reglas de negocio "raras" o casos límite ya pensados.

## Lo que SÍ puede quedar pendiente

- Detalles técnicos de una integración (a confirmar con el dev del otro sistema).
- Datos concretos que solo tiene el cliente (tarifas exactas, listados…).
- Funcionalidades de fases posteriores.

> Todo lo pendiente debe estar **anotado** en `07-pendientes-cliente.md`, no en la cabeza de nadie.

---

## Veredicto

Cuando los **imprescindibles** estén marcados, el Analista escribe aquí:

- **Estado:** ☐ En progreso · ☐ LISTO para construir
- **Fecha del veredicto:**
- **Qué queda pendiente (menor):**
- **Recomendación** (construir con IA / pasar a dev humano):
