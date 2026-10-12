/**
 * Confinamiento de rutas: el agente solo puede tocar archivos dentro del workspace.
 *
 * Las rutas que manda el modelo son "input no confiable" (igual que un input
 * de usuario en una web). Sin esto, el modelo podría pedir `../../etc/passwd`
 * o seguir un symlink que apunta fuera de la carpeta.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ToolError } from "./types.js";

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convierte una ruta del modelo en una ruta absoluta segura dentro del workspace.
 * Lanza ToolError si se escapa (por `..`, ruta absoluta o symlink).
 */
export async function resolveInWorkspace(workspaceRoot: string, requested: string): Promise<string> {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, requested);

  // 1) Chequeo léxico: "../" y rutas absolutas fuera del root.
  if (!isInside(root, target)) {
    throw new ToolError(`La ruta "${requested}" está fuera del workspace. Usa rutas dentro de ${root}`);
  }

  // 2) Chequeo real: resolvemos symlinks del ancestro existente más cercano
  //    (el archivo puede no existir todavía si lo vamos a crear).
  let existing = target;
  while (!(await exists(existing))) existing = path.dirname(existing);
  const realRoot = await fs.realpath(root);
  const realExisting = await fs.realpath(existing);
  if (!isInside(realRoot, realExisting)) {
    throw new ToolError(`La ruta "${requested}" apunta fuera del workspace (symlink).`);
  }

  return target;
}

/** Ruta relativa al workspace, para mostrar resultados más legibles. */
export function displayPath(workspaceRoot: string, absolute: string): string {
  return path.relative(workspaceRoot, absolute) || ".";
}
