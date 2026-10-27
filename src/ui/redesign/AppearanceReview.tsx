/** Paired artwork evidence; interactive controls use the production components. */
import { useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { palettes, spaceAccentPalettes } from '../palette.ts';
import type { ThemeMode } from '../palette.ts';
import { getTheme, watchTheme } from '../theme.ts';
import { gemCoverSources, gems } from './gemCovers.ts';
import './appearanceReview.css';
type Accent = keyof typeof spaceAccentPalettes;
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
