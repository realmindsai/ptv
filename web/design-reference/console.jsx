/* global React, MapBg, SvgI */
// Console — Variation B. Terminal-y, riderly, mono-heavy.
// Visually: dark ink top half (form + results), muted map bottom half.

// ─────────────────────────────────────────────────────────────
// Reusable bits
// ─────────────────────────────────────────────────────────────
function ConsoleHeader({ status = 'ready', extra }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px', borderBottom: '1px solid var(--rmai-ink-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono)', fontSize: 12 }}>
        <span style={{ color: 'var(--rmai-purple)', fontWeight: 600 }}>~/ptv</span>
        <span style={{ color: 'var(--rmai-ink-mut)' }}>$</span>
        <span style={{ color: 'var(--rmai-ink-fg)', fontWeight: 500 }}>plan</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)' }}>
        {extra}
        <span className="dot" style={{ background: status === 'ready' ? 'var(--rmai-green)' : status === 'busy' ? 'var(--rmai-orange)' : 'var(--rmai-ink-mut)' }}/>
        <span style={{ color: 'var(--rmai-ink-fg2)' }}>{status}</span>
      </div>
    </div>
  );
}

function ConsoleField({ name, value, placeholder, caret, hint, focus }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: '1px solid var(--rmai-ink-3)',
      background: focus ? 'rgba(167,122,205,0.06)' : 'transparent',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontFamily: 'var(--mono)', fontSize: 13 }}>
        <span style={{ color: 'var(--rmai-purple)', width: 50, fontWeight: 600 }}>{name}</span>
        <span style={{ color: 'var(--rmai-ink-mut)' }}>›</span>
        <span style={{ flex: 1, color: value ? 'var(--rmai-ink-fg)' : 'var(--rmai-ink-mut)', fontWeight: value ? 500 : 400 }}>
          {value || placeholder}
          {caret && <span className="caret caret--purple"/>}
        </span>
        {hint && <span style={{ fontSize: 10, color: 'var(--rmai-ink-mut)', letterSpacing: '0.02em' }}>{hint}</span>}
      </div>
    </div>
  );
}

function ConsoleParamRow({ flag, value, hint, alt }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 1fr auto',
      gap: 10, alignItems: 'baseline',
      padding: '7px 14px', fontFamily: 'var(--mono)', fontSize: 12,
      background: alt ? 'rgba(232,230,225,0.02)' : 'transparent',
    }}>
      <span style={{ color: 'var(--rmai-ink-fg2)' }}>{flag}</span>
      <span style={{ color: 'var(--rmai-ink-fg)' }}>{value}</span>
      <span style={{ color: 'var(--rmai-ink-mut)', fontSize: 10 }}>{hint}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 1 — Empty / fresh boot
