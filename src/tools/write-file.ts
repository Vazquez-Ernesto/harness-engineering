import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "./types.js";
import { displayPath, resolveInWorkspace } from "./workspace.js";

export const writeFileTool = defineTool({
  name: "write_file",
  description:
    "Crea un archivo nuevo o reemplaza por completo uno existente con el contenido dado. " +
    "Crea las carpetas intermedias si faltan. Para cambios pequeños en archivos existentes usa edit_file.",
  risk: "write",
  schema: z.object({
    path: z.string().describe("Ruta del archivo, relativa al workspace"),
    content: z.string().describe("Contenido completo del archivo"),
  }),
  summarize: (input) => `${input.path} (${input.content.split("\n").length} líneas)`,
  async run(input, ctx) {
    const file = await resolveInWorkspace(ctx.workspaceRoot, input.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, input.content, "utf8");
    return `Escribí ${displayPath(ctx.workspaceRoot, file)} (${input.content.length} caracteres).`;
  },
});
