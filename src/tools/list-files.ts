import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "./types.js";
import { displayPath, resolveInWorkspace } from "./workspace.js";

const MAX_ENTRIES = 500;
/** Carpetas que casi nunca aportan y llenarían el contexto. */
export const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".harness", "coverage", "target"]);

export const listFilesTool = defineTool({
  name: "list_files",
  description:
    "Lista archivos y carpetas del workspace de forma recursiva (las carpetas terminan en /). " +
    "Ignora .git, node_modules, dist y similares. Úsala para orientarte en un proyecto.",
  risk: "read",
  schema: z.object({
    path: z.string().default(".").describe("Carpeta a listar, relativa al workspace"),
    max_depth: z.number().int().min(1).max(10).default(3).describe("Profundidad máxima"),
  }),
  summarize: (input) => input.path,
  async run(input, ctx) {
    const start = await resolveInWorkspace(ctx.workspaceRoot, input.path);
    const entries: string[] = [];

    async function walk(dir: string, depth: number): Promise<void> {
      if (entries.length >= MAX_ENTRIES) return;
      const children = await fs.readdir(dir, { withFileTypes: true });
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (entries.length >= MAX_ENTRIES) return;
        const full = path.join(dir, child.name);
        if (child.isDirectory()) {
          if (IGNORED_DIRS.has(child.name)) continue;
          entries.push(displayPath(ctx.workspaceRoot, full) + "/");
          if (depth < input.max_depth) await walk(full, depth + 1);
        } else {
          entries.push(displayPath(ctx.workspaceRoot, full));
        }
      }
    }

    await walk(start, 1);
    if (entries.length === 0) return "(carpeta vacía)";
    const note = entries.length >= MAX_ENTRIES ? `\n[Lista cortada en ${MAX_ENTRIES} entradas; lista una subcarpeta]` : "";
    return entries.join("\n") + note;
  },
});
