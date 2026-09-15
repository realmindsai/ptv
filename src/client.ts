import { createHmac } from 'crypto';

const BASE_URL = 'https://timetableapi.ptv.vic.gov.au';

export class MissingCredentialsError extends Error {
  constructor() {
    super('PTV_DEV_ID and PTV_API_KEY environment variables are required');
  }
}

function getCredentials(): { devId: string; apiKey: string } {
  const devId = process.env.PTV_DEV_ID;
  const apiKey = process.env.PTV_API_KEY;
  if (!devId || !apiKey) throw new MissingCredentialsError();
  return { devId, apiKey };
}

export function buildQueryString(params: Record<string, string | number | number[] | string[]>): string {
  // Callers must not pass boolean/undefined values — encodeURIComponent would coerce them to strings
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}

export function sign(pathWithDevId: string, apiKey: string): string {
  return createHmac('sha1', apiKey).update(pathWithDevId).digest('hex').toUpperCase();
}

/**
 * PTV explains its refusals in the response body, e.g.
 *   {"message":"Forbidden (403): Throttling limit reached for this service."}
 * Throwing only the status code hid that for as long as nobody read the body —
 * a per-endpoint throttle is indistinguishable from a permissions problem
 * without it. Never throws: a diagnostic must not mask the original failure.
 */
async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
    } catch {
      // Not JSON (an HTML error page from a proxy, say) — fall through.
    }
    return text.slice(0, 200);
  } catch {
    return null;
  }
}

export async function ptv(
  path: string,
  params: Record<string, string | number | number[] | string[]> = {}
): Promise<unknown> {
  const { devId, apiKey } = getCredentials();

  const queryString = buildQueryString(params);
  const pathWithParams = queryString ? `${path}?${queryString}` : path;
  const pathWithDevId = pathWithParams.includes('?')
    ? `${pathWithParams}&devid=${devId}`
    : `${pathWithParams}?devid=${devId}`;

  const signature = sign(pathWithDevId, apiKey);
  const url = `${BASE_URL}${pathWithDevId}&signature=${signature}`;

  const response = await fetch(url);
  if (!response.ok) {
    const detail = await readErrorMessage(response);
    throw new Error(JSON.stringify({
      error: `${response.status} ${pathWithParams}`,
      ...(detail ? { message: detail } : {}),
    }));
  }
  return response.json();
}
