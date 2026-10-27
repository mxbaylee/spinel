/** Appearance exploration only. All choices and uploaded images stay in this story. */
import { lazy, Suspense, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { palettes, spaceAccentPalettes } from '../palette.ts';
import type { ThemeMode } from '../palette.ts';
import { getTheme, watchTheme } from '../theme.ts';
import { ProfileIcon } from '../../profile/ProfileIcon.tsx';
import { Button, Modal } from './Controls.tsx';
import { EditorMockup } from './Mockups.tsx';
import { LoadingReview } from './LoadingReview.tsx';
import type { NativeSnapshot } from './NativeEditors.tsx';
import coast from './assets/coast.jpg';
import { gemCoverSources, gems } from './gemCovers.ts';
import './appearanceReview.css';

const NativeEditor = lazy(() =>
  import('./NativeEditors.tsx').then((module) => ({ default: module.NativeEditor })),
);
type Accent = keyof typeof spaceAccentPalettes;
type Cover =
  | { type: 'gem'; color: Accent }
  | { type: 'photo'; src: string; name: string; position: number; credit?: boolean };
const accents = Object.keys(spaceAccentPalettes) as Accent[];
const samplePhoto: Cover = {
  type: 'photo',
  src: coast,
  name: 'Coastal cliffs',
  position: 54,
  credit: true,
};
const photographerSource = 'https://unsplash.com/@jkmatt?utm_source=spinel&utm_medium=referral';
const unsplashSource = 'https://unsplash.com/?utm_source=spinel&utm_medium=referral';

function PhotoCredit() {
  return (
    <p className="rd-cover-credit">
      Photo by{' '}
      <a href={photographerSource} target="_blank" rel="noreferrer">
        Jon Matthews
      </a>{' '}
      on{' '}
      <a href={unsplashSource} target="_blank" rel="noreferrer">
        Unsplash
      </a>
    </p>
  );
}

function GemCover({ color, mode }: { color: Accent; mode?: ThemeMode }) {
  const activeMode = useSyncExternalStore(watchTheme, getTheme);
  const variant = mode ?? activeMode;
  return (
    <img
      className="rd-gem-cover"
      src={gemCoverSources[color][variant]}
      data-gem={color}
      data-mode={variant}
      alt=""
    />
  );
}

export function GemCollection() {
  return (
    <div className="sp-ui rd-gem-collection" role="list" aria-label="Gem cover collection">
      {gems.map((gem) => (
        <div key={gem} role="listitem">
          <GemCover color={gem} />
          <h2>{spaceAccentPalettes[gem].label}</h2>
        </div>
      ))}
    </div>
  );
}

/** Both art variants are visible together, independent of the Storybook toolbar. */
export function GemPairs() {
  return (
    <div className="sp-ui rd-gem-pairs" role="list" aria-label="Gem banner pairs">
      {gems.map((gem) => (
        <section key={gem} role="listitem" data-gem-pair={gem}>
          <h2>{spaceAccentPalettes[gem].label}</h2>
          {(['light', 'dark'] as const).map((mode) => (
            <div
              key={mode}
              className="rd-gem-pair-mode"
              data-pair-mode={mode}
              style={
                {
                  '--sp-panel': palettes[mode]['sp-panel'],
                  '--sp-text': palettes[mode]['sp-text'],
                } as CSSProperties
              }
            >
              <h3>{mode === 'light' ? 'Light' : 'Dark'}</h3>
              <figure>
                <div className="rd-gem-pair-wide">
                  <GemCover color={gem} mode={mode} />
                </div>
                <figcaption>Wide · 144 px high</figcaption>
              </figure>
              <figure>
                <div className="rd-gem-pair-phone">
                  <GemCover color={gem} mode={mode} />
                </div>
                <figcaption>Phone · up to 390 px wide, 112 px high</figcaption>
              </figure>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function CoverArt({ cover }: { cover: Cover }) {
  return cover.type === 'gem' ? (
    <GemCover color={cover.color} />
  ) : (
    <img src={cover.src} alt="" style={{ objectPosition: `50% ${cover.position}%` }} />
  );
}

export function AppearanceReview({
  space = true,
  kind = 'doc',
  initialAccent = 'spinel',
  initialCover = 'gem',
  initialDialog,
  initialSource = 'Gems',
}: {
  space?: boolean;
  kind?: 'doc' | 'sheet';
  initialAccent?: Accent;
  initialCover?: 'gem' | 'photo' | 'none';
  initialDialog?: 'cover' | 'accent';
  initialSource?: 'Gems' | 'Upload' | 'Unsplash';
}) {
  const mode = useSyncExternalStore(watchTheme, getTheme);
  const [accent, setAccent] = useState(initialAccent);
  const title = space
    ? kind === 'sheet'
      ? 'Budget'
      : 'Overview'
    : kind === 'sheet'
      ? 'Quarterly budget'
      : 'A few good recipes';
  const [covers, setCovers] = useState<Record<string, Cover | null>>({
    [title]:
      initialCover === 'photo'
        ? samplePhoto
        : initialCover === 'none'
          ? null
          : { type: 'gem', color: initialAccent },
  });
  const [dialog, setDialog] = useState(initialDialog);
  const [page, setPage] = useState(title);
  const [source, setSource] = useState(initialSource);
  const [uploadError, setUploadError] = useState('');
  const [query, setQuery] = useState('');
  const snapshots = useRef(new Map<string, NativeSnapshot>());
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current!;
    const main = element.querySelector<HTMLElement>('.rd-main')!;
    const header = element.querySelector<HTMLElement>('.rd-editor-header')!;
    const resize = () =>
      element.style.setProperty(
        '--rd-editor-height',
        `${Math.max(280, main.clientHeight - header.offsetHeight)}px`,
      );
    const observer = new ResizeObserver(resize);
    observer.observe(main);
    observer.observe(header);
    resize();
    return () => observer.disconnect();
  }, []);
  const colors = spaceAccentPalettes[accent][mode];
  const accentStyle = {
    '--sp-accent': colors.accent,
    '--sp-on-accent': colors.onAccent,
    '--sp-tint-1': colors.tint,
    '--sp-select': colors.tint,
    '--rd-accent-ink': colors.ink,
  } as CSSProperties;
  // Native content and semantic colors retain the original theme.
  const editorStyle = Object.fromEntries(
    Object.entries(palettes[mode]).map(([key, value]) => [`--${key}`, value]),
  ) as CSSProperties;
  const cover = covers[page];
  const setCover = (next: Cover | null) => setCovers((current) => ({ ...current, [page]: next }));
  const upload = (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    ) {
      setUploadError('Choose a JPG, PNG or WebP image smaller than 8 MB.');
      return;
    }
    const targetPage = page;
    const reader = new FileReader();
    reader.onerror = () => setUploadError('Could not read that image. Choose another.');
    reader.onload = () => {
      const src = String(reader.result);
      const image = new Image();
      image.onerror = () => setUploadError('Could not open that image. Choose another.');
      image.onload = () =>
        setCovers((current) => ({
          ...current,
          [targetPage]: { type: 'photo', src, name: file.name, position: 50 },
        }));
      image.src = src;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className="sp-ui rd-appearance-review"
      ref={root}
      data-space={space}
      data-accent={accent}
      style={space ? accentStyle : undefined}
    >
      <EditorMockup
        navigationAppearance={space ? accentStyle : undefined}
        space={space}
        sheet={!space && kind === 'sheet'}
        title={title}
        initialPage={title}
        appearanceAction={
          space ? (
            <Button aria-label="Space appearance" onClick={() => setDialog('accent')}>
              <ProfileIcon icon="lucide:palette" size={18} />
            </Button>
          ) : undefined
        }
        beforeTitle={(name) => (
          <>
            <div
              className={`rd-page-cover ${covers[name] ? '' : 'rd-page-cover-empty'}`}
              data-cover={covers[name]?.type ?? 'none'}
            >
              {covers[name] && <CoverArt cover={covers[name]} />}
              <div className="rd-cover-actions">
                <Button
                  onClick={() => {
                    setPage(name);
                    setDialog('cover');
                  }}
                >
                  <ProfileIcon icon="lucide:image" size={16} />{' '}
                  {covers[name] ? 'Change cover' : 'Add cover'}
                </Button>
              </div>
              {covers[name]?.type === 'photo' && covers[name].credit && <PhotoCredit />}
            </div>
          </>
        )}
        editorContent={(name, pageKind) => (
          <div className="rd-appearance-native" style={editorStyle}>
            <Suspense fallback={<LoadingReview label="Opening editor…" />}>
              <NativeEditor
                key={name}
                kind={pageKind}
                title={name}
                getSnapshot={() => snapshots.current.get(name)}
                onSnapshot={(snapshot) => snapshots.current.set(name, snapshot)}
              />
            </Suspense>
          </div>
        )}
      />
      <Modal
        open={dialog === 'accent'}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined);
        }}
        title="Space appearance"
        icon="space"
        description="An accent for Autumn plans. Each page keeps its own cover."
      >
        <div className="rd-appearance-picker" style={accentStyle}>
          <h3>Accent color</h3>
          <div className="rd-accent-options" role="group" aria-label="Space accent">
            {accents.map((key) => (
              <Button key={key} aria-pressed={key === accent} onClick={() => setAccent(key)}>
                <span
                  className="rd-accent-swatch"
                  style={{
                    background:
                      key === 'bismuth'
                        ? `linear-gradient(135deg, ${spaceAccentPalettes.bismuth.facets.join(', ')})`
                        : spaceAccentPalettes[key][mode].accent,
                  }}
                />
                {spaceAccentPalettes[key].label}
                <span aria-hidden="true">{key === accent ? '✓' : ''}</span>
              </Button>
            ))}
          </div>
          <p className="sp-muted">
            Navigation, selected pages and controls share this accent. Covers are chosen page by
            page.
          </p>
          <Button onClick={() => setDialog(undefined)}>Done</Button>
        </div>
      </Modal>
      <Modal
        open={dialog === 'cover'}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined);
        }}
        title="Page cover"
        icon="doc"
        description={`Choose a cover for ${page}.`}
      >
        <div
          className="rd-appearance-picker rd-cover-picker"
          style={space ? accentStyle : undefined}
        >
          <div className="rd-cover-preview">
            {cover ? <CoverArt cover={cover} /> : <span className="sp-muted">No cover</span>}
          </div>
          <div className="rd-cover-sources" role="group" aria-label="Cover source">
            {(['Gems', 'Upload', 'Unsplash'] as const).map((item) => (
              <Button key={item} aria-pressed={source === item} onClick={() => setSource(item)}>
                {item}
              </Button>
            ))}
          </div>
          <div className="rd-cover-source-panel" key={source}>
            {source === 'Gems' && (
              <div className="rd-gem-presets" role="group" aria-label="Gem covers">
                {gems.map((gem) => (
                  <Button
                    key={gem}
                    aria-pressed={cover?.type === 'gem' && cover.color === gem}
                    onClick={() => setCover({ type: 'gem', color: gem })}
                  >
                    <span className="rd-gem-thumbnail">
                      <GemCover color={gem} />
                    </span>
                    <span>{spaceAccentPalettes[gem].label}</span>
                  </Button>
                ))}
              </div>
            )}
            {source === 'Upload' && (
              <div className="rd-cover-upload">
                <label htmlFor="review-cover-file">Choose an image</label>
                <input
                  id="review-cover-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => upload(event.target.files?.[0])}
                />
                <p className="sp-muted">
                  JPG, PNG or WebP · up to 8 MB. Previewed on this device only.
                </p>
                {uploadError && <p role="alert">{uploadError}</p>}
              </div>
            )}
            {source === 'Unsplash' && (
              <div className="rd-unsplash-preview">
                <label htmlFor="review-photo-search">Search photos</label>
                <input
                  id="review-photo-search"
                  value={query}
                  placeholder="Try coast, mountains, texture…"
                  onChange={(event) => setQuery(event.target.value)}
                />
                <p className="sp-muted">
                  Sample library for this preview. Live Unsplash search is not connected.
                </p>
                {!query || /coast|sea|ocean|cliff|beach/i.test(query) ? (
                  <>
                    <Button className="rd-photo-result" onClick={() => setCover(samplePhoto)}>
                      <img src={coast} alt="Coastal cliffs above the ocean" />
                      <span>Coastal cliffs</span>
                    </Button>
                    <PhotoCredit />
                  </>
                ) : (
                  <p role="status">No sample photos match. Try “coast”.</p>
                )}
              </div>
            )}
          </div>
          <div className="rd-cover-position-slot">
            {cover?.type === 'photo' && (
              <label className="rd-cover-position">
                Photo position
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={cover.position}
                  onChange={(event) => setCover({ ...cover, position: Number(event.target.value) })}
                />
              </label>
            )}
          </div>
          <div className="rd-cover-footer">
            <Button disabled={!cover} onClick={() => setCover(null)}>
              Remove cover
            </Button>
            <Button onClick={() => setDialog(undefined)}>Done</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
