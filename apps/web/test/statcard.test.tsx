import { render } from '@testing-library/react';
import { Cpu } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { StatCard } from '../src/components/StatCard.tsx';

describe('StatCard', () => {
  it('markiert die Warngrenze auf dem Balken', () => {
    const { container, rerender } = render(<StatCard icon={Cpu} label="Arbeitsspeicher" value="9 GB" load={30} threshold={80} />);
    const mark = container.querySelector<HTMLElement>('.meter-threshold');
    expect(mark).not.toBeNull();
    expect(mark!.style.left).toBe('80%');
    rerender(<StatCard icon={Cpu} label="Prozessor" value="12 %" load={12} />);
    expect(container.querySelector('.meter-threshold')).toBeNull();
  });

  it('setzt bei „belegt / gesamt“ die Gesamtmenge kleiner daneben', () => {
    const { container } = render(<StatCard icon={Cpu} label="Arbeitsspeicher" value="3,2 / 7,8 GB" load={41} />);
    const value = container.querySelector('.stat-value')!;
    expect(value.textContent).toBe('3,2 / 7,8 GB');
    expect(value.querySelector('.stat-of')?.textContent).toBe(' / 7,8 GB');
  });
});
