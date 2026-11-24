import { createElement } from 'react';
import { GemLogo } from './GemLogo.ts';

/** Shared by native Node HTML rendering and the browser, before and after React loads. */
export function StartupScreen({ contained = false }: { contained?: boolean }) {
  return createElement(
    contained ? 'div' : 'main',
    { className: `sp-startup${contained ? ' sp-startup-contained' : ''}` },
    createElement(
      'div',
      { className: 'sp-startup-content', role: 'status' },
      createElement(
        'span',
        { className: 'sp-startup-gem', 'aria-hidden': true },
        createElement(GemLogo, { size: 52 }),
      ),
      createElement('strong', { className: 'sp-startup-wordmark' }, 'spinel'),
      createElement('p', null, 'Loading your workspace…'),
    ),
  );
}
