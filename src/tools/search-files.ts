import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, ToolError } from "./types.js";
import { displayPath, resolveInWorkspace } from "./workspace.js";
import { IGNORED_DIRS } from "./list-files.js";

const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 1_000_000;

export const searchFilesTool = defineTool({
  name: "search_files",
  description:
    "Busca una expresión regular (sintaxis JavaScript) en el contenido de los archivos del workspace. " +
    "Devuelve líneas con formato ruta:línea: texto. Úsala para encontrar dónde se define o usa algo.",
  risk: "read",
  schema: z.object({
    pattern: z.string().describe("Expresión regular a buscar, p. ej. 'function\\s+login'"),
    path: z.string().default(".").describe("Carpeta donde buscar, relativa al workspace"),
    ignore_case: z.boolean().default(false),
  }),
  summarize: (input) => `/${input.pattern}/ en ${input.path}`,
  async run(input, ctx) {
    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern, input.ignore_case ? "i" : "");
    } catch (err) {
      throw new ToolError(`Expresión regular inválida: ${(err as Error).message}`);
    }
    const start = await resolveInWorkspace(ctx.workspaceRoot, input.path);
    const matches: string[] = [];

    async function searchFile(file: string): Promise<void> {
      const stat = await fs.stat(file);
      if (stat.size > MAX_FILE_BYTES) return;
      const content = await fs.readFile(file, "utf8");
      if (content.includes("\u0000")) return; // binario
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
        if (regex.test(lines[i]!)) {
          matches.push(`${displayPath(ctx.workspaceRoot, file)}:${i + 1}: ${lines[i]!.trim().slice(0, 300)}`);
        }
      }
    }

    async function walk(dir: string): Promise<void> {
      const children = await fs.readdir(dir, { withFileTypes: true });
      for (const child of children) {
        if (matches.length >= MAX_MATCHES) return;
        const full = path.join(dir, child.name);
        if (child.isDirectory()) {
          if (!IGNORED_DIRS.has(child.name)) await walk(full);
        } else if (child.isFile()) {
          await searchFile(full);
        }
      }
    }

    const stat = await fs.stat(start);
    if (stat.isDirectory()) await walk(start);
    else await searchFile(start);

    if (matches.length === 0) return "Sin coincidencias.";
    const note = matches.length >= MAX_MATCHES ? `\n[Cortado en ${MAX_MATCHES} coincidencias; afina el patrón]` : "";
    return matches.join("\n") + note;
  },
});
