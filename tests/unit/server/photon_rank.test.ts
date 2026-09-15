import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePhotonFeatures } from '../../../src/server/photon';
import { rankPhotonHits } from '../../../src/server/photon_rank';

// Fixtures are verbatim responses recorded from the live Photon on totoro
// (2026-09-15). They record the BROKEN ranking the beads describe, so these
// tests prove the post-ranker repairs real payloads, not synthetic ones.
function fixture(name: string) {
  const p = resolve(__dirname, '../../fixtures/photon', `${name}.json`);
  return parsePhotonFeatures(JSON.parse(readFileSync(p, 'utf8')));
}

describe('parsePhotonFeatures', () => {
  it('keeps the locality fields the ranker needs', () => {
    const hits = fixture('st-kilda-library');
    expect(hits[0]).toMatchObject({
      name: 'Little LIbrary 40 Clarence St',
      district: 'Brunswick East',
      city: 'City of Merri-bek',
      state: 'Victoria',
      osm_key: 'place',
      osm_value: 'house',
    });
  });

  it('puts the suburb (district) into the label so a wrong suburb is visible', () => {
    const hits = fixture('st-kilda-library');
    expect(hits[0].label).toContain('Brunswick East');
  });

  it('returns [] for a response with no features', () => {
    expect(parsePhotonFeatures(JSON.parse('{"features":[]}'))).toEqual([]);
  });
});

describe('rankPhotonHits — ptv-qjz: suburb named in the query wins', () => {
  it('ranks a St Kilda feature above the Brunswick East one Photon put first', () => {
    const hits = fixture('st-kilda-library');
    // Photon's own order is the bug: a library 11km away in the wrong suburb.
    expect(hits[0].district).toBe('Brunswick East');

    const out = rankPhotonHits('St Kilda library', hits);
    const top = out.hits[0];
    expect(`${top.name} ${top.district} ${top.city}`).toContain('St Kilda');
    expect(top.district).not.toBe('Brunswick East');
    // St Kilda sits south-east of the CBD; Brunswick East is north of it.
    expect(top.lat).toBeLessThan(-37.85);
    expect(out.confident).toBe(true);
  });

  it('does not let a shared "St" token promote St Albans', () => {
    const out = rankPhotonHits('St Kilda library', fixture('st-kilda-library'));
    expect(out.hits[0].name).not.toContain('St Albans');
  });
});

describe('rankPhotonHits — ptv-q97: a wrong-state hit is never returned', () => {
  it('drops every non-Victorian candidate for "Flinders Street Station"', () => {
    const hits = fixture('flinders-street-station');
    // Photon's top hit is a house in Townsville, 2000km away.
    expect(hits[0].city).toBe('Townsville');
    expect(hits.every((h) => h.state !== 'Victoria')).toBe(true);

    const out = rankPhotonHits('Flinders Street Station', hits);
    expect(out.hits).toEqual([]);
    expect(out.confident).toBe(false);
  });
});

describe('rankPhotonHits — must not make the already-correct cases worse', () => {
  it('is a no-op on a category-less query Photon already gets right', () => {
    const hits = fixture('ceres-brunswick-east');
    const out = rankPhotonHits('CERES Community Gardens', hits);
    expect(out.hits[0].name).toBe('CERES Community Gardens');
    expect(out.confident).toBe(true);
  });

  it('keeps the suburb itself on top for a bare suburb query', () => {
    const hits = fixture('hurstbridge');
    const out = rankPhotonHits('Hurstbridge', hits);
    expect(out.hits[0].name).toBe('Hurstbridge');
    expect(out.hits[0].osm_value).toBe('suburb');
    expect(out.confident).toBe(true);
  });

  it('keeps a street-in-suburb query on its street', () => {
    const hits = fixture('carlisle-street-st-kilda');
    const out = rankPhotonHits('Carlisle Street St Kilda', hits);
    expect(out.hits[0].street ?? out.hits[0].name).toBe('Carlisle Street');
    expect(out.hits[0].district).toBe('St Kilda');
    expect(out.confident).toBe(true);
  });
});

describe('rankPhotonHits — degenerate input', () => {
  it('reports low confidence when the named suburb matches nothing', () => {
    const out = rankPhotonHits('library in Zzyzxville', fixture('no-such-suburb'));
    expect(out.confident).toBe(false);
    // Must still degrade gracefully rather than throw or blank out: the
    // in-state candidates survive so the caller can fall back to them.
    expect(out.hits.length).toBeGreaterThan(0);
    expect(out.hits.every((h) => h.state === 'Victoria')).toBe(true);
  });

  it('handles an empty result set', () => {
    const out = rankPhotonHits('qqzzxxjjvv', fixture('empty-result'));
    expect(out.hits).toEqual([]);
    expect(out.confident).toBe(false);
  });

  it('handles an empty query without throwing', () => {
    const out = rankPhotonHits('', fixture('hurstbridge'));
    expect(out.confident).toBe(false);
    expect(Array.isArray(out.hits)).toBe(true);
  });
});

describe('rankPhotonHits — purity', () => {
  it('is stable across repeated runs and does not mutate its input', () => {
    const hits = fixture('st-kilda-library');
    const before = JSON.parse(JSON.stringify(hits));
    const a = rankPhotonHits('St Kilda library', hits);
    const b = rankPhotonHits('St Kilda library', hits);
    expect(a).toEqual(b);
    expect(hits).toEqual(before);
  });
});

describe('parsePhotonFeatures — the label has to identify the place', () => {
  it('keeps the street address, so a house is not labelled as its suburb', () => {
    // Photon gives a house no `name`, only housenumber + street. Dropping them
    // labelled 150 Carlisle Street as plain "St Kilda" — the caller could not
    // tell whether it got the address it asked for or the whole suburb.
    const hits = fixture('street-address');
    expect(hits[0].label).toBe(
      '150 Carlisle Street, St Kilda, City of Port Phillip, Victoria, Australia',
    );
  });
});

describe('rankPhotonHits — with the Victoria bbox Photon now applies', () => {
  it('puts the CBD Flinders Street above the outer-suburb ones', () => {
    const out = rankPhotonHits(
      'Flinders Street Station',
      fixture('flinders-street-station-bbox'),
    );
    expect(out.hits[0].district).toBe('Melbourne');
    expect(out.hits[0].name).toBe('Flinders Street');
  });

  it('ranks an exact street address first', () => {
    const out = rankPhotonHits('150 Carlisle Street St Kilda', fixture('street-address'));
    expect(out.hits[0].street).toBe('Carlisle Street');
    expect(out.hits[0].district).toBe('St Kilda');
    expect(out.confident).toBe(true);
  });
});
