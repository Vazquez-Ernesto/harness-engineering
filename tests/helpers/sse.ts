/** Construye una respuesta HTTP en streaming (SSE) como la de un proveedor real. */
export function sseResponse(chunks: unknown[], { splitEvery = 0 }: { splitEvery?: number } = {}): Response {
  let text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  const encoder = new TextEncoder();
  // splitEvery > 0 trocea el cuerpo en pedazos arbitrarios, como hace la red de verdad.
  const pieces: string[] = [];
  if (splitEvery > 0) {
    while (text.length > 0) {
      pieces.push(text.slice(0, splitEvery));
      text = text.slice(splitEvery);
    }
  } else {
    pieces.push(text);
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
