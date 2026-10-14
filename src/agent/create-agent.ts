/**
 * Ensambla un Agent con todas sus piezas. Lo usan tanto la CLI como el
 * servidor de la UI web: misma lógica, distinta "cara".
 */
import { Agent, type AgentEvents } from "./agent.js";
import type { HarnessConfig } from "../config.js";
import { createModelClient } from "../model/providers.js";
import type { ModelClient } from "../model/client.js";
import { createDefaultRegistry } from "../tools/registry.js";
import { PermissionManager, type Approver, type PermissionMode } from "../permissions/permissions.js";
import { buildSystemPrompt } from "../prompts/system.js";
import type { Transcript } from "../observability/transcript.js";

export interface CreateAgentOptions {
  config: HarnessConfig;
  workspaceRoot: string;
  approver: Approver;
  permissionMode?: PermissionMode;
  events?: AgentEvents;
  transcript?: Transcript;
  /** Para tests: sustituye al modelo real. */
  model?: ModelClient;
}

export function createAgent(options: CreateAgentOptions): Agent {
  const { config, workspaceRoot } = options;
  return new Agent({
    model: options.model ?? createModelClient(config),
    tools: createDefaultRegistry(),
    permissions: new PermissionManager(options.permissionMode ?? "ask", options.approver),
    system: buildSystemPrompt({
      workspaceRoot,
      platform: process.platform,
      date: new Date().toISOString().slice(0, 10),
    }),
    workspaceRoot,
    maxSteps: config.maxSteps,
    events: options.events,
    transcript: options.transcript,
  });
}
