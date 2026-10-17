import { useEffect, useRef, useState } from 'react';
import {
  CommandType,
  IImageIoService,
  ImageSourceType,
  ImageUploadStatusType,
} from '@univerjs/core';
import { ImageIoService } from '@univerjs/drawing';
import {
  UniverDrawingPlugin,
  UniverDrawingUIPlugin,
  UniverDocsDrawingPlugin,
  UniverDocsDrawingUIPlugin,
} from '@univerjs/preset-docs-drawing';
import { UniverDocsHyperLinkPreset } from '@univerjs/preset-docs-hyper-link';
import linkEnUS from '@univerjs/preset-docs-hyper-link/locales/en-US';
import '@univerjs/preset-docs-hyper-link/lib/index.css';
import drawingEnUS from '@univerjs/preset-docs-drawing/locales/en-US';
import '@univerjs/preset-docs-drawing/lib/index.css';
import type { IDocumentData } from '@univerjs/core';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import enUS from '@univerjs/preset-docs-core/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
import { Autosave, SaveFailure } from '../src/shared/autosave.ts';
import type { SaveState } from '../src/shared/autosave.ts';

export function DocEditor({
  id,
  name,
  onDirty,
}: {
  id: string;
  name: string;
  onDirty: (dirty: boolean) => void;
}) {
  const [uploadError, setUploadError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<Autosave | null>(null);
  const [status, setStatus] = useState<SaveState>({
    dirty: false,
    message: 'Loading document…',
    failed: false,
  });
  useEffect(() => {
    let disposed = false;
    let uploads = 0;
    let disposeEditor: (() => void) | undefined;
    let save: Autosave | undefined;
    let lastState = status;
    const publish = (state: SaveState) => {
      lastState = state;
      if (disposed) return;
      const dirty = uploads > 0 || state.dirty;
      onDirty(dirty);
      setStatus({
        ...state,
        dirty,
        message: uploads ? 'Uploading image — keep this tab open.' : state.message,
      });
    };
    void (async () => {
      const response = await fetch(`/api/items/${id}/doc`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not load this document.');
      if (disposed) return;
      const data = result as { snapshot: IDocumentData | null; revision: number };
      class StoredImages extends ImageIoService {
        override async saveImage(file: File) {
          uploads++;
          this.setWaitCount(uploads);
          setUploadError('');
          publish(lastState);
          try {
            const response = await fetch(`/api/items/${id}/images`, {
              method: 'POST',
              headers: { 'Content-Type': file.type },
              body: file,
              signal: AbortSignal.timeout(30_000),
            });
            const image = await response.json();
            if (!response.ok) throw new Error(image.error ?? 'Image upload failed.');
            return {
              imageId: crypto.randomUUID(),
              imageSourceType: ImageSourceType.URL,
              source: image.url as string,
              base64Cache: image.url as string,
              status: ImageUploadStatusType.SUCCUSS,
            };
          } catch (error) {
            if (!disposed)
              setUploadError(
                error instanceof Error
                  ? error.message
                  : 'Image upload failed. Try inserting the file again.',
              );
            throw new Error(ImageUploadStatusType.ERROR_IMAGE);
          } finally {
            uploads--;
            this.setWaitCount(uploads);
            publish(lastState);
          }
        }
      }
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(enUS, drawingEnUS, linkEnUS) },
        plugins: [
          [
            UniverDrawingPlugin,
            {
              override: [[IImageIoService, { useClass: StoredImages }]],
              allowImageSize: 5 * 1024 * 1024,
            },
          ],
          UniverDrawingUIPlugin,
          UniverDocsDrawingPlugin,
          UniverDocsDrawingUIPlugin,
        ],
        presets: [
          UniverDocsCorePreset({ container: container.current! }),
          UniverDocsHyperLinkPreset(),
        ],
      });
      disposeEditor = () => univer.dispose();
      const document = univerAPI.createDocument(data.snapshot ?? { id, title: name });
      save = new Autosave(
        data.revision,
        data.snapshot,
        async (payload) => {
          const response = await fetch(`/api/items/${id}/doc`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
          });
          const result = await response.json();
          if (!response.ok)
            throw new SaveFailure(
              response.status,
              result.error ?? 'Changes have not been saved. Try again.',
            );
          return result as { revision: number };
        },
        publish,
      );
      controller.current = save;
      const capture = () => {
        if (disposed) return;
        try {
          save!.changed(document.save());
        } catch {
          publish({
            dirty: true,
            message:
              'Could not prepare your changes for saving. Keep this tab open and copy your changes.',
            failed: true,
          });
        }
      };
      univerAPI.addEvent(univerAPI.Event.CommandExecuted, ({ type }) => {
        if (type === CommandType.MUTATION) queueMicrotask(capture);
      });
      capture();
    })().catch((error) => {
      if (!disposed)
        publish({
          dirty: false,
          message:
            error instanceof Error
              ? error.message
              : 'Could not load this document. Reload to try again.',
          failed: true,
        });
    });
    const online = () => save?.retry();
    window.addEventListener('online', online);
    return () => {
      disposed = true;
      window.removeEventListener('online', online);
      save?.dispose();
      // Univer owns a separate React root; unmount it after our cleanup commit.
      if (disposeEditor) queueMicrotask(disposeEditor);
      controller.current = null;
      onDirty(false);
    };
    // Name is folder metadata; a rename must not recreate an editor with pending edits.
  }, [id]);
  return (
    <section className="sheet-editor" aria-label="Doc document">
      <div className="save-status" role="status" aria-live="polite">
        {status.message}
        {status.failed && status.dirty && (
          <button onClick={() => controller.current?.retry()}>Retry saving</button>
        )}
      </div>
      {uploadError && <p role="alert">{uploadError} Try inserting the file again.</p>}
      <div className="univer-container" ref={container} />
    </section>
  );
}
