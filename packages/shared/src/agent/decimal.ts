import type { ModelPrice } from './models';

type DecimalLike = { toString(): string };

/** Coerce a Prisma Decimal-like value to a plain number. */
export function decimalToNumber(value: DecimalLike): number;
export function decimalToNumber(value: DecimalLike | null): number | null;
export function decimalToNumber(value: DecimalLike | null): number | null {
  return value == null ? null : Number(value);
}

/** Convert Decimal-backed model pricing columns into runtime price values. */
export function toModelPrice(row: { inputPerM: DecimalLike; outputPerM: DecimalLike }): ModelPrice {
  return {
    inputPerM: decimalToNumber(row.inputPerM),
    outputPerM: decimalToNumber(row.outputPerM),
  };
}
