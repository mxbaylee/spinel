import { expect, test } from 'vitest';
import { icons } from 'lucide';
import { EMOJI_CATALOG, ICON_CATALOG, searchPersonIcons } from './person-icon-search.ts';
import { validIdentityIcon } from '../shared/appearance.ts';
import { avatarProfile, defaultProfile, profileAvatar, validIcon } from './profile.ts';
import { iconNodes } from './iconNodes.ts';

const renamedIcons = [
  ['album', 'square-bookmark'],
  ['book-marked', 'book-bookmark'],
  ['building-2', 'building-complex'],
  ['music', 'eighth-notes'],
  ['music-2', 'eighth-note'],
  ['music-3', 'half-note'],
  ['music-4', 'sixteenth-notes'],
] as const;

test('item identity search combines icons and emoji names, keywords, typos and pasted sequences', () => {
  const flower = searchPersonIcons('flower', 'All', true).map((choice) => choice.value);
  expect(flower).toContain('lucide:flower');
  expect(flower).toContain('🌻');
  expect(searchPersonIcons('flowre', 'All', true).some((choice) => choice.value === '🌻')).toBe(
    true,
  );
  expect(
    searchPersonIcons('book', 'Emojis', true).every(
      (choice) => !choice.value.startsWith('lucide:'),
    ),
  ).toBe(true);
  for (const emoji of ['🌻', '👩🏽‍💻', '🇨🇦', '1️⃣']) {
    expect(searchPersonIcons(emoji, 'All', true).map((choice) => choice.value)).toEqual([emoji]);
    expect(validIdentityIcon(emoji)).toBe(true);
  }
  expect(searchPersonIcons('🌻🌷', 'All', true)).toEqual([]);
  expect(searchPersonIcons('zzzzzzzzzzzz', 'All', true)).toEqual([]);
  expect(new Set(EMOJI_CATALOG.map((choice) => choice.value)).size).toBe(EMOJI_CATALOG.length);
  expect(EMOJI_CATALOG.every((choice) => validIdentityIcon(choice.value))).toBe(true);
  // Profile avatar URLs still require Lucide; item emoji support is explicitly enabled.
  expect(searchPersonIcons('flower').every((choice) => choice.value.startsWith('lucide:'))).toBe(
    true,
  );
});

test('catalog names resolve to the pinned Lucide pack without falling back', () => {
  const catalogNames = ICON_CATALOG.map((icon) =>
    icon.name
      .split('-')
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(''),
  );
  expect(new Set(catalogNames)).toEqual(new Set(Object.keys(icons)));
  for (const choice of ICON_CATALOG) {
    expect(validIcon(choice.value)).toBe(true);
    expect(iconNodes(choice.value).length).toBeGreaterThan(0);
  }
});
test.each(renamedIcons)('saved %s remains compatible with %s', (legacy, canonical) => {
  for (const name of [legacy, canonical]) {
    const profile = { icon: `lucide:${name}`, color: defaultProfile('Bee').color };
    expect(validIcon(profile.icon)).toBe(true);
    // A saved name survives the public avatar URL round trip without normalization.
    expect(avatarProfile(profileAvatar(profile))).toEqual(profile);
  }
  expect(iconNodes(`lucide:${legacy}`)).toEqual(iconNodes(`lucide:${canonical}`));
});
test.each([
  ['alarm-check', 'alarm-clock-check'],
  ['alarm-minus', 'alarm-clock-minus'],
  ['alarm-plus', 'alarm-clock-plus'],
  ...renamedIcons,
] as const)('browse and search show %s / %s once', (legacy, canonical) => {
  const choice = ICON_CATALOG.find((icon) => icon.name === canonical)!;
  expect(choice.categories.length).toBeGreaterThan(0);
  for (const category of ['All', ...choice.categories]) {
    const matches = searchPersonIcons('', category).filter(
      (icon) => icon.name === legacy || icon.name === canonical,
    );
    expect(matches.map((icon) => icon.name)).toEqual([canonical]);
  }
  for (const query of [legacy, canonical]) {
    const matches = searchPersonIcons(query).filter(
      (icon) => icon.name === legacy || icon.name === canonical,
    );
    expect(matches).toEqual([expect.objectContaining({ canonicalName: canonical })]);
  }
});
test('album keeps all local synonyms after its canonical rename', () => {
  const tags = ['photo album', 'scrapbook', 'gallery', 'music collection', 'record', 'vinyl'];
  for (const name of ['album', 'square-bookmark']) {
    expect(ICON_CATALOG.find((icon) => icon.name === name)?.tags).toEqual(
      expect.arrayContaining(tags),
    );
  }
  for (const query of tags) {
    expect(
      searchPersonIcons(query).filter((icon) => icon.canonicalName === 'square-bookmark'),
    ).toHaveLength(1);
  }
});
test.each([
  ['arrow-down-0-1', 'arrow-down-01'],
  ['arrow-down-1-0', 'arrow-down-10'],
  ['arrow-up-0-1', 'arrow-up-01'],
  ['arrow-up-1-0', 'arrow-up-10'],
])('both saved numeric spellings %s and %s remain valid', (separated, compact) => {
  // Each pair shares an export key, so the full-catalog export-set check cannot protect both.
  expect(validIcon(`lucide:${separated}`)).toBe(true);
  expect(validIcon(`lucide:${compact}`)).toBe(true);
  expect(iconNodes(`lucide:${separated}`)).toEqual(iconNodes(`lucide:${compact}`));
});
test('search ranks names, synonyms and typos and filters categories', () => {
  expect(searchPersonIcons('flower')[0].name).toBe('flower');
  expect(searchPersonIcons('lotus').some((icon) => icon.name === 'flower-2')).toBe(true);
  expect(searchPersonIcons('flowre').some((icon) => icon.name === 'flower')).toBe(true);
  expect(searchPersonIcons('doctor').some((icon) => icon.name === 'stethoscope')).toBe(true);
  expect(
    searchPersonIcons('', 'animals').every((icon) => icon.categories.includes('animals')),
  ).toBe(true);
  expect(searchPersonIcons('🌼')).toEqual([]);
  expect(searchPersonIcons('zzzzzzzzzzzzzzzzzz')).toEqual([]);
});
test('only catalog avatar paths decode, without user identity', () => {
  const profile = defaultProfile('Bee');
  expect(avatarProfile(profileAvatar(profile))).toEqual({
    icon: profile.icon,
    color: profile.color,
  });
  for (const path of [
    'https://attacker/avatar.svg',
    '/profile-avatar/not-real/info-strong.svg',
    '/profile-avatar/flower/not-a-color.svg',
  ])
    expect(avatarProfile(path)).toBeUndefined();
});
