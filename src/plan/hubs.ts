// Melbourne metropolitan transfer hubs. These 13 stations cover ~95% of
// useful K=2 trips by being on at least two distinct train lines or by
// serving as inter-modal interchanges (V/Line ↔ metro).
//
// stop_ids fetched from the live PTV API via `node dist/index.js search <name>`.

export const HUB_STOP_IDS: number[] = [
  /* Flinders Street     */ 1071,
  /* Southern Cross      */ 1181,
  /* Melbourne Central   */ 1120,
  /* Parliament          */ 1155,
  /* Flagstaff           */ 1068,
  /* Richmond            */ 1162,
  /* South Yarra         */ 1180,
  /* North Melbourne     */ 1144,
  /* Footscray           */ 1072,
  /* Caulfield           */ 1036,
  /* Dandenong           */ 1049,
  /* Clifton Hill        */ 1041,
  /* Sunshine            */ 1218,
];

const HUB_SET = new Set(HUB_STOP_IDS);

export function isHub(stopId: number): boolean {
  return HUB_SET.has(stopId);
}
