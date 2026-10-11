import { formatInvestment, parseInvestment, rosterInvestment } from './investment';

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
});
