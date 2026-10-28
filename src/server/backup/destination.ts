import type { BackupConfig } from './config.ts';
import { FilesystemStore } from './filesystem.ts';
import { SpacesStore } from './spaces.ts';

// Keep failure-test transports small; production destinations also retrieve bytes.
export interface RemoteStore {
  put(key: string, path: string, sha256: string, signal: AbortSignal): Promise<void>;
  list(signal: AbortSignal): Promise<string[]>;
  remove(key: string, signal: AbortSignal): Promise<void>;
  download?(key: string, destination: string, signal?: AbortSignal): Promise<string>;
  close?(): void | Promise<void>;
  // Caller must hold the shared backup/verification lease, with no active publisher.
  cleanup?(signal: AbortSignal): Promise<void>;
}
export interface BackupDestination extends RemoteStore {
  download(key: string, destination: string, signal?: AbortSignal): Promise<string>;
  close(): void | Promise<void>;
}
export function createDestination(config: BackupConfig): BackupDestination {
  if (config.type === 'manual') throw new Error('No automatic backup destination is configured.');
  return config.type === 'filesystem' ? new FilesystemStore(config) : new SpacesStore(config);
}
