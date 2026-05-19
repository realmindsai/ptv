export type LatLon = { lat: number; lon: number };

export type RouteTypeBikeable = 0 | 3; // 0 = Metro Train, 3 = V/Line

export type ItineraryLabel =
  | 'recommended' | 'fastest' | 'most-bike' | 'most-bike-path' | 'fewest-transfers';

export type ConstraintViolation =
  | 'min_bike_km' | 'max_bike_km' | 'max_transfers' | 'min_on_path_fraction';

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

export type PlanGoal = 'commute' | 'day-ride' | 'max-path';

export type PlanMode = 'bike-only' | 'bike-train';

export type CustomModelPriorityRule = {
  if: string;
  multiply_by: number;
};

export type CustomModel = {
  priority: CustomModelPriorityRule[];
  distance_influence: number;
};

export const DAY_RIDE_CUSTOM_MODEL: CustomModel = {
  priority: [
    { if: 'road_class == SECONDARY',   multiply_by: 0.1 },
    { if: 'road_class == PRIMARY',     multiply_by: 0.05 },
    { if: 'road_class == TRUNK',       multiply_by: 0.05 },
    { if: 'road_class == TERTIARY',    multiply_by: 0.4 },
    { if: 'road_class == RESIDENTIAL', multiply_by: 0.7 },
  ],
  distance_influence: 50,
};

export const MAX_PATH_CUSTOM_MODEL: CustomModel = {
  priority: [
    { if: 'road_class == SECONDARY',   multiply_by: 0.02 },
    { if: 'road_class == PRIMARY',     multiply_by: 0.01 },
    { if: 'road_class == TRUNK',       multiply_by: 0.01 },
    { if: 'road_class == TERTIARY',    multiply_by: 0.1 },
    { if: 'road_class == RESIDENTIAL', multiply_by: 0.3 },
  ],
  distance_influence: 10,
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
  hillWeight: number;
  goal: PlanGoal;
  mode: PlanMode;
  minOnPathFraction?: number;
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
export const CANDIDATE_DETOUR_MAX = 1.4;   // drop bike-leg endpoints whose (origin→stop + stop→other)/(origin→other) exceeds this
export const MOST_BIKE_MAX_OVERTIME_MIN = 30; // hard cap on how much slower most-bike may be vs fastest
export const MAX_HUB_FANOUT = 50;
export const PATH_BONUS_PER_KM = 5;
export const HILL_ASCEND_WEIGHT = 0.05;    // cost reduction per metre ascended when hillWeight > 0
export const HILL_SUSTAINED_WEIGHT = 0.02; // cost reduction per (grade% * metres) when hillWeight > 0
export const HILL_FLAT_OFFSET = 0.3;       // flat-fraction penalty term (makes hilliness negative for flat routes)
