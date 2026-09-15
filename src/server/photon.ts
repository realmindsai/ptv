export type PhotonHit = {
  label: string;
  lat: number;
  lon: number;
  osm_key?: string;
  osm_value?: string;
  // Locality fields kept verbatim from Photon so the post-ranker can tell a
  // right-name/wrong-suburb hit from a right one. Photon leaves `suburb` null
  // in this import — `district` is where the suburb actually lands, and `city`
  // is the LGA ("City of Port Phillip"), not the suburb.
  name?: string;
  street?: string;
  housenumber?: string;
  district?: string;
  city?: string;
  state?: string;
};

// Victoria bounding box (lon_w, lat_s, lon_e, lat_n). Photon's `bbox` HARD-
// constrains results, unlike lat/lon which only nudges the ranking. Nominatim
// has always been bounded to the same box (see nominatim.ts); leaving Photon
// unbounded is what let "Flinders Street Station" resolve to Townsville.
const VICTORIA_BBOX = '140.96,-39.16,149.98,-33.98';

// Proximity bias. Photon uses this point for distance ranking only; it does
// not exclude anything. The chat tools further filter by country.
const MELBOURNE_CENTRE = { lat: -37.8136, lon: 144.9631 };

function composeLabel(feat: any): string {
  const p = feat?.properties ?? {};
  // Photon's "name" is the primary feature name (e.g. "CERES Community Gardens").
  // We append city/state/country so the user can recognise which one they got.
  // `district` carries the suburb in this import and must be shown: without it
  // a wrong-suburb hit reads as plausible ("Little Library, City of Merri-bek").
  // A house has no `name` — only housenumber + street. Without them the label
  // for "150 Carlisle Street" was just "St Kilda", which reads exactly like the
  // whole suburb and gives the caller no way to tell which one it got.
  const primary = p.name ?? [p.housenumber, p.street].filter(Boolean).join(' ');
  const parts = [primary, p.suburb, p.district, p.city, p.state, p.country].filter(Boolean);
  // De-duplicate adjacent identical parts (e.g. suburb == city in CBD).
  const out: string[] = [];
  for (const part of parts) {
    if (out[out.length - 1] !== part) out.push(part);
  }
  return out.join(', ');
}

/**
 * Turn a Photon GeoJSON response into PhotonHits. Split out of `search` so the
 * post-ranker can be tested against recorded payloads without touching the net.
 */
export function parsePhotonFeatures(json: unknown): PhotonHit[] {
  const features = (json as { features?: any[] } | null)?.features ?? [];
  const hits: PhotonHit[] = [];
  for (const f of features) {
    const coords = f?.geometry?.coordinates;
    const p = f?.properties ?? {};
    if (!Array.isArray(coords) || coords.length < 2) continue;
    // Keep AU only — Photon ranks by proximity, but a typo can still pull
    // in a hit from Indonesia/NZ. We hard-filter here.
    if (p.countrycode && p.countrycode !== 'AU') continue;
    hits.push({
      label: composeLabel(f),
      lat: coords[1],
      lon: coords[0],
      osm_key: p.osm_key,
      osm_value: p.osm_value,
      name: p.name ?? undefined,
      street: p.street ?? undefined,
      housenumber: p.housenumber ?? undefined,
      district: p.district ?? undefined,
      city: p.city ?? undefined,
      state: p.state ?? undefined,
    });
  }
  return hits;
}

export class Photon {
  constructor(private readonly baseUrl: string) {}

  async search(q: string, limit = 8): Promise<PhotonHit[]> {
    const u = new URL('/api', this.baseUrl);
    u.searchParams.set('q', q);
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('lang', 'en');
    // Bias toward Melbourne. Photon uses this to rank by proximity; it does
    // NOT exclude results outside this point — `bbox` below does that.
    u.searchParams.set('lat', String(MELBOURNE_CENTRE.lat));
    u.searchParams.set('lon', String(MELBOURNE_CENTRE.lon));
    u.searchParams.set('bbox', VICTORIA_BBOX);
    try {
      const res = await fetch(u.toString(), { headers: { 'User-Agent': 'ptv-chat/1.0' } });
      if (!res.ok) return [];
      return parsePhotonFeatures(await res.json());
    } catch {
      return [];
    }
  }
}
