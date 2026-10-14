# Conceptos: cómo funciona un harness de agentes

Este documento explica las ideas y te dice **en qué archivo** vive cada una, para que las veas en código real.

## 1. El modelo no hace nada por sí solo

Un LLM recibe texto y devuelve texto. No lee archivos, no ejecuta comandos, no recuerda conversaciones anteriores. La API de Claude es **sin estado**: cada llamada lleva *todo* lo necesario.

Cada llamada que hace este harness envía tres cosas (`src/model/client.ts`):

| Parte | Qué es | Dónde se arma |
|---|---|---|
| `system` | Instrucciones de trabajo: quién es, cómo debe trabajar | `src/prompts/system.ts` |
| `tools` | Catálogo de herramientas: nombre, descripción y JSON Schema de la entrada | `src/tools/registry.ts` |
| `messages` | El historial completo de la conversación | `Agent.messages` en `src/agent/agent.ts` |

## 2. Tool use: el modelo *pide*, el harness *hace*

Cuando el modelo quiere usar una herramienta no la ejecuta: responde con un bloque `tool_use` y `stop_reason: "tool_use"`:

```json
{ "type": "tool_use", "id": "toolu_01", "name": "read_file", "input": { "path": "src/app.ts" } }
```

El harness ejecuta `read_file` y le contesta con un mensaje de usuario que contiene un `tool_result` con el mismo `id`:

```json
{ "type": "tool_result", "tool_use_id": "toolu_01", "content": "1\timport ..." }
```

Reglas que el harness debe cumplir (y que los tests comprueban):

- **Cada `tool_use` necesita su `tool_result`**, aunque falle o lo canceles. Si no, la API rechaza la siguiente llamada.
- Si el modelo pide varias herramientas a la vez, **todos los resultados van juntos en un solo mensaje**.
- Si algo falla, se devuelve con `is_error: true`. El modelo lee el error y corrige el rumbo. **Los errores de herramientas son información para el modelo, no excepciones que tumban el programa.**

## 3. El bucle agéntico

Esto es literalmente lo que hace `Agent.send()` en `src/agent/agent.ts`:

```
          ┌─────────────────────────────────────────────┐
          ▼                                             │
  [llamar al modelo] ──► ¿stop_reason?                  │
                          ├─ end_turn ──► FIN           │
                          ├─ tool_use ──► validar ──► permiso ──► ejecutar ──► añadir resultados
                          ├─ refusal / max_tokens / contexto lleno ──► FIN con aviso
                          └─ pause_turn ──► reenviar y continuar
```

Un agente es ese bucle + buenas herramientas + buenas barandillas. Nada más.

## 4. Las barandillas (lo que separa una demo de un producto)

| Problema real | Cómo lo resuelve este harness | Archivo |
|---|---|---|
| El modelo manda una entrada mal formada | Se valida con zod antes de ejecutar; si falla, error al modelo | `agent.ts` → `runTool` |
| El modelo pide rutas como `../../etc/passwd` | Confinamiento al workspace, incluidos symlinks | `tools/workspace.ts` |
| El modelo quiere ejecutar algo peligroso | Permisos según riesgo: lectura libre, escritura/ejecución preguntan | `permissions/permissions.ts` |
| Bucle infinito de herramientas | Límite `maxSteps` por turno | `agent.ts` |
| Un comando imprime 50.000 líneas | Se recorta el centro de la salida | `tools/truncate.ts` |
| Un comando se cuelga | Timeout en `bash` | `tools/bash.ts` |
| La respuesta se corta a mitad de un `tool_use` | No se ejecuta una entrada incompleta | `agent.ts` → `handleStopReason` |
| El JSON de la herramienta llega roto | Reintento acotado del paso | `model/client.ts` + `agent.ts` |
| Quieres cancelar | Ctrl+C aborta y deja el historial válido | `cli.ts` + `agent.ts` |
| "¿Qué hizo el agente y cuánto costó?" | Transcript JSONL + contabilidad de tokens | `observability/` |

## 5. El contexto es el recurso escaso

