import { useRef, useState } from 'react';
import { DuplicateFile } from './DuplicateFile.tsx';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ActionMenu, Modal } from '../src/ui/redesign/Controls.tsx';
import { useEditorChrome } from './EditorFrame.tsx';
import { Collaborators } from './Collaborators.tsx';
import type { Collaborator } from './Collaborators.tsx';
import { VersionNames } from './VersionNames.tsx';
import { FileExports } from './FileExports.tsx';
import { guestItemId } from './documentAccess.ts';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';

export function EditorTools({
  id,
  name,
  spaceId,
  people,
  saved,
  dirty = false,
  print,
  insertFormula,
  formulas,
}: {
  id: string;
  name: string;
  spaceId?: string;
  people: Collaborator[];
  saved: boolean;
  dirty?: boolean;
  print(): Promise<void>;
  insertFormula?: () => void;
  formulas?: (close: () => void) => ReactNode;
}) {
  const chrome = useEditorChrome();
  const [panel, setPanel] = useState<'Versions' | 'Export' | 'Formulas' | null>(null);
  const [exportError, setExportError] = useState('');
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const duplicateTrigger = useRef<HTMLButtonElement | null>(null);
  const guest = chrome?.guest ?? Boolean(guestItemId());
  const controls = (
    <>
      <Collaborators people={people} />
      {guest ? (
        <>
          {insertFormula && (
            <button
              className="sp-control"
              aria-label="Insert formula"
              title="Insert formula"
              onClick={insertFormula}
            >
              <ProfileIcon icon="lucide:square-function" />
            </button>
          )}
          {formulas && (
            <button
              className="sp-control"
              aria-label="Formulas"
              title="Formulas"
              onClick={() => setPanel('Formulas')}
            >
              <ProfileIcon icon="lucide:list" />
            </button>
          )}
        </>
      ) : (
        <ActionMenu
          label="Document actions"
          actions={[
            ...(chrome?.actions ?? []),
            ...(chrome?.duplicate
              ? [
                  {
                    label: 'Duplicate…',
                    onClick: (trigger?: HTMLButtonElement | null) => {
                      duplicateTrigger.current = trigger ?? null;
                      setDuplicateOpen(true);
                    },
                  },
                ]
              : []),
            { label: 'Versions', onClick: () => setPanel('Versions') },
            { label: 'Export', onClick: () => setPanel('Export') },
            ...(insertFormula ? [{ label: 'Insert formula', onClick: insertFormula }] : []),
            ...(formulas ? [{ label: 'Formulas', onClick: () => setPanel('Formulas') }] : []),
          ]}
        />
      )}
    </>
  );
  return (
    <>
      {chrome ? chrome.toolsTarget && createPortal(controls, chrome.toolsTarget) : controls}
      {duplicateOpen && chrome?.duplicate && !guest && (
        <DuplicateFile
          {...chrome.duplicate}
          dirty={dirty}
          saveReady={saved}
          onClose={() => setDuplicateOpen(false)}
          finalFocus={() =>
            duplicateTrigger.current?.isConnected ? duplicateTrigger.current : true
          }
        />
      )}
      {panel && (
        <Modal
          title={panel}
          onBack={() => setPanel(null)}
          icon={panel === 'Versions' ? 'history' : panel === 'Export' ? 'upload' : 'info'}
          open
          onOpenChange={(open) => {
            if (!open) setPanel(null);
          }}
        >
          {panel === 'Versions' && !guest && (
            <VersionNames id={id} spaceId={spaceId} saved={saved} embedded />
          )}
          {panel === 'Export' && exportError && <p role="alert">{exportError}</p>}
          {panel === 'Export' && !guest && (
            <FileExports
              id={id}
              name={name}
              spaceId={spaceId}
              saved={saved}
              print={async () => {
                setExportError('');
                setPanel(null);
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                try {
                  await print();
                } catch (cause) {
                  setExportError(
                    cause instanceof Error ? cause.message : 'Could not open printing.',
                  );
                  setPanel('Export');
                }
              }}
              embedded
            />
          )}
          {panel === 'Formulas' && formulas?.(() => setPanel(null))}
        </Modal>
      )}
    </>
  );
}
