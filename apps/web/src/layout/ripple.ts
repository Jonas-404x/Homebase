import { useEffect } from 'react';

/** Elemente, die beim Antippen eine Welle bekommen (wie bei Android). */
const HOSTS = '.button, .nav-icon, .settings-item, .settings-result, .stat-clickable, .segment, .palette-item, .app-row';

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Material-Ripple: beim Antippen breitet sich vom Finger aus ein heller Kreis aus.
 * Ein Listener für die ganze Seite; aus bei „Bewegung reduzieren“.
 */
export function useRipple(): void {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (reducedMotion() || e.button > 0) return;
      const target = e.target instanceof Element ? e.target : null;
      const link = target?.closest('.nav-link');
      const host = (link?.querySelector('.nav-icon') ?? target?.closest(HOSTS)) as HTMLElement | null;
      if (!host || (host as HTMLButtonElement).disabled) return;
      const box = host.getBoundingClientRect();
      const d = Math.max(box.width, box.height) * 2.2 || 80;
      const dot = document.createElement('span');
      dot.className = 'ripple';
      dot.setAttribute('aria-hidden', 'true');
      const x = link ? box.width / 2 : (e.clientX || box.left + box.width / 2) - box.left;
      const y = link ? box.height / 2 : (e.clientY || box.top + box.height / 2) - box.top;
      dot.style.width = dot.style.height = `${d}px`;
      dot.style.left = `${x - d / 2}px`;
      dot.style.top = `${y - d / 2}px`;
      // Eigene Klammer: React setzt className beim Klick oft neu (z. B. „active“) und
      // würde eine Klasse am Element selbst wieder entfernen, dann wäre die Welle riesig.
      const clip = document.createElement('span');
      clip.className = 'ripple-clip';
      clip.setAttribute('aria-hidden', 'true');
      clip.appendChild(dot);
      host.appendChild(clip);
      const done = () => clip.remove();
      dot.addEventListener('animationend', done);
      setTimeout(done, 700);
    };
    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
}
