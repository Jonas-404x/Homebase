import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Navigation } from '../src/layout/Navigation.tsx';

describe('Navigation', () => {
  it('zeigt alle fünf Bereiche und markiert den aktiven', () => {
    render(
      <MemoryRouter initialEntries={['/apps']}>
        <Navigation />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Übersicht', 'Dienste', 'Apps', 'Minecraft', 'Einstellungen']);
    expect(within(nav).getByRole('link', { name: 'Apps' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Übersicht' })).not.toHaveAttribute('aria-current');
  });

  it('lässt „Übersicht“ in der Detailansicht markiert', () => {
    render(
      <MemoryRouter initialEntries={['/details/cpu']}>
        <Navigation />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Übersicht' })).toHaveAttribute('aria-current', 'page');
  });
});
