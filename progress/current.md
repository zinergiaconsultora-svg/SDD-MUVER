# Progreso actual

> **¿Qué es esto?** La foto de lo que se está haciendo AHORA mismo. Lo mantienen el
> leader y el implementer. Si cierras la sesión y la abres mañana, esto te dice por
> dónde ibas. (El histórico cerrado va a `history.md`.)

- **Feature en curso:** #13 `vista-compacta-y-resumen` — lista compacta, resumen de cada proyecto, worktrees agrupados y filtros
- **Estado:** `spec_ready` (61 requisitos, 27 tareas; lint 0/0) — **esperando aprobación humana (puerta 1)**
- **Tarea actual:** Revisión humana de `specs/vista-compacta-y-resumen/`; antes de implementar, el implementer debe partir del código de la feature 14
- **Siguiente paso:** Humano aprueba la spec → `in_progress` → implementer → tests → reviewer → done; después la feature 15 (endurecimiento 2).
- **Bloqueos / esperando:** aprobación humana de la spec de la feature 13

## Decisiones tomadas con el humano

- `panel-muver` se unifica dentro de este repo, en la carpeta `panel/`.
- Roadmap de 5 fases (ver `feature_list.json`): 1 base (hecha), 2 acceso web seguro,
  3 descubrimiento automático de proyectos de Claude Code, 4 trabajar desde el panel
  (Claude Code CLI + botones SDD), 5 visual y avisos push.
- Publicación en Internet con **Cloudflare Tunnel**; el humano tiene Claude Code CLI
  instalado en su PC Windows.
- Fase 4 (decisión del humano): Claude lanzado desde el panel puede editar ficheros y
  ejecutar solo los comandos de una lista autorizada por proyecto; protección extra con
  **Cloudflare Access + contraseña** para las acciones que ejecutan cosas (requiere dominio
  propio en Cloudflare; mientras no lo haya, repetir contraseña en acciones críticas).
- Roadmap ampliado (aprobado por el humano): tras la fase 4 → 6 agentes endurecidos
  (sdd:false), 7 puertas de calidad, 8 memoria del estudio, 9 equipo de especialistas y
  fábrica de proyectos, 10 ojos (verificación visual), 5 avisos push, 11 vista previa en el
  móvil, 12 piloto nocturno.
- Dominio propio: el humano lo comprará más adelante (uso personal). Hasta entonces, URL
  temporal + contraseña + reconfirmación. Revisar antes de la fase 5 (Web Push necesita
  una URL fija).
- Decisión del humano: la seguridad (feature 14) va antes que la vista compacta (feature 13).
- Pendiente del humano: T36 de la fase 4 desde el móvil y Commit y push real; T37 (Internet); T27 (fase 1), T30/T31 (fase 2) y T27 (fase 3) manuales en Windows/móvil; rutas
  reales y `appUrl` en `panel/projects.json`; aportar `muver.html` para `panel/legacy/`.

---

_(Este fichero se sobrescribe a medida que avanza el trabajo.)_
