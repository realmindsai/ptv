// Melbourne metropolitan transfer hubs. These 13 stations cover ~95% of
// useful K=2 trips by being on at least two distinct train lines or by
// serving as inter-modal interchanges (V/Line ↔ metro).
//
// stop_ids and names fetched from the live PTV API via
// `node dist/index.js search <name>`.

export const HUBS: ReadonlyArray<{ stopId: number; name: string }> = [
  { stopId: 1071, name: 'Flinders Street Station' },
  { stopId: 1181, name: 'Southern Cross Station' },
  { stopId: 1120, name: 'Melbourne Central Station' },
  { stopId: 1155, name: 'Parliament Station' },
  { stopId: 1068, name: 'Flagstaff Station' },
  { stopId: 1162, name: 'Richmond Station' },
  { stopId: 1180, name: 'South Yarra Station' },
  { stopId: 1144, name: 'North Melbourne Station' },
  { stopId: 1072, name: 'Footscray Station' },
  { stopId: 1036, name: 'Caulfield Station' },
  { stopId: 1049, name: 'Dandenong Station' },
  { stopId: 1041, name: 'Clifton Hill Station' },
  { stopId: 1218, name: 'Sunshine Station' },
];

export const HUB_STOP_IDS: number[] = HUBS.map((h) => h.stopId);

const HUB_SET = new Set(HUB_STOP_IDS);
const HUB_NAME_BY_ID = new Map(HUBS.map((h) => [h.stopId, h.name] as const));

export function isHub(stopId: number): boolean {
  return HUB_SET.has(stopId);
}

export function hubName(stopId: number): string {
  return HUB_NAME_BY_ID.get(stopId) ?? '';
}
