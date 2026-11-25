import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRipple } from '../src/layout/ripple.ts';

function Demo() {
  useRipple();
  return (
    <div>
      <button className="button">Los</button>
      <p className="plain">Text</p>
    </div>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Ripple beim Tippen', () => {
  it('lässt auf Knöpfen eine Welle an der Fingerposition entstehen', () => {
    const { container } = render(<Demo />);
    const btn = container.querySelector('button')!;
    fireEvent.pointerDown(btn, { clientX: 5, clientY: 5 });
    expect(btn.querySelector('.ripple')).not.toBeNull();
    fireEvent.pointerDown(container.querySelector('.plain')!);
    expect(container.querySelector('.plain .ripple')).toBeNull();
  });

  it('bleibt bei „Bewegung reduzieren“ aus', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    const { container } = render(<Demo />);
    const btn = container.querySelector('button')!;
    fireEvent.pointerDown(btn);
    expect(btn.querySelector('.ripple')).toBeNull();
  });

  it('bleibt in einer eigenen Klammer, auch wenn React die Klasse neu setzt', () => {
    const { container } = render(<Demo />);
    const btn = container.querySelector('button')!;
    fireEvent.pointerDown(btn, { clientX: 5, clientY: 5 });
    btn.className = 'button active'; // wie beim Klick auf einen Einstellungs-Eintrag
    const dot = btn.querySelector('.ripple')!;
    expect(dot.parentElement).toHaveClass('ripple-clip');
    expect(dot.parentElement!.parentElement).toBe(btn);
  });
});
