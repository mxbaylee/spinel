import { expect, test } from 'vitest';
import { icons } from 'lucide';
import { ICON_CATALOG, searchPersonIcons } from './person-icon-search.ts';
import { avatarProfile, defaultProfile, profileAvatar, validIcon } from './profile.ts';
import { iconNodes } from './iconNodes.ts';

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
