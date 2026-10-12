# harness-engineering

Un **agente de código para la terminal construido desde cero**, en TypeScript, sobre la API de Claude.

Tiene dos objetivos:

1. **Aprender** cómo funciona por dentro un harness de agentes (lo que hay detrás de Claude Code, Cursor, Codex…), sin frameworks que escondan las piezas.
2. **Ser la base de un producto** que se pueda vender más adelante (ver [docs/ROADMAP.md](docs/ROADMAP.md)).

> **¿Qué es un harness?** El modelo de IA solo genera texto. El *harness* es todo el software que lo rodea y lo convierte en un agente: el bucle que lo llama una y otra vez, las herramientas que puede usar, los permisos, la gestión del contexto, los logs y los límites. *Harness engineering* es diseñar bien esas piezas. Explicación completa en [docs/01-conceptos.md](docs/01-conceptos.md).

## Puesta en marcha

Requisitos: Node.js 20 o superior y una API key de Anthropic (<https://console.anthropic.com>).

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # en Windows PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."

npm run dev                                   # modo interactivo en la carpeta actual
npm run dev -- --cwd ../mi-proyecto           # trabajar sobre otro proyecto
npm run dev -- "explica la estructura de este repo"   # una sola tarea y termina
```

Dentro del modo interactivo: `/help`, `/usage` (tokens y coste), `/reset`, `/exit`. **Ctrl+C** cancela el turno en curso.

Cuando el agente quiera escribir un archivo o ejecutar un comando, te preguntará: `s` (sí), `n` (no) o `t` (sí a todo lo de esa herramienta durante la sesión). `--auto-approve` desactiva las preguntas: úsalo solo en carpetas desechables.

### Variables de entorno opcionales

| Variable | Por defecto | Para qué |
|---|---|---|
| `HARNESS_MODEL` | `claude-opus-5-5` | Modelo de Claude |
| `HARNESS_EFFORT` | `high` | Cuánto razona el modelo: `low`, `medium`, `high`, `xhigh`, `max` |
| `HARNESS_MAX_STEPS` | `50` | Máximo de llamadas al modelo por cada mensaje tuyo |

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Ejecuta el CLI desde el código fuente (tsx) |
| `npm test` | Corre los tests (vitest). **No usan la API ni gastan tokens** |
| `npm run typecheck` | Comprueba tipos |
| `npm run build` / `npm start` | Compila a `dist/` y ejecuta la versión compilada |

## Mapa del código

```
src/
├── cli.ts                  Ensambla todas las piezas y gestiona la terminal
├── config.ts               Modelo, effort, límites (desde variables de entorno)
├── agent/agent.ts          ★ EL BUCLE DEL AGENTE: empieza a leer por aquí
├── model/client.ts         Única pieza que habla con la API de Claude
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
tests/                      Tests con un modelo falso (FakeModel)
```

Cada sesión queda registrada en `.harness/sessions/*.jsonl` dentro del proyecto sobre el que trabaja el agente: qué se pidió, qué respondió el modelo, qué herramientas usó, qué se aprobó y cuántos tokens costó.

## Seguridad: lo que hay que saber

- Las herramientas de archivos **no pueden salir del workspace** (se bloquean `../`, rutas absolutas y symlinks hacia fuera).
- `bash` **no está aislado**: corre con tus permisos de usuario. La protección es que te pregunta antes de cada comando. Aislarlo en un contenedor está en el roadmap.
- Nunca subas tu `.env` ni tu API key al repositorio (`.env` ya está en `.gitignore`).
