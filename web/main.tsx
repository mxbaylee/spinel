import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GuestApp } from './GuestApp.tsx';
import { guestItemId } from './documentAccess.ts';
import { App } from './App.tsx';
import '../src/ui/theme.css';
import { initializeTheme } from '../src/ui/theme.ts';

initializeTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>{guestItemId() ? <GuestApp /> : <App />}</StrictMode>,
);
