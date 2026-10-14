import { useEffect, useState } from "react";
import type { ProviderId } from "../../../src/server/protocol";
import type { ConnectionStatus, SessionInfo } from "../useAgent";

interface Props {
  session: SessionInfo | null;
  connection: ConnectionStatus;
  busy: boolean;
  onConfigure: (provider: ProviderId, model: string) => void;
  onReset: () => void;
}

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: "conectando…",
  open: "conectado",
  closed: "desconectado",
};

export function Header({ session, connection, busy, onConfigure, onReset }: Props) {
  const [provider, setProvider] = useState<ProviderId | "">("");
  const [model, setModel] = useState("");

  // Cuando el servidor confirma la sesión, sincronizamos el formulario.
  useEffect(() => {
    if (!session) return;
    setProvider(session.provider);
    setModel(session.model);
  }, [session]);

  const changed = session !== null && (provider !== session.provider || model !== session.model);

  const onProviderChange = (next: ProviderId) => {
    setProvider(next);
    const option = session?.providers.find((p) => p.id === next);
    if (option) setModel(option.defaultModel);
  };

  return (
    <header className="header">
      <div className="brand">
        <span className="logo" aria-hidden>
          H
        </span>
        <span>harness</span>
      </div>

      {session && (
        <form
          className="model-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (provider) onConfigure(provider, model);
          }}
        >
          <select
            aria-label="Proveedor"
            value={provider}
            disabled={busy}
            onChange={(e) => onProviderChange(e.target.value as ProviderId)}
          >
            {session.providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.configured}>
                {p.label}
                {p.configured ? "" : " (sin clave)"}
              </option>
            ))}
          </select>
          <input aria-label="Modelo" value={model} disabled={busy} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
          {changed && (
            <button type="submit" className="btn" disabled={busy} title="Cambiar de modelo empieza una conversación nueva">
              Aplicar
            </button>
          )}
        </form>
      )}

      <div className="header-right">
        {session && (
          <span className="workspace" title={`Transcript: ${session.transcriptFile}`}>
            {session.workspace}
          </span>
        )}
        <span className={`status status-${connection}`}>{CONNECTION_LABEL[connection]}</span>
        <button className="btn btn-ghost" onClick={onReset} disabled={busy}>
          Nueva conversación
        </button>
      </div>
    </header>
  );
}
