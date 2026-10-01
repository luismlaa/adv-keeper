"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DisplayMessage } from "@/lib/chat/history";
import { MessageBubble } from "./message-bubble";
import { QuickReplies } from "./quick-replies";
import { TypingIndicator } from "./typing-indicator";

interface ChatWindowProps {
  slug: string;
  businessName: string;
  initialMessages: DisplayMessage[];
}

interface ChatResponse {
  reply?: string;
  messages?: DisplayMessage[];
  error?: string;
}

const GREETING = (businessName: string): DisplayMessage => ({
  id: "greeting",
  role: "assistant",
  text: `¡Hola! 👋 Soy Keeper, la asistente de ${businessName}. Pregúntame precios, horarios o por tus paquetes, y te reservo al momento.`,
  createdAt: "",
});

const MAX_LENGTH = 1000;

export function ChatWindow({ slug, businessName, initialMessages }: ChatWindowProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, notice]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (trimmed === "" || sending) return;
    setSending(true);
    setNotice(null);
    setDraft("");
    const optimistic: DisplayMessage = { id: `local-${Date.now()}`, role: "client", text: trimmed, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, text: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as ChatResponse;
      if (res.ok && data.messages) setMessages(data.messages);
      else setNotice(data.reply ?? "No pude enviar tu mensaje. Intenta de nuevo.");
    } catch {
      setNotice("Sin conexión. Revisa tu internet e intenta de nuevo.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  const shown = [GREETING(businessName), ...messages];

  return (
    <div className="mx-auto flex h-dvh w-full max-w-xl flex-col bg-[#efeae2] text-[#111b21]">
      <header className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white shadow">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-lg font-semibold" aria-hidden>
          {businessName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{businessName}</h1>
          <p className="text-xs text-white/80">{sending ? "Keeper está escribiendo…" : "en línea · responde al instante"}</p>
        </div>
      </header>

      <main className="flex-1 space-y-2 overflow-y-auto px-3 py-4" aria-live="polite">
        {shown.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {sending && <TypingIndicator />}
        {notice !== null && (
          <p role="alert" className="mx-auto max-w-[85%] rounded-lg bg-[#fff3c4] px-3 py-2 text-center text-sm text-[#54656f] shadow-sm">
            {notice}
          </p>
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="bg-[#f0f2f5] px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <QuickReplies disabled={sending} onPick={(text) => void send(text)} />
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Escribe un mensaje
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={MAX_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder="Escribe un mensaje"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-3xl bg-white px-4 py-2.5 text-[15px] leading-6 outline-none placeholder:text-[#8696a0] focus:ring-2 focus:ring-[#25d366]/50"
          />
          <button
            type="submit"
            disabled={sending || draft.trim() === ""}
            aria-label="Enviar"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white transition disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden>
              <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </form>
      </footer>
    </div>
  );
}
