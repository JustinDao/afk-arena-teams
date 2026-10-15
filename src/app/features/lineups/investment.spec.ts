import {
  defaultAscensionForInvestment,
  formatInvestment,
  isAscensionAtLeast,
  parseInvestment,
  rosterInvestment,
  sanitizeInvestmentForAscension,
} from './investment';

describe('investment codes', () => {
  it('treats a compact code without an engraving suffix as zero engraving', () => {
    expect(parseInvestment('303')).toEqual({ si: 30, furn: 3, eng: 0 });
    expect(parseInvestment('309')).toEqual({ si: 30, furn: 9, eng: 0 });
  });

  it('parses two-digit furniture values and explicit engraving', () => {
    expect(parseInvestment('3012e60')).toEqual({ si: 30, furn: 12, eng: 60 });
    expect(parseInvestment('303e0')).toEqual({ si: 30, furn: 3, eng: 0 });
    expect(parseInvestment('409e60')).toEqual({ si: 40, furn: 9, eng: 60 });
  });

  it('supports sparse values and validates investment limits', () => {
    expect(parseInvestment('e60')).toEqual({ si: null, furn: null, eng: 60 });
    expect(parseInvestment('--9e60')).toEqual({ si: null, furn: 9, eng: 60 });
    expect(parseInvestment('5036e60')).toEqual({ si: 50, furn: 36, eng: 60 });
    expect(parseInvestment('5136e60')).toBeNull();
    expect(parseInvestment('5037e60')).toBeNull();
    expect(parseInvestment('3112e60')).toBeNull();
    expect(parseInvestment('3013e60')).toBeNull();
    expect(parseInvestment('3013e101')).toBeNull();
    expect(parseInvestment('-309e60')).toBeNull();
  });

  it('formats investments without truncating double-digit furniture', () => {
    expect(formatInvestment({ si: 30, furn: 3, eng: 0 })).toBe('303e0');
    expect(formatInvestment({ si: 30, furn: 12, eng: 60 })).toBe('3012e60');
    expect(formatInvestment({ si: null, furn: 9, eng: 60 })).toBe('--9e60');
  });

  it('shows legacy saved roster values without an engraving as zero engraving', () => {
    expect(rosterInvestment({ inv: '309', si: 30, furn: 9, eng: null })).toEqual({
      si: 30,
      furn: 9,
      eng: 0,
    });
  });

  describe('sanitizeInvestmentForAscension', () => {
    it('removes engraving when dropping below A1 star', () => {
      const inv = { si: 30, furn: 9, eng: 60 };
      expect(sanitizeInvestmentForAscension(inv, 'ascended')).toEqual({
        si: 30,
        furn: 9,
        eng: 0,
      });
      expect(formatInvestment(sanitizeInvestmentForAscension(inv, 'ascended'))).toBe('309e0');
    });

    it('removes furniture and engraving when dropping below Ascended', () => {
      const inv = { si: 30, furn: 9, eng: 60 };
      expect(sanitizeInvestmentForAscension(inv, 'mythic')).toEqual({
        si: 30,
        furn: 0,
        eng: 0,
      });
      expect(formatInvestment(sanitizeInvestmentForAscension(inv, 'mythic'))).toBe('300e0');
    });

    it('removes signature item, furniture, and engraving when dropping below Mythic', () => {
      const inv = { si: 30, furn: 9, eng: 60 };
      expect(sanitizeInvestmentForAscension(inv, 'legendary')).toEqual({
        si: 0,
        furn: 0,
        eng: 0,
      });
      expect(sanitizeInvestmentForAscension(inv, null)).toEqual({
        si: 0,
        furn: 0,
        eng: 0,
      });
    });

    it('keeps investments that are compatible with the ascension rank', () => {
      const inv = { si: 30, furn: 9, eng: 60 };
      expect(sanitizeInvestmentForAscension(inv, 'ascended_1')).toEqual({
        si: 30,
        furn: 9,
        eng: 60,
      });
      expect(sanitizeInvestmentForAscension(inv, 'ascended_5')).toEqual({
        si: 30,
        furn: 9,
        eng: 60,
      });
    });
  });

  describe('defaultAscensionForInvestment', () => {
    it('returns ascended_1 when engraving is present', () => {
      expect(defaultAscensionForInvestment({ si: 30, furn: 9, eng: 60 })).toBe('ascended_1');
      expect(defaultAscensionForInvestment({ si: null, furn: null, eng: 30 })).toBe('ascended_1');
    });

    it('returns ascended when furniture is present without engraving', () => {
      expect(defaultAscensionForInvestment({ si: 30, furn: 9, eng: 0 })).toBe('ascended');
      expect(defaultAscensionForInvestment({ si: null, furn: 3, eng: null })).toBe('ascended');
    });

    it('returns mythic when only signature item is present', () => {
      expect(defaultAscensionForInvestment({ si: 30, furn: 0, eng: 0 })).toBe('mythic');
      expect(defaultAscensionForInvestment({ si: 20, furn: null, eng: null })).toBe('mythic');
    });

    it('returns null when investment is null or zeroed', () => {
      expect(defaultAscensionForInvestment(null)).toBeNull();
      expect(defaultAscensionForInvestment({ si: 0, furn: 0, eng: 0 })).toBeNull();
    });
  });
});
