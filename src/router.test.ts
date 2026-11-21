import { describe, expect, test } from 'bun:test';
import { validateCollectionSearch } from './router';

describe('validateCollectionSearch', () => {
  test('accepts valid substance, rarity, and sort params', () => {
    expect(
      validateCollectionSearch({
        type: 'liquid',
        rarity: 'mythic',
        sort: 'total',
      }),
    ).toEqual({
      type: 'liquid',
      rarity: 'mythic',
      sort: 'total',
    });
  });

  test('drops unknown or non-string values safely', () => {
    expect(
      validateCollectionSearch({
        type: 'fire',
        rarity: 123,
        sort: 'invalid',
      }),
    ).toEqual({});
  });

  test('preserves valid fields while dropping invalid siblings', () => {
    expect(
      validateCollectionSearch({
        type: 'botanical',
        rarity: 'legendary',
        sort: 'rarity',
      }),
    ).toEqual({
      type: 'botanical',
      sort: 'rarity',
    });
  });
});
