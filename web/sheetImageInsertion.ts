import {
  CommandType,
  CustomCommandExecutionError,
  ICommandService,
  IUniverInstanceService,
  ImageSourceType,
  ImageUploadStatusType,
  UniverInstanceType,
} from '@univerjs/core';
import type { ICellData, IImageIoServiceParam, Univer, Workbook } from '@univerjs/core';
import { IRenderManagerService } from '@univerjs/engine-render';
import { SetRangeValuesCommand, SheetsSelectionsService } from '@univerjs/sheets';
import {
  InsertFloatImageCommand,
  InsertSheetDrawingCommand,
  SheetDrawingUpdateController,
} from '@univerjs/preset-sheets-drawing';
import { documentPath } from './documentAccess.ts';
import { maintenanceFetch as fetch } from './maintenanceFetch.ts';
import type { OfflineSession } from './offline/OfflineSession.ts';

const cellImageCommand = 'sheet.command.insert-cell-image';
const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
const changedTarget = 'The selected cell changed. Select a cell and insert the image again.';
class SheetImageError extends Error {}
type Target = { subUnitId: string; row: number; col: number; cell: string; structure: number };
type Job = {
  file: File;
  target: Target;
  imageId: string;
  cell: boolean;
  failed?: boolean;
  preview?: string;
};

/** Cancel closes the native chooser without leaving an outstanding insertion. */
function chooseImage(container: HTMLElement, signal: AbortSignal) {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = imageTypes.join(',');
    input.hidden = true;
    const finish = () => {
      signal.removeEventListener('abort', finish);
      input.remove();
      resolve(signal.aborted ? [] : Array.from(input.files ?? []));
    };
    input.addEventListener('change', finish, { once: true });
    input.addEventListener('cancel', finish, { once: true });
    signal.addEventListener('abort', finish, { once: true });
    container.append(input);
    if (signal.aborted) finish();
    else input.click();
  });
}

