import { expect, test, vi } from 'vitest';
import {
  DrawingTypeEnum,
  ImageSourceType,
  ImageUploadStatusType,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
} from '@univerjs/core';
import type { IDocClipboardHook } from '@univerjs/docs-ui';
import {
  createDocImageFeedback,
  DocImageError,
  docImageErrorMessage,
  imageUploadFailed,
  installDocImagePaste,
  uploadedImageSource,
  uploadDocImage,
} from '../../web/docImages.ts';

const itemId = 'test-document';
const hash = 'a'.repeat(64);
const url = `/api/items/${itemId}/images/${hash}`;
const file = new File(['fixture'], 'image.png', { type: 'image/png' });
const image = {
  imageId: hash,
  source: url,
  base64Cache: url,
  imageSourceType: ImageSourceType.URL,
  status: ImageUploadStatusType.SUCCUSS,
};
const response = () => Response.json({ id: hash, url }, { status: 201 });
const drawing = (source: string, id = 'image') => ({
  drawingId: id,
  unitId: 'native-unit',
  subUnitId: 'native-unit',
  drawingType: DrawingTypeEnum.DRAWING_IMAGE,
  imageSourceType: ImageSourceType.URL,
  source,
  layoutType: PositionedObjectLayoutType.INLINE,
  docTransform: {
    size: { width: 80, height: 60 },
    positionH: { relativeFrom: ObjectRelativeFromH.PAGE },
    positionV: { relativeFrom: ObjectRelativeFromV.PAGE },
    angle: 0,
  },
});

function uploadOptions() {
  const lifetime = new AbortController();
  const request = vi.fn(async () => response());
  const verifyRemote = vi.fn();
  const prepareImages = vi.fn(async () => {});
  const toVisible = vi.fn();
  const options: Parameters<typeof uploadDocImage>[1] = {
    itemId,
    path: `/api/guest-spaces/space/items/${itemId}`,
    request,
    signal: lifetime.signal,
    canEdit: () => true,
    offline: {
      enabled: true,
      online: true,
      verifyRemote,
      prepareImages,
      toVisible: <T>(value: T): T => {
        toVisible(value);
        return value;
      },
    },
  };
  return { options, lifetime, request, verifyRemote, prepareImages, toVisible };
}

