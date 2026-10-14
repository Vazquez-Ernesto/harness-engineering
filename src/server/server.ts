/**
 * Servidor de la UI web.
 *
 *  - Sirve la app React ya compilada (dist/web).
 *  - Abre un WebSocket en /ws: cada pestaña conectada es una Session.
 *
 * Seguridad: este servidor puede ejecutar comandos en tu máquina, así que
 *  1. solo escucha en 127.0.0.1 (no es accesible desde otra máquina), y
 *  2. comprueba la cabecera Origin del WebSocket. Los WebSockets NO tienen
 *     protección CORS: sin este chequeo, cualquier web que visites podría
 *     conectarse a ws://localhost y pedirle al agente que ejecute cosas
 *     (ataque "Cross-Site WebSocket Hijacking").
 *
 * Uso:
 *   npm run ui                              -> compila todo y abre el servidor
 *   npm run ui -- --cwd ../mi-proyecto
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { loadConfig, loadDotEnv } from "../config.js";
import { Session } from "./session.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";

const HOST = "127.0.0.1";
/** Puerto del servidor de desarrollo de Vite (npm run dev:web). */
const VITE_DEV_PORT = 5173;

export function allowedOrigins(port: number): Set<string> {
  const origins = new Set<string>();
  for (const p of [port, VITE_DEV_PORT]) {
    origins.add(`http://localhost:${p}`);
    origins.add(`http://127.0.0.1:${p}`);
  }
  return origins;
}

export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  return origin !== undefined && allowedOrigins(port).has(origin);
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

/** Busca la web compilada tanto si corremos desde dist/ como desde src/ (tsx). */
function findWebDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../web"), path.resolve(here, "../../dist/web")];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "index.html"))) ?? null;
}

function serveStatic(webDir: string | null, req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!webDir) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("La web no está compilada. Ejecuta `npm run build` (o usa `npm run dev:web` en desarrollo).");
    return;
  }
  const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const requested = path.resolve(webDir, "." + urlPath);
  // Mismo principio que las herramientas: nada fuera de la carpeta permitida.
  const inside = requested === webDir || requested.startsWith(webDir + path.sep);
  const file = inside && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(webDir, "index.html");
  res.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

function parseArgs(argv: string[]): { cwd: string } {
  const index = argv.indexOf("--cwd");
  return { cwd: path.resolve(index >= 0 ? (argv[index + 1] ?? ".") : (process.env.HARNESS_WORKSPACE ?? ".")) };
}

function main(): void {
  loadDotEnv();
  const { cwd } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const port = Number(process.env.HARNESS_PORT ?? 4317);
  const webDir = findWebDir();

  const server = http.createServer((req, res) => serveStatic(webDir, req, res));
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: ({ origin }: { origin?: string }) => isAllowedOrigin(origin, port),
  });

  wss.on("connection", (socket: WebSocket) => {
    const send = (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    let session: Session;
    try {
      session = new Session({ config, workspaceRoot: cwd, send });
    } catch (err) {
      send({ type: "error", message: (err as Error).message });
      socket.close();
      return;
    }

    socket.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send({ type: "error", message: "Mensaje no es JSON válido." });
        return;
      }
      session.handle(message).catch((err: Error) => send({ type: "error", message: err.message }));
    });
    // Si cierras la pestaña, se cancela lo que estuviera haciendo el agente.
    socket.on("close", () => session.cancel());
  });

  server.listen(port, HOST, () => {
    console.log(`harness UI → http://localhost:${port}`);
    console.log(`proveedor: ${config.provider} · modelo: ${config.model}`);
    console.log(`workspace: ${cwd}`);
    if (!webDir) console.log("(la web no está compilada: usa `npm run dev:web` y abre http://localhost:5173)");
  });
}

// Solo arranca si se ejecuta directamente (no al importarlo en los tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