/** Account-scoped upload and native command lifetime; owns no drawing model. */
export function sheetImageInsertion(options: {
  id: string;
  unitId: string;
  spaceId?: string;
  container: HTMLElement;
  offline?: OfflineSession;
  canInsert: () => boolean;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
}) {
  const lifetime = new AbortController();
  let active: Job | undefined;
  let picking = false;
  let structure = 0;
  let readTarget: (() => Target | undefined) | undefined;
  let stop: (() => void) | undefined;
  const allowed = () => {
    if (lifetime.signal.aborted || !options.canInsert())
      throw new SheetImageError('Image insertion needs an account with edit access.');
    options.offline?.verifyRemote();
    if (!navigator.onLine || (options.offline?.enabled && !options.offline.online))
      throw new SheetImageError('Connect before inserting a new image.');
  };
  const verify = (job: Job) => {
    allowed();
    const current = readTarget?.();
    if (
      active !== job ||
      current?.structure !== job.target.structure ||
      !current ||
      current.subUnitId !== job.target.subUnitId ||
      current.row !== job.target.row ||
      current.col !== job.target.col ||
      (job.cell && current.cell !== job.target.cell)
    )
      throw new SheetImageError(changedTarget);
  };
  const errorMessage = (error: unknown) =>
    error instanceof SheetImageError
      ? error.message
      : 'The image could not be inserted. Try again.';
  const upload = async (file: File): Promise<IImageIoServiceParam> => {
    const job = active;
    if (!job || job.file !== file)
      throw new SheetImageError('Use the Image menu to insert a saved image.');
    verify(job);
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(30_000)]);
    const response = await (options.offline?.fetch.bind(options.offline) ?? fetch)(
      `${documentPath(options.id, options.spaceId)}/images`,
      { method: 'POST', headers: { 'Content-Type': file.type }, body: file, signal },
    );
    const image = await response.json();
    verify(job);
    if (!response.ok)
      throw new SheetImageError(image.error ?? 'The image could not be uploaded. Try again.');
    const prefix = `/api/items/${options.id}/images/`;
    if (
      typeof image.url !== 'string' ||
      !image.url.startsWith(prefix) ||
      !/^[a-f\d]{64}$/.test(image.url.slice(prefix.length))
    )
      throw new SheetImageError('The image could not be saved. Try again.');
    await options.offline?.prepareImages(image.url, signal);
    verify(job);
    // Decode the validated local file, avoiding an unbounded native Image URL
    // fetch after the upload. Only the canonical stored source enters the model.
    job.preview = URL.createObjectURL(file);
    return {
      imageId: job.imageId,
      source: options.offline?.toVisible(image.url) ?? image.url,
      base64Cache: job.preview,
      imageSourceType: ImageSourceType.URL,
      status: ImageUploadStatusType.SUCCUSS,
    };
  };
  return {
    // Native controllers swallow an upload exception. Preserve its actionable
    // message here; the insertion wrapper handles the resulting false outcome.
    upload: async (file: File) => {
      try {
        return await upload(file);
      } catch (error) {
        if (active?.file === file) active.failed = true;
        if (!lifetime.signal.aborted) options.onError(errorMessage(error));
        throw error;
      }
    },
    attach(univer: Univer) {
      const injector = univer.__getInjector();
      const commands = injector.get(ICommandService);
      const workbook = () =>
        injector
          .get(IUniverInstanceService)
          .getUnit<Workbook>(options.unitId, UniverInstanceType.UNIVER_SHEET);
      const selections = injector.get(SheetsSelectionsService);
      readTarget = () => {
        const sheet = workbook()?.getActiveSheet();
        const primary = selections
          .getWorkbookSelections(options.unitId)
          .getCurrentLastSelection()?.primary;
        if (!sheet || !primary) return;
        const row = primary.isMerged ? primary.startRow : primary.actualRow;
        const col = primary.isMerged ? primary.startColumn : primary.actualColumn;
        return {
          subUnitId: sheet.getSheetId(),
          row,
          col,
          cell: JSON.stringify(sheet.getCell(row, col) ?? null),
          structure,
        };
      };
      // A late native continuation must never write into a newly selected cell,
      // a changed worksheet, or an editor whose authority ended during upload.
      const fence = commands.beforeCommandExecuted((command) => {
        const params = command.params as
          | {
              unitId?: string;
              drawings?: { drawingId: string }[];
              value?: Record<number, Record<number, ICellData>>;
            }
          | undefined;
        // Capture structure changes even while the chooser is open, before a
        // file exists. Sorting also moves blank image targets between rows.
        if (
          command.type === CommandType.MUTATION &&
          params?.unitId === options.unitId &&
          /^sheet\.mutation\.(insert-(row|col)|remove-(rows|col|sheet)|move-(rows|columns|range)|reorder-range|add-worksheet-merge|remove-worksheet-merge)$/.test(
            command.id,
          )
        )
          structure++;
        const job = active;
        if (!job) return;
        const ownsImage =
          command.id === InsertSheetDrawingCommand.id
            ? params?.drawings?.some((drawing) => drawing.drawingId === job.imageId)
            : command.id === SetRangeValuesCommand.id &&
              Boolean(
                params?.value?.[job.target.row]?.[job.target.col]?.p?.drawings?.[job.imageId],
              );
        if (ownsImage) {
          try {
            verify(job);
          } catch (error) {
            job.failed = true;
            if (!lifetime.signal.aborted) options.onError(errorMessage(error));
            throw new CustomCommandExecutionError(errorMessage(error));
          }
        }
      });
      const insert = async (cell: boolean, files?: File[]) => {
        if (active || picking) {
          options.onError('An image is still being inserted. Wait before adding another.');
          return false;
        }
        let job: Job | undefined;
        try {
          allowed();
          const target = readTarget!();
          if (!target) throw new SheetImageError('Select a cell before inserting an image.');
          if (!files) {
            picking = true;
            try {
              files = await chooseImage(options.container, lifetime.signal);
            } finally {
              picking = false;
            }
          }
          if (!files.length) return false;
          allowed();
          if (files.length !== 1) throw new SheetImageError('Insert one image at a time.');
          const file = files[0];
          if (!imageTypes.includes(file.type))
            throw new SheetImageError('Choose a PNG, JPEG or WebP image.');
          if (!file.size || file.size > 5 * 1024 * 1024)
            throw new SheetImageError('Choose an image no larger than 5 MiB.');
          job = {
            file,
            target,
            imageId: crypto.randomUUID(),
            cell,
          };
          active = job;
          options.onError('');
          options.onBusy(true);
          verify(job);
          const controller = injector
            .get(IRenderManagerService)
            .getRenderUnitById(options.unitId)
            ?.with(SheetDrawingUpdateController);
          if (!controller) throw new SheetImageError('The image editor is not ready. Try again.');
          const inserted = cell
            ? await controller.insertCellImageByFile(file, {
                unitId: options.unitId,
                subUnitId: target.subUnitId,
                row: target.row,
                col: target.col,
              })
            : await controller.insertFloatImageByFile(file);
          if (!inserted && !lifetime.signal.aborted && !job.failed)
            options.onError('The image could not be inserted. Try again.');
          return Boolean(inserted);
        } catch (error) {
          if (!lifetime.signal.aborted) options.onError(errorMessage(error));
          return false;
        } finally {
          if (job) {
            if (job.preview) URL.revokeObjectURL(job.preview);
            active = undefined;
            options.onBusy(false);
          }
        }
      };
      const replacements = [
        [InsertFloatImageCommand.id, false],
        [cellImageCommand, true],
      ] as const;
      const registrations = replacements.map(([id, cell]) => {
        commands.unregisterCommand(id);
        return commands.registerCommand({
          id,
          type: CommandType.COMMAND,
          handler: (_accessor, params?: { files?: File[] }) => insert(cell, params?.files),
        });
      });
      const paste = (event: ClipboardEvent) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void insert(false, files);
      };
      const drop = (event: DragEvent) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void insert(false, files);
      };
      const dragover = (event: DragEvent) => {
        if (!event.dataTransfer?.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = options.canInsert() ? 'copy' : 'none';
      };
      options.container.addEventListener('paste', paste, true);
      options.container.addEventListener('drop', drop, true);
      options.container.addEventListener('dragover', dragover);
      stop = () => {
        options.container.removeEventListener('paste', paste, true);
        options.container.removeEventListener('drop', drop, true);
        options.container.removeEventListener('dragover', dragover);
        fence.dispose();
        registrations.forEach((registration) => registration.dispose());
      };
    },
    dispose() {
      lifetime.abort();
      stop?.();
    },
  };
}
