/**
 * Registro de herramientas: traduce nuestras herramientas al formato de la API
 * y busca la herramienta correcta cuando el modelo pide una.
 */
import { z } from "zod";
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Tool } from "./types.js";
import { readFileTool } from "./read-file.js";
import { listFilesTool } from "./list-files.js";
import { searchFilesTool } from "./search-files.js";
import { writeFileTool } from "./write-file.js";
import { editFileTool } from "./edit-file.js";
import { bashTool } from "./bash.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) throw new Error(`Herramienta duplicada: ${tool.name}`);
      this.tools.set(tool.name, tool);
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Definiciones para la API. El orden es siempre el mismo (el de registro):
   * si cambiara entre llamadas, se invalidaría el prompt cache.
   */
  toApiTools(): BetaTool[] {
    return [...this.tools.values()].map((tool) => {
      const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.schema, { io: "input" }) as Record<string, unknown>;
      return {
        name: tool.name,
        description: tool.description,
        input_schema: schema as BetaTool["input_schema"],
        // Con streaming, la entrada de la herramienta llega a medida que se
        // genera (útil para write_file con archivos grandes). Contrapartida:
        // la API ya no la valida, así que la validamos nosotros con zod.
        eager_input_streaming: true,
      };
    });
  }
}

export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry([
    readFileTool,
    listFilesTool,
    searchFilesTool,
    editFileTool,
    writeFileTool,
    bashTool,
  ] as Tool[]);
}
