// Melbourne metropolitan transfer hubs. These 13 stations cover ~95% of
// useful K=2 trips by being on at least two distinct train lines or by
// serving as inter-modal interchanges (V/Line ↔ metro).
//
// stop_ids, names, and coords fetched from the live PTV API.

export const HUBS: ReadonlyArray<{
  stopId: number; name: string; lat: number; lon: number;
}> = [
  { stopId: 1071, name: 'Flinders Street Station',  lat: -37.81831,    lon: 144.966965  },
  { stopId: 1181, name: 'Southern Cross Station',    lat: -37.8185463,  lon: 144.95192   },
  { stopId: 1120, name: 'Melbourne Central Station', lat: -37.8099365,  lon: 144.9626    },
  { stopId: 1155, name: 'Parliament Station',        lat: -37.8110542,  lon: 144.9729    },
  { stopId: 1068, name: 'Flagstaff Station',         lat: -37.8119774,  lon: 144.955658  },
  { stopId: 1162, name: 'Richmond Station',          lat: -37.8240738,  lon: 144.990158  },
  { stopId: 1180, name: 'South Yarra Station',       lat: -37.8384438,  lon: 144.99234   },
  { stopId: 1144, name: 'North Melbourne Station',   lat: -37.80631,    lon: 144.941513  },
  { stopId: 1072, name: 'Footscray Station',         lat: -37.8010864,  lon: 144.9032    },
  { stopId: 1036, name: 'Caulfield Station',         lat: -37.8774567,  lon: 145.042526  },
  { stopId: 1049, name: 'Dandenong Station',         lat: -37.98966,    lon: 145.209061  },
  { stopId: 1041, name: 'Clifton Hill Station',      lat: -37.7886543,  lon: 144.995422  },
  { stopId: 1218, name: 'Sunshine Station',          lat: -37.7883377,  lon: 144.832458  },
];

export const HUB_STOP_IDS: number[] = HUBS.map((h) => h.stopId);

const HUB_SET = new Set(HUB_STOP_IDS);
const HUB_NAME_BY_ID = new Map(HUBS.map((h) => [h.stopId, h.name] as const));
const HUB_COORD_BY_ID = new Map(HUBS.map((h) => [h.stopId, { lat: h.lat, lon: h.lon }] as const));

export function isHub(stopId: number): boolean {
  return HUB_SET.has(stopId);
}

export function hubName(stopId: number): string {
  return HUB_NAME_BY_ID.get(stopId) ?? '';
}

export function hubCoord(stopId: number): { lat: number; lon: number } | null {
  return HUB_COORD_BY_ID.get(stopId) ?? null;
}
