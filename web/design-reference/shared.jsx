/* global React */
// Shared: simulated Melbourne map background + helpers used by both variations.
// Hurstbridge (NE) → Williamstown (SW). The route line crosses the city.

// Approximate viewBox coords. NE top-right, SW bottom-left.
// Hurstbridge ~ (820, 80) — Williamstown ~ (110, 580) — CBD ~ (430, 340)
const MAP_W = 900;
const MAP_H = 700;

// Suburb labels — kept sparse and editorial.
const SUBURBS_DARK = [
  { x: 800, y: 100,  t: 'Hurstbridge' },
  { x: 660, y: 195,  t: 'Eltham' },
  { x: 575, y: 260,  t: 'Heidelberg' },
  { x: 470, y: 320,  t: 'Clifton Hill' },
  { x: 430, y: 365,  t: 'Melbourne' },
  { x: 555, y: 410,  t: 'Richmond' },
  { x: 670, y: 480,  t: 'Caulfield' },
  { x: 290, y: 440,  t: 'Footscray' },
  { x: 145, y: 595,  t: 'Williamstown' },
  { x: 380, y: 565,  t: 'Port Melbourne' },
];

// Suggested itinerary path (bike-train) — bike to Hurstbridge stn, train to
// Flinders, bike to Williamstown. Coordinates are chosen for storytelling, not
// geography.
const PATH_BIKE_1   = 'M 820 85 L 805 105 L 790 100';
const PATH_TRAIN    = 'M 790 100 Q 700 200 600 250 Q 530 290 460 340 L 430 360';
const PATH_BIKE_2   = 'M 430 360 Q 360 380 300 430 Q 230 475 175 520 Q 140 555 110 580';

// Alt route (recommended max-path): more bike, longer
const PATH_ALT_BIKE = 'M 820 85 Q 720 160 640 230 Q 540 300 460 350 L 410 380 Q 320 410 240 460 Q 165 510 110 580';

// Alt route (commute/fastest): more train, transfers
const PATH_FAST     = 'M 820 85 L 790 100 Q 720 150 660 200 Q 580 270 500 330 L 430 360 Q 380 410 320 470 Q 230 530 110 580';