test('stored upload retains request authority scope, canonical response and prepared-image admission', async () => {
  const f = uploadOptions();
  await expect(uploadDocImage(file, f.options)).resolves.toBe(url);
  expect(f.request).toHaveBeenCalledWith(`/api/guest-spaces/space/items/${itemId}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: file,
    signal: f.lifetime.signal,
  });
  expect(f.prepareImages).toHaveBeenCalledWith(url, f.lifetime.signal);
  expect(f.toVisible).toHaveBeenCalledWith(url);
});

test('a prepared online document retains its verified local blob mapping', async () => {
  const f = uploadOptions();
  const visible = 'blob:https://spinel.example/verified-image';
  f.options.offline!.toVisible = <T>(value: T): T => (value === url ? visible : value) as T;
  await expect(uploadDocImage(file, f.options)).resolves.toBe(visible);
  expect(f.prepareImages).toHaveBeenCalledWith(url, f.lifetime.signal);
});

test('prepared-offline refusal and unsupported or oversized images do not issue a POST', async () => {
  const f = uploadOptions();
  f.options.offline!.online = false;
  await expect(uploadDocImage(file, f.options)).rejects.toThrow(
    'Connect before inserting a new image.',
  );
  f.options.offline!.online = true;
  await expect(
    uploadDocImage(new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }), f.options),
  ).rejects.toThrow('Choose a PNG, JPEG or WebP image.');
  await expect(
    uploadDocImage(
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
      f.options,
    ),
  ).rejects.toThrow('Choose an image no larger than 5 MiB.');
  expect(f.request).not.toHaveBeenCalled();
});

test.each(['response', 'body', 'prepared image'] as const)(
  'retired editor cannot admit an image after awaiting %s, even after a new grant',
  async (stage) => {
    const f = uploadOptions();
    const held = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    const wait = async () => {
      reached.resolve();
      await held.promise;
    };
    if (stage === 'response')
      f.request.mockImplementation(async () => {
        await wait();
        return response();
      });
    else if (stage === 'body') {
      const slow = response();
      vi.spyOn(slow, 'json').mockImplementation(async () => {
        await wait();
        return { id: hash, url };
      });
      f.request.mockResolvedValue(slow);
    } else f.prepareImages.mockImplementation(wait);
    const pending = uploadDocImage(file, f.options);
    const refused = expect(pending).rejects.toThrow();
    await reached.promise;
    f.options.canEdit = () => false;
    f.lifetime.abort();
    f.options.canEdit = () => true;
    held.resolve();
    await refused;
    expect(f.toVisible).not.toHaveBeenCalled();
  },
);

test('ended remote authentication refuses a late response before image admission', async () => {
  const f = uploadOptions();
  const held = Promise.withResolvers<Response>();
  f.request.mockReturnValue(held.promise);
  const pending = uploadDocImage(file, f.options);
  const refused = expect(pending).rejects.toThrow('ended');
  f.verifyRemote.mockImplementation(() => {
    throw new Error('ended');
  });
  held.resolve(response());
  await refused;
  expect(f.prepareImages).not.toHaveBeenCalled();
  expect(f.toVisible).not.toHaveBeenCalled();
});

test.each([
  [401, 'Your sign-in ended. Sign in again to add an image.'],
  [403, 'Image not added. Check your edit access.'],
  [404, 'Image not added. Check your edit access.'],
] as const)(
  'HTTP %s reports a plain access message even with an unreadable body',
  async (status, message) => {
    await expect(
      uploadedImageSource(new Response('private upstream detail', { status }), itemId),
    ).rejects.toThrow(message);
  },
);

test('only the known image-limit messages are displayed; transport and parser errors stay private', async () => {
  const message = 'This document has reached its 50 MiB image limit.';
  await expect(
    uploadedImageSource(Response.json({ error: message }, { status: 413 }), itemId),
  ).rejects.toThrow('Doc image limit reached. Try a smaller image.');
  for (const result of [
    new Response('<html>private proxy detail</html>', { status: 503 }),
    Response.json({ error: 'private backend detail' }, { status: 500 }),
    Response.json(null, { status: 201 }),
  ])
    await expect(uploadedImageSource(result, itemId)).rejects.toThrow(imageUploadFailed);
  for (const error of [
    new TypeError('Failed to fetch'),
    new DOMException('timeout'),
    new SyntaxError('JSON detail'),
  ])
    expect(docImageErrorMessage(error)).toBe(imageUploadFailed);
  expect(docImageErrorMessage(new DocImageError(message))).toBe(message);
});

test('successful response must name this document and the exact stored hash', async () => {
  for (const invalid of [
    { id: hash, url: `https://spinel.example${url}` },
    { id: hash, url: `/api/items/another/images/${hash}` },
    { id: 'b'.repeat(64), url },
    { id: hash, url: `${url}?private=1` },
    { id: hash, url: 'data:image/png;base64,AAAA' },
  ])
    await expect(
      uploadedImageSource(Response.json(invalid, { status: 201 }), itemId),
    ).rejects.toThrow(imageUploadFailed);
});

function clipboardFixture() {
  let hook!: IDocClipboardHook;
  const removed = vi.fn();
  const messages: string[] = [];
  const failed = vi.fn();
  const clipboard: Parameters<typeof installDocImagePaste>[0] = {
    legacyPaste: vi.fn(async () => true),
    changePasteMode: vi.fn(async () => true),
    dismissPasteOptions: vi.fn(),
    addClipboardHook: (value) => {
      hook = value;
      return { dispose: removed };
    },
  };
  const options = {
    unitId: 'native-unit',
    itemId,
    origin: 'https://spinel.example',
    canEdit: () => true,
    toCanonical: (source: string) => source,
    saveImage: vi.fn(async () => image),
    busy: vi.fn(),
    failed,
    beginFeedback: createDocImageFeedback(
      (message) => {
        messages.push(message);
        if (message) failed(message);
      },
      (): boolean => options.canEdit(),
    ),
  };
  return { clipboard, options, removed, messages, hook: () => hook };
}

test.each(['legacyPaste', 'changePasteMode'] as const)(
  '%s owns busy protection beyond upload until the delegated native operation settles',
  async (method) => {
    const f = clipboardFixture();
    const dimensions = Promise.withResolvers<void>();
    const uploaded = Promise.withResolvers<void>();
    const native = vi.fn(async () => {
      await f.hook().onBeforePasteImage!(file);
      uploaded.resolve();
      await dimensions.promise;
      return true;
    });
    f.clipboard[method] = native;
    const installed = installDocImagePaste(f.clipboard, f.options);
    const pending =
      method === 'legacyPaste'
        ? f.clipboard.legacyPaste({ files: [file] })
        : f.clipboard.changePasteMode('source');
    await uploaded.promise;
    expect(f.options.busy.mock.calls).toEqual([[true]]);
    dimensions.resolve();
    await expect(pending).resolves.toBe(true);
    expect(f.options.busy.mock.calls).toEqual([[true], [false]]);
    expect(f.options.failed).not.toHaveBeenCalled();
    installed.dispose();
  },
);

