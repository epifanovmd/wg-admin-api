import type { ValueTransformer } from "typeorm";

/**
 * `bigint` Postgres приходит строкой; размеры и счётчики укладываются в
 * `number` (до 2^53). Колонка: `@Column({ type: "bigint", transformer: bigintNumber })`.
 */
export const bigintNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
