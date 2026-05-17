/* global React, MapBg, SvgI */
// Atlas — Variation A. Map-first, bottom-sheet, riderly.

// ─────────────────────────────────────────────────────────────
// Reusable bits
// ─────────────────────────────────────────────────────────────
function AtlasTopPill({ from = 'hurstbridge', to = 'williamstown', focus }) {
  return (
    <div className="top-pill">
      <div className="field-stack" style={{ position: 'relative' }}>
        <div className={`field ${focus === 'from' ? 'field--focus' : ''}`} style={{ borderRadius: '10px 10px 0 0', border: 'none', borderBottom: '1px solid var(--rmai-border)', background: 'var(--rmai-white)' }}>
          <div className="field-icon field-icon--from"><div style={{ width: 6, height: 6, borderRadius: 999, background: 'white' }}/></div>
          <div className="field-text">
            <div className="lbl">From</div>
            <div className={from ? 'val' : 'placeholder'}>{from || 'Origin'}</div>
          </div>
          <button className="iconbtn" style={{ width: 28, height: 28, boxShadow: 'none', border: 'none' }}>{SvgI.swap('#8D8D92')}</button>
        </div>
        <div className={`field ${focus === 'to' ? 'field--focus' : ''}`} style={{ borderRadius: '0 0 10px 10px', border: 'none', background: 'var(--rmai-white)' }}>
          <div className="field-icon field-icon--to">{SvgI.pin('#fff')}</div>
          <div className="field-text">
            <div className="lbl">To</div>
            <div className={to ? 'val' : 'placeholder'}>{to || 'Destination'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AtlasMapControls({ withLoc = true, withCompass = true }) {
  return (
    <>
      <div style={{ position: 'absolute', right: 12, top: 122, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="iconbtn">{SvgI.plus('#1A1B25')}</button>
        <button className="iconbtn">{SvgI.minus('#1A1B25')}</button>
        {withLoc && <button className="iconbtn" style={{ marginTop: 4 }}>{SvgI.loc('#A77ACD')}</button>}
      </div>
    </>
  );
}

function ParamRow({ label, value, mono = true }) {
  return (
    <div className="row-flex" style={{ justifyContent: 'space-between', padding: '8px 0' }}>
      <span style={{ fontSize: 13, color: 'var(--rmai-fg-2)' }}>{label}</span>
      <span className={mono ? 'num' : ''} style={{ fontSize: 13, color: 'var(--rmai-fg-1)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function ItinCard({ label, total, depart, arrive, bikeKm, onPath, transfers, ascend, active, segs }) {
  const segments = segs || [
    { t: 'bike', dur: 12 },
    { t: 'wait', dur: 4 },
    { t: 'train', dur: 33 },
    { t: 'wait', dur: 2 },
    { t: 'bike', dur: 18 },
  ];
  const total_dur = segments.reduce((a, b) => a + b.dur, 0);
  return (
    <div className={`itin ${active ? 'itin--active' : ''}`}>
      <div className="top">
        <span className="label" style={{ color: active ? 'var(--rmai-purple)' : 'var(--rmai-fg-mut)' }}>{label}</span>
        <span className="total">{total}</span>
      </div>
      <div className="timeline">
        {segments.map((s, i) => (
          <span key={i} className={`seg--${s.t}`} style={{ flex: s.dur / total_dur }}/>
        ))}
      </div>
      <div className="meta">
        <span>{SvgI.bike('var(--rmai-fg-mut)')} <b>{bikeKm}</b>km</span>
        <span>{SvgI.train('var(--rmai-fg-mut)')} <b>{transfers}</b> xfer</span>
        <span>↗ <b>{ascend}</b>m</span>
        <span style={{ marginLeft: 'auto' }}>{depart} → {arrive}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 1 — Empty / fresh
// ─────────────────────────────────────────────────────────────
function AtlasEmpty() {
  return (
    <div className="app" style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--rmai-bg)' }}>
      <MapBg theme="mut" showRoutes={false}/>
      <AtlasTopPill from="" to=""/>
      <AtlasMapControls/>

      {/* "Tap to plan" hint dot at city center */}
      <div style={{ position: 'absolute', left: '50%', top: '46%', transform: 'translate(-50%, -50%)' }}>
        <div className="pulse" style={{ left: -14, top: -14 }}/>
        <div style={{ width: 16, height: 16, borderRadius: 999, background: 'var(--rmai-purple)', border: '2.5px solid white', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}/>
      </div>

      {/* Bottom sheet — recent trips / get started */}
      <div className="sheet" style={{ padding: '8px 0 24px' }}>
        <div className="sheet-grab"/>
        <div className="sheet-row" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <span className="eyebrow">— plan a ride</span>
          <span style={{ fontSize: 11, color: 'var(--rmai-fg-mut)', fontFamily: 'var(--mono)' }}>● tailnet · ptv.magpie-inconnu</span>
        </div>
        <div className="sheet-row" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.01em', color: 'var(--rmai-fg-1)' }}>
            where to ride?
          </div>
          <div style={{ fontSize: 13, color: 'var(--rmai-fg-mut)', marginTop: 4 }}>
            Type a place, paste coords, or tap the map.
          </div>
        </div>

        <div className="sheet-row" style={{ marginTop: 16 }}>
          <div className="eyebrow eyebrow--mut" style={{ marginBottom: 8 }}>Recent</div>
          {[
            { from: 'hurstbridge', to: 'williamstown', when: 'yesterday · 08:00', km: '24.8 km · bike-train' },
            { from: 'home', to: 'altona pier', when: 'tue · 06:30', km: '18.2 km · bike-only' },
            { from: 'sandringham', to: 'docklands', when: 'mon · 17:45', km: '21.5 km · bike-train' },
          ].map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--rmai-border)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 999, background: 'var(--rmai-lavender)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {SvgI.bike('var(--rmai-purple)')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--rmai-fg-1)' }}>
                  {r.from} <span style={{ color: 'var(--rmai-fg-mut)', fontWeight: 400 }}>→</span> {r.to}
                </div>
                <div className="num" style={{ fontSize: 11, color: 'var(--rmai-fg-mut)', marginTop: 1 }}>{r.when} · {r.km}</div>
              </div>
              {SvgI.chev('right', '#8D8D92')}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 2 — Typing with autocomplete dropdown
// ─────────────────────────────────────────────────────────────
function AtlasTyping() {
  return (
    <div className="app" style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--rmai-bg)' }}>
      <MapBg theme="mut" showRoutes={false}/>
      <AtlasTopPill from="hurstbridge" to="willi" focus="to"/>

      {/* Inline caret marker after "willi" — pure visual */}
      <div style={{ position: 'absolute', top: 78, left: 86, width: 2, height: 18, background: 'var(--rmai-purple)', animation: 'blink 1.1s steps(1) infinite' }}/>

      {/* Suggest dropdown — appears below the To field */}
      <div style={{ position: 'absolute', left: 12, right: 12, top: 124 }}>
        <div className="suggest">
          <div className="suggest-row suggest-row--active">
            <span className="sicon">{SvgI.pin('#A77ACD')}</span>
            <div className="stxt">
              <strong>Williamstown</strong>, Hobsons Bay, VIC
              <div className="sub">3016 · suburb · pop. 14,400</div>
            </div>
            <span className="num" style={{ fontSize: 10, color: 'var(--rmai-fg-mut)' }}>-37.86, 144.89</span>
          </div>
          <div className="suggest-row">
            <span className="sicon">{SvgI.pin('#8D8D92')}</span>
            <div className="stxt">
              <strong>Williamstown</strong> Beach, Williamstown
              <div className="sub">beach · 1.2 km from centre</div>
            </div>
          </div>
          <div className="suggest-row">
            <span className="sicon">{SvgI.pin('#8D8D92')}</span>
            <div className="stxt">
              <strong>Williamstown</strong> railway station
              <div className="sub">stn · Williamstown line · zone 1</div>
            </div>
          </div>
          <div className="suggest-row">
            <span className="sicon">{SvgI.pin('#8D8D92')}</span>
            <div className="stxt">
              <strong>Williamstown</strong> North
              <div className="sub">suburb · 3016</div>
            </div>
          </div>
          <div className="suggest-row" style={{ background: '#FAFAFA' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--rmai-fg-mut)', width: 14, textAlign: 'center' }}>↵</span>
            <div className="stxt" style={{ fontSize: 12.5, color: 'var(--rmai-fg-mut)' }}>
              or paste <span className="num" style={{ color: 'var(--rmai-fg-1)' }}>-37.86,144.89</span> as raw coords
            </div>
          </div>
        </div>
        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--rmai-fg-mut)', marginTop: 6, paddingLeft: 4, letterSpacing: '0.04em' }}>
          ● geocoder: nominatim · au only · 312ms
        </div>
      </div>

      {/* Faux keyboard at the bottom */}
      <FauxKeyboard/>
    </div>
  );
}

function FauxKeyboard() {
  const rows = [
    'qwertyuiop'.split(''),
    'asdfghjkl'.split(''),
    ['shift', ...'zxcvbnm'.split(''), 'back'],
    ['123', 'space', 'return'],
  ];
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      background: '#D1D4DB', padding: '8px 4px 26px',
      borderTop: '0.5px solid rgba(0,0,0,0.15)',
    }}>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 10, padding: i === 1 ? '0 18px' : '0 4px' }}>
          {row.map((k) => {
            const wide = k === 'shift' || k === 'back' || k === '123' || k === 'return';
            const space = k === 'space';
            const flex = space ? 5 : wide ? 1.4 : 1;
            return (
              <div key={k} style={{
                flex, height: 40, borderRadius: 5,
                background: (wide && !space) ? '#A2A6B0' : '#FFFFFF',
                fontFamily: '-apple-system, system-ui', fontSize: 16, fontWeight: 400, color: '#1A1B25',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 1px 0 rgba(0,0,0,0.2)',
                textTransform: 'lowercase',
              }}>{k === 'space' ? '' : k === 'back' ? '⌫' : k === 'return' ? 'return' : k === 'shift' ? '⇧' : k}</div>
            );
          })}
        </div>
      ))}
      <div style={{ height: 6, width: 140, background: '#1A1B25', borderRadius: 999, margin: '4px auto 0' }}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 3 — Results loaded (recommended itinerary active)
// ─────────────────────────────────────────────────────────────
function AtlasResults() {
  return (
    <div className="app" style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--rmai-bg)' }}>
      <MapBg theme="light" activeRoute="recommended"/>
      <AtlasTopPill from="hurstbridge" to="williamstown"/>
      <AtlasMapControls/>

      {/* Bottom sheet with results */}
      <div className="sheet">
        <div className="sheet-grab"/>

        <div className="sheet-row" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div className="eyebrow">— 3 itineraries</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--rmai-fg-1)', marginTop: 4 }}>depart 08:00 · bike-train</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="num" style={{ fontSize: 10, color: 'var(--rmai-green)' }}>● cache hit</div>
            <div className="num" style={{ fontSize: 10, color: 'var(--rmai-fg-mut)' }}>312 ms</div>
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--rmai-border)', margin: '14px 18px' }}/>

        <div className="sheet-row" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ItinCard
            active label="● recommended" total="1h 09m"
            depart="08:04" arrive="09:13"
            bikeKm="6.2" onPath="78%" transfers="1" ascend="42"
          />
          <ItinCard
            label="fastest" total="0h 58m"
            depart="08:12" arrive="09:10"
            bikeKm="3.4" onPath="62%" transfers="2" ascend="28"
            segs={[{t:'bike',dur:6},{t:'wait',dur:3},{t:'train',dur:32},{t:'wait',dur:5},{t:'train',dur:8},{t:'bike',dur:4}]}
          />
          <ItinCard
            label="max-path" total="2h 22m"
            depart="08:00" arrive="10:22"
            bikeKm="24.8" onPath="92%" transfers="0" ascend="180"
            segs={[{t:'bike',dur:142}]}
          />
        </div>

        <div className="sheet-row" style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn--secondary" style={{ flex: 1 }}>{SvgI.swap('#1A1B25')} share</button>
          <button className="btn btn--cta" style={{ flex: 2 }}>start ride →</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 4 — Advanced options expanded
// ─────────────────────────────────────────────────────────────
function AtlasAdvanced() {
  return (
    <div className="app" style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--rmai-bg)' }}>
      <MapBg theme="mut" showRoutes={false}/>
      <AtlasTopPill from="hurstbridge" to="williamstown"/>

      <div className="sheet" style={{ height: '78%' }}>
        <div className="sheet-grab"/>
        <div className="sheet-row" style={{ marginBottom: 14 }}>
          <div className="eyebrow">— advanced</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--rmai-fg-1)', marginTop: 4 }}>tune the planner</div>
        </div>

        <div className="sheet-row">
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--rmai-fg-mut)', marginBottom: 8 }}>Time</div>
          <div className="seg" style={{ marginBottom: 14 }}>
            <button className="on">depart at</button>
            <button>arrive by</button>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <span className="num" style={{ fontSize: 18, fontWeight: 600, color: 'var(--rmai-fg-1)' }}>08 : 00</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--rmai-fg-mut)', fontFamily: 'var(--mono)' }}>mon · 17 may</span>
          </div>
        </div>

        <div className="sheet-row">
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--rmai-fg-mut)', marginBottom: 8 }}>Mode &amp; Goal</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <div className="chip chip--lav" style={{ height: 32, padding: '0 12px', fontSize: 13 }}>{SvgI.bike('#8954B6')} bike-train</div>
            <div className="chip" style={{ height: 32, padding: '0 12px', fontSize: 13, background: 'transparent', border: '1px solid var(--rmai-border)' }}>{SvgI.bike('#8D8D92')} bike-only</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            {['commute', 'day-ride', 'max-path'].map((g, i) => (
              <div key={g} className={i === 0 ? 'chip chip--lav' : 'chip'} style={{ height: 32, padding: '0 12px', fontSize: 13, background: i === 0 ? 'var(--rmai-lavender)' : 'transparent', border: i === 0 ? 'none' : '1px solid var(--rmai-border)', color: i === 0 ? 'var(--rmai-purple-d)' : 'var(--rmai-fg-2)' }}>{g}</div>
            ))}
          </div>
        </div>

        <div className="sheet-row">
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--rmai-fg-mut)', marginBottom: 10 }}>Tuning</div>
          <Slider label="prefer-bike-path" v="on" sub="route via dedicated paths where possible"/>
          <Slider label="hill-weight" v="0.4" sub="0 = ignore hills · 1 = avoid" pct={40}/>
          <Slider label="min-on-path" v="0.65" sub="65% of bike legs on path" pct={65}/>
          <ParamRow label="max-transfers" value="1"/>
          <ParamRow label="min/max bike km" value="0 — 20"/>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, v, sub, pct }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--rmai-border)' }}>
      <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: 'var(--rmai-fg-1)', fontWeight: 500 }}>{label}</span>
        <span className="num" style={{ fontSize: 13, color: 'var(--rmai-purple)', fontWeight: 600 }}>{v}</span>
      </div>
      {pct != null && (
        <div style={{ position: 'relative', height: 4, borderRadius: 999, background: 'var(--rmai-stone)', margin: '6px 0 4px' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct + '%', background: 'var(--rmai-purple)', borderRadius: 999 }}/>
          <div style={{ position: 'absolute', left: pct + '%', top: '50%', transform: 'translate(-50%,-50%)', width: 14, height: 14, borderRadius: 999, background: 'white', border: '2px solid var(--rmai-purple)' }}/>
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--rmai-fg-mut)', fontFamily: 'var(--mono)' }}>{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 5 — Phase 2: map-click pin drop (mid-interaction)
// ─────────────────────────────────────────────────────────────
function AtlasMapClick() {
  return (
    <div className="app" style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--rmai-bg)' }}>
      <MapBg theme="light" showRoutes={false}>
        {/* From pin already dropped at Hurstbridge */}
        <div style={{ position: 'absolute', left: '88%', top: '12%', transform: 'translate(-50%, -100%)' }}>
          <PinMarker color="#1A1B25" label="from" sub="hurstbridge"/>
        </div>
        {/* To pin being dragged */}
        <div style={{ position: 'absolute', left: '18%', top: '78%', transform: 'translate(-50%, -100%)' }}>
          <PinMarker color="#A77ACD" label="to" sub="williamstown beach" dragging/>
          <div className="pulse" style={{ left: -10, top: -2 }}/>
        </div>
      </MapBg>
      <AtlasMapControls/>

      {/* Phase-2 hint banner */}
      <div style={{
        position: 'absolute', left: 12, right: 12, top: 8,
        background: 'rgba(26,27,37,0.92)',
        backdropFilter: 'blur(20px)',
        color: 'white', padding: '12px 14px', borderRadius: 14,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ width: 28, height: 28, borderRadius: 999, background: 'rgba(167,122,205,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {SvgI.pin('#fff')}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>drag the lilac pin to set destination</div>
          <div className="num" style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 1 }}>● reverse: -37.860, 144.892 · willi&shy;amstown beach</div>
        </div>
        <button style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 18 }}>×</button>
      </div>

      {/* Mini sheet — plan auto-fires */}
      <div className="sheet" style={{ paddingBottom: 24 }}>
        <div className="sheet-grab"/>
        <div className="sheet-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="dot dot--lg dot--purple" style={{ background: 'var(--rmai-purple)' }}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--rmai-fg-1)' }}>planning while you drag…</div>
            <div className="num" style={{ fontSize: 11, color: 'var(--rmai-fg-mut)' }}>orchestrator · gh-route + osrm-au</div>
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            <Dot d={0}/><Dot d={120}/><Dot d={240}/>
          </div>
        </div>
        <div className="sheet-row" style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button className="btn btn--secondary" style={{ flex: 1 }}>{SvgI.loc('#1A1B25')} use my location</button>
          <button className="btn btn--secondary" style={{ flex: 1 }}>clear pins</button>
        </div>
      </div>
    </div>
  );
}