// ─────────────────────────────────────────────────────────────
function ConsoleEmpty() {
  return (
    <div className="app console" style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <ConsoleHeader status="ready" extra={<><span>tailnet</span><span style={{margin:'0 4px'}}>·</span></>}/>

      <div style={{ padding: '20px 16px 0' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--rmai-ink-mut)', letterSpacing: '0.04em', marginBottom: 4 }}>
          # boot · 2026-05-17T08:00:04+1000
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--rmai-purple)', letterSpacing: '0.04em', marginBottom: 18 }}>
          ● orchestrator:up · gh-route:up · osrm-au:up · redis:up
        </div>

        <div style={{ fontFamily: 'var(--sans)', fontSize: 28, fontWeight: 700, color: 'var(--rmai-ink-fg)', lineHeight: 1.1, letterSpacing: '-0.01em', marginBottom: 6 }}>
          where to ride<span style={{ color: 'var(--rmai-purple)' }}>?</span>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--rmai-ink-mut)', marginBottom: 18, letterSpacing: '0.02em' }}>
          place name · lat,lon · or tap the map below
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--rmai-ink-3)' }}>
        <ConsoleField name="from" placeholder="hurstbridge | -37.64,145.19" caret focus/>
        <ConsoleField name="to"   placeholder="williamstown | …"/>
      </div>

      {/* Mini map preview at bottom */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 280, borderTop: '1px solid var(--rmai-ink-3)' }}>
        <MapBg theme="dark" showRoutes={false}/>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 36, background: 'linear-gradient(to bottom, transparent, rgba(20,21,28,0.92))' }}/>
        <div style={{ position: 'absolute', left: 14, bottom: 12, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)', letterSpacing: '0.04em' }}>
          ● melb · z14 · tap to drop pins (phase 2)
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 2 — Typing autocomplete (terminal dropdown)
// ─────────────────────────────────────────────────────────────
function ConsoleTyping() {
  return (
    <div className="app console" style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <ConsoleHeader status="ready"/>

      <div style={{ padding: '14px 0 0' }}>
        <ConsoleField name="from" value="hurstbridge" hint="-37.64,145.19"/>
        <ConsoleField name="to" value="willi" caret focus/>
      </div>

      {/* Autocomplete dropdown — terminal style */}
      <div style={{
        margin: '8px 14px 0',
        border: '1px solid var(--rmai-ink-3)',
        borderRadius: 6,
        background: 'rgba(232,230,225,0.02)',
      }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--rmai-ink-3)', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-purple)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>matches · nominatim</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)' }}>4 · 312ms · au</span>
        </div>

        {[
          { sel: true, n: 1, name: 'Williamstown', meta: 'suburb · Hobsons Bay · VIC 3016', coords: '-37.86, 144.89', rank: 'r:18' },
          { n: 2, name: 'Williamstown Beach', meta: 'beach · 1.2 km from centre', coords: '-37.87, 144.88', rank: 'r:24' },
          { n: 3, name: 'Williamstown station', meta: 'stn · Williamstown line · zone 1', coords: '-37.86, 144.90', rank: 'r:30' },
          { n: 4, name: 'Williamstown North', meta: 'suburb · 3016', coords: '-37.85, 144.88', rank: 'r:18' },
        ].map((r) => (
          <div key={r.n} style={{
            padding: '8px 12px', borderBottom: '1px solid var(--rmai-ink-3)',
            background: r.sel ? 'rgba(167,122,205,0.10)' : 'transparent',
            display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 10, alignItems: 'center',
          }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: r.sel ? 'var(--rmai-purple)' : 'var(--rmai-ink-mut)' }}>{r.sel ? '▸' : ' '}{r.n}</span>
            <div>
              <div style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 600, color: 'var(--rmai-ink-fg)' }}>{r.name}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)', marginTop: 1 }}>{r.meta}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-fg2)' }}>{r.coords}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--rmai-ink-mut)' }}>{r.rank}</div>
            </div>
          </div>
        ))}

        <div style={{ padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)' }}>
          <span style={{ color: 'var(--rmai-ink-fg2)' }}>↑↓</span> nav · <span style={{ color: 'var(--rmai-ink-fg2)' }}>↵</span> accept · <span style={{ color: 'var(--rmai-ink-fg2)' }}>esc</span> dismiss · or paste <span style={{ color: 'var(--rmai-purple)' }}>lat,lon</span>
        </div>
      </div>

      {/* Status line */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '10px 16px', borderTop: '1px solid var(--rmai-ink-3)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)' }}>
        <span><span className="dot"/> nominatim:au · debounce 300ms</span>
        <span>insert · L2 C5</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 3 — Results
