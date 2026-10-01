const QUICK_REPLIES: readonly { label: string; text: string }[] = [
  { label: "¿Cuánto cuesta…?", text: "¿Cuánto cuestan sus servicios?" },
  { label: "¿Tienes para mañana?", text: "¿Tienes para mañana?" },
  { label: "Mis paquetes", text: "¿Cómo van mis paquetes?" },
];

export function QuickReplies({ disabled, onPick }: { disabled: boolean; onPick: (text: string) => void }) {
  return (
    <div className="mb-2 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Respuestas rápidas">
      {QUICK_REPLIES.map((q) => (
        <button
          key={q.label}
          type="button"
          disabled={disabled}
          onClick={() => onPick(q.text)}
          className="shrink-0 rounded-full border border-[#00a884]/40 bg-white px-3 py-1.5 text-sm text-[#008069] shadow-sm transition active:bg-[#e7fce3] disabled:opacity-50"
        >
          {q.label}
        </button>
      ))}
    </div>
  );
}
