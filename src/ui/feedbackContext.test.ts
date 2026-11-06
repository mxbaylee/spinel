import { describe, expect, it } from 'vitest';
import { feedbackPageContext } from '../../web/feedbackContext.ts';

const fileId = '11111111-1111-4111-8111-111111111111';
const spaceId = '22222222-2222-4222-8222-222222222222';
describe('intentional feedback page context', () => {
  it('sends only a route label and opaque authorized candidate IDs, never URLs, titles or tokens', () => {
    expect(
      feedbackPageContext(
        { pathname: '/', search: `?item=${fileId}&search=private%20contents&token=secret` },
        true,
      ),
    ).toEqual({ route: '/files/:id', fileId });
    expect(feedbackPageContext({ pathname: '/profile', search: '?token=secret' }, true)).toEqual({
      route: '/profile',
    });
  });
  it('does not attribute a folder or ambiguous query as the open document', () => {
    expect(feedbackPageContext({ pathname: '/', search: `?item=${fileId}` }, false)).toEqual({
      route: '/files',
    });
    expect(
      feedbackPageContext({ pathname: '/', search: `?item=${fileId}&item=${spaceId}` }, true),
    ).toEqual({ route: '/files' });
  });
  it('uses the actual selected Space page even when navigation selected it implicitly', () => {
    expect(
      feedbackPageContext({ pathname: `/spaces/${spaceId}`, search: '' }, true, {
        fileId,
        spaceId,
      }),
    ).toEqual({ route: '/spaces/:id', fileId, spaceId });
    expect(
      feedbackPageContext(
        { pathname: `/spaces/${spaceId}`, search: '?trash=1&name=private' },
        false,
      ),
    ).toEqual({ route: '/spaces/:id' });
  });
});
