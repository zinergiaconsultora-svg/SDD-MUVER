# Progreso actual

> **¿Qué es esto?** La foto de lo que se está haciendo AHORA mismo. Lo mantienen el
> leader y el implementer. Si cierras la sesión y la abres mañana, esto te dice por
> dónde ibas. (El histórico cerrado va a `history.md`.)

- **Feature en curso:** #3 `puesto-de-mando-descubrimiento-claude` — los proyectos de Claude Code aparecen solos (fase 3)
- **Estado:** `in_progress` — implementación terminada (246 tests en verde, `init.sh` OK); **esperando revisión humana (puerta 2)**
- **Tarea actual:** T27 (verificación manual del humano en Windows); T1–T26 y T28 hechas
- **Siguiente paso:** Implementer termina → humano revisa tests (puerta 2) → reviewer → done.
- **Bloqueos / esperando:** aprobación humana de los tests (puerta 2) y verificación manual T27

## Decisiones tomadas con el humano

- `panel-muver` se unifica dentro de este repo, en la carpeta `panel/`.
- Roadmap de 5 fases (ver `feature_list.json`): 1 base (hecha), 2 acceso web seguro,
  3 descubrimiento automático de proyectos de Claude Code, 4 trabajar desde el panel
  (Claude Code CLI + botones SDD), 5 visual y avisos push.
- Publicación en Internet con **Cloudflare Tunnel**; el humano tiene Claude Code CLI
  instalado en su PC Windows.
- Pendiente del humano: T27 (fase 1) y T30/T31 (fase 2) manuales en Windows/móvil; rutas
  reales y `appUrl` en `panel/projects.json`; aportar `muver.html` para `panel/legacy/`.

---

_(Este fichero se sobrescribe a medida que avanza el trabajo.)_
