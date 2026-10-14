# harness-engineering

Un **agente de código para la terminal construido desde cero**, en TypeScript, sobre la API de Claude.

Tiene dos objetivos:

1. **Aprender** cómo funciona por dentro un harness de agentes (lo que hay detrás de Claude Code, Cursor, Codex…), sin frameworks que escondan las piezas.
2. **Ser la base de un producto** que se pueda vender más adelante (ver [docs/ROADMAP.md](docs/ROADMAP.md)).

> **¿Qué es un harness?** El modelo de IA solo genera texto. El *harness* es todo el software que lo rodea y lo convierte en un agente: el bucle que lo llama una y otra vez, las herramientas que puede usar, los permisos, la gestión del contexto, los logs y los límites. *Harness engineering* es diseñar bien esas piezas. Explicación completa en [docs/01-conceptos.md](docs/01-conceptos.md).

## Puesta en marcha

Requisitos: Node.js 20.12 o superior y **una** API key de cualquiera de estos proveedores:

| Proveedor | Variable | Modelo por defecto | Notas |
|---|---|---|---|
| Google Gemini | `GEMINI_API_KEY` | `gemini-2.5-flash` | Capa gratuita en AI Studio |
| OpenRouter | `OPENROUTER_API_KEY` | `qwen/qwen3-coder:free` | Modelos gratis con sufijo `:free` |
| Ollama | `OLLAMA_API_KEY` o `OLLAMA_BASE_URL` | `gpt-oss:120b` | Cloud con clave, o local sin clave |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | De pago |

```bash
npm install
cp .env.example .env      # y rellena tu(s) clave(s) en .env
```

> Los modelos gratuitos cambian a menudo. Si uno da error, elige otro: en la UI se cambia desde la cabecera, en la CLI con `HARNESS_MODEL`. Para el agente conviene un modelo que soporte *tool calling* (llamadas a herramientas).

### Interfaz web

```bash
npm run ui                              # compila y abre http://localhost:4317
npm run ui -- --cwd ../mi-proyecto      # el agente trabaja sobre otro proyecto
```

En la cabecera eliges proveedor y modelo. Cada acción de escritura o ejecución aparece con botones **Sí / Siempre en esta sesión / No**, y "Detener" cancela el turno.

Para desarrollar la UI con recarga en caliente, usa dos terminales: `npm run dev:server` y `npm run dev:web` (abre http://localhost:5173).

### Línea de comandos

```bash
npm run dev                                   # modo interactivo en la carpeta actual
npm run dev -- --cwd ../mi-proyecto           # trabajar sobre otro proyecto
npm run dev -- "explica la estructura de este repo"   # una sola tarea y termina
```

Dentro del modo interactivo: `/help`, `/usage` (tokens y coste), `/reset`, `/exit`. **Ctrl+C** cancela el turno en curso.

Cuando el agente quiera escribir un archivo o ejecutar un comando, te preguntará: `s` (sí), `n` (no) o `t` (sí a todo lo de esa herramienta durante la sesión). `--auto-approve` desactiva las preguntas: úsalo solo en carpetas desechables.

### Variables de entorno opcionales

| Variable | Por defecto | Para qué |
|---|---|---|
| `HARNESS_PROVIDER` | el primero con clave | `anthropic`, `gemini`, `openrouter` u `ollama` |
| `HARNESS_MODEL` | según proveedor | Modelo concreto |
| `HARNESS_EFFORT` | `high` | Solo Anthropic: cuánto razona el modelo (`low` … `max`) |
| `HARNESS_MAX_STEPS` | `50` | Máximo de llamadas al modelo por cada mensaje tuyo |
| `HARNESS_PORT` | `4317` | Puerto de la UI web |

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run ui` | Compila todo y arranca la interfaz web |
| `npm run dev:server` + `npm run dev:web` | UI en modo desarrollo (recarga en caliente) |
| `npm run dev` | Ejecuta el CLI desde el código fuente (tsx) |
| `npm test` | Corre los tests (vitest). **No usan la API ni gastan tokens** |
| `npm run typecheck` | Comprueba tipos (servidor y web) |
| `npm run build` / `npm start` | Compila a `dist/` y ejecuta la CLI compilada |

## Mapa del código

```
src/
├── cli.ts                  Interfaz de terminal
├── config.ts               Proveedor, modelo, límites (desde variables de entorno / .env)
├── agent/agent.ts          ★ EL BUCLE DEL AGENTE: empieza a leer por aquí
├── agent/create-agent.ts   Ensambla un agente (lo usan la CLI y la web)
├── model/
│   ├── client.ts           Contrato "un modelo de IA" que usa el bucle
│   ├── anthropic.ts        Adaptador para Claude (SDK oficial)
│   ├── openai-compatible.ts Adaptador para Gemini, OpenRouter, Ollama... (fetch + SSE a mano)
│   └── providers.ts        Catálogo de proveedores y sus claves
├── server/                 Servidor de la UI web
│   ├── server.ts           HTTP + WebSocket (con chequeo de Origin)
│   ├── session.ts          Una pestaña conectada = una sesión con su agente
│   └── protocol.ts         Mensajes entre web y servidor (tipos compartidos)
├── tools/                  Lo que el agente puede hacer
│   ├── types.ts            Contrato de una herramienta
│   ├── registry.ts         Traduce herramientas al formato de la API
│   ├── workspace.ts        Impide salir de la carpeta del proyecto
│   ├── truncate.ts         Recorta salidas enormes (gestión de contexto)
│   └── read-file · list-files · search-files · edit-file · write-file · bash
├── permissions/            Quién decide si una acción se ejecuta
├── observability/          Transcript JSONL de cada sesión + tokens y coste
├── prompts/system.ts       Instrucciones de trabajo del agente
└── ui/terminal.ts          Cómo se pinta todo en la terminal
web/src/                    La UI en React (Vite)
├── useAgent.ts             Hook: WebSocket + reducer con el estado del chat
└── components/             Header, Composer, ChatItemView
tests/                      Tests con modelo y proveedor simulados (sin red ni tokens)
```

Cada sesión queda registrada en `.harness/sessions/*.jsonl` dentro del proyecto sobre el que trabaja el agente: qué se pidió, qué respondió el modelo, qué herramientas usó, qué se aprobó y cuántos tokens costó.

## Seguridad: lo que hay que saber

- Las herramientas de archivos **no pueden salir del workspace** (se bloquean `../`, rutas absolutas y symlinks hacia fuera).
- `bash` **no está aislado**: corre con tus permisos de usuario. La protección es que te pregunta antes de cada comando. Aislarlo en un contenedor está en el roadmap.
- La UI web solo escucha en `127.0.0.1` y rechaza conexiones WebSocket de otros orígenes: sin eso, cualquier web que visitaras podría pedirle al agente que ejecute comandos (*Cross-Site WebSocket Hijacking*).
- Nunca subas tu `.env` ni pegues tus API keys en chats, issues o capturas (`.env` ya está en `.gitignore`).
