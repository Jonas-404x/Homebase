import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BigChart } from '../src/components/BigChart.tsx';

afterEach(() => vi.restoreAllMocks());

const fmt = (v: number) => `${v.toFixed(1)} %`;

describe('BigChart', () => {
  it('stürzt nicht ab, wenn nach dem Antippen weniger Punkte kommen', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    const props = { from: 0, to: 30_000, label: 'Verlauf', timeZone: 'UTC', format: fmt, max: 100 };
    const { container, rerender } = render(<BigChart {...props} times={[0, 10_000, 20_000, 30_000]} series={[{ name: 'Last', tone: 'a', values: [1, 2, 3, 4] }]} />);
    fireEvent.pointerMove(container.querySelector('.big-chart-plot')!, { clientX: 100 });
    expect(screen.getByText('4.0 %')).toBeInTheDocument();
    rerender(<BigChart {...props} times={[0, 10_000, 20_000]} series={[{ name: 'Last', tone: 'a', values: [1, 2, 3] }]} />);
    expect(screen.getByRole('img', { name: 'Verlauf' })).toBeInTheDocument();
  });

  it('unterbricht die Linie, wenn lange keine Werte kamen (PC aus)', () => {
    const h = 3600_000;
    const { container } = render(
      <BigChart
        from={0}
        to={24 * h}
        label="Verlauf"
        timeZone="UTC"
        format={fmt}
        max={100}
        times={[0, 6 * 60_000, 10 * h, 10 * h + 6 * 60_000]}
        series={[{ name: 'Last', tone: 'a', values: [10, 20, 30, 40] }]}
      />,
    );
    const d = container.querySelector('.big-chart-line')!.getAttribute('d')!;
    expect(d.match(/M/g)).toHaveLength(2);
  });
  it('zeichnet die Warngrenze als Linie, nur wenn es eine gibt', () => {
    const props = { from: 0, to: 30_000, label: 'Verlauf', timeZone: 'UTC', format: fmt, max: 100, times: [0, 10_000], series: [{ name: 'Belegt', tone: 'a' as const, values: [40, 50] }] };
    const { container, rerender } = render(<BigChart {...props} threshold={80} />);
    const line = container.querySelector('.big-chart-threshold');
    expect(line).not.toBeNull();
    // 220 hoch, 80 von 100 → 20 % von oben.
    expect(line!.getAttribute('y1')).toBe('44');
    rerender(<BigChart {...props} />);
    expect(container.querySelector('.big-chart-threshold')).toBeNull();
  });
});
