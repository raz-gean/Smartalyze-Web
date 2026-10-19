// Browser-local drafts of unsaved Edit-tab changes, so a refresh or closed tab
// doesn't lose work. Every access is wrapped: storage can be full, disabled, or
// unavailable (private windows), and the editor must keep working without it.

const DRAFT_KEY_PREFIX = "smartalyze:edit-draft:";

export type EditDraft = {
  // Dataset version the edits were made against; a draft for an older version is stale.
  baseVersionId: number | null;
  savedAt: string;
  editedCells: Array<[string, unknown]>;
  deletedRows: number[];
  insertedRows: Array<[number, Record<string, unknown>]>;
  columns: string[];
  // Original column name -> current name.
  columnRenames: Array<[string, string]>;
};

function draftKey(datasetId: number): string {
  return `${DRAFT_KEY_PREFIX}${datasetId}`;
}

export function readEditDraft(datasetId: number): EditDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(datasetId));
    return raw ? (JSON.parse(raw) as EditDraft) : null;
  } catch {
    return null;
  }
}

/** Returns false if the draft could not be stored (e.g. browser storage is full). */
export function writeEditDraft(datasetId: number, draft: EditDraft): boolean {
  try {
    window.localStorage.setItem(draftKey(datasetId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeEditDraft(datasetId: number): void {
  try {
    window.localStorage.removeItem(draftKey(datasetId));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** Remove every stored draft, on deliberate sign-out so a shared computer doesn't keep data. */
export function clearEditDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
