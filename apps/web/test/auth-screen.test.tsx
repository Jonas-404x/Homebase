import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthScreen } from '../src/pages/AuthScreen.tsx';

describe('Anmeldeseite', () => {
  it('zeichnet das Muster in den Ecken nur als Deko', () => {
    const { container } = render(<AuthScreen mode="login" onDone={() => {}} />);
    const deco = container.querySelector('.auth-deco');
    expect(deco).toHaveAttribute('aria-hidden', 'true');
    // Zwei Lineale (oben links, unten rechts), je mit Skala und einer Marke.
    const rulers = deco!.querySelectorAll('.auth-ruler');
    expect(rulers).toHaveLength(2);
    for (const r of rulers) {
      expect(r.querySelectorAll('.auth-tick').length).toBeGreaterThan(10);
      expect(r.querySelectorAll('.auth-mark')).toHaveLength(1);
    }
  });

  it('zeigt die Uhrzeit unter dem Formular', () => {
    render(<AuthScreen mode="login" onDone={() => {}} />);
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('verrät vor der Anmeldung keine Systemwerte', () => {
    const { container } = render(<AuthScreen mode="login" onDone={() => {}} />);
    expect(container.textContent).not.toMatch(/%|GB|MB\/s/);
  });
});
