/**
 * Gestión de contexto, versión 1: no meter salidas gigantes en la conversación.
 *
 * Cada carácter que devuelve una herramienta se reenvía al modelo en TODAS las
 * llamadas siguientes. Un `npm install` con 5.000 líneas de log llenaría la
 * ventana de contexto y encarecería cada paso. Guardamos el principio y el
 * final (donde suelen estar el comando y el error) y avisamos del recorte.
 */
export const DEFAULT_MAX_CHARS = 30_000;

export function truncateMiddle(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  const omitted = text.length - half * 2;
  return `${text.slice(0, half)}\n\n[... ${omitted} caracteres omitidos por el harness ...]\n\n${text.slice(-half)}`;
}
