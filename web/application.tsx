import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GuestApp } from './GuestApp.tsx';
import { guestItemId } from './documentAccess.ts';
import { App } from './App.tsx';
import '../src/ui/theme.css';
import { initializeTheme } from '../src/ui/theme.ts';
import { installRuntimeHost } from './offline/runtime.ts';
import type { RuntimeHost, RuntimeCompatibility } from './offline/runtime.ts';

declare const __SPINEL_RUNTIME_COMPATIBILITY__: RuntimeCompatibility;
export const compatibility: RuntimeCompatibility =
  typeof __SPINEL_RUNTIME_COMPATIBILITY__ === 'undefined'
    ? { format: 1, sdkVersion: '1.1.0' }
    : __SPINEL_RUNTIME_COMPATIBILITY__;

/** Only the tiny public loader calls this, after selecting a compatible build. */
export function startApplication(element: HTMLElement, host: RuntimeHost) {
  installRuntimeHost(host);
  const stopTheme = initializeTheme();
  const root = createRoot(element);
  root.render(<StrictMode>{guestItemId() ? <GuestApp /> : <App />}</StrictMode>);
  return () => {
    root.unmount();
    stopTheme();
  };
}
