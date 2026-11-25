import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from '../src/components/Sparkline.tsx';

const xs = (el: Element) => (el.getAttribute('points') ?? '').split(' ').map((p) => Number(p.split(',')[0]));

describe('Sparkline', () => {
  it('verteilt Punkte nach der Zeit, nicht nach ihrer Anzahl', () => {
    const now = 3_600_000;
    const { container } = render(
      <Sparkline points={[{ at: 0, v: 1 }, { at: 60_000, v: 2 }, { at: now, v: 3 }]} windowMs={now} label="x" />,
    );
    expect(xs(container.querySelector('polyline')!)).toEqual([0, 1.67, 100]);
  });

  it('lässt Punkte außerhalb des Zeitraums weg', () => {
    const { container } = render(
      <Sparkline points={[{ at: 0, v: 1 }, { at: 50_000, v: 2 }, { at: 100_000, v: 3 }]} windowMs={50_000} label="x" />,
    );
    expect(xs(container.querySelector('polyline')!)).toEqual([0, 100]);
  });
});
