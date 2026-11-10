/** The list's sections, in their default order. Plain values so pure triage code can use them. */
export const SECTIONS = ["pinned", "unread", "running", "inactive"] as const;
export type Section = (typeof SECTIONS)[number];

/** Order of the chats inside a section, by the time the section sorts on. */
export type SortDirection = "oldest" | "newest";
export const DEFAULT_SECTION_SORT: Readonly<Record<Section, SortDirection>> = {
  pinned: "oldest",
  unread: "oldest",
  running: "oldest",
  inactive: "newest",
};