test('concurrent text paste cannot end image protection or turn native cancellation into an upload error', async () => {
  const f = clipboardFixture();
  const imageDone = Promise.withResolvers<boolean>();
  f.clipboard.legacyPaste = async (payload) => {
    if (payload.files.length) {
      await f.hook().onBeforePasteImage!(file);
      return imageDone.promise;
    }
    return false;
  };
  const installed = installDocImagePaste(f.clipboard, f.options);
  const pending = f.clipboard.legacyPaste({ files: [file] });
  await expect(f.clipboard.legacyPaste({ files: [], text: 'ordinary text' })).resolves.toBe(false);
  expect(f.options.busy.mock.calls).toEqual([[true]]);
  imageDone.resolve(false);
  await expect(pending).resolves.toBe(false);
  expect(f.options.busy.mock.calls).toEqual([[true], [false]]);
  expect(f.options.failed).not.toHaveBeenCalled();
  installed.dispose();
});

test('ordinary text paste keeps its native result without image work or busy feedback', async () => {
  const f = clipboardFixture();
  const native = f.clipboard.legacyPaste;
  const installed = installDocImagePaste(f.clipboard, f.options);
  const payload = { files: [], text: 'ordinary text' };
  await expect(f.clipboard.legacyPaste(payload)).resolves.toBe(true);
  expect(native).toHaveBeenCalledWith(payload);
  expect(f.options.saveImage).not.toHaveBeenCalled();
  expect(f.options.busy).not.toHaveBeenCalled();
  installed.dispose();
});

test('view-only paste never delegates to native preparation', async () => {
  const f = clipboardFixture();
  f.options.canEdit = () => false;
  const native = f.clipboard.legacyPaste;
  const installed = installDocImagePaste(f.clipboard, f.options);
  await expect(f.clipboard.legacyPaste({ files: [file] })).resolves.toBe(false);
  expect(native).not.toHaveBeenCalled();
  expect(f.options.saveImage).not.toHaveBeenCalled();
  installed.dispose();
});

test.each(['freeze', 'dispose'] as const)(
  '%s retires pending preparation and cannot revive it',
  async (action) => {
    const f = clipboardFixture();
    const held = Promise.withResolvers<typeof image>();
    f.options.saveImage.mockReturnValue(held.promise);
    const native = vi.fn(async () => {
      await f.hook().onBeforePasteImage!(file);
      return true;
    });
    f.clipboard.legacyPaste = native;
    const installed = installDocImagePaste(f.clipboard, f.options);
    const pending = f.clipboard.legacyPaste({ files: [file] });
    const refused = expect(pending).rejects.toThrow('cancelled');
    f.options.canEdit = () => false;
    if (action === 'dispose') installed.dispose();
    else installed.cancel();
    expect(f.clipboard.dismissPasteOptions).toHaveBeenCalledOnce();
    f.options.canEdit = () => true;
    held.resolve(image);
    await refused;
    expect(f.options.busy.mock.calls).toEqual([[true], [false]]);
    expect(f.options.failed).not.toHaveBeenCalled();
    installed.dispose();
    expect(f.clipboard.legacyPaste).toBe(native);
    expect(f.removed).toHaveBeenCalledOnce();
  },
);

test('failed image preparation rejects the HTML hook instead of retaining inline base64', async () => {
  const f = clipboardFixture();
  f.options.saveImage.mockRejectedValue(new Error('storage refused'));
  f.clipboard.legacyPaste = async () => {
    await f.hook().onBeforePasteImage!(file);
    throw new Error('Must not reach insertion');
  };
  const installed = installDocImagePaste(f.clipboard, f.options);
  await expect(
    f.clipboard.legacyPaste({ files: [], html: '<img src="data:image/png;base64,AAAA">' }),
  ).rejects.toThrow('storage refused');
  expect(f.options.failed).toHaveBeenCalledOnce();
  expect(f.options.busy.mock.calls).toEqual([[true], [false]]);
  installed.dispose();
});

function pasteWithUnsupportedSource(f: ReturnType<typeof clipboardFixture>) {
  const data = {
    body: { dataStream: '\b\r' },
    drawings: { image: drawing(`https://spinel.example/api/items/other/images/${hash}`) },
  };
  f.clipboard.legacyPaste = async (payload) => {
    if (payload.files.length) await f.hook().onBeforePasteImage!(file);
    else f.hook().onBeforePaste!(data.body, { documentData: data, targetUnitId: 'native-unit' });
    return true;
  };
}

