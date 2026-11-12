/**
 * Which line of builds this is. Only "main" updates itself (the update check always installs the
 * newest commit of the repository's default branch, which would replace a trial branch). Set back to
 * "main" when a trial branch is merged.
 */
export const RELEASE_CHANNEL: string = "main";