function MapBg({ theme = 'light', showRoutes = true, activeRoute = 'recommended', children }) {
  const isDark = theme === 'dark';
  const isMut  = theme === 'mut';

  // Theme colors
  const land   = isDark ? '#1B1C24' : isMut ? '#E5E2DC' : '#EFEDE8';
  const water  = isDark ? '#15161C' : isMut ? '#DCD7CE' : '#E3DEEC';
  const park   = isDark ? '#1F2127' : isMut ? '#DCDBD3' : '#E4E1D2';
  const street = isDark ? 'rgba(232,230,225,0.10)' : 'rgba(26,27,37,0.10)';
  const streetMaj = isDark ? 'rgba(232,230,225,0.18)' : 'rgba(26,27,37,0.18)';
  const labelText = isDark ? 'rgba(232,230,225,0.55)' : 'rgba(60,60,60,0.55)';

  // Route colours
  const routeBike  = '#A77ACD';
  const routeTrain = isDark ? '#E8E6E1' : '#1A1B25';
  const routeAlt   = isDark ? 'rgba(232,230,225,0.4)' : 'rgba(60,60,60,0.4)';

  return (
    <div className="map" style={{ background: land }}>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid slice">
        {/* Water — Port Phillip Bay bottom-left */}
        <path
          d={`M -20 ${MAP_H} L -20 540 Q 90 510 200 545 Q 260 565 320 600 Q 380 640 430 ${MAP_H} Z`}
          fill={water}
        />
        {/* Yarra river — winding */}
        <path
          d="M 900 280 Q 700 320 580 380 Q 450 440 380 510 Q 320 580 280 660 L 280 700"
          fill="none" stroke={water} strokeWidth="14" strokeLinecap="round"
        />
        {/* Park blocks — sparse */}
        <rect x="380" y="290" width="60" height="36" fill={park} rx="2"/>
        <rect x="510" y="350" width="44" height="30" fill={park} rx="2"/>
        <rect x="720" y="320" width="50" height="40" fill={park} rx="2"/>

        {/* Minor street grid — thin lines */}
        <g stroke={street} strokeWidth="1" fill="none">
          {/* diagonals echoing Melbourne grid */}
          {Array.from({ length: 14 }, (_, i) => (
            <line key={`h${i}`} x1="0" y1={50 + i*48} x2={MAP_W} y2={50 + i*48} />
          ))}
          {Array.from({ length: 16 }, (_, i) => (
            <line key={`v${i}`} x1={60 + i*55} y1="0" x2={60 + i*55} y2={MAP_H} />
          ))}
        </g>

        {/* Major arterials */}
        <g stroke={streetMaj} strokeWidth="2.2" fill="none" strokeLinecap="round">
          <path d="M 0 360 Q 220 350 430 360 Q 600 370 900 320"/>
          <path d="M 430 0 L 430 700"/>
          <path d="M 0 480 Q 200 470 430 470 Q 600 470 900 480"/>
        </g>

        {/* Routes */}
        {showRoutes && (
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {/* Inactive alt */}
            {activeRoute !== 'fastest' && (
              <path d={PATH_FAST} stroke={routeAlt} strokeWidth="3.5" strokeDasharray="2 6" opacity="0.7"/>
            )}
            {activeRoute !== 'maxpath' && (
              <path d={PATH_ALT_BIKE} stroke={routeAlt} strokeWidth="3.5" strokeDasharray="2 6" opacity="0.55"/>
            )}

            {/* Active recommended — bike, train, bike */}
            {activeRoute === 'recommended' && (
              <>
                <path d={PATH_BIKE_1} stroke={routeBike} strokeWidth="5"/>
                <path d={PATH_TRAIN}  stroke={routeTrain} strokeWidth="5"/>
                {/* Dashed overlay on train to indicate rail */}
                <path d={PATH_TRAIN}  stroke={isDark ? '#1B1C24' : '#FAFAFA'} strokeWidth="1.3" strokeDasharray="6 6"/>
                <path d={PATH_BIKE_2} stroke={routeBike} strokeWidth="5"/>
              </>
            )}
            {activeRoute === 'fastest' && (
              <path d={PATH_FAST} stroke={routeBike} strokeWidth="5"/>
            )}
            {activeRoute === 'maxpath' && (
              <path d={PATH_ALT_BIKE} stroke={routeBike} strokeWidth="5"/>
            )}
          </g>
        )}

        {/* Suburb labels */}
        <g fontFamily="JetBrains Mono, monospace" fontSize="10" fontWeight="500" fill={labelText} letterSpacing="0.06em">
          {SUBURBS_DARK.map((s) => (
            <text key={s.t} x={s.x} y={s.y} textAnchor="middle">{s.t.toLowerCase()}</text>
          ))}
        </g>

        {/* Origin & destination markers */}
        {showRoutes && (
          <g>
            {/* Origin — Hurstbridge */}
            <circle cx="820" cy="85" r="9" fill="#FFFFFF" stroke="#1A1B25" strokeWidth="3"/>
            {/* Destination — Williamstown */}
            <g transform="translate(110 580)">
              <path d="M 0 -22 C -10 -22 -14 -14 -14 -8 C -14 -2 -7 8 0 18 C 7 8 14 -2 14 -8 C 14 -14 10 -22 0 -22 Z" fill="#A77ACD"/>
              <circle cx="0" cy="-9" r="4" fill="#FFFFFF"/>
            </g>
          </g>
        )}
      </svg>

      {children}
      <div className="map-attr">© osm · graphhopper · nominatim</div>
    </div>
  );
}

// Common SVG icons (16px viewBox=24) — Lucide-style, 1.8 stroke
const SvgI = {
  bike: (c='currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/>
      <path d="M15 6h3l1.5 4.5L12 14l-2-4 4-3"/><path d="M5.5 17.5L12 14"/>
    </svg>
  ),
  train: (c='currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14"/>
      <circle cx="9" cy="14" r="0.5" fill={c}/><circle cx="15" cy="14" r="0.5" fill={c}/>
      <path d="M7 21l2-3M17 21l-2-3"/>
    </svg>
  ),
  walk: (c='currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13" cy="4" r="1.5"/><path d="M10 22l2-7-3-4 2-5 4 3 3 2"/><path d="M9 11l-4 5"/>
    </svg>
  ),
  clock: (c='currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
    </svg>
  ),
  pin: (c='currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s7-7.4 7-12a7 7 0 1 0-14 0c0 4.6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>
    </svg>
  ),
  arrow: (c='currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6"/>
    </svg>
  ),
  chev: (dir='down', c='currentColor') => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transform: dir==='up'?'rotate(180deg)':dir==='right'?'rotate(-90deg)':'none'}}>
      <path d="M6 9l6 6 6-6"/>
    </svg>
  ),
  loc: (c='currentColor') => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
    </svg>
  ),
  swap: (c='currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4v16M3 8l4-4 4 4M17 20V4M21 16l-4 4-4-4"/>
    </svg>
  ),
  plus: (c='currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  ),
  minus: (c='currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14"/>
    </svg>
  ),
  more: (c='currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>
    </svg>
  ),
};

Object.assign(window, { MapBg, SvgI, MAP_W, MAP_H });
