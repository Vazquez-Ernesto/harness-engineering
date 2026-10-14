import { describe, expect, it, vi } from "vitest";
import { PermissionManager, type Approver } from "../src/permissions/permissions.js";
import { readFileTool } from "../src/tools/read-file.js";
import { bashTool } from "../src/tools/bash.js";
import type { Tool } from "../src/tools/types.js";

const request = (tool: Tool) => ({ toolUseId: "toolu_1", tool, input: {}, summary: "" });

describe("PermissionManager", () => {
  it("permite lecturas sin preguntar", async () => {
    const approver = vi.fn<Approver>();
    const pm = new PermissionManager("ask", approver);
    expect((await pm.check(request(readFileTool as Tool))).allowed).toBe(true);
    expect(approver).not.toHaveBeenCalled();
  });

  it("pregunta antes de ejecutar y respeta un 'no'", async () => {
    const pm = new PermissionManager("ask", async () => "no");
    expect((await pm.check(request(bashTool as Tool))).allowed).toBe(false);
  });

  it("'siempre' deja de preguntar por esa herramienta", async () => {
    const approver = vi.fn<Approver>().mockResolvedValue("always");
    const pm = new PermissionManager("ask", approver);
    await pm.check(request(bashTool as Tool));
    await pm.check(request(bashTool as Tool));
    expect(approver).toHaveBeenCalledTimes(1);
  });

  it("auto-approve no pregunta nunca", async () => {
    const approver = vi.fn<Approver>();
    const pm = new PermissionManager("auto-approve", approver);
    expect((await pm.check(request(bashTool as Tool))).allowed).toBe(true);
    expect(approver).not.toHaveBeenCalled();
  });
});