Todo lo que entra en `messages` se reenvía en **cada** llamada siguiente. Consecuencias:

- **Coste**: un turno de 20 pasos paga el historial 20 veces. Por eso usamos **prompt caching** (`cache_control` en `model/client.ts`): la parte repetida se cobra a ~10% del precio. Funciona porque el historial es *append-only*: nunca editamos mensajes viejos, solo añadimos al final. Si cambias un byte del principio, la caché se invalida.
- **Calidad**: un contexto lleno de ruido empeora las decisiones. Por eso recortamos salidas largas, ignoramos `node_modules` y leemos archivos por partes.
- **Límite**: si no cabe, la API devuelve `model_context_window_exceeded`. La siguiente evolución es *compaction* (resumir lo antiguo); está en el roadmap.

## 6. Las descripciones de herramientas son prompts

El modelo decide qué herramienta usar **solo** leyendo su `description` y su esquema. Una descripción ambigua produce un agente torpe. Mira `edit-file.ts`: la descripción explica que `old_string` debe ser único y que hay que leer antes de editar. Cuando el agente se equivoque de forma repetida, lo primero que debes revisar es la descripción de la herramienta y el system prompt.

## 7. Un harness, muchos modelos: adaptadores

El bucle no sabe con qué proveedor habla: depende de la interfaz `ModelClient` (`src/model/client.ts`). Cada proveedor tiene un **adaptador** que traduce:

- `anthropic.ts` usa el SDK oficial de Claude.
- `openai-compatible.ts` habla el formato *Chat Completions* de OpenAI, que imitan Gemini, OpenRouter, Ollama y muchos más. Está hecho con `fetch` a mano para que veas qué viaja por la red.

Diferencias que el adaptador tiene que esconder:

| Concepto | Formato interno (Anthropic) | Formato OpenAI |
|---|---|---|
| Pedir herramienta | bloque `tool_use` dentro del mensaje del asistente | campo `tool_calls` con `arguments` como **texto JSON** |
| Resultado | bloque `tool_result` en un mensaje `user` | un mensaje `role: "tool"` por cada resultado |
| System prompt | campo `system` aparte | primer mensaje con `role: "system"` |
| Por qué paró | `stop_reason: "tool_use"` | `finish_reason: "tool_calls"` (a veces `"stop"` aunque haya llamadas) |
| Streaming | eventos tipados del SDK | líneas `data: {...}` (Server-Sent Events) con las llamadas troceadas |

Hay detalles de cada proveedor: Gemini adjunta una "firma de pensamiento" (`extra_content`) a cada llamada y exige recibirla de vuelta, y los planes gratuitos devuelven `429` a menudo, así que el adaptador reintenta con espera exponencial.

## 8. La UI es otra "cara" del mismo agente

La web no reimplementa nada: el servidor (`src/server/session.ts`) crea el mismo `Agent` que la CLI y convierte sus eventos (`onText`, `onToolCall`, ...) en mensajes WebSocket. Los permisos son una promesa que se resuelve cuando pulsas "Sí" o "No" en el navegador. Por eso el núcleo tiene que estar desacoplado de la interfaz desde el día uno.

## 9. Cómo testear un agente (tu ventaja como QA)

El modelo es no determinista y cuesta dinero, así que **se separa**: el bucle depende de la interfaz `ModelClient`, no del SDK. En los tests (`tests/agent.test.ts`) usamos `FakeModel`, un modelo falso con respuestas guionizadas:

```ts
const model = new FakeModel([
  message("tool_use", [toolUse("read_file", { path: "a.txt" })]),  // paso 1: pide leer
  message("end_turn", [text("Dice 'hola'.")]),                      // paso 2: termina
]);
```

Así probamos el *harness* de forma determinista: que ejecuta lo pedido, respeta permisos, se detiene en los límites, no ejecuta respuestas cortadas, etc.

Probar la *calidad del agente completo* (¿resuelve bien las tareas?) es otra disciplina: **evals**. Un conjunto de tareas reales con un criterio de éxito comprobable que se ejecuta contra el modelo real. Está en el roadmap y es donde tu experiencia en QA vale más.
