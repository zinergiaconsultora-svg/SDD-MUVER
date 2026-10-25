# Progreso actual

> **¿Qué es esto?** La foto de lo que se está haciendo AHORA mismo. Lo mantienen el
> leader y el implementer. Si cierras la sesión y la abres mañana, esto te dice por
> dónde ibas. (El histórico cerrado va a `history.md`.)

- **Feature en curso:** #1 `puesto-de-mando-base` — Puesto de Mando MUVER, fase 1
- **Estado:** `in_progress` — implementación terminada (83 tests en verde, `init.sh` OK); **esperando revisión humana de los tests (puerta 2)**
- **Tarea actual:** T27 (verificación manual del humano en Windows/móvil); T1–T26 y T28–T30 hechas
- **Siguiente paso:** El humano aprueba los tests → el leader lanza al reviewer → `done`.
- **Bloqueos / esperando:**
  - Aprobación humana de los tests (puerta 2) y verificación manual T27.
  - El humano debe aportar el `muver.html` actual de `panel-muver` (se guardará en
    `panel/legacy/muver.html`) y ajustar las rutas locales de `panel/projects.json`.

## Decisiones tomadas en esta sesión

- `panel-muver` se unifica dentro de este repo, en la carpeta `panel/`.
- El puesto de mando se divide en 3 features (fase 1 lectura + alta de proyectos +
  móvil; fase 2 acciones de desarrollo; fase 3 visual de lo hecho y avisos).
- Proyectos iniciales: app-flyder, appcc-real, crm-zinergia, app-finanzas-restaurante.

---

_(Este fichero se sobrescribe a medida que avanza el trabajo.)_