test('a later unsupported paste replaces the previous upload failure with its own explanation', async () => {
  const f = clipboardFixture();
  pasteWithUnsupportedSource(f);
  f.options.saveImage.mockRejectedValue(new DocImageError(imageUploadFailed));
  const installed = installDocImagePaste(f.clipboard, f.options);
  await expect(f.clipboard.legacyPaste({ files: [file] })).rejects.toThrow(imageUploadFailed);
  expect(f.messages.at(-1)).toBe(imageUploadFailed);
  await expect(f.clipboard.legacyPaste({ files: [], html: '<img>' })).rejects.toThrow(
    'This image cannot be pasted. Insert it from a file instead.',
  );
  expect(f.messages.at(-1)).toBe('This image cannot be pasted. Insert it from a file instead.');
  installed.dispose();
});

test.each(['clipboard', 'toolbar'] as const)(
  'an older upload failure cannot overwrite newer %s feedback',
  async (newer) => {
    const f = clipboardFixture();
    pasteWithUnsupportedSource(f);
    const held = Promise.withResolvers<typeof image>();
    f.options.saveImage.mockReturnValue(held.promise);
    const installed = installDocImagePaste(f.clipboard, f.options);
    const older = f.clipboard.legacyPaste({ files: [file] });
    const refused = expect(older).rejects.toThrow(imageUploadFailed);
    if (newer === 'clipboard')
      await expect(f.clipboard.legacyPaste({ files: [], html: '<img>' })).rejects.toThrow(
        'This image cannot be pasted. Insert it from a file instead.',
      );
    else {
      // The toolbar begins feedback once for the whole native insertion,
      // sharing this owner with clipboard actions, not its busy lifetime.
      const report = f.options.beginFeedback();
      report('Image not inserted. Place the cursor and try again.');
    }
    const current = f.messages.at(-1);
    expect(f.options.busy.mock.calls).toEqual([[true]]);
    held.reject(new DocImageError(imageUploadFailed));
    await refused;
    expect(f.messages.at(-1)).toBe(current);
    expect(f.options.failed).toHaveBeenCalledOnce();
    expect(f.options.busy.mock.calls).toEqual([[true], [false]]);
    installed.dispose();
  },
);

test('paste normalizes only scoped stored image fields and retains authored strings and offline blobs', () => {
  const f = clipboardFixture();
  const blob = 'blob:https://spinel.example/local-image';
  f.options.toCanonical = (source) => (source === blob ? url : source);
  const installed = installDocImagePaste(f.clipboard, f.options);
  const absolute = `${f.options.origin}${url}`;
  const sources = [absolute, url, blob];
  const data = {
    body: { dataStream: `${absolute}\r\n` },
    drawings: Object.fromEntries(
      sources.map((source, index) => [String(index), drawing(source, String(index))]),
    ),
    customData: { source: absolute },
    resources: [
      {
        name: 'DOC_DRAWING_PLUGIN',
        data: JSON.stringify({ data: { image: { source: absolute } } }),
      },
    ],
  };
  const context = { documentData: data, targetUnitId: 'native-unit' };
  f.hook().onBeforePaste!(data.body, context);
  expect(Object.values(data.drawings).map((drawing) => drawing.source)).toEqual([
    url,
    ...sources.slice(1),
  ]);
  expect(data.body.dataStream).toBe(`${absolute}\r\n`);
  expect(data.customData.source).toBe(absolute);
  expect(JSON.parse(data.resources[0].data).data.image.source).toBe(url);
  f.options.canEdit = () => false;
  expect(() => f.hook().onBeforePaste!(data.body, context)).toThrow('cancelled');
  installed.dispose();
});

test.each([
  `https://other.example${url}`,
  `https://spinel.example/api/items/other/images/${hash}`,
  `https://spinel.example${url}?extra=1`,
  `https://spinel.example${url}#extra`,
  'data:image/png;base64,AAAA',
  'blob:https://spinel.example/unverified-image',
])('unsupported clipboard image %s is refused before native mutation', async (source) => {
  const f = clipboardFixture();
  const data = { body: { dataStream: '\b\r\n' }, drawings: { image: drawing(source) } };
  const applied = vi.fn();
  f.clipboard.legacyPaste = async () => {
    f.hook().onBeforePaste!(data.body, { documentData: data, targetUnitId: 'native-unit' });
    applied();
    return true;
  };
  const installed = installDocImagePaste(f.clipboard, f.options);
  await expect(f.clipboard.legacyPaste({ files: [], html: '<img>' })).rejects.toThrow(
    'This image cannot be pasted. Insert it from a file instead.',
  );
  expect(applied).not.toHaveBeenCalled();
  expect(f.options.failed).toHaveBeenCalledWith(
    'This image cannot be pasted. Insert it from a file instead.',
  );
  installed.dispose();
});
