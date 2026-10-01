import type { DisplayMessage } from "@/lib/chat/history";
import { toRichSegments } from "@/lib/chat/rich-text";

const timeFormatter = new Intl.DateTimeFormat("es-DO", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Santo_Domingo",
});

export function MessageBubble({ message }: { message: DisplayMessage }) {
  const mine = message.role === "client";
  const segments = toRichSegments(message.text);
  const links = segments.filter((s) => s.type === "link");

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 pt-1.5 pb-1 text-[15px] leading-snug shadow-sm ${
          mine ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">
          {segments.map((s, i) =>
            s.type === "link" ? null : s.bold ? (
              <strong key={i}>{s.text}</strong>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </p>
        {links.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {links.map((link, i) => (
              <a
                key={i}
                href={link.url}
                rel="noopener noreferrer"
                className="block rounded-md bg-[#00a884] px-3 py-2 text-center text-sm font-semibold text-white active:bg-[#008f6f]"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}
        {message.createdAt !== "" && (
          <time dateTime={message.createdAt} className="mt-0.5 block text-right text-[11px] text-[#667781]">
            {timeFormatter.format(new Date(message.createdAt))}
          </time>
        )}
      </div>
    </div>
  );
}
