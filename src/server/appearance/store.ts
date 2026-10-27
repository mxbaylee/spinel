import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AuthError } from '../auth/store.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { WorkspaceFiles } from '../workspace/files.ts';
import { resolveSpaceScope } from '../workspace/space-scope.ts';
import { validateDocumentCredentials } from '../workspace/document-access.ts';
import { readAppearance } from './data.ts';
import { UnsplashProvider } from './unsplash.ts';
import {
  validIdentityIcon,
  validColor,
  validGem,
  validImageBase64,
} from '../../shared/appearance.ts';
import type { CoverVariants, ItemAppearance, PageCover } from '../../shared/appearance.ts';
export type AppearanceActor = { userId: string; customData: Record<string, unknown> };
let decoding = 0;
const bad = (message = 'Check this appearance change and try again.') =>
  new AuthError(400, message);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad();
  return value as Record<string, unknown>;
};
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw bad();
}
export class AppearanceStore {
  readonly workspace: WorkspaceStore;
  readonly provider: UnsplashProvider;
  constructor(workspace: WorkspaceStore, provider = new UnsplashProvider()) {
    this.workspace = workspace;
    this.provider = provider;
  }
  authorize(actor: AppearanceActor, id: string, write = false) {
    const { userId, customData } = actor;
    validateDocumentCredentials(this.workspace, userId, customData, write);
    if (customData.spaceId !== undefined) {
      if (!this.workspace.spacesEnabled || customData.spaceItem !== id)
        throw new AuthError(404, 'This page is not available.');
      return resolveSpaceScope(
        this.workspace.auth,
        userId,
        String(customData.spaceId),
        id,
        write ? (customData.spaceId === id ? 'admin' : 'edit') : 'read',
      ).item;
    }
    if (userId.startsWith('guest:'))
      return this.workspace.get(userId, id, write ? 'admin' : 'read');
    return new WorkspaceFiles(this.workspace).get(userId, id, write ? 'admin' : 'read');
  }
  get(actor: AppearanceActor, id: string) {
    this.authorize(actor, id);
    let canEdit = false;
    try {
      this.authorize(actor, id, true);
      canEdit = true;
    } catch (error) {
      if (!(error instanceof AuthError) || error.status !== 403) throw error;
    }
    return { appearance: readAppearance(this.workspace.auth.database, id), canEdit };
  }
  asset(actor: AppearanceActor, id: string, hash: string) {
    this.authorize(actor, id);
    const cover = readAppearance(this.workspace.auth.database, id).cover;
    if (cover?.source !== 'upload' || !Object.values(cover.images).includes(hash))
      throw new AuthError(404, 'This cover is not available.');
    const row = this.workspace.auth.database
      .prepare('SELECT data FROM cover_assets WHERE item_id=? AND id=?')
      .get(id, hash);
    if (!row) throw new AuthError(404, 'This cover is not available.');
    return Buffer.from(row.data as Uint8Array);
  }
  async search(actor: AppearanceActor, id: string, query: string) {
    this.authorize(actor, id, true);
    const result = await this.provider.search(query);
    this.authorize(actor, id, true);
    return result;
  }
  async update(actor: AppearanceActor, id: string, input: unknown) {
    const item = this.authorize(actor, id, true),
      body = object(input);
    keys(body, ['revision', 'icon', 'iconColor', 'accent', 'cover']);
    if (!Number.isSafeInteger(body.revision) || Object.keys(body).length < 2) throw bad();
    const previous = readAppearance(this.workspace.auth.database, id);
    if (previous.revision !== body.revision)
      throw new AuthError(
        409,
        'Appearance changed elsewhere. Close and reopen appearance before saving.',
      );
    const next: ItemAppearance = { ...previous, revision: previous.revision + 1 };
    if (Object.hasOwn(body, 'icon')) {
      if (body.icon !== null && !validIdentityIcon(body.icon))
        throw bad('Choose an icon or one emoji.');
      next.icon = body.icon as string | null;
    }
    if (Object.hasOwn(body, 'iconColor')) {
      if (body.iconColor !== null && !validColor(body.iconColor))
        throw bad('Choose an icon color.');
      next.iconColor = body.iconColor as string | null;
    }
    if (Object.hasOwn(body, 'accent')) {
      if (item.kind !== 'space' || (body.accent !== null && !validGem(body.accent)))
        throw bad('Choose a Space accent.');
      next.accent = body.accent as ItemAppearance['accent'];
    }
    const assets = new Map<string, Buffer>();
    if (Object.hasOwn(body, 'cover')) {
      if (!['doc', 'sheet'].includes(item.kind)) throw bad('Covers belong to Docs and Sheets.');
      if (body.cover === null) next.cover = null;
      else {
        const cover = object(body.cover);
        if (cover.source === 'gem') {
          keys(cover, ['source', 'gem']);
          if (!validGem(cover.gem)) throw bad('Choose a gem.');
          next.cover = {
            source: 'gem',
            gem: cover.gem,
          };
        } else if (cover.source === 'upload' || cover.source === 'unsplash') {
          keys(cover, ['source', 'images', 'position']);
          if (
            typeof cover.position !== 'number' ||
            !Number.isFinite(cover.position) ||
            cover.position < 0 ||
            cover.position > 100
          )
            throw bad();
          const images = object(cover.images),
            names = Object.keys(images);
          if (
            !(names.length === 1 && names[0] === 'shared') &&
            !(names.length === 2 && names.includes('light') && names.includes('dark'))
          )
            throw bad('Choose one shared image or a light and dark pair.');
          const prepared: Record<string, unknown> = {};
          for (const name of names) {
            if (cover.source === 'unsplash') {
              const value = images[name];
              // Retain an already authorized selection when only cropping or pairing changes.
              const existing =
                previous.cover?.source === 'unsplash'
                  ? Object.values(previous.cover.images).find((photo) => photo.id === value)
                  : undefined;
              prepared[name] = existing ?? (await this.provider.choose(value));
            } else if (typeof images[name] === 'string') {
              const hash = images[name] as string;
              const bytes = this.asset(actor, id, hash);
              assets.set(hash, bytes);
              prepared[name] = hash;
            } else {
              const file = object(images[name]);
              keys(file, ['data']);
              if (!validImageBase64(file.data, 8 * 1024 * 1024))
                throw bad('Choose a PNG, JPEG or WebP up to 8 MB.');
              const bytes = Buffer.from(file.data, 'base64');
              if (!bytes.length || bytes.length > 8 * 1024 * 1024)
                throw bad('Choose an image up to 8 MB.');
              if (decoding >= 2)
                throw new AuthError(429, 'Cover images are still uploading. Try again shortly.');
              let normalized: Buffer;
              decoding++;
              try {
                const decoder = sharp(bytes, { limitInputPixels: 16_000_000, animated: false });
                const metadata = await decoder.metadata();
                if (
                  !['png', 'jpeg', 'webp'].includes(metadata.format ?? '') ||
                  (metadata.pages ?? 1) > 1
                )
                  throw new Error();
                normalized = await decoder
                  .rotate()
                  .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
                  .webp({ quality: 90 })
                  .toBuffer();
              } catch {
                throw bad('Choose a still PNG, JPEG or WebP under 16 megapixels.');
              } finally {
                decoding--;
              }
              const hash = createHash('sha256').update(normalized).digest('hex');
              assets.set(hash, normalized);
              prepared[name] = hash;
            }
            this.authorize(actor, id, true);
          }
          next.cover = {
            source: cover.source,
            images: prepared as CoverVariants<string>,
            position: cover.position,
          } as PageCover;
        } else throw bad('Choose Gems, Upload or Unsplash.');
      }
    }
    return this.workspace.auth.transaction(() => {
      this.authorize(actor, id, true);
      const db = this.workspace.auth.database;
      if (readAppearance(db, id).revision !== body.revision)
        throw new AuthError(
          409,
          'Appearance changed elsewhere. Close and reopen appearance before saving.',
        );
      if (Object.hasOwn(body, 'cover')) {
        const bytes = [...assets.values()].reduce((total, data) => total + data.length, 0);
        const owner = this.workspace.fileOwner(id);
        const used = Number(
          db
            .prepare(
              'SELECT coalesce(sum(length(a.data)),0) AS bytes FROM cover_assets a JOIN workspace_items i ON i.id=a.item_id WHERE i.owner_id=? AND i.id<>?',
            )
            .get(owner, id)!.bytes,
        );
        const before = Number(
          db
            .prepare(
              'SELECT coalesce(sum(length(data)),0) AS bytes FROM cover_assets WHERE item_id=?',
            )
            .get(id)!.bytes,
        );
        if (bytes > 16 * 1024 * 1024 || (bytes > before && bytes + used > 100 * 1024 * 1024))
          throw new AuthError(
            413,
            'Cover storage is full. Remove an existing cover or choose a smaller image.',
          );
        db.prepare('DELETE FROM cover_assets WHERE item_id=?').run(id);
        for (const [hash, data] of assets)
          db.prepare('INSERT INTO cover_assets(item_id,id,data) VALUES(?,?,?)').run(id, hash, data);
      }
      db.prepare(
        'INSERT INTO item_appearance(item_id,revision,value) VALUES(?,?,?) ON CONFLICT(item_id) DO UPDATE SET revision=excluded.revision,value=excluded.value',
      ).run(id, next.revision, JSON.stringify(next));
      return this.get(actor, id);
    });
  }
}
