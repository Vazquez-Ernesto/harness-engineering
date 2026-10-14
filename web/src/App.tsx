import { useEffect, useRef } from "react";
import { useAgent } from "./useAgent";
import { Header } from "./components/Header";
import { Composer } from "./components/Composer";
import { ChatItemView } from "./components/ChatItemView";

const SUGGESTIONS = [
  "Explícame la estructura de este proyecto",
  "Busca dónde se manejan los errores y resúmelo",
  "Ejecuta los tests y dime si algo falla",
];

export function App() {
  const agent = useAgent();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Autoscroll mientras llega la respuesta.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [agent.items]);

  return (
    <div className="app">
      <Header
        session={agent.session}
        connection={agent.connection}
        busy={agent.busy}
        onConfigure={agent.configure}
        onReset={agent.reset}
      />

      <main className="chat">
        <div className="chat-inner">
          {agent.items.length === 0 ? (
            <div className="empty">
              <h1>¿En qué trabajamos?</h1>
              <p>El agente puede leer, buscar y editar archivos del workspace y ejecutar comandos. Te pedirá permiso antes de escribir o ejecutar.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="suggestion" disabled={agent.busy || agent.connection !== "open"} onClick={() => agent.sendMessage(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            agent.items.map((item) => <ChatItemView key={item.key} item={item} onApprove={agent.approve} />)
          )}
          {agent.busy && agent.items.at(-1)?.kind === "user" && <div className="working">Trabajando…</div>}
          <div ref={bottomRef} />
        </div>
      </main>

      <Composer
        busy={agent.busy}
        disabled={agent.connection !== "open"}
        onSend={agent.sendMessage}
        onCancel={agent.cancel}
      />
    </div>
  );
}
