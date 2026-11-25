import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// Unter Last (alle Tests parallel) braucht das erste Rendern manchmal länger als 1 s.
configure({ asyncUtilTimeout: 3000 });

// jsdom kennt diese Browser-APIs nicht, cmdk braucht sie.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= function () {};
