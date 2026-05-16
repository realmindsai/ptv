/**
 * Commander 14 treats any arg beginning with '-' as an option flag, which
 * breaks lat/lon coordinate pairs like "-37.7656,144.9614" (negative latitude).
 *
 * SCOPE: This preprocessor handles negative coordinate-shaped args ONLY
 * (matched by /^-\d[\d.]*,\d/). It does NOT handle negative values passed
 * to numeric options (e.g. `--min-bike-km -5`). Negative numeric option
 * values are rejected by commands/plan.ts after parsing, which is the
 * correct layer for input validation.
 */
export const NEG_COORD_PREFIX = '__NEG__';

/**
 * Rewrite argv so that negative lat,lon pairs don't confuse commander.
 * Any arg matching /^-\d[\d.]*,\d/ (e.g. "-37.7656,144.9614") is rewritten
 * to "__NEG__37.7656,144.9614".
 */
export function preprocessArgv(argv: string[]): string[] {
  return argv.map((a) =>
    /^-\d[\d.]*,\d/.test(a) ? NEG_COORD_PREFIX + a.slice(1) : a,
  );
}
