type StopFields = {
  stop_id: number;
  stop_name: string;
  stop_suburb: string;
  route_type: number;
  stop_latitude: number;
  stop_longitude: number;
  stop_distance?: number;
};

function trimStopArray(stops: StopFields[]): Partial<StopFields>[] {
  return stops.map((s) => ({
    stop_id: s.stop_id,
    stop_name: s.stop_name,
    stop_suburb: s.stop_suburb,
    route_type: s.route_type,
    stop_latitude: s.stop_latitude,
    stop_longitude: s.stop_longitude,
    ...(s.stop_distance !== undefined && { stop_distance: s.stop_distance }),
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export function trimDepartures(data: AnyRecord): AnyRecord[] {
  return (data.departures ?? []).map((d: AnyRecord) => ({
    scheduled_departure_utc: d.scheduled_departure_utc,
    estimated_departure_utc: d.estimated_departure_utc,
    platform_number: d.platform_number,
    run_ref: d.run_ref,
    route_id: d.route_id,
    stop_id: d.stop_id,
    flags: d.flags,
  }));
}

export function trimRoutes(data: AnyRecord): AnyRecord[] {
  return (data.routes ?? []).map((r: AnyRecord) => ({
    route_id: r.route_id,
    route_name: r.route_name,
    route_number: r.route_number,
    route_type: r.route_type,
  }));
}

export function trimDisruptions(data: AnyRecord): AnyRecord[] {
  // data.disruptions is an object with named bucket arrays (metro_train, metro_tram, etc.)
  // We flatten all buckets. d.disruption_type is a string field on each disruption object
  // (e.g. "Planned Works"), distinct from the bucket key (transport mode).
  const buckets = (data.disruptions ?? {}) as Record<string, AnyRecord[]>;
  const all: AnyRecord[] = (Object.values(buckets) as AnyRecord[][]).flat();
  return all.map((d) => ({
    disruption_id: d.disruption_id,
    title: d.title,
    description: d.description,
    disruption_status: d.disruption_status,
    disruption_type: d.disruption_type,
    affected_routes: d.affected_routes,
  }));
}

export function trimSearch(data: AnyRecord): AnyRecord {
  return {
    stops: trimStopArray((data.stops ?? []) as StopFields[]),
    routes: (data.routes ?? []).map((r: AnyRecord) => ({
      route_id: r.route_id,
      route_name: r.route_name,
      route_number: r.route_number,
      route_type: r.route_type,
    })),
  };
}

export function trimNearby(data: AnyRecord): Partial<StopFields>[] {
  return trimStopArray((data.stops ?? []) as StopFields[]);
}

// Used by the `stops search` command — /v3/stops/search/{term} returns a SearchResult
// shape with `stops` array (same as trimSearch but routes array may be absent/empty).
export function trimStopsSearch(data: AnyRecord): AnyRecord {
  return {
    stops: trimStopArray((data.stops ?? []) as StopFields[]),
    ...(data.routes?.length ? { routes: (data.routes as AnyRecord[]).map((r) => ({
      route_id: r.route_id, route_name: r.route_name, route_number: r.route_number, route_type: r.route_type,
    })) } : {}),
  };
}

export function trimStopDetails(
  data: AnyRecord,
  opts: { amenities?: boolean; accessibility?: boolean }
): AnyRecord {
  // The stop_details response nests location under stop_location.stop_gps.
  // stop_suburb exists as a top-level field on V3.StopDetails per Swagger.
  const s = data.stop ?? {};
  const gps = s.stop_location?.stop_gps ?? s; // flat fallback if schema changes
  const result: AnyRecord = {
    stop_id: s.stop_id,
    stop_name: s.stop_name,
    stop_suburb: s.stop_suburb,
    stop_latitude: gps.latitude ?? s.stop_latitude,
    stop_longitude: gps.longitude ?? s.stop_longitude,
  };
  if (opts.amenities && s.stop_amenities !== undefined) result.stop_amenities = s.stop_amenities;
  if (opts.accessibility && s.stop_accessibility !== undefined) result.stop_accessibility = s.stop_accessibility;
  return result;
}
