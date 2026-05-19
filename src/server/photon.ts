export type PhotonHit = {
  label: string;
  lat: number;
  lon: number;
  osm_key?: string;
  osm_value?: string;
};

// Victoria bounding box used to bias (but not hard-constrain) Photon results.
// Photon doesn't enforce a `bounded` flag like Nominatim — it uses lon/lat for
// distance ranking only. The chat tools further filter by country.
const MELBOURNE_CENTRE = { lat: -37.8136, lon: 144.9631 };

function composeLabel(feat: any): string {
  const p = feat?.properties ?? {};
  // Photon's "name" is the primary feature name (e.g. "CERES Community Gardens").
  // We append city/state/country so the user can recognise which one they got.
  const parts = [p.name, p.suburb, p.city, p.state, p.country].filter(Boolean);
  // De-duplicate adjacent identical parts (e.g. suburb == city in CBD).
  const out: string[] = [];
  for (const part of parts) {
    if (out[out.length - 1] !== part) out.push(part);
  }
  return out.join(', ');
}

export class Photon {
  constructor(private readonly baseUrl: string) {}

  async search(q: string, limit = 8): Promise<PhotonHit[]> {
    const u = new URL('/api', this.baseUrl);
    u.searchParams.set('q', q);
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('lang', 'en');
    // Bias toward Melbourne. Photon uses this to rank by proximity; it does
    // NOT exclude results outside this point.
    u.searchParams.set('lat', String(MELBOURNE_CENTRE.lat));
    u.searchParams.set('lon', String(MELBOURNE_CENTRE.lon));
    try {
      const res = await fetch(u.toString(), { headers: { 'User-Agent': 'ptv-chat/1.0' } });
      if (!res.ok) return [];
      const json = (await res.json()) as { features?: any[] };
      const features = json.features ?? [];
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
        });
      }
      return hits;
    } catch {
      return [];
    }
  }
}
