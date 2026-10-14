import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readFileTool } from "../src/tools/read-file.js";
import { editFileTool } from "../src/tools/edit-file.js";
import { writeFileTool } from "../src/tools/write-file.js";
import { listFilesTool } from "../src/tools/list-files.js";
import { searchFilesTool } from "../src/tools/search-files.js";
import { bashTool } from "../src/tools/bash.js";
import { resolveInWorkspace } from "../src/tools/workspace.js";
import { truncateMiddle } from "../src/tools/truncate.js";
import { ToolError } from "../src/tools/types.js";
import { makeWorkspace } from "./helpers/workspace.js";

describe("resolveInWorkspace", () => {
  it("acepta rutas dentro del workspace", async () => {
    const root = await makeWorkspace({ "a.txt": "x" });
    await expect(resolveInWorkspace(root, "a.txt")).resolves.toBe(path.join(root, "a.txt"));
    await expect(resolveInWorkspace(root, "nuevo/dir/b.txt")).resolves.toBe(path.join(root, "nuevo/dir/b.txt"));
  });

  it("rechaza ../ y rutas absolutas fuera del workspace", async () => {
    const root = await makeWorkspace();
    await expect(resolveInWorkspace(root, "../fuera.txt")).rejects.toBeInstanceOf(ToolError);
    await expect(resolveInWorkspace(root, "/etc/passwd")).rejects.toBeInstanceOf(ToolError);
  });

  it("no se deja engañar por un nombre que empieza por '..'", async () => {
    const root = await makeWorkspace({ "..notas.txt": "ok" });
    await expect(resolveInWorkspace(root, "..notas.txt")).resolves.toBe(path.join(root, "..notas.txt"));
  });

  it("rechaza symlinks que apuntan fuera del workspace", async () => {
    const root = await makeWorkspace();
    const outside = await makeWorkspace({ "secreto.txt": "s" });
    await fs.symlink(outside, path.join(root, "enlace"));
    await expect(resolveInWorkspace(root, "enlace/secreto.txt")).rejects.toBeInstanceOf(ToolError);
  });
});

describe("read_file", () => {
  it("devuelve el contenido con números de línea", async () => {
    const root = await makeWorkspace({ "a.txt": "uno\ndos\ntres" });
    const out = await readFileTool.run({ path: "a.txt" }, { workspaceRoot: root });
    expect(out).toBe("     1\tuno\n     2\tdos\n     3\ttres");
  });

  it("respeta offset y limit e indica el rango", async () => {
    const root = await makeWorkspace({ "a.txt": "1\n2\n3\n4\n5" });
    const out = await readFileTool.run({ path: "a.txt", offset: 2, limit: 2 }, { workspaceRoot: root });
    expect(out).toContain("     2\t2\n     3\t3");
    expect(out).toContain("[Mostrando líneas 2-3 de 5]");
  });

  it("lanza ToolError si el archivo no existe", async () => {
    const root = await makeWorkspace();
    await expect(readFileTool.run({ path: "nada.txt" }, { workspaceRoot: root })).rejects.toBeInstanceOf(ToolError);
  });
});

describe("edit_file", () => {
  const edit = (root: string, input: Partial<Parameters<typeof editFileTool.run>[0]>) =>
    editFileTool.run({ path: "a.ts", old_string: "", new_string: "", replace_all: false, ...input }, { workspaceRoot: root });

  it("reemplaza una aparición única", async () => {
    const root = await makeWorkspace({ "a.ts": "const x = 1;\nconst y = 2;\n" });
    await edit(root, { old_string: "x = 1", new_string: "x = 42" });
    expect(await fs.readFile(path.join(root, "a.ts"), "utf8")).toBe("const x = 42;\nconst y = 2;\n");
  });

  it("falla si el texto no existe", async () => {
    const root = await makeWorkspace({ "a.ts": "hola" });
    await expect(edit(root, { old_string: "adiós", new_string: "x" })).rejects.toThrow(/No encontré/);
  });

  it("falla si el texto es ambiguo, salvo con replace_all", async () => {
    const root = await makeWorkspace({ "a.ts": "foo foo foo" });
    await expect(edit(root, { old_string: "foo", new_string: "bar" })).rejects.toThrow(/3 veces/);
    await edit(root, { old_string: "foo", new_string: "bar", replace_all: true });
    expect(await fs.readFile(path.join(root, "a.ts"), "utf8")).toBe("bar bar bar");
  });

  it("no interpreta patrones especiales como $& en el texto nuevo", async () => {
    const root = await makeWorkspace({ "a.ts": "precio" });
    await edit(root, { old_string: "precio", new_string: "cuesta $& y $1" });
    expect(await fs.readFile(path.join(root, "a.ts"), "utf8")).toBe("cuesta $& y $1");
  });
});

describe("write_file, list_files y search_files", () => {
  it("write_file crea carpetas intermedias", async () => {
    const root = await makeWorkspace();
    await writeFileTool.run({ path: "src/deep/new.ts", content: "export {};\n" }, { workspaceRoot: root });
    expect(await fs.readFile(path.join(root, "src/deep/new.ts"), "utf8")).toBe("export {};\n");
  });

  it("list_files ignora node_modules", async () => {
    const root = await makeWorkspace({ "src/a.ts": "", "node_modules/pkg/index.js": "" });
    const out = await listFilesTool.run({ path: ".", max_depth: 3 }, { workspaceRoot: root });
    expect(out.split("\n")).toEqual(["src/", "src/a.ts"]);
  });

  it("search_files devuelve ruta:línea", async () => {
    const root = await makeWorkspace({ "src/a.ts": "uno\nfunction login() {}\n" });
    const out = await searchFilesTool.run({ pattern: "function\\s+login", path: ".", ignore_case: false }, { workspaceRoot: root });
    expect(out).toBe("src/a.ts:2: function login() {}");
  });
});

describe("bash", () => {
  it("devuelve stdout y código de salida", async () => {
    const root = await makeWorkspace();
    const out = await bashTool.run({ command: "echo hola" }, { workspaceRoot: root });
    expect(out).toContain("<stdout>\nhola\n\n</stdout>");
    expect(out).toContain("Código de salida: 0");
  });

  it("un exit code distinto de 0 es información, no una excepción", async () => {
    const root = await makeWorkspace();
    const out = await bashTool.run({ command: "echo fallo >&2; exit 3" }, { workspaceRoot: root });
    expect(out).toContain("fallo");
    expect(out).toContain("Código de salida: 3");
  });

  it("se ejecuta dentro del workspace", async () => {
    const root = await makeWorkspace();
    const out = await bashTool.run({ command: "pwd" }, { workspaceRoot: root });
    expect(out).toContain(await fs.realpath(root));
  });
});

describe("truncateMiddle", () => {
  it("conserva principio y final", () => {
    const out = truncateMiddle("a".repeat(50) + "b".repeat(50), 20);
    expect(out.startsWith("a".repeat(10))).toBe(true);
    expect(out.endsWith("b".repeat(10))).toBe(true);
    expect(out).toContain("80 caracteres omitidos");
  });
});
