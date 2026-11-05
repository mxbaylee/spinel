import { RUNTIME_DESCRIPTOR_ID, SHELL_CACHE_PREFIX } from '../../src/shared/offlineShell.ts';

/** Read names only: never open/create an account database or cache, or write a cookie. */
export const initialChromeStorageScript = `
const descriptor=JSON.parse(document.getElementById(${JSON.stringify(RUNTIME_DESCRIPTOR_ID)})?.textContent || 'null');
if(!descriptor || !/^[a-f0-9]{16}$/.test(descriptor.version))throw new Error('runtime-unavailable');
const databases=await indexedDB.databases();const names=await caches.keys();
if(!Array.isArray(databases)||databases.some(entry=>typeof entry?.name!=='string')||
  !Array.isArray(names)||names.some(name=>typeof name!=='string'))throw new Error('storage-unavailable');
const shell=${JSON.stringify(SHELL_CACHE_PREFIX)}+descriptor.version;
return {markerAbsent:localStorage.getItem('spinel.offline.account')===null,
  boundaryAbsent:!document.cookie.split(';').some(entry=>entry.trim().startsWith('spinel-capability-boundary=')),
  accountDatabases:databases.filter(entry=>entry.name.startsWith('spinel-offline-')&&entry.name!=='spinel-offline-runtime').length,
  runtimeDatabases:databases.filter(entry=>entry.name==='spinel-offline-runtime').length,
  currentShellCaches:names.filter(name=>name===shell).length,
  unexpectedCaches:names.filter(name=>name!==shell).length};
`;

/** The anonymous page may already create its public runtime DB/current shell. */
export function verifyInitialChromeStorage(value: unknown) {
  const v = value as Record<string, unknown> | null;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    v.markerAbsent !== true ||
    v.boundaryAbsent !== true ||
    v.accountDatabases !== 0 ||
    v.unexpectedCaches !== 0 ||
    ![0, 1].includes(v.runtimeDatabases as number) ||
    ![0, 1].includes(v.currentShellCaches as number)
  )
    throw new Error('capability-initial-chrome-storage-unverified');
  return {
    markerAbsent: true,
    boundaryAbsent: true,
    accountDatabases: 0,
    runtimeDatabases: v.runtimeDatabases as number,
    currentShellCaches: v.currentShellCaches as number,
    unexpectedCaches: 0,
  };
}
