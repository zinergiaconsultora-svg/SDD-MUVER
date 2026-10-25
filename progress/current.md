# Progreso actual

> **¿Qué es esto?** La foto de lo que se está haciendo AHORA mismo. Lo mantienen el
> leader y el implementer. Si cierras la sesión y la abres mañana, esto te dice por
> dónde ibas. (El histórico cerrado va a `history.md`.)

- **Feature en curso:** #2 `puesto-de-mando-acceso-web` — acceso web seguro (fase 2)
- **Estado:** `in_progress` (spec aprobada por el humano; implementer trabajando)
- **Tarea actual:** Implementación TDD de `specs/puesto-de-mando-acceso-web/tasks.md` (T1→T34)
- **Siguiente paso:** Implementer termina → humano revisa tests (puerta 2) → reviewer → done.
- **Bloqueos / esperando:** —

## Decisiones tomadas con el humano

- `panel-muver` se unifica dentro de este repo, en la carpeta `panel/`.
- Roadmap de 5 fases (ver `feature_list.json`): 1 base (hecha), 2 acceso web seguro,
  3 descubrimiento automático de proyectos de Claude Code, 4 trabajar desde el panel
  (Claude Code CLI + botones SDD), 5 visual y avisos push.
- Publicación en Internet con **Cloudflare Tunnel**; el humano tiene Claude Code CLI
  instalado en su PC Windows.
- Pendiente del humano: T27 de la fase 1 (prueba manual), rutas reales y `appUrl` en
  `panel/projects.json`, aportar `muver.html` para `panel/legacy/`.

---

_(Este fichero se sobrescribe a medida que avanza el trabajo.)_
