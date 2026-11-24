import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StartupScreen } from '../ui/StartupScreen.tsx';
import { initialThemeCss, initialThemeScript } from '../ui/initialTheme.ts';

/** Build/dev HTML only: no React or private application dependency in the bootstrap. */
export function startupHtml(html: string, styles: string) {
  if (!html.includes('<div id="root"></div>')) return html;
  return html
    .replace(
      '</head>',
      `<style>${initialThemeCss}body{margin:0}${styles}</style><script>${initialThemeScript}</script></head>`,
    )
    .replace(
      '<div id="root"></div>',
      `<div id="root">${renderToStaticMarkup(createElement(StartupScreen))}</div>`,
    );
}
