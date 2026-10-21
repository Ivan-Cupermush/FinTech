import '@testing-library/jest-dom/vitest';

// В jsdom нет WebGL: эффекты уходят в CSS-режим, а не шумят в консоль.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
