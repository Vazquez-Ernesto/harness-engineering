import { spawn } from "node:child_process";
import { z } from "zod";
import { defineTool } from "./types.js";
import { truncateMiddle } from "./truncate.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

/**
 * Ejecuta un comando de shell en el workspace.
 *
 * OJO: esto NO es un sandbox. El comando corre con tus permisos de usuario y
 * puede tocar cualquier cosa de tu máquina. La única barrera es que el
 * sistema de permisos te pregunta antes de cada ejecución. Aislar esto
 * (contenedor, usuario sin privilegios) es uno de los siguientes pasos del roadmap.
 */
export const bashTool = defineTool({
  name: "bash",
  description:
    "Ejecuta un comando de bash en la carpeta del workspace y devuelve stdout, stderr y el código de salida. " +
    "Úsalo para correr tests, linters, builds, git, etc. Cada llamada es un proceso nuevo: " +
    "los cd y variables no persisten entre llamadas. No lances procesos interactivos ni servidores que no terminan.",
  risk: "execute",
  schema: z.object({
    command: z.string().min(1).describe("Comando a ejecutar"),
    timeout_ms: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().describe("Tiempo máximo en ms"),
  }),
  summarize: (input) => input.command,
  run(input, ctx) {
    return new Promise((resolve) => {
      const child = spawn("bash", ["-c", input.command], {
        cwd: ctx.workspaceRoot,
        env: process.env,
        signal: ctx.signal,
        timeout: input.timeout_ms ?? DEFAULT_TIMEOUT_MS,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", (err) => (stderr += `\n[error del proceso: ${err.message}]`));
      child.on("close", (code, signal) => {
        const parts = [];
        if (stdout) parts.push(`<stdout>\n${truncateMiddle(stdout)}\n</stdout>`);
        if (stderr) parts.push(`<stderr>\n${truncateMiddle(stderr)}\n</stderr>`);
        parts.push(signal ? `Proceso terminado por señal ${signal} (¿timeout?)` : `Código de salida: ${code}`);
        // Un exit code != 0 NO es un error del harness: es información útil
        // para el modelo (p. ej. un test que falla). Se devuelve como resultado normal.
        resolve(parts.join("\n"));
      });
    });
  },
});
