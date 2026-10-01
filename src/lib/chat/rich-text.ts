/**
 * Tiny, safe formatter for concierge replies: splits text into plain/bold runs and http(s) links
 * (bare URLs or markdown `[label](url)`), so the UI can render links as tappable buttons without
 * ever injecting HTML.
 */

export type RichSegment =
  | { type: "text"; text: string; bold: boolean }
  | { type: "link"; url: string; label: string };

const LINK_PATTERN = /\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?¡¿"'»]+$/;

export function linkLabel(url: string, fallback: string | null): string {
  if (/\/pay\//.test(url)) return "Pagar anticipo";
  return fallback ?? "Abrir enlace";
}

function textSegments(text: string): RichSegment[] {
  if (text === "") return [];
  return text
    .split(/(\*\*[^*\n]+\*\*)/g)
    .filter((part) => part !== "")
    .map((part) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4
        ? { type: "text", text: part.slice(2, -2), bold: true }
        : { type: "text", text: part, bold: false },
    );
}

export function toRichSegments(input: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let cursor = 0;
  for (const match of input.matchAll(LINK_PATTERN)) {
    const start = match.index;
    const [whole, mdLabel, mdUrl, bareUrl] = match;
    let url = mdUrl ?? bareUrl ?? "";
    let end = start + whole.length;
    if (bareUrl !== undefined) {
      const trailing = TRAILING_PUNCTUATION.exec(url)?.[0] ?? "";
      url = url.slice(0, url.length - trailing.length);
      end -= trailing.length;
    }
    segments.push(...textSegments(input.slice(cursor, start)));
    segments.push({ type: "link", url, label: linkLabel(url, mdLabel ?? null) });
    cursor = end;
  }
  segments.push(...textSegments(input.slice(cursor)));
  return segments;
}
