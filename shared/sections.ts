/** The list's sections, in their default order. Plain values so pure triage code can use them. */
export const SECTIONS = ["pinned", "unread", "running", "inactive"] as const;
export type Section = (typeof SECTIONS)[number];