// ─────────────────────────────────────────────────────────────
function ConsoleResults() {
  return (
    <div className="app console" style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <ConsoleHeader status="ok" extra={<><span style={{color:'var(--rmai-green)'}}>● cache</span><span style={{margin:'0 4px'}}>·</span><span>312ms</span><span style={{margin:'0 4px'}}>·</span></>}/>

      {/* Compact from/to summary row */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--rmai-ink-3)', display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: 'var(--mono)', fontSize: 12 }}>
        <span style={{ color: 'var(--rmai-purple)' }}>›</span>
        <span style={{ color: 'var(--rmai-ink-fg)' }}>hurstbridge</span>
        <span style={{ color: 'var(--rmai-ink-mut)' }}>→</span>
        <span style={{ color: 'var(--rmai-ink-fg)' }}>williamstown</span>
        <span style={{ color: 'var(--rmai-ink-mut)', marginLeft: 'auto' }}>08:00 · bike-train · commute</span>
      </div>

      {/* Results table — ASCII-ish */}
      <div style={{ padding: '10px 0 4px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '22px 1fr 56px 50px 38px 38px',
          gap: 6, padding: '0 14px 6px',
          fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--rmai-ink-mut)',
          textTransform: 'uppercase', letterSpacing: '0.12em',
          borderBottom: '1px dashed var(--rmai-ink-3)',
        }}>
          <span>#</span><span>itinerary</span><span style={{textAlign:'right'}}>total</span><span style={{textAlign:'right'}}>bike</span><span style={{textAlign:'right'}}>xfer</span><span style={{textAlign:'right'}}>↗</span>
        </div>

        {[
          { n: 1, sel: true, label: 'recommended', tag: '●', dur: '01:09', dep: '08:04', arr: '09:13', bike: '6.2km', xfer: '1', asc: '42' },
          { n: 2, label: 'fastest', dur: '00:58', dep: '08:12', arr: '09:10', bike: '3.4km', xfer: '2', asc: '28' },
          { n: 3, label: 'max-path', dur: '02:22', dep: '08:00', arr: '10:22', bike: '24.8km', xfer: '0', asc: '180' },
        ].map((r) => (
          <ConsoleItinRow key={r.n} {...r}/>
        ))}
      </div>

      {/* Map showing the active route */}
      <div style={{ flex: 1, position: 'relative', borderTop: '1px solid var(--rmai-ink-3)', minHeight: 220 }}>
        <MapBg theme="dark" activeRoute="recommended"/>

        {/* Floating compact stats on map */}
        <div style={{
          position: 'absolute', left: 12, top: 10,
          background: 'rgba(20,21,28,0.85)', backdropFilter: 'blur(8px)',
          border: '1px solid var(--rmai-ink-3)',
          padding: '6px 10px', borderRadius: 6,
          fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--rmai-ink-fg2)',
        }}>
          <span style={{ color: 'var(--rmai-purple)' }}>#1</span> recommended · <span style={{ color: 'var(--rmai-ink-fg)' }}>01:09</span> · on-path <span style={{ color: 'var(--rmai-green)' }}>78%</span>
        </div>
      </div>

      {/* Footer status */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--rmai-ink-3)', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)' }}>
        <span style={{ color: 'var(--rmai-green)' }}>● ok</span>
        <span>3 itin · 312ms</span>
        <span style={{ marginLeft: 'auto', color: 'var(--rmai-purple)', cursor: 'pointer' }}>↳ share url</span>
      </div>
    </div>
  );
}

