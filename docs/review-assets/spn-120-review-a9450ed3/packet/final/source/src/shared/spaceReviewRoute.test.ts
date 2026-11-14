import { expect, test } from 'vitest';
import { spaceReviewReturnPath, spaceReviewSignInPath } from './spaceReviewRoute.ts';

const space = '12345678-1234-4234-8234-123456789abc';
const item = 'abcdef12-abcd-4bcd-8bcd-abcdef123456';
const location = (href: string) => new URL(href, 'https://spinel.example');

test('Space index, selected page and Trash survive sign-in using only stable IDs', () => {
  for (const href of [
    '/spaces',
    '/spaces/' + space,
    '/spaces/' + space + '?item=' + item,
    '/spaces/' + space + '?trash=1',
    '/review/spaces',
    '/review/spaces/' + space,
    '/review/spaces/' + space + '?item=' + item,
    '/review/spaces/' + space + '?trash=1',
  ]) {
    const signIn = spaceReviewSignInPath(location(href));
    expect(signIn).toMatch(/^\/sign-in\?space=/);
    expect(spaceReviewReturnPath(location(signIn!))).toBe(
      href.replace('/review/spaces', '/spaces'),
    );
  }
  expect(spaceReviewSignInPath(location('/review/spaces/' + space.toUpperCase() + '/'))).toBe(
    '/sign-in?space=' + space,
  );
});

test('malformed, conflicting or external navigation cannot become a sign-in return', () => {
  for (const href of [
    '/sign-in?space=https://other.invalid',
    '/sign-in?space=//other.invalid',
    '/sign-in?space=../admin',
    '/sign-in?space=' + space + '&space=' + space,
    '/sign-in?space=' + space + '&item=',
    '/sign-in?space=' + space + '&item=' + item + '&item=' + item,
    '/sign-in?space=' + space + '&item=' + item + '&trash=1',
    '/sign-in?space=' + space + '&trash=0',
    '/sign-in?space=' + space + '&trash=1&trash=1',
    '/sign-in?space=index&item=' + item,
    '/sign-in?space=index&trash=1',
    '/sign-in?space=' + space + '&connect=' + item,
    '/sign-in?returnTo=/review/spaces/' + space,
    '/connect?space=' + space,
  ])
    expect(spaceReviewReturnPath(location(href))).toBeNull();
  for (const href of [
    '/',
    '/admin',
    '/share/' + item,
    '/review/spaces/not-an-id',
    '/review/spaces/' + space + '/children/' + item,
    '/review/spaces/' + space + '?item=' + item + '&trash=1',
    '/review/spaces?item=' + item,
  ])
    expect(spaceReviewSignInPath(location(href))).toBeNull();
  expect(
    spaceReviewReturnPath(location('/sign-in?space=' + space + '&returnTo=https://other.invalid')),
  ).toBe('/spaces/' + space);
});
