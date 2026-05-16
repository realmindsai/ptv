export type LatLon = { lat: number; lon: number };

export type RouteTypeBikeable = 0 | 3; // 0 = Metro Train, 3 = V/Line

export type ItineraryLabel =
  | 'recommended' | 'fastest' | 'most-bike' | 'most-bike-path' | 'fewest-transfers';

export type ConstraintViolation =
  | 'min_bike_km' | 'max_bike_km' | 'max_transfers';

export type GeoJsonLineString = {
  type: 'LineString';
  coordinates: [number, number][];  // [lon, lat] pairs (GeoJSON convention)
};

export type BikeLeg = {
  mode: 'bike';
  from: LatLon;
  to: LatLon;
  km: number;
  min: number;
  kmOnPath?: number | null;
  ascendM?: number;
  descendM?: number;
  maxSustainedGradePercent?: number;
  maxSustainedGradeM?: number;
  flatFraction?: number;
  steepFraction?: number;
  geometry?: GeoJsonLineString | null;
};

export type TrainLeg = {
  mode: 'train';
  routeId: number;
  routeType: RouteTypeBikeable;
  routeName: string;
  fromStopId: number;
  toStopId: number;
  fromStopName: string;
  toStopName: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  departUtc: string;
  arriveUtc: string;
  runRef: string;
};

export type Leg = BikeLeg | TrainLeg;

export type Itinerary = {
  labels: ItineraryLabel[];
  totalTimeMin: number;
  bikeKm: number;
  bikeMin: number;
  bikeKmOnPath?: number | null;
  trainKm: number;
  trainMin: number;
  waitMin: number;
  transfers: number;
  transferDwellMin?: number;
  ascendM?: number;
  descendM?: number;
  maxSustainedGradePercent?: number;
  maxSustainedGradeM?: number;
  flatFraction?: number;
  steepFraction?: number;
  legs: Leg[];
  constraintsViolated?: ConstraintViolation[];
};

export type PlanRequest = {
  from: LatLon;
  to: LatLon;
  departUtc?: Date;
  arriveByUtc?: Date;
  minBikeKm: number;
  maxBikeKm: number;
  maxTransfers: number;
  enrich: boolean;
  preferBikePath: boolean;
};

export type PlanResult = {
  query: PlanRequest;
  itineraries: Itinerary[];
  warnings?: string[];
};

export type AccessCandidate = {
  stopId: number;
  stopName: string;
  routeType: RouteTypeBikeable;
  routeIds: number[];
  coord: LatLon;
  bikeKm: number;
  bikeMin: number;
};

export type DepartureWithPattern = {
  routeId: number;
  routeType: RouteTypeBikeable;
  routeName: string;
  runRef: string;
  departUtc: string;
  pattern: { stopId: number; arriveUtc: string }[];
};

export const MAX_PLAUSIBLE_TOTAL_MIN = 180;
export const BIKEABLE_ROUTE_TYPES: RouteTypeBikeable[] = [0, 3];
export const TRANSFER_BUFFER_MIN = 5;
export const TOP_N_CANDIDATES = 30;        // upper bound on total kept
export const CANDIDATES_CLOSE = 15;        // closest by bikeMin
export const CANDIDATES_FAR = 15;          // farthest by bikeMin within radius
export const MAX_HUB_FANOUT = 50;
export const PATH_BONUS_PER_KM = 5;