function ConsoleItinRow({ n, sel, label, tag, dur, dep, arr, bike, xfer, asc }) {
  const segs = sel
    ? [{t:'bike',f:12},{t:'wait',f:4},{t:'train',f:33},{t:'wait',f:2},{t:'bike',f:18}]
    : label === 'fastest'
      ? [{t:'bike',f:6},{t:'wait',f:3},{t:'train',f:32},{t:'wait',f:5},{t:'train',f:8},{t:'bike',f:4}]
      : [{t:'bike',f:142}];
  const total = segs.reduce((a,b)=>a+b.f, 0);
  return (
    <div style={{
      padding: '10px 14px',
      borderBottom: '1px solid var(--rmai-ink-3)',
      background: sel ? 'rgba(167,122,205,0.06)' : 'transparent',
      borderLeft: sel ? '2px solid var(--rmai-purple)' : '2px solid transparent',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '22px 1fr 56px 50px 38px 38px',
        gap: 6, alignItems: 'center', fontFamily: 'var(--mono)', fontSize: 12,
      }}>
        <span style={{ color: sel ? 'var(--rmai-purple)' : 'var(--rmai-ink-mut)' }}>{sel ? `▸${n}` : ` ${n}`}</span>
        <span style={{ color: 'var(--rmai-ink-fg)' }}>{tag} {label}</span>
        <span style={{ textAlign: 'right', color: 'var(--rmai-ink-fg)', fontWeight: 600 }}>{dur}</span>
        <span style={{ textAlign: 'right', color: 'var(--rmai-ink-fg2)' }}>{bike}</span>
        <span style={{ textAlign: 'right', color: 'var(--rmai-ink-fg2)' }}>{xfer}</span>
        <span style={{ textAlign: 'right', color: 'var(--rmai-ink-fg2)' }}>{asc}m</span>
      </div>
      {/* ASCII timeline */}
      <div style={{ display: 'flex', height: 4, marginTop: 8, borderRadius: 2, overflow: 'hidden' }}>
        {segs.map((s, i) => (
          <span key={i} style={{
            flex: s.f / total,
            background: s.t === 'bike' ? 'var(--rmai-purple)'
                     : s.t === 'train' ? 'var(--rmai-ink-fg)'
                     : 'var(--rmai-ink-3)',
          }}/>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)' }}>
        <span style={{ color: 'var(--rmai-ink-fg2)' }}>{dep}</span>
        <span>→</span>
        <span style={{ color: 'var(--rmai-ink-fg2)' }}>{arr}</span>
        {sel && <span style={{ marginLeft: 'auto', color: 'var(--rmai-ink-fg2)' }}>{SvgI.bike('var(--rmai-purple)')} hbg → eltham ↻ {SvgI.train('var(--rmai-ink-fg2)')} hurstbridge line ↻ {SvgI.bike('var(--rmai-purple)')} flinders → willi</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 4 — Advanced expanded (param list)
// ─────────────────────────────────────────────────────────────
function ConsoleAdvanced() {
  return (
    <div className="app console" style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <ConsoleHeader status="ready"/>

      <div style={{ padding: '14px 0 0' }}>
        <ConsoleField name="from" value="hurstbridge" hint="-37.64,145.19"/>
        <ConsoleField name="to" value="williamstown" hint="-37.86,144.89"/>
      </div>

      <div style={{ padding: '14px 14px 8px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-purple)', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>— flags</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)' }}>↹ tab to cycle</span>
      </div>

      <div style={{ borderTop: '1px solid var(--rmai-ink-3)', borderBottom: '1px solid var(--rmai-ink-3)' }}>
        <ConsoleParamRow flag="--mode"               value="bike-train"   hint="bike-only | bike-train"/>
        <ConsoleParamRow flag="--goal"               value="commute"      hint="commute | day-ride | max-path" alt/>
        <ConsoleParamRow flag="--depart"             value="08:00"        hint="hh:mm · today"/>
        <ConsoleParamRow flag="--arrive-by"          value="—"            hint="mutex with --depart" alt/>
        <ConsoleParamRow flag="--prefer-bike-path"   value="on"           hint="bool"/>
        <ConsoleParamRow flag="--hill-weight"        value="0.40"         hint="0.0–1.0 · avoid hills" alt/>
        <ConsoleParamRow flag="--min-on-path"        value="0.65"         hint="frac of bike legs on path"/>
        <ConsoleParamRow flag="--max-transfers"      value="1"            hint="int" alt/>
        <ConsoleParamRow flag="--min-bike-km"        value="0"            hint="km"/>
        <ConsoleParamRow flag="--max-bike-km"        value="20"           hint="km" alt/>
        <ConsoleParamRow flag="--enrich"             value="true"         hint="bool · stop names + paths"/>
      </div>

      <div style={{ padding: '12px 14px', fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--rmai-ink-fg2)' }}>
        <div style={{ color: 'var(--rmai-ink-mut)', marginBottom: 4 }}># equivalent cli</div>
        <div style={{ background: 'rgba(232,230,225,0.04)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--rmai-ink-3)', lineHeight: 1.5 }}>
          <span style={{ color: 'var(--rmai-purple)' }}>$ ptv plan</span> <span style={{ color: 'var(--rmai-ink-fg2)' }}>--from hurstbridge --to williamstown \</span><br/>
          <span style={{ paddingLeft: 12, color: 'var(--rmai-ink-fg2)' }}>--mode bike-train --goal commute --depart 08:00 \</span><br/>
          <span style={{ paddingLeft: 12, color: 'var(--rmai-ink-fg2)' }}>--hill-weight 0.4 --min-on-path 0.65</span>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '10px 14px', borderTop: '1px solid var(--rmai-ink-3)', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)' }}>
        <span><span className="dot"/> defaults from src/commands/plan.ts</span>
        <span style={{ marginLeft: 'auto', color: 'var(--rmai-purple)' }}>↵ plan ride</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 5 — Phase 2: map-click pin drop
// ─────────────────────────────────────────────────────────────
function ConsoleMapClick() {
  return (
    <div className="app console" style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <ConsoleHeader status="busy" extra={<><span style={{color:'var(--rmai-orange)'}}>planning</span><span style={{margin:'0 4px'}}>·</span></>}/>

      {/* Compact param row */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--rmai-ink-3)', fontFamily: 'var(--mono)', fontSize: 11, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: 'var(--rmai-purple)' }}>›</span>
        <span style={{ color: 'var(--rmai-ink-fg)' }}>-37.640, 145.190</span>
        <span style={{ color: 'var(--rmai-ink-mut)' }}>→</span>
        <span style={{ color: 'var(--rmai-ink-fg)' }}>-37.870, 144.886</span>
        <span style={{ marginLeft: 'auto', color: 'var(--rmai-orange)' }}>↻ refiring…</span>
      </div>

      {/* Map dominant */}
      <div style={{ flex: 1, position: 'relative', minHeight: 380 }}>
        <MapBg theme="dark" showRoutes={false}>
          {/* From pin */}
          <div style={{ position: 'absolute', left: '88%', top: '12%', transform: 'translate(-50%, -100%)' }}>
            <ConsolePinMarker label="01" name="from" color="#22C55E"/>
          </div>
          {/* To pin — dragging */}
          <div style={{ position: 'absolute', left: '18%', top: '78%', transform: 'translate(-50%, -100%)' }}>
            <ConsolePinMarker label="02" name="to · willi beach" color="#A77ACD" dragging/>
            <div className="pulse" style={{ left: -10, top: -2 }}/>
          </div>
          {/* Faint preview line */}
          <svg viewBox="0 0 900 700" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} preserveAspectRatio="xMidYMid slice">
            <path d="M 790 90 Q 500 280 165 545" fill="none" stroke="#A77ACD" strokeWidth="3" strokeDasharray="3 6" opacity="0.7"/>
          </svg>
        </MapBg>

        {/* Hint chip top-left */}
        <div style={{
          position: 'absolute', left: 12, top: 12,
          background: 'rgba(20,21,28,0.85)', backdropFilter: 'blur(8px)',
          border: '1px solid var(--rmai-ink-3)', borderRadius: 6,
          padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 10.5,
        }}>
          <div style={{ color: 'var(--rmai-purple)', marginBottom: 2 }}>● map.click</div>
          <div style={{ color: 'var(--rmai-ink-fg2)' }}>drag pin to refire plan</div>
        </div>

        {/* My location button */}
        <button style={{
          position: 'absolute', right: 12, top: 12,
          background: 'rgba(20,21,28,0.85)', border: '1px solid var(--rmai-ink-3)',
          width: 38, height: 38, borderRadius: 6, color: 'var(--rmai-purple)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>{SvgI.loc('#A77ACD')}</button>
      </div>

      {/* Bottom log */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--rmai-ink-3)', fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--rmai-ink-mut)', lineHeight: 1.6 }}>
        <div><span style={{color:'var(--rmai-green)'}}>●</span> <span style={{color:'var(--rmai-ink-fg2)'}}>reverse</span> 144.886,-37.870 → <span style={{color:'var(--rmai-ink-fg)'}}>williamstown beach</span></div>
        <div><span style={{color:'var(--rmai-orange)'}}>●</span> <span style={{color:'var(--rmai-ink-fg2)'}}>plan</span>    debounce 250ms · awaiting drag-stop</div>
        <div><span style={{color:'var(--rmai-ink-mut)'}}>·</span> <span style={{color:'var(--rmai-ink-fg2)'}}>url</span>     <span style={{color:'var(--rmai-purple)'}}>#from=-37.64,145.19&amp;to=-37.87,144.89</span></div>
      </div>
    </div>
  );
}

function ConsolePinMarker({ label, name, color, dragging }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transform: dragging ? 'translateY(-2px)' : 'none' }}>
      <div style={{
        background: 'rgba(20,21,28,0.92)',
        padding: '4px 8px', borderRadius: 4, border: `1px solid ${color}`,
        fontFamily: 'var(--mono)', fontSize: 10, color: '#E8E6E1',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ color, fontWeight: 600 }}>[{label}]</span>
        <span>{name}</span>
      </div>
      <svg width="22" height="28" viewBox="0 0 22 28">
        <path d="M 11 0 C 4.5 0 0 4.5 0 11 C 0 18 11 28 11 28 C 11 28 22 18 22 11 C 22 4.5 17.5 0 11 0 Z" fill={color}/>
        <circle cx="11" cy="11" r="4.5" fill="#14151C"/>
      </svg>
      <div className="pin-shadow"/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN 6 — Phase 2: offline shell / PWA install
// ─────────────────────────────────────────────────────────────
function ConsoleOffline() {
  return (
    <div className="app console" style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <ConsoleHeader status="offline" extra={<><span style={{color:'var(--rmai-orange)'}}>● offline</span><span style={{margin:'0 4px'}}>·</span></>}/>

      <div style={{ padding: '20px 16px' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-orange)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>— signal dropped</div>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--rmai-ink-fg)', lineHeight: 1.2, marginBottom: 8 }}>
          shell still here.<br/>
          <span style={{ color: 'var(--rmai-ink-mut)' }}>plan can't reach tailnet.</span>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--rmai-ink-fg2)', lineHeight: 1.6, marginBottom: 20 }}>
          serviceworker has the ui shell + last 3 trips cached. ptv departures need network — try again when you're back on tailnet.
        </div>

        <div style={{ background: 'rgba(232,230,225,0.04)', border: '1px solid var(--rmai-ink-3)', borderRadius: 6, padding: '10px 12px', fontFamily: 'var(--mono)', fontSize: 10.5, marginBottom: 14 }}>
          <div style={{ color: 'var(--rmai-ink-mut)', marginBottom: 6 }}># sw cache</div>
          <div style={{ color: 'var(--rmai-green)' }}>● /index.html         · 14 KB</div>
          <div style={{ color: 'var(--rmai-green)' }}>● /static/leaflet.js  · 142 KB</div>
          <div style={{ color: 'var(--rmai-green)' }}>● /static/htmx.min.js · 47 KB</div>
          <div style={{ color: 'var(--rmai-green)' }}>● /static/app.css     · 8 KB</div>
          <div style={{ color: 'var(--rmai-ink-mut)' }}>· /api/plan          · skipped (volatile)</div>
        </div>

        <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--rmai-purple)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginBottom: 8 }}>— recent · viewable offline</div>
        {[
          { from: 'hurstbridge', to: 'williamstown', dur: '01:09', when: 'yesterday' },
          { from: 'home',        to: 'altona pier',  dur: '00:48', when: 'tue' },
          { from: 'sandringham', to: 'docklands',    dur: '00:54', when: 'mon' },
        ].map((t, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'baseline', gap: 10,
            padding: '8px 0', borderBottom: i === 2 ? 'none' : '1px solid var(--rmai-ink-3)',
            fontFamily: 'var(--mono)', fontSize: 12,
          }}>
            <span style={{ color: 'var(--rmai-ink-mut)' }}>·</span>
            <span style={{ color: 'var(--rmai-ink-fg)' }}>{t.from}</span>
            <span style={{ color: 'var(--rmai-ink-mut)' }}>→</span>
            <span style={{ color: 'var(--rmai-ink-fg)' }}>{t.to}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--rmai-purple)' }}>{t.dur}</span>
            <span style={{ fontSize: 10, color: 'var(--rmai-ink-mut)' }}>{t.when}</span>
          </div>
        ))}
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '10px 14px', borderTop: '1px solid var(--rmai-ink-3)', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)' }}>
        <span style={{ color: 'var(--rmai-orange)' }}>● offline</span>
        <span>polling tailnet every 8s</span>
        <span style={{ marginLeft: 'auto', color: 'var(--rmai-purple)' }}>↻ retry</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DESKTOP — Console
