# Historial

> **¿Qué es esto?** El registro de TODO lo que se ha ido completando, en orden. Solo se
> AÑADE (no se borra). Es la memoria a largo plazo del proyecto: qué se hizo, cuándo y
> qué cambió. Cuando una feature pasa a `done`, su resumen se mueve aquí.

---

<!-- Formato sugerido por entrada:

## [fecha] · Feature N: <nombre>
- **Qué se hizo:** ...
- **Ficheros cambiados:** ...
- **Requisitos cubiertos:** R1, R2, ...
- **Tests añadidos:** ...
- **Notas / decisiones:** ...

-->

## 2026-10-25 · Feature 1: puesto-de-mando-base (Puesto de Mando MUVER, fase 1)
- **Qué se hizo:** Panel web local en `panel/` que lista los proyectos registrados,
  lee su estado real en disco (feature_list.json, progress/current.md, git), muestra
  tarjetas con semáforo (atencion / en_curso / inactivo / ok / no_encontrado), acceso
  directo a cada app, vista de detalle, alta y baja de proyectos desde la interfaz,
  escucha en la red local (0.0.0.0:4310), diseño mobile-first con tema claro/oscuro y
  manifest para "añadir a pantalla de inicio".
- **Ficheros cambiados:** `panel/**` (nuevo: server.js, lib/, public/, test/,
  projects.json, package.json), `init.sh` (ejecuta `npm test` del panel),
  `docs/verification.md` (trazabilidad), `docs/architecture.md` (arquitectura).
- **Requisitos cubiertos:** R1–R37 (`specs/puesto-de-mando-base/requirements.md`).
- **Tests añadidos:** 83 tests con `node:test` en `panel/test/` (registry, git-info,
  project-state, network, api, render, styles). `bash init.sh` en verde.
- **Notas / decisiones:** Node >= 18 sin dependencias; ESM; `git` solo vía `execFile`
  con argumentos fijos; sin autenticación (solo red de confianza) hasta la fase 2.
  Pendiente del humano: T27 (verificación manual en Windows/móvil), rutas reales y
  `appUrl` en `panel/projects.json`, y aportar `muver.html` para `panel/legacy/`.
  Mejoras anotadas por el reviewer (no bloqueantes): `detectBlock` solo lee la misma
  línea de "Bloqueos / esperando"; mensaje específico si `projects.json` está corrupto;
  subdirectorio de un repo padre muestra el repo padre. Revisión completa en
  `progress/review_puesto-de-mando-base.md`.
