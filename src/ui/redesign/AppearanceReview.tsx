/** Appearance exploration only. All choices and uploaded images stay in this story. */
import { lazy, Suspense, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { palettes, spaceAccentPalettes } from '../palette.ts';
import { getTheme, watchTheme } from '../theme.ts';
import { ProfileIcon } from '../../profile/ProfileIcon.tsx';
import { Button, Modal } from './Controls.tsx';
import { EditorMockup } from './Mockups.tsx';
import { LoadingReview } from './LoadingReview.tsx';
import type { NativeSnapshot } from './NativeEditors.tsx';
import coast from './assets/coast.jpg';
import './appearanceReview.css';

const NativeEditor = lazy(() =>
  import('./NativeEditors.tsx').then((module) => ({ default: module.NativeEditor })),
);
type Accent = keyof typeof spaceAccentPalettes;
type Cover =
  | { type: 'gem'; color: Accent; cut: 'facets' | 'prism' }
  | { type: 'photo'; src: string; name: string; position: number; credit?: boolean };
const accents = Object.keys(spaceAccentPalettes) as Accent[];
const samplePhoto: Cover = {
  type: 'photo',
  src: coast,
  name: 'Coastal cliffs',
  position: 54,
  credit: true,
};
const photoSource = 'https://unsplash.com/photos/e0-Qsr4vIzo';

function GemCover({ color, cut }: { color: Accent; cut: 'facets' | 'prism' }) {
  const id = useId();
  const colors = spaceAccentPalettes[color].facets;
  // A repeatable mesh, not a stretched illustration. Left/right edges share vertices.
  const faces = [
    '0,0 140,0 82,74',
    '140,0 300,0 242,64 82,74',
    '300,0 420,0 420,96 242,64',
    '0,0 82,74 0,96',
    '0,96 82,74 132,160 0,220',
    '82,74 242,64 132,160',
    '242,64 420,96 312,184 132,160',
    '420,96 420,220 312,184',
    '0,220 132,160 220,220',
    '132,160 312,184 220,220',
    '220,220 312,184 420,220',
  ];
  return (
    <svg className="rd-gem-cover" width="100%" height="100%" aria-hidden="true">
      <defs>
        <pattern
          id={id}
          width={cut === 'prism' ? 680 : 420}
          height="220"
          patternUnits="userSpaceOnUse"
          viewBox="0 0 420 220"
          preserveAspectRatio="none"
        >
          {faces.map((points, index) => (
            <polygon
              key={points}
              points={points}
              fill={colors[(index * 3 + (cut === 'prism' ? 1 : 0)) % colors.length]}
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

function CoverArt({ cover }: { cover: Cover }) {
  return cover.type === 'gem' ? (
    <GemCover color={cover.color} cut={cover.cut} />
  ) : (
    <img src={cover.src} alt="" style={{ objectPosition: `50% ${cover.position}%` }} />
  );
}

export function AppearanceReview({
  space = true,
  kind = 'doc',
  initialAccent = 'emerald',
  initialCover = 'gem',
  initialDialog,
  initialSource = 'Spinel Gems',
}: {
  space?: boolean;
  kind?: 'doc' | 'sheet';
  initialAccent?: Accent;
  initialCover?: 'gem' | 'photo' | 'none';
  initialDialog?: 'cover' | 'accent';
  initialSource?: 'Spinel Gems' | 'Upload' | 'Unsplash';
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
          : { type: 'gem', color: initialAccent, cut: 'facets' },
  });
  const [dialog, setDialog] = useState(initialDialog);
  const [page, setPage] = useState(title);
  const [source, setSource] = useState(initialSource);
  const [gemColor, setGemColor] = useState(initialAccent);
  const [uploadError, setUploadError] = useState('');
  const [query, setQuery] = useState('');
  const snapshots = useRef(new Map<string, NativeSnapshot>());
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
            {covers[name]?.type === 'photo' && covers[name].credit && (
              <a className="rd-cover-credit" href={photoSource} target="_blank" rel="noreferrer">
                Jon Matthews / Unsplash
              </a>
            )}
          </div>
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
                  style={{ background: spaceAccentPalettes[key][mode].accent }}
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
        <div className="rd-appearance-picker" style={space ? accentStyle : undefined}>
          {cover && (
            <div className="rd-cover-preview">
              <CoverArt cover={cover} />
            </div>
          )}
          <div className="rd-cover-sources" role="group" aria-label="Cover source">
            {(['Spinel Gems', 'Upload', 'Unsplash'] as const).map((item) => (
              <Button key={item} aria-pressed={source === item} onClick={() => setSource(item)}>
                {item}
              </Button>
            ))}
          </div>
          {source === 'Spinel Gems' && (
            <>
              <div className="rd-gem-colors" role="group" aria-label="Gem color">
                {accents.map((key) => (
                  <Button
                    key={key}
                    aria-label={spaceAccentPalettes[key].label}
                    title={spaceAccentPalettes[key].label}
                    aria-pressed={gemColor === key}
                    onClick={() => setGemColor(key)}
                  >
                    <span
                      className="rd-accent-swatch"
                      style={{ background: spaceAccentPalettes[key][mode].accent }}
                    />
                    <span aria-hidden="true">{gemColor === key ? '✓' : ''}</span>
                  </Button>
                ))}
              </div>
              <div className="rd-gem-presets">
                {(['facets', 'prism'] as const).map((cut) => (
                  <Button
                    key={cut}
                    aria-pressed={
                      cover?.type === 'gem' && cover.color === gemColor && cover.cut === cut
                    }
                    onClick={() => setCover({ type: 'gem', color: gemColor, cut })}
                  >
                    <span className="rd-gem-thumbnail">
                      <GemCover color={gemColor} cut={cut} />
                    </span>
                    <span>{cut === 'facets' ? 'Endless facets' : 'Wide prism'}</span>
                  </Button>
                ))}
              </div>
            </>
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
                  <a href={photoSource} target="_blank" rel="noreferrer">
                    Photo by Jon Matthews on Unsplash
                  </a>
                </>
              ) : (
                <p role="status">No sample photos match. Try “coast”.</p>
              )}
            </div>
          )}
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
