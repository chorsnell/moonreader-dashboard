/** Control characters and line or paragraph separators. */
const BREAKS = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/** Text from a device or a file, safe to put in one line of update.log. */
export const oneLine = (text: string, max = 200): string =>
  text.replace(BREAKS, ' ').trim().slice(0, max);
