/**
 * Explicit route prop types (Next 16 passes params/searchParams as Promises). Used instead of the
 * generated `PageProps<...>` globals so `tsc --noEmit` works on a fresh clone without `.next/types`.
 */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export interface SearchPageProps {
  searchParams: SearchParams;
}

export interface IdPageProps {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}
