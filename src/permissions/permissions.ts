/**
 * Sistema de permisos: la frontera entre "el modelo quiere hacer X" y "X ocurre".
 *
 * Regla por defecto:
 *   - Herramientas de lectura: se permiten solas.
 *   - Escritura y ejecución: se te pregunta. Puedes responder "siempre" para
 *     no volver a ser preguntado por esa herramienta en esta sesión.
 *   - Modo auto-approve: se permite todo (solo para entornos desechables).
 */
import type { Tool } from "../tools/types.js";

export type ApprovalAnswer = "yes" | "no" | "always";

export interface ApprovalRequest {
  /** Id de la llamada (tool_use) que se quiere aprobar. */
  toolUseId: string;
  tool: Tool;
  input: unknown;
  /** Resumen de una línea de lo que va a hacer. */
  summary: string;
}

/** Quién responde a "¿permito esto?". En la CLI es un prompt en la terminal. */
export type Approver = (request: ApprovalRequest) => Promise<ApprovalAnswer>;

export type PermissionMode = "ask" | "auto-approve";

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
}

export class PermissionManager {
  private readonly alwaysAllowed = new Set<string>();

  constructor(
    private readonly mode: PermissionMode,
    private readonly approver: Approver,
  ) {}

  async check(request: ApprovalRequest): Promise<PermissionDecision> {
    const { tool } = request;
    if (tool.risk === "read") return { allowed: true, reason: "lectura permitida por defecto" };
    if (this.mode === "auto-approve") return { allowed: true, reason: "modo auto-approve" };
    if (this.alwaysAllowed.has(tool.name)) return { allowed: true, reason: "permitido para toda la sesión" };

    const answer = await this.approver(request);
    if (answer === "always") {
      this.alwaysAllowed.add(tool.name);
      return { allowed: true, reason: "aprobado (siempre en esta sesión)" };
    }
    if (answer === "yes") return { allowed: true, reason: "aprobado por el usuario" };
    return { allowed: false, reason: "rechazado por el usuario" };
  }
}
