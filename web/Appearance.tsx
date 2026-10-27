import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import {
  appearancePath,
  coverVariant,
  emptyAppearance,
  filenameEmoji,
  gemNames,
  validIdentityIcon,
} from '../src/shared/appearance.ts';
import type {
  ItemAppearance,
  GemName,
  PageCover,
  UnsplashPhoto,
} from '../src/shared/appearance.ts';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { IconPicker } from './ProfileSettings.tsx';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { getTheme, watchTheme } from '../src/ui/theme.ts';
import { spaceAccentPalettes, fillPresets, palettes } from '../src/ui/palette.ts';
import { gemCoverSources } from '../src/ui/redesign/gemCovers.ts';
import './appearance.css';
export type AppearanceTarget = {
  id: string;
  name: string;
  kind: 'folder' | 'space' | 'doc' | 'sheet';
  spaceId?: string | null;
  guest?: boolean;
  appearance?: ItemAppearance;
};
export function ItemIcon({
  name,
  kind,
  appearance,
  size = 24,
}: {
  name: string;
  kind?: string;
  appearance?: ItemAppearance;
  size?: number;
}) {
  const icon = appearance?.icon ?? (kind === 'folder' ? 'lucide:folder' : filenameEmoji(name));
  return (
    <span
      className="item-icon"
      aria-hidden="true"
      style={{
        fontSize: size,
        color:
          kind === 'folder'
            ? appearance?.folderColor
              ? `var(--fill-${appearance.folderColor}-bg)`
              : undefined
            : undefined,
      }}
    >
      {icon.startsWith('lucide:') ? <ProfileIcon icon={icon} size={size} /> : icon}
    </span>
  );
}
export function IdentityChoice({
  name,
  kind,
  value,
  onChange,
  disabled = false,
}: {
  name: string;
  kind?: string;
  value: string | null;
  onChange(value: string | null): void;
  disabled?: boolean;
}) {
  const [picker, setPicker] = useState(false),
    [emoji, setEmoji] = useState('');
  return (
    <div className="identity-choice">
      <div className="identity-choice-current">
        <ItemIcon name={name} kind={kind} appearance={{ ...emptyAppearance(), icon: value }} />
        <span>{value ? 'Custom icon' : 'Automatic icon'}</span>
      </div>
      <Button type="button" disabled={disabled} onClick={() => setPicker(true)}>
        Choose icon
      </Button>
      <label>
        Emoji
        <input
          aria-label="Emoji"
          value={emoji}
          disabled={disabled}
          maxLength={32}
          placeholder="🌷"
          onChange={(event) => {
            const next = event.target.value;
            setEmoji(next);
            if (validIdentityIcon(next)) onChange(next);
          }}
        />
      </label>
      {emoji && !validIdentityIcon(emoji) && <span role="status">Enter one emoji.</span>}
      <Button
        type="button"
        disabled={disabled || value === null}
        onClick={() => {
          onChange(null);
          setEmoji('');
        }}
      >
        Reset icon
      </Button>
      {picker && (
        <IconPicker
          value={value ?? ''}
          close={() => setPicker(false)}
          choose={(next) => {
            onChange(next);
            setEmoji('');
            setPicker(false);
          }}
        />
      )}
    </div>
  );
}
type AppearanceResponse = { appearance: ItemAppearance; canEdit: boolean };
export async function appearanceRequest(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<AppearanceResponse> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal,
    ...(body === undefined
      ? {}
      : {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(value.error ?? 'Could not load appearance.'), {
      status: response.status,
    });
  return value;
}
export function useAppearance(target: AppearanceTarget | undefined, disabled = false) {
  const path = target ? appearancePath(target.id, target.spaceId ?? undefined, target.guest) : '';
  const [state, setState] = useState<AppearanceResponse>({
    appearance: target?.appearance ?? emptyAppearance(),
    canEdit: false,
  });
  const [error, setError] = useState('');
  const epoch = useRef(0),
    serial = useRef(0);
  useEffect(() => {
    const generation = ++epoch.current;
    setState({ appearance: target?.appearance ?? emptyAppearance(), canEdit: false });
    setError('');
    if (!path || disabled) return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      const order = ++serial.current;
      try {
        const result = await appearanceRequest(path, undefined, controller.signal);
        if (epoch.current === generation && serial.current === order) {
          setState(result);
          setError('');
        }
      } catch (cause) {
        if (controller.signal.aborted || epoch.current !== generation || serial.current !== order)
          return;
        if ([401, 403, 404].includes((cause as { status?: number }).status ?? 0))
          setState({ appearance: emptyAppearance(), canEdit: false });
        else setState((value) => ({ ...value, canEdit: false }));
        setError(cause instanceof Error ? cause.message : 'Reconnect to change appearance.');
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    window.addEventListener('focus', refresh);
    return () => {
      ++epoch.current;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
    // Scope identity, rather than projection object identity, owns this request lifetime.
  }, [path, disabled]);
  async function save(patch: Record<string, unknown>) {
    const generation = epoch.current;
    ++serial.current;
    const result = await appearanceRequest(path, { revision: state.appearance.revision, ...patch });
    if (generation !== epoch.current) throw new Error('This item is no longer open.');
    ++serial.current;
    setState(result);
    setError('');
    window.dispatchEvent(new Event('spinel-appearance-changed'));
  }
  return { ...state, error, save, path };
}
export function CoverArt({
  cover,
  path,
  offline = false,
  assets,
}: {
  cover: PageCover;
  path: string;
  offline?: boolean;
  assets?: Record<string, string>;
}) {
  const mode = useSyncExternalStore(watchTheme, getTheme);
  const photo = cover.source === 'unsplash' ? coverVariant(cover.images, mode) : undefined;
  const hash = cover.source === 'upload' ? coverVariant(cover.images, mode) : undefined;
  if (offline && photo)
    return <div className="appearance-offline-cover">Connect to view the Unsplash cover.</div>;
  const src =
    cover.source === 'gem'
      ? gemCoverSources[cover.gem][cover.mode ?? mode]
      : (photo?.url ?? assets?.[hash!] ?? `${path}/assets/${hash}`);
  return (
    <>
      <img
        className="appearance-cover-art"
        src={src}
        alt=""
        style={{
          objectPosition: cover.source === 'gem' ? 'left center' : `50% ${cover.position}%`,
        }}
      />
      {photo && (
        <p className="appearance-credit">
          Photo by{' '}
          <a href={photo.profile} target="_blank" rel="noreferrer">
            {photo.photographer}
          </a>{' '}
          on{' '}
          <a
            href="https://unsplash.com/?utm_source=spinel&utm_medium=referral"
            target="_blank"
            rel="noreferrer"
          >
            Unsplash
          </a>
        </p>
      )}
    </>
  );
}
export function AppearanceDialog({
  target,
  value,
  path,
  save,
  close,
}: {
  target: AppearanceTarget;
  value: ItemAppearance;
  path: string;
  save(patch: Record<string, unknown>): Promise<void>;
  close(): void;
}) {
  const [icon, setIcon] = useState(value.icon),
    [color, setColor] = useState(value.folderColor),
    [accent, setAccent] = useState(value.accent);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [cover, setCover] = useState(false);
  const [draftRevision, setDraftRevision] = useState(value.revision);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await save({
        revision: draftRevision,
        icon,
        ...(target.kind === 'folder' ? { folderColor: color } : {}),
        ...(target.kind === 'space' ? { accent } : {}),
      });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save appearance.');
    } finally {
      setBusy(false);
    }
  }
  if (cover)
    return (
      <CoverDialog
        initial={value.cover}
        path={path}
        save={async (patch) => {
          await save({ ...patch, revision: draftRevision });
          setDraftRevision((current) => current + 1);
        }}
        close={() => setCover(false)}
      />
    );
  return (
    <Modal
      title={`Appearance · ${target.name}`}
      icon="palette"
      open
      dismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <div className="appearance-settings">
        <IdentityChoice
          name={target.name}
          kind={target.kind}
          value={icon}
          onChange={setIcon}
          disabled={busy}
        />
        {target.kind === 'folder' && (
          <>
            <div role="group" aria-label="Folder color" className="appearance-colors">
              {fillPresets.map((preset) => (
                <button
                  key={preset.id}
                  aria-label={preset.label}
                  aria-pressed={color === preset.id}
                  disabled={busy}
                  style={{
                    background: `var(--fill-${preset.id}-bg)`,
                    color: `var(--fill-${preset.id}-fg)`,
                  }}
                  onClick={() => setColor(preset.id)}
                >
                  {color === preset.id ? '✓' : ''}
                </button>
              ))}
            </div>
            <Button disabled={busy} onClick={() => setColor(null)}>
              Reset color
            </Button>
          </>
        )}
        {target.kind === 'space' && (
          <label>
            Space accent
            <select
              value={accent ?? 'spinel'}
              disabled={busy}
              onChange={(event) =>
                setAccent(event.target.value === 'spinel' ? null : (event.target.value as GemName))
              }
            >
              {gemNames.map((gem) => (
                <option key={gem} value={gem}>
                  {spaceAccentPalettes[gem].label}
                </option>
              ))}
            </select>
          </label>
        )}
        {['doc', 'sheet'].includes(target.kind) && (
          <Button disabled={busy} onClick={() => setCover(true)}>
            Change cover
          </Button>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="sp-actions">
          <Button disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button primary disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Save appearance'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
type UploadImage = string | { data: string };
export function CoverDialog({
  initial,
  path,
  save,
  close,
}: {
  initial: PageCover | null;
  path: string;
  save(patch: Record<string, unknown>): Promise<void>;
  close(): void;
}) {
  const mode = useSyncExternalStore(watchTheme, getTheme);
  const [source, setSource] = useState<'gem' | 'upload' | 'unsplash'>(initial?.source ?? 'gem');
  const [gem, setGem] = useState<GemName>(initial?.source === 'gem' ? initial.gem : 'spinel');
  const [gemMode, setGemMode] = useState<'auto' | 'light' | 'dark'>(
    initial?.source === 'gem' ? (initial.mode ?? 'auto') : 'auto',
  );
  const [paired, setPaired] = useState(initial?.source !== 'gem' && !!initial?.images.light);
  const [variant, setVariant] = useState<'light' | 'dark'>(mode);
  const [uploads, setUploads] = useState<Partial<Record<string, UploadImage>>>(
    initial?.source === 'upload' ? initial.images : {},
  );
  const [photos, setPhotos] = useState<Partial<Record<string, UnsplashPhoto>>>(
    initial?.source === 'unsplash' ? initial.images : {},
  );
  const [position, setPosition] = useState(
    initial && initial.source !== 'gem' ? initial.position : 50,
  );
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<UnsplashPhoto[]>([]),
    [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const active = useRef(true),
    searchOrder = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      ++searchOrder.current;
    };
  }, []);
  const key = paired ? variant : 'shared';
  const values = source === 'upload' ? uploads : photos;
  const ready = source === 'gem' || (paired ? !!values.light && !!values.dark : !!values.shared);
  const upload = uploads[key];
  const preview =
    source === 'gem'
      ? gemCoverSources[gem][gemMode === 'auto' ? mode : gemMode]
      : source === 'unsplash'
        ? photos[key]?.url
        : typeof upload === 'string'
          ? `${path}/assets/${upload}`
          : upload
            ? `data:image/webp;base64,${upload.data}`
            : undefined;
  async function chooseUpload(file: File | undefined) {
    if (!file) return;
    setError('');
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    ) {
      setError('Choose a PNG, JPEG or WebP up to 8 MB.');
      return;
    }
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read this image.'));
        reader.readAsDataURL(file);
      });
      if (active.current) setUploads((current) => ({ ...current, [key]: { data } }));
    } catch {
      if (active.current) setError('Could not read this image.');
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function search(event: React.FormEvent) {
    event.preventDefault();
    const order = ++searchOrder.current;
    setSearching(true);
    setError('');
    try {
      const response = await fetch(`${path}/unsplash?q=${encodeURIComponent(query)}`, {
        cache: 'no-store',
        redirect: 'error',
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Could not search Unsplash.');
      if (active.current && order === searchOrder.current) {
        setResults(value.photos);
        setSearched(true);
      }
    } catch (cause) {
      if (active.current && order === searchOrder.current)
        setError(cause instanceof Error ? cause.message : 'Could not search Unsplash.');
    } finally {
      if (active.current && order === searchOrder.current) setSearching(false);
    }
  }
  async function commit(remove = false) {
    setBusy(true);
    setError('');
    try {
      const selected = paired
        ? { light: values.light, dark: values.dark }
        : { shared: values.shared };
      await save({
        cover: remove
          ? null
          : source === 'gem'
            ? { source, gem, ...(gemMode === 'auto' ? {} : { mode: gemMode }) }
            : {
                source,
                position,
                images:
                  source === 'unsplash'
                    ? Object.fromEntries(
                        Object.entries(selected).map(([name, photo]) => [
                          name,
                          (photo as UnsplashPhoto).id,
                        ]),
                      )
                    : selected,
              },
      });
      if (active.current) close();
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : 'Could not save cover.');
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <Modal
      title="Page cover"
      icon="palette"
      open
      dismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <div className="appearance-cover-picker">
        <div className="appearance-cover-preview">
          {preview ? (
            <img
              src={preview}
              alt="Cover preview"
              style={{ objectPosition: source === 'gem' ? 'left center' : `50% ${position}%` }}
            />
          ) : (
            <span>Choose a cover</span>
          )}
        </div>
        <div className="appearance-source-buttons" role="group" aria-label="Cover source">
          {(['gem', 'upload', 'unsplash'] as const).map((value) => (
            <Button
              key={value}
              disabled={busy}
              aria-pressed={source === value}
              onClick={() => {
                setSource(value);
                setError('');
              }}
            >
              {value === 'gem' ? 'Gems' : value === 'upload' ? 'Upload' : 'Unsplash'}
            </Button>
          ))}
        </div>
        <div className="appearance-cover-options">
          {source === 'gem' ? (
            <>
              <label>
                Gem artwork
                <select
                  value={gemMode}
                  disabled={busy}
                  onChange={(event) => setGemMode(event.target.value as 'auto' | 'light' | 'dark')}
                >
                  <option value="auto">Match light and dark mode</option>
                  <option value="light">Light artwork in both modes</option>
                  <option value="dark">Dark artwork in both modes</option>
                </select>
              </label>
              <div className="appearance-gem-grid">
                {gemNames.map((value) => (
                  <button
                    key={value}
                    disabled={busy}
                    aria-pressed={gem === value}
                    onClick={() => setGem(value)}
                  >
                    <img src={gemCoverSources[value][gemMode === 'auto' ? mode : gemMode]} alt="" />
                    <span>{spaceAccentPalettes[value].label}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={paired}
                  disabled={busy}
                  onChange={(event) => setPaired(event.target.checked)}
                />
                Separate light and dark images
              </label>
              {paired && (
                <label>
                  Image for
                  <select
                    value={variant}
                    disabled={busy}
                    onChange={(event) => setVariant(event.target.value as 'light' | 'dark')}
                  >
                    <option value="light">Light mode</option>
                    <option value="dark">Dark mode</option>
                  </select>
                </label>
              )}
              {source === 'upload' ? (
                <label>
                  Upload {paired ? variant : 'cover'} image
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={(event) => void chooseUpload(event.target.files?.[0])}
                  />
                  <small>Still PNG, JPEG or WebP · up to 8 MB and 16 megapixels.</small>
                </label>
              ) : (
                <>
                  <form onSubmit={(event) => void search(event)} className="appearance-search">
                    <label>
                      Search Unsplash
                      <input
                        value={query}
                        maxLength={100}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <Button type="submit" disabled={busy || searching || !query.trim()}>
                      {searching ? 'Searching…' : 'Search'}
                    </Button>
                  </form>
                  <p role="status">
                    {searched
                      ? results.length
                        ? `${results.length} photos`
                        : 'No photos found. Try another search.'
                      : 'Search for a photo to use as your cover.'}
                  </p>
                  <div className="appearance-photo-grid">
                    {results.map((photo) => (
                      <div key={photo.id}>
                        <button
                          disabled={busy}
                          aria-label={`Select photo by ${photo.photographer}`}
                          aria-pressed={photos[key]?.id === photo.id}
                          onClick={() => setPhotos((current) => ({ ...current, [key]: photo }))}
                        >
                          <img src={photo.url} alt="" />
                        </button>
                        <small>
                          <a href={photo.profile} target="_blank" rel="noreferrer">
                            {photo.photographer}
                          </a>{' '}
                          on{' '}
                          <a
                            href="https://unsplash.com/?utm_source=spinel&utm_medium=referral"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Unsplash
                          </a>
                        </small>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="appearance-cover-position">
          {source !== 'gem' && (
            <label>
              Vertical position
              <input
                type="range"
                min="0"
                max="100"
                value={position}
                disabled={busy}
                onChange={(event) => setPosition(Number(event.target.value))}
              />
            </label>
          )}
        </div>
        <div className="appearance-cover-footer">
          {error && <p role="alert">{error}</p>}
          <div className="sp-actions">
            <Button disabled={busy} onClick={() => void commit(true)}>
              Remove cover
            </Button>
            <Button disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button primary disabled={busy || !ready} onClick={() => void commit()}>
              {busy ? 'Saving…' : 'Save cover'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
export function accentStyle(
  accent: GemName | null | undefined,
  mode: 'light' | 'dark',
): CSSProperties {
  const colors = spaceAccentPalettes[accent ?? 'spinel'][mode];
  return {
    '--sp-accent': colors.accent,
    '--sp-on-accent': colors.onAccent,
    '--sp-tint-1': colors.tint,
    '--sp-select': colors.tint,
    '--appearance-selection-bg': colors.accent,
    '--appearance-selection-fg': colors.onAccent,
  } as CSSProperties;
}
export function ConnectedAppearanceDialog({
  target,
  close,
}: {
  target: AppearanceTarget;
  close(): void;
}) {
  const state = useAppearance(target);
  return state.canEdit ? (
    <AppearanceDialog
      target={target}
      value={state.appearance}
      path={state.path}
      save={state.save}
      close={close}
    />
  ) : (
    <Modal
      title="Appearance"
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <p role="status">{state.error || 'Checking appearance access…'}</p>
      <Button onClick={close}>Close</Button>
    </Modal>
  );
}
export function useSpaceAccent(accent: GemName | null | undefined) {
  const mode = useSyncExternalStore(watchTheme, getTheme);
  useEffect(() => {
    const style = document.documentElement.style;
    const values = accentStyle(accent, mode);

    for (const [key, value] of Object.entries(values)) style.setProperty(key, String(value));
    return () => {
      for (const key of Object.keys(values)) {
        const value = palettes[getTheme()][key.slice(2)];
        if (value) style.setProperty(key, value);
        else style.removeProperty(key);
      }
    };
  }, [accent, mode]);
  return Object.fromEntries(
    Object.entries(palettes[mode]).map(([key, value]) => [`--${key}`, value]),
  ) as CSSProperties;
}
export function useOfflineAppearance(
  accountId: string | undefined,
  target: AppearanceTarget | undefined,
) {
  const [value, setValue] = useState<{
    appearance: ItemAppearance;
    assets: Record<string, string>;
  } | null>(null);
  useEffect(() => {
    setValue(null);
    if (!accountId || !target) return;
    let active = true;
    void import('./offline/offlineStore.ts')
      .then(async ({ openOfflineStore, preparedAccount }) => {
        if (preparedAccount() !== accountId) return;
        const store = await openOfflineStore(accountId);
        const saved = await store.bundle(target.id).finally(() => store.close());
        if (
          !active ||
          !saved ||
          saved.bundle.spaceId !== (target.spaceId ?? undefined) ||
          preparedAccount() !== accountId
        )
          return;
        const { verifyCoverAssets } = await import('./offline/download.ts');
        await verifyCoverAssets(saved.bundle);
        if (active && preparedAccount() === accountId)
          setValue({
            appearance: saved.bundle.appearance ?? emptyAppearance(),
            assets: Object.fromEntries(
              Object.entries(saved.bundle.coverAssets ?? {}).map(([hash, data]) => [
                hash,
                `data:image/webp;base64,${data}`,
              ]),
            ),
          });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [accountId, target?.id, target?.spaceId]);
  return value;
}
