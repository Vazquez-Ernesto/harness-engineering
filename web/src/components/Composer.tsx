import { useState, type KeyboardEvent } from "react";

interface Props {
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}

export function Composer({ busy, disabled, onSend, onCancel }: Props) {
  const [text, setText] = useState("");

  const submit = () => {
    const value = text.trim();
    if (!value || busy || disabled) return;
    onSend(value);
    setText("");
  };

  // Enter envía; Shift+Enter hace salto de línea.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <footer className="composer">
      <div className="composer-inner">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={disabled ? "Sin conexión con el servidor…" : "Pide algo al agente (Enter para enviar, Shift+Enter nueva línea)"}
          rows={2}
          disabled={disabled}
        />
        {busy ? (
          <button className="btn btn-danger" onClick={onCancel}>
            Detener
          </button>
        ) : (
          <button className="btn btn-primary" onClick={submit} disabled={disabled || !text.trim()}>
            Enviar
          </button>
        )}
      </div>
    </footer>
  );
}
