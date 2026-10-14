# Roadmap

Dos caminos en paralelo: **aprender** (cada fase añade un concepto de harness engineering) y **producto** (lo que hace falta para poder venderlo).

## Fase 0 — Núcleo ✅ (esta versión)

- [x] Bucle agéntico manual con streaming
- [x] Herramientas: `read_file`, `list_files`, `search_files`, `edit_file`, `write_file`, `bash`
- [x] Validación de entradas con zod y confinamiento al workspace
- [x] Permisos por nivel de riesgo (lectura / escritura / ejecución)
- [x] Límites: pasos máximos, timeout, recorte de salidas
- [x] Manejo de todos los `stop_reason` (refusal, max_tokens, pause_turn, contexto lleno)
- [x] Prompt caching, thinking adaptativo y fallback automático ante rechazos
- [x] Transcript JSONL por sesión y contabilidad de tokens/coste
- [x] Tests deterministas con `FakeModel`

**Ejercicio para ti:** lee `src/agent/agent.ts` de arriba abajo, ejecuta `npm test` y luego pídele al agente una tarea pequeña en un proyecto de prueba. Abre el `.jsonl` de la sesión y sigue cada paso.

## Fase 0.5 — Multi-proveedor e interfaz web ✅

- [x] Adaptador compatible con OpenAI: Gemini, OpenRouter, Ollama (cloud y local)
- [x] Reintentos con backoff ante límites de uso (429) y errores 5xx
- [x] UI web en React: streaming, razonamiento, tarjetas de herramientas, aprobaciones, cancelar, cambio de modelo
- [x] Servidor WebSocket con protección contra Cross-Site WebSocket Hijacking

Siguientes pasos de la UI:
- [ ] Ver el diff de cada edición antes de aprobarla
- [ ] Historial de sesiones (leer los transcripts JSONL) y reanudarlas
- [ ] Elegir el workspace desde la UI
- [ ] Login (p. ej. con Google) cuando haya usuarios remotos — hoy solo es local

## Fase 1 — Evals: medir si el agente es bueno

Sin medición no hay mejora, y sin evidencia no hay venta.

- [ ] Carpeta `evals/` con 10–20 tareas reales (repo de ejemplo + instrucción + verificación automática, p. ej. "los tests pasan").
- [ ] Script que ejecuta cada tarea en un workspace temporal con `--auto-approve` y reporta: % de éxito, pasos, tokens y coste por tarea.
- [ ] Comparar cambios de system prompt, descripciones de herramientas y `effort` con números.

## Fase 2 — Contexto para sesiones largas

- [ ] **Compaction**: resumir la parte antigua del historial cuando se acerca al límite (la API tiene compaction del lado del servidor).
- [ ] **Memoria del proyecto**: leer un archivo tipo `AGENTS.md` / `CLAUDE.md` del repo y añadirlo al system prompt.
- [ ] Reanudar sesiones desde el transcript.

## Fase 3 — Extensibilidad

- [ ] **Hooks**: scripts que se ejecutan antes/después de cada herramienta (p. ej. formatear tras editar, bloquear `rm -rf`).
- [ ] Reglas de permisos configurables por archivo (permitir `npm test` siempre, denegar `git push`).
- [ ] **MCP**: conectar herramientas externas (Jira, bases de datos, navegador) mediante Model Context Protocol.
- [ ] **Subagentes**: delegar subtareas (p. ej. "investiga este módulo") en un agente con su propio contexto.
- [ ] Ejecutar herramientas de solo lectura en paralelo.

## Fase 4 — Seguridad seria

- [ ] Ejecutar `bash` dentro de un contenedor (Docker) o con un usuario sin privilegios.
- [ ] Lista de comandos y rutas sensibles bloqueadas (`.env`, claves SSH).
- [ ] Modo "solo lectura" para revisar código sin riesgo.

## Fase 5 — Producto

- [ ] Empaquetar como CLI instalable (`npm install -g`) con onboarding de API key.
- [ ] Modo CI/headless: ejecutar el agente en GitHub Actions (revisar PRs, arreglar tests que fallan).
- [ ] Telemetría opcional y panel de coste por usuario/equipo.

## Notas para venderlo

Un harness genérico compite con productos gratuitos o muy pulidos (Claude Code, Cursor, Codex). Lo que se vende es **especialización + confianza**:

- **Elige un nicho** donde sepas más que la competencia. Con 4 años de QA, un agente que mantiene suites de tests, investiga tests flaky o genera tests a partir de casos manuales es un diferenciador real. El núcleo de este repo sirve igual; cambian las herramientas, el system prompt y los evals.
- **Las evals son tu argumento de venta**: "resuelve el 80% de estas tareas a 0,15 $ cada una" convence más que una demo.
- **El coste por tarea define tu precio y tu margen**: por eso se mide desde la fase 0.
- **Seguridad y auditoría** (permisos, transcripts, sandbox) es lo que piden las empresas antes de dejar un agente tocar su código.
- **Licencia**: el `package.json` está como `UNLICENSED`. Antes de publicar, decide si será código cerrado, open-core (núcleo abierto + funciones de pago) u open source, y revisa los términos de uso de la API de Anthropic para productos comerciales.
