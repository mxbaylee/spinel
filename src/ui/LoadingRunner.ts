import { createElement, Fragment } from 'react';
function Boot() {
  return createElement(
    Fragment,
    null,
    createElement('path', {
      className: 'rd-runner-light',
      d: 'M-7-5Q0-9 7-5L8 1Q23-1 25 9Q26 18 15 19H-6Q-12 18-11 10Z',
    }),
    createElement('path', {
      className: 'rd-runner-dark',
      d: 'M-7-7L0-2 7-8 8 5 25-2 23 19H-11L-10 5Z',
    }),
  );
}
/** Existing loading silhouette, shared with native Node initial-HTML rendering. */
export function LoadingRunner() {
  return createElement(
    'svg',
    { className: 'rd-runner', viewBox: '0 -12 160 180', 'aria-hidden': 'true', focusable: 'false' },
    createElement(
      'g',
      { className: 'rd-runner-bounce', fill: 'currentColor' },
      createElement(
        'g',
        { transform: 'translate(73 91)' },
        createElement(
          'g',
          { className: 'rd-runner-leg rd-runner-leg-back' },
          createElement('path', { d: 'M0 0Q-4 12 0 25', className: 'rd-runner-limb' }),
          createElement(
            'g',
            { transform: 'translate(0 25)' },
            createElement(
              'g',
              { className: 'rd-runner-knee rd-runner-knee-back' },
              createElement('path', { d: 'M0 0L0 23', className: 'rd-runner-limb' }),
              createElement('g', { transform: 'translate(0 23)' }, createElement(Boot, null)),
            ),
          ),
        ),
      ),
      createElement(
        'g',
        { transform: 'translate(77 63)' },
        createElement(
          'g',
          { className: 'rd-runner-arm rd-runner-arm-back' },
          createElement('path', { d: 'M0 0Q-8 14-3 21L13 12', className: 'rd-runner-limb' }),
          createElement('path', { d: 'M8 9Q8 3 14 4L21 9Q25 14 20 18L13 18Z' }),
        ),
      ),
      createElement('path', { d: 'M77 48L75 59 83 61 85 47Z' }),
      createElement('path', {
        d: 'M71 56Q79 52 89 60L84 76Q84 85 79 96Q65 101 61 90L65 75 65 63Z',
      }),
      createElement('ellipse', {
        cx: '69',
        cy: '63',
        rx: '10',
        ry: '9',
        transform: 'rotate(-18 69 63)',
      }),
      createElement('path', {
        d: 'M64 29Q65 15 82 17Q96 18 98 32L103 36 98 40Q96 51 83 52Q67 50 63 39Z',
      }),
      createElement(
        'g',
        { className: 'rd-runner-hair rd-runner-light' },
        createElement('path', {
          d: 'M66 24C54 22 43 16 48 7C52 0 60 3 62 8C65-2 76 0 76 9C77 17 71 22 66 24Z',
        }),
        createElement('path', {
          d: 'M91 23C88 14 87 2 95 1C102 0 105 5 103 10C111 8 117 14 113 20C108 28 98 26 91 23Z',
        }),
      ),
      createElement(
        'g',
        { className: 'rd-runner-hair rd-runner-dark' },
        createElement('path', { d: 'M68 24C57 27 46 20 39 14L53 13 47 8C58 7 64 9 70 16Z' }),
        createElement('path', { d: 'M88 20C84 12 90 3 96-5L97 5 103 0C105 12 99 21 93 24Z' }),
      ),
      createElement(
        'g',
        { transform: 'translate(70 64)' },
        createElement(
          'g',
          { className: 'rd-runner-arm rd-runner-arm-front' },
          createElement('path', { d: 'M0 0Q-6 14-2 21L14 10', className: 'rd-runner-limb' }),
          createElement('path', { d: 'M9 7Q10 1 15 3L23 8Q27 14 21 17L14 16Z' }),
        ),
      ),
      createElement(
        'g',
        { transform: 'translate(72 92)' },
        createElement(
          'g',
          { className: 'rd-runner-leg rd-runner-leg-front' },
          createElement('path', { d: 'M0 0Q-4 12 0 25', className: 'rd-runner-limb' }),
          createElement(
            'g',
            { transform: 'translate(0 25)' },
            createElement(
              'g',
              { className: 'rd-runner-knee rd-runner-knee-front' },
              createElement('path', { d: 'M0 0L0 23', className: 'rd-runner-limb' }),
              createElement('g', { transform: 'translate(0 23)' }, createElement(Boot, null)),
            ),
          ),
        ),
      ),
    ),
  );
}
