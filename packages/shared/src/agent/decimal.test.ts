import { describe, expect, it } from 'vitest';
import { decimalToNumber, toModelPrice } from './decimal';

const dec = (s: string) => ({ toString: () => s });

describe('decimalToNumber', () => {
  it('converts a Decimal-like object to a number', () => {
    expect(decimalToNumber(dec('5.000000'))).toBe(5);
  });

  it('returns null for a null input', () => {
    expect(decimalToNumber(null)).toBeNull();
  });

  it('returns 0 for a zero value', () => {
    expect(decimalToNumber(dec('0'))).toBe(0);
  });

  it('preserves high-precision fractional values', () => {
    expect(decimalToNumber(dec('1.123456'))).toBeCloseTo(1.123456, 6);
  });

  it('works with any object whose toString returns a numeric string', () => {
    expect(decimalToNumber({ toString: () => '0.001' })).toBeCloseTo(0.001, 6);
  });
});

describe('toModelPrice', () => {
  it('converts Decimal-like row fields to plain numbers', () => {
    const result = toModelPrice({ inputPerM: dec('3.000000'), outputPerM: dec('15.000000') });
    expect(result).toEqual({ inputPerM: 3, outputPerM: 15 });
  });

  it('preserves typical sub-dollar pricing precision', () => {
    const result = toModelPrice({ inputPerM: dec('0.001'), outputPerM: dec('0.003') });
    expect(result.inputPerM).toBeCloseTo(0.001, 6);
    expect(result.outputPerM).toBeCloseTo(0.003, 6);
  });

  it('handles whole-number pricing (e.g. 5.00 / 25.00)', () => {
    const result = toModelPrice({ inputPerM: dec('5.00'), outputPerM: dec('25.00') });
    expect(result).toEqual({ inputPerM: 5, outputPerM: 25 });
  });

  it('returns an object with only inputPerM and outputPerM fields', () => {
    const result = toModelPrice({ inputPerM: dec('1'), outputPerM: dec('2') });
    expect(Object.keys(result).sort()).toEqual(['inputPerM', 'outputPerM']);
  });
});