function Dot({ d }) {
  return (
    <span style={{
      width: 6, height: 6, borderRadius: 999, background: 'var(--rmai-purple)',
      animation: `pulse 1.2s ease-in-out ${d}ms infinite`,
      display: 'inline-block',
    }}/>
  );
}

function PinMarker({ color, label, sub, dragging }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transform: dragging ? 'translateY(-2px)' : 'none' }}>
      <div style={{
        background: 'white', padding: '4px 10px', borderRadius: 999,
        boxShadow: '0 4px 14px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 500, color: '#1A1B25' }}>{sub}</span>
      </div>
      <svg width="22" height="28" viewBox="0 0 22 28">
        <path d="M 11 0 C 4.5 0 0 4.5 0 11 C 0 18 11 28 11 28 C 11 28 22 18 22 11 C 22 4.5 17.5 0 11 0 Z" fill={color}/>
        <circle cx="11" cy="11" r="4.5" fill="white"/>
      </svg>
      <div className="pin-shadow"/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 6 — Phase 2: install PWA prompt
// ─────────────────────────────────────────────────────────────
function AtlasInstall() {
  return (
    <div className="app" style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--rmai-bg)', overflow: 'hidden' }}>
      <MapBg theme="mut" activeRoute="recommended"/>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,27,37,0.42)', backdropFilter: 'blur(4px)' }}/>

      {/* iOS share-sheet style install dialog */}
      <div style={{
        position: 'absolute', left: 12, right: 12, bottom: 24,
        background: 'rgba(248,247,244,0.95)',
        backdropFilter: 'blur(40px)',
        borderRadius: 22, padding: '20px 20px 16px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div className="sheet-grab" style={{ margin: '0 auto 12px' }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'var(--rmai-fg-1)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
            position: 'relative',
          }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.04em' }}>~/</span>
            <span style={{ position: 'absolute', bottom: 7, right: 9, fontSize: 16, color: 'var(--rmai-purple)' }}>●</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--rmai-fg-1)' }}>ptv plan</div>
            <div style={{ fontSize: 12.5, color: 'var(--rmai-fg-2)' }}>tailnet-only · 0 internet egress</div>
            <div className="num" style={{ fontSize: 10.5, color: 'var(--rmai-fg-mut)', marginTop: 2 }}>ptv.magpie-inconnu.ts.net</div>
          </div>
        </div>
        <div style={{ fontSize: 14, color: 'var(--rmai-fg-1)', lineHeight: 1.45, marginBottom: 14 }}>
          install to home screen — opens to the map, remembers your last trip, shows the shell even when signal drops.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--secondary" style={{ flex: 1 }}>not now</button>
          <button className="btn btn--cta" style={{ flex: 1.4 }}>{SvgI.plus('#fff')} install</button>
        </div>
        <div className="num" style={{ fontSize: 10, color: 'var(--rmai-fg-mut)', textAlign: 'center', marginTop: 10, letterSpacing: '0.04em' }}>
          ● serviceworker:ready · manifest:ok · 192/512px icons cached
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DESKTOP screen — Atlas, browser frame
// ─────────────────────────────────────────────────────────────
function AtlasDesktop() {
  return (
    <div className="app" style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--rmai-bg)', display: 'flex' }}>
      {/* Left rail — form */}
      <div style={{ width: 360, flexShrink: 0, padding: '20px 22px', borderRight: '1px solid var(--rmai-border)', background: 'var(--rmai-white)', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--rmai-fg-1)' }}>~/ptv plan</span>
          <span className="dot dot--lg"/>
        </div>
        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--rmai-fg-mut)', marginBottom: 18 }}>
          ● live · cache 91% · p50 312ms
        </div>

        <div className="field-stack" style={{ position: 'relative', marginBottom: 14 }}>
          <div className="field" style={{ borderRadius: '12px 12px 0 0', borderBottom: 'none' }}>
            <div className="field-icon field-icon--from"><div style={{ width: 5, height: 5, borderRadius: 999, background: 'white' }}/></div>
            <div className="field-text"><div className="lbl">From</div><div className="val">hurstbridge</div></div>
          </div>
          <div className="field" style={{ borderRadius: '0 0 12px 12px' }}>
            <div className="field-icon field-icon--to">{SvgI.pin('#fff')}</div>
            <div className="field-text"><div className="lbl">To</div><div className="val">williamstown</div></div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div className="field" style={{ flex: 1, padding: '10px 12px' }}>
            <div className="field-text">
              <div className="lbl">Depart</div>
              <div className="val num">08 : 00</div>
            </div>
          </div>
          <div className="field" style={{ flex: 1, padding: '10px 12px', opacity: 0.5 }}>
            <div className="field-text">
              <div className="lbl">Arrive by</div>
              <div className="placeholder num">--:--</div>
            </div>
          </div>
        </div>

        <div className="eyebrow eyebrow--mut" style={{ marginBottom: 8 }}>Mode</div>
        <div className="seg" style={{ marginBottom: 14, width: '100%', display: 'flex' }}>
          <button className="on" style={{ flex: 1 }}>bike-train</button>
          <button style={{ flex: 1 }}>bike-only</button>
        </div>

        <div className="eyebrow eyebrow--mut" style={{ marginBottom: 8 }}>Goal</div>
        <div className="seg" style={{ marginBottom: 18, width: '100%', display: 'flex' }}>
          <button className="on" style={{ flex: 1 }}>commute</button>
          <button style={{ flex: 1 }}>day-ride</button>
          <button style={{ flex: 1 }}>max-path</button>
        </div>

        <details style={{ marginBottom: 18 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--rmai-purple)', listStyle: 'none' }}>▸ advanced · 5 tunings</summary>
        </details>

        <button className="btn btn--cta btn--full btn--lg">plan ride →</button>
        <div className="num" style={{ fontSize: 10, color: 'var(--rmai-fg-mut)', textAlign: 'center', marginTop: 8, letterSpacing: '0.04em' }}>
          ⌘↵ to plan · drag two pins on map
        </div>
      </div>

      {/* Right — map with overlaid results */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapBg theme="light" activeRoute="recommended"/>
        <AtlasMapControls/>

        {/* Floating results cards top-right */}
        <div style={{ position: 'absolute', right: 16, top: 16, width: 280, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="eyebrow" style={{ background: 'var(--rmai-white)', padding: '6px 12px', borderRadius: 999, border: '1px solid var(--rmai-border)', display: 'inline-block' }}>— 3 itineraries · 312ms</div>
          <ItinCard active label="● recommended" total="1h 09m" depart="08:04" arrive="09:13" bikeKm="6.2" onPath="78%" transfers="1" ascend="42"/>
          <ItinCard label="fastest" total="0h 58m" depart="08:12" arrive="09:10" bikeKm="3.4" onPath="62%" transfers="2" ascend="28"/>
          <ItinCard label="max-path" total="2h 22m" depart="08:00" arrive="10:22" bikeKm="24.8" onPath="92%" transfers="0" ascend="180" segs={[{t:'bike',dur:142}]}/>
        </div>

        {/* URL hash hint bottom-left */}
        <div style={{
          position: 'absolute', left: 16, bottom: 16, background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(10px)',
          padding: '8px 12px', borderRadius: 999, border: '1px solid var(--rmai-border)',
          fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--rmai-fg-2)',
        }}>
          🔗 #from=-37.64,145.19&amp;to=-37.86,144.89&amp;depart=0800&amp;goal=commute
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  AtlasEmpty, AtlasTyping, AtlasResults, AtlasAdvanced, AtlasMapClick, AtlasInstall, AtlasDesktop,
});
