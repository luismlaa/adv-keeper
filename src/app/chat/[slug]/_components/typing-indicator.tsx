export function TypingIndicator() {
  return (
    <div className="flex justify-start" role="status">
      <div className="flex items-center gap-2 rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm text-[#667781] shadow-sm">
        <span className="flex gap-1" aria-hidden>
          <span className="size-1.5 animate-bounce rounded-full bg-[#8696a0] [animation-delay:-0.3s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-[#8696a0] [animation-delay:-0.15s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-[#8696a0]" />
        </span>
        Keeper está escribiendo…
      </div>
    </div>
  );
}
