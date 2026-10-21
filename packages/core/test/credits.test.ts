import { describe, expect, it } from 'vitest';
import { CREDITS, creditsFor, LICENSE_NAMES, licenseText } from '../src/credits';

describe('credits', () => {
  it('lists the three visual libraries the design is built on', () => {
    const names = CREDITS.filter((c) => c.featured).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['React Three Fiber', 'liquid-glass-react', 'ShaderGradient', 'three.js']));
  });

  it('gives every library a full license text with its own copyright', () => {
    for (const c of CREDITS) {
      const text = licenseText(c);
      expect(text, c.name).toContain(c.copyright);
      expect(text.length, c.name).toBeGreaterThan(400);
    }
  });

  it('keeps the permission notice MIT and ISC require', () => {
    const mit = licenseText(CREDITS.find((c) => c.name === 'liquid-glass-react')!);
    expect(mit).toMatch(/^MIT License/);
    expect(mit).toContain('The above copyright notice and this permission notice shall be included');
    expect(mit).toContain('Copyright 2025 MAX ROVENSKY');
    const isc = licenseText(CREDITS.find((c) => c.license === 'ISC')!);
    expect(isc).toContain('copyright notice and this permission notice appear in all copies');
  });

  it('includes the whole OFL for the font', () => {
    const ofl = licenseText(CREDITS.find((c) => c.license === 'OFL-1.1')!);
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(ofl).toContain('TERMINATION');
    expect(ofl).toContain('DISCLAIMER');
  });

  it('links only to https project pages and has unique names', () => {
    expect(new Set(CREDITS.map((c) => c.name)).size).toBe(CREDITS.length);
    for (const c of CREDITS) expect(c.url).toMatch(/^https:\/\/github\.com\//);
    for (const c of CREDITS) expect(LICENSE_NAMES[c.license]).toBeTruthy();
  });

  it('filters by platform and puts featured libraries first', () => {
    const web = creditsFor('web');
    expect(web.map((c) => c.name)).toContain('ShaderGradient');
    expect(web.map((c) => c.name)).not.toContain('Expo');
    const firstPlain = web.findIndex((c) => !c.featured);
    expect(web.slice(firstPlain).some((c) => c.featured)).toBe(false);
    const mobile = creditsFor('mobile');
    expect(mobile.map((c) => c.name)).toContain('Expo');
    expect(mobile.map((c) => c.name)).not.toContain('liquid-glass-react');
  });
});
