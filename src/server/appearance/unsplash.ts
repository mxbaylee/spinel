import { AuthError } from '../auth/store.ts';
import type { UnsplashPhoto } from '../../shared/appearance.ts';
type ProviderPhoto = {
  id: string;
  urls: { regular: string };
  user: { name: string; links: { html: string } };
  links: { html: string; download_location: string };
};
let activeRequests = 0;
export class UnsplashProvider {
  constructor(
    privateKey: string | undefined = process.env.UNSPLASH_ACCESS_KEY,
    fetcher: typeof fetch = fetch,
  ) {
    this.key = privateKey;
    this.fetcher = fetcher;
  }
  private key: string | undefined;
  private fetcher: typeof fetch;
  private async request(path: string) {
    if (!this.key)
      throw new AuthError(503, 'Unsplash is not configured. Upload an image or choose a gem.');
    if (activeRequests >= 4) throw new AuthError(429, 'Unsplash is busy. Try again shortly.');
    activeRequests++;
    try {
      let response: Response;
      try {
        response = await this.fetcher('https://api.unsplash.com' + path, {
          headers: { Authorization: `Client-ID ${this.key}`, 'Accept-Version': 'v1' },
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new AuthError(502, 'Unsplash could not be reached. Try again.');
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new AuthError(502, 'Unsplash is unavailable. Try again later.');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > 1024 * 1024) throw new AuthError(502, 'Unsplash returned too much data.');
          chunks.push(chunk.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (error) {
        await reader.cancel().catch(() => {});
        if (error instanceof AuthError) throw error;
        throw new AuthError(502, 'Unsplash returned an invalid response.');
      } finally {
        reader.releaseLock();
      }
    } finally {
      activeRequests--;
    }
  }
  private project(photo: ProviderPhoto): UnsplashPhoto {
    try {
      if (
        !/^[\w-]{1,80}$/.test(photo.id) ||
        typeof photo.user.name !== 'string' ||
        photo.user.name.length > 200
      )
        throw new Error();
      const image = new URL(photo.urls.regular);
      if (
        image.protocol !== 'https:' ||
        image.hostname !== 'images.unsplash.com' ||
        image.username ||
        image.password
      )
        throw new Error();
      const link = (value: string) => {
        const url = new URL(value);
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'unsplash.com' ||
          url.username ||
          url.password
        )
          throw new Error();
        url.searchParams.set('utm_source', 'spinel');
        url.searchParams.set('utm_medium', 'referral');
        return url.href;
      };
      return {
        id: photo.id,
        url: image.href,
        photographer: photo.user.name,
        profile: link(photo.user.links.html),
        page: link(photo.links.html),
      };
    } catch {
      throw new AuthError(502, 'Unsplash returned an invalid photo.');
    }
  }
  async search(query: string) {
    if (!query.trim() || query.length > 100)
      throw new AuthError(400, 'Enter a search of 1–100 characters.');
    const result = await this.request(
      `/search/photos?per_page=12&query=${encodeURIComponent(query.trim())}`,
    );
    if (!Array.isArray(result.results) || result.results.length > 12)
      throw new AuthError(502, 'Unsplash returned invalid search results.');
    return result.results.map((photo: ProviderPhoto) => this.project(photo));
  }
  async choose(id: unknown) {
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id))
      throw new AuthError(400, 'Choose an Unsplash photo.');
    const raw = (await this.request(`/photos/${encodeURIComponent(id)}`)) as ProviderPhoto;
    const photo = this.project(raw);
    if (photo.id !== id) throw new AuthError(502, 'Unsplash returned a different photo.');
    // Use the supported download event, never a client-supplied URL or image proxy.
    let tracking: URL;
    try {
      tracking = new URL(raw.links.download_location);
    } catch {
      throw new AuthError(502, 'Unsplash returned an invalid download event.');
    }
    if (
      tracking.origin !== 'https://api.unsplash.com' ||
      tracking.pathname !== `/photos/${id}/download`
    )
      throw new AuthError(502, 'Unsplash returned an invalid download event.');
    await this.request(tracking.pathname + tracking.search);
    return photo;
  }
}
