import fs from "node:fs/promises";
import { z } from "zod";
import { defineTool, ToolError } from "./types.js";
import { displayPath, resolveInWorkspace } from "./workspace.js";

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
}

/**
 * Edición por "buscar y reemplazar texto exacto", el mismo enfoque que usan
 * los agentes de código profesionales. Es más fiable que pedir números de
 * línea (que cambian tras cada edición) y más barato que reescribir el archivo.
 */
export const editFileTool = defineTool({
  name: "edit_file",
  description:
    "Reemplaza un fragmento de texto exacto en un archivo existente. old_string debe aparecer " +
    "exactamente una vez (incluye líneas de contexto para hacerlo único), salvo que replace_all sea true. " +
    "Respeta la indentación original. Lee el archivo antes de editarlo.",
  risk: "write",
  schema: z.object({
    path: z.string().describe("Ruta del archivo, relativa al workspace"),
    old_string: z.string().min(1).describe("Texto exacto a reemplazar"),
    new_string: z.string().describe("Texto nuevo"),
    replace_all: z.boolean().default(false).describe("Reemplazar todas las apariciones"),
  }),
  summarize: (input) => input.path,
  async run(input, ctx) {
    const file = await resolveInWorkspace(ctx.workspaceRoot, input.path);
    const shown = displayPath(ctx.workspaceRoot, file);
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch (err) {
      throw new ToolError(`No pude leer ${shown}: ${(err as Error).message}`);
    }

    if (input.old_string === input.new_string) {
      throw new ToolError("old_string y new_string son iguales; no hay nada que cambiar.");
    }
    const count = countOccurrences(content, input.old_string);
    if (count === 0) {
      throw new ToolError(`No encontré old_string en ${shown}. Vuelve a leer el archivo y copia el texto exacto.`);
    }
    if (count > 1 && !input.replace_all) {
      throw new ToolError(
        `old_string aparece ${count} veces en ${shown}. Añade contexto para que sea único o usa replace_all.`,
      );
    }

    // split/join en vez de String.replace: evita que "$&" o "$1" en new_string
    // se interpreten como patrones especiales de reemplazo.
    const updated = input.replace_all
      ? content.split(input.old_string).join(input.new_string)
      : content.replace(input.old_string, () => input.new_string);
    await fs.writeFile(file, updated, "utf8");
    return `Edité ${shown} (${input.replace_all ? count : 1} reemplazo/s).`;
  },
});