// ─────────────────────────────────────────────────────────────
function ConsoleDesktop() {
  return (
    <div className="app console" style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <ConsoleHeader status="ok" extra={<><span style={{color:'var(--rmai-green)'}}>● cache 91%</span><span style={{margin:'0 4px'}}>·</span><span>p50 312ms</span><span style={{margin:'0 4px'}}>·</span><span>q 0</span><span style={{margin:'0 4px'}}>·</span></>}/>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left: form */}
        <div style={{ width: 380, flexShrink: 0, borderRight: '1px solid var(--rmai-ink-3)', display: 'flex', flexDirection: 'column' }}>
          <ConsoleField name="from" value="hurstbridge" hint="-37.64,145.19"/>
          <ConsoleField name="to"   value="williamstown" hint="-37.86,144.89"/>

          <div style={{ padding: '14px 14px 6px' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-purple)', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>— flags</div>
          </div>
          <div style={{ borderTop: '1px solid var(--rmai-ink-3)', borderBottom: '1px solid var(--rmai-ink-3)' }}>
            <ConsoleParamRow flag="--mode" value="bike-train" hint="| bike-only"/>
            <ConsoleParamRow flag="--goal" value="commute" hint="| day-ride | max-path" alt/>
            <ConsoleParamRow flag="--depart" value="08:00" hint="hh:mm"/>
            <ConsoleParamRow flag="--prefer-bike-path" value="on" hint="bool" alt/>
            <ConsoleParamRow flag="--hill-weight" value="0.40" hint="0.0–1.0"/>
            <ConsoleParamRow flag="--min-on-path" value="0.65" hint="frac" alt/>
            <ConsoleParamRow flag="--max-transfers" value="1" hint="int"/>
            <ConsoleParamRow flag="--max-bike-km" value="20" hint="km" alt/>
          </div>

          <div style={{ padding: '14px 14px', borderBottom: '1px solid var(--rmai-ink-3)' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-purple)', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>— $ equiv</div>
            <div style={{ background: 'rgba(232,230,225,0.04)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--rmai-ink-3)', fontFamily: 'var(--mono)', fontSize: 10.5, lineHeight: 1.6 }}>
              <div><span style={{ color: 'var(--rmai-purple)' }}>ptv plan</span> <span style={{ color: 'var(--rmai-ink-fg2)' }}>--from hurstbridge \</span></div>
              <div style={{ paddingLeft: 10, color: 'var(--rmai-ink-fg2)' }}>--to williamstown --mode bike-train \</div>
              <div style={{ paddingLeft: 10, color: 'var(--rmai-ink-fg2)' }}>--goal commute --depart 08:00 \</div>
              <div style={{ paddingLeft: 10, color: 'var(--rmai-ink-fg2)' }}>--hill-weight 0.4 --min-on-path 0.65</div>
            </div>
          </div>

          <div style={{ padding: 14, marginTop: 'auto' }}>
            <button style={{
              width: '100%', padding: '14px', background: 'var(--rmai-orange)', color: '#fff',
              fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600,
              border: 'none', borderRadius: 4, cursor: 'pointer',
            }}>↵ plan ride</button>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--rmai-ink-mut)', textAlign: 'center', marginTop: 6, letterSpacing: '0.04em' }}>
              ⌘↵ to re-plan · ⌘k for cmd palette
            </div>
          </div>
        </div>

        {/* Right: results table + map */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--rmai-ink-3)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-purple)', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>— 3 itineraries</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-green)' }}>● cache hit · 312ms</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-purple)' }}>↳ copy share url</span>
          </div>

          <div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '22px 1fr 56px 50px 38px 38px',
              gap: 6, padding: '6px 14px',
              fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--rmai-ink-mut)',
              textTransform: 'uppercase', letterSpacing: '0.12em',
              borderBottom: '1px dashed var(--rmai-ink-3)',
            }}>
              <span>#</span><span>itinerary</span><span style={{textAlign:'right'}}>total</span><span style={{textAlign:'right'}}>bike</span><span style={{textAlign:'right'}}>xfer</span><span style={{textAlign:'right'}}>↗</span>
            </div>
            <ConsoleItinRow n={1} sel label="recommended" tag="●" dur="01:09" dep="08:04" arr="09:13" bike="6.2km" xfer="1" asc="42"/>
            <ConsoleItinRow n={2} label="fastest" dur="00:58" dep="08:12" arr="09:10" bike="3.4km" xfer="2" asc="28"/>
            <ConsoleItinRow n={3} label="max-path" dur="02:22" dep="08:00" arr="10:22" bike="24.8km" xfer="0" asc="180"/>
          </div>

          <div style={{ flex: 1, position: 'relative', borderTop: '1px solid var(--rmai-ink-3)', minHeight: 280 }}>
            <MapBg theme="dark" activeRoute="recommended"/>

            {/* Compass + zoom */}
            <div style={{ position: 'absolute', right: 12, top: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button style={{ width: 32, height: 32, background: 'rgba(20,21,28,0.85)', border: '1px solid var(--rmai-ink-3)', borderRadius: 4, color: '#E8E6E1', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 14 }}>+</button>
              <button style={{ width: 32, height: 32, background: 'rgba(20,21,28,0.85)', border: '1px solid var(--rmai-ink-3)', borderRadius: 4, color: '#E8E6E1', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 14 }}>−</button>
              <button style={{ width: 32, height: 32, background: 'rgba(20,21,28,0.85)', border: '1px solid var(--rmai-ink-3)', borderRadius: 4, color: 'var(--rmai-purple)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{SvgI.loc('#A77ACD')}</button>
            </div>

            <div style={{
              position: 'absolute', left: 12, bottom: 12,
              background: 'rgba(20,21,28,0.85)', backdropFilter: 'blur(8px)',
              border: '1px solid var(--rmai-ink-3)', borderRadius: 4,
              padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-fg2)',
              letterSpacing: '0.04em',
            }}>
              # url <span style={{ color: 'var(--rmai-purple)' }}>#from=-37.64,145.19&amp;to=-37.86,144.89&amp;depart=0800&amp;goal=commute</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer status bar */}
      <div style={{ borderTop: '1px solid var(--rmai-ink-3)', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--rmai-ink-mut)', background: 'rgba(232,230,225,0.02)' }}>
        <span style={{ color: 'var(--rmai-green)' }}>● tailnet</span>
        <span>ptv.magpie-inconnu.ts.net:8085</span>
        <span>—</span>
        <span>gh-route:up</span>
        <span>osrm-au:up</span>
        <span>redis:91%</span>
        <span style={{ marginLeft: 'auto' }}>2026-05-17 · 08:04:31 +1000</span>
      </div>
    </div>
  );
}

Object.assign(window, {
  ConsoleEmpty, ConsoleTyping, ConsoleResults, ConsoleAdvanced, ConsoleMapClick, ConsoleOffline, ConsoleDesktop,
});
