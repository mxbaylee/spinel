import { DetailsPopover } from '../src/ui/redesign/Controls.tsx';

/** Stable editor help slot shared by the production Sheet and its stories. */
export function SheetImageStatus({ error = '' }: { error?: string }) {
  return (
    <div className="editor-help sheet-image-help" role={error ? 'alert' : undefined}>
      {error && (
        <>
          <span className="sheet-image-announcement">{error}</span>
          <DetailsPopover label="Image not inserted · Details">
            <p>{error}</p>
          </DetailsPopover>
        </>
      )}
    </div>
  );
}
