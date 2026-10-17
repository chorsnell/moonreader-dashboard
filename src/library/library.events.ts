/** Emitted when something arrives that may need a rebuild: a backup, or a synced reading position. */
export const LIBRARY_CHANGED = 'library.changed';

/** Emitted after a rebuild has written new data files. */
export const LIBRARY_REBUILT = 'library.rebuilt';
