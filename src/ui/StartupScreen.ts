import { createElement } from 'react';
import { GemLogo } from './GemLogo.ts';
import { LoadingRunner } from './LoadingRunner.ts';

/** Shared by native Node HTML rendering and the browser, before and after React loads. */
export function StartupScreen({ contained = false }: { contained?: boolean }) {
  return createElement(
    contained ? 'div' : 'main',
    { className: `sp-startup${contained ? ' sp-startup-contained' : ''}` },
    createElement(
      'div',
      { className: 'sp-startup-content', role: 'status' },
      createElement(
        'div',
        { className: 'sp-startup-brand' },
        createElement(
          'span',
          { className: 'sp-startup-gem', 'aria-hidden': true },
          createElement(GemLogo, { size: 32 }),
        ),
        createElement('strong', { className: 'sp-startup-wordmark' }, 'spinel'),
      ),
      createElement('div', { className: 'rd-loading' }, createElement(LoadingRunner)),
      createElement('p', null, 'Loading your workspace…'),
    ),
  );
}
