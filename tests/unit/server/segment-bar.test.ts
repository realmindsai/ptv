import { describe, it, expect } from 'vitest';
// @ts-expect-error - importing untyped JS module
import { segmentsFromItinerary, segmentBarHtml } from '../../../src/server/static-assets/segment-bar.js';

describe('segmentsFromItinerary', () => {
  it('emits bike|train segments in order with min and km labels', () => {
    const it = {
      legs: [
        { mode: 'bike',  km: 5.0, min: 12 },
        { mode: 'train', routeName: 'Hurstbridge', departUtc: '2026-05-18T08:04:00Z', arriveUtc: '2026-05-18T08:49:00Z' },
        { mode: 'bike',  km: 11.0, min: 31 },
      ],
    };
    const segs = segmentsFromItinerary(it);
    expect(segs).toEqual([
      { kind: 'bike',  min: 12, label: '5.0km' },
      { kind: 'train', min: 45, label: 'Hurstbridge' },
      { kind: 'bike',  min: 31, label: '11.0km' },
    ]);
  });
});

describe('segmentBarHtml', () => {
  it('renders proportional flex bars with class names', () => {
    const html = segmentBarHtml([
      { kind: 'bike',  min: 12, label: '5km' },
      { kind: 'train', min: 48, label: 'Hurstbridge' },
    ]);
    expect(html).toContain('class="seg-bar"');
    expect(html).toContain('seg seg--bike');
    expect(html).toContain('seg seg--train');
    expect(html).toContain('style="flex:12"');
    expect(html).toContain('style="flex:48"');
  });
});
