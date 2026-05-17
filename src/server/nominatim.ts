export type GeocodeResult = {
  label: string;
  lat: number;
  lon: number;
  rank: number;
};

// Melbourne metro viewbox (lon_w, lat_n, lon_e, lat_s). Biases ranking; does not exclude.
const MELBOURNE_VIEWBOX = '144.5,-37.5,145.6,-38.3';

export class Nominatim {
  constructor(private readonly baseUrl: string) {}

  async search(q: string, limit = 8): Promise<GeocodeResult[]> {
    const u = new URL('/search', this.baseUrl);
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('countrycodes', 'au');
    u.searchParams.set('viewbox', MELBOURNE_VIEWBOX);
    u.searchParams.set('bounded', '0');
    try {
      const res = await fetch(u.toString(), { headers: { 'User-Agent': 'ptv-web/1.0' } });
      if (!res.ok) return [];
      const rows = (await res.json()) as Array<{
        display_name: string; lat: string; lon: string; place_rank: number;
      }>;
      return rows.map((r) => ({
        label: r.display_name,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        rank: r.place_rank,
      }));
    } catch {
      return [];
    }
  }

  async reverse(lat: number, lon: number): Promise<string | null> {
    const u = new URL('/reverse', this.baseUrl);
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lon));
    u.searchParams.set('format', 'jsonv2');
    try {
      const res = await fetch(u.toString(), { headers: { 'User-Agent': 'ptv-web/1.0' } });
      if (!res.ok) return null;
      const row = (await res.json()) as { display_name?: string };
      return row.display_name ?? null;
    } catch {
      return null;
    }
  }
}
