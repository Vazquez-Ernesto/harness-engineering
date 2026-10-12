import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Crea una carpeta temporal con los archivos indicados. */
export async function makeWorkspace(files: Record<string, string> = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-test-"));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(root, name);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  return root;
}
