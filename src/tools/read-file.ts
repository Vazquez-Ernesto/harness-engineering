import fs from "node:fs/promises";
import { z } from "zod";
import { defineTool, ToolError } from "./types.js";
import { displayPath, resolveInWorkspace } from "./workspace.js";
import { truncateMiddle } from "./truncate.js";

const MAX_LINES = 2000;

export const readFileTool = defineTool({
  name: "read_file",
  description:
    "Lee un archivo de texto del workspace y lo devuelve con números de línea. " +
    `Devuelve como máximo ${MAX_LINES} líneas; usa offset y limit para leer archivos largos por partes. ` +
    "Lee siempre un archivo antes de editarlo.",
  risk: "read",
  schema: z.object({
    path: z.string().describe("Ruta del archivo, relativa al workspace"),
    offset: z.number().int().min(1).optional().describe("Línea desde la que empezar (1 = primera)"),
    limit: z.number().int().min(1).max(MAX_LINES).optional().describe("Cuántas líneas leer"),
  }),
  summarize: (input) => input.path,
  async run(input, ctx) {
    const file = await resolveInWorkspace(ctx.workspaceRoot, input.path);
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch (err) {
      throw new ToolError(`No pude leer ${displayPath(ctx.workspaceRoot, file)}: ${(err as Error).message}`);
    }
    if (content.length === 0) return "(archivo vacío)";

    const lines = content.split("\n");
    const start = (input.offset ?? 1) - 1;
    const end = Math.min(lines.length, start + (input.limit ?? MAX_LINES));
    if (start >= lines.length) {
      throw new ToolError(`offset ${input.offset} supera el total de líneas (${lines.length})`);
    }

    // Formato "cat -n": el número de línea ayuda al modelo a ubicarse y a citar.
    const numbered = lines
      .slice(start, end)
      .map((line, i) => `${String(start + i + 1).padStart(6)}\t${line}`)
      .join("\n");
    const footer = end < lines.length ? `\n\n[Mostrando líneas ${start + 1}-${end} de ${lines.length}]` : "";
    return truncateMiddle(numbered) + footer;
  },
});
