/**
 * Commander treats any arg beginning with '-' as an option flag, which breaks
 * lat/lon coordinate pairs like "-37.7656,144.9614" (negative latitude).
 *
 * We rewrite those args to a sentinel prefix in index.ts before commander
 * parses them, and unwrap the sentinel in parseCoord() inside commands/plan.ts.
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
