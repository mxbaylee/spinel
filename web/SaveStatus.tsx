import { createPortal } from 'react-dom';
import { Popover } from '@base-ui/react/popover';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import type { SaveState } from '../src/shared/autosave.ts';
import './saveStatus.css';

/** Keep the editor's live announcement and save controller together, while
 * presenting its fixed-size control in the shell's title-adjacent slot. */
export function SaveStatus({
  state,
  target,
  onRetry,
}: {
  state: SaveState;
  target: HTMLElement | null;
  onRetry(): void;
}) {
  const label = state.failed
    ? state.dirty
      ? 'Not saved'
      : 'Check status'
    : state.dirty
      ? state.message.startsWith('Editing cell')
        ? 'Editing…'
        : 'Saving…'
      : state.message.startsWith('View only')
        ? 'View only'
        : state.message === 'All changes saved.'
          ? 'Saved'
          : 'Loading…';
  const icon = state.failed
    ? 'circle-alert'
    : label === 'Saved'
      ? 'check'
      : label === 'View only'
        ? 'eye'
        : 'clock-3';
  return (
    <>
      <span
        className="save-announcement"
        role="status"
        aria-label="Save status"
        aria-live="polite"
        aria-atomic="true"
      >
        {state.message}
      </span>
      {target &&
        createPortal(
          <Popover.Root>
            <Popover.Trigger
              className="save-trigger"
              data-failed={state.failed}
              aria-label={`Save details: ${label}`}
            >
              <ProfileIcon icon={`lucide:${icon}`} size={18} />
              <span>{label}</span>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner className="save-positioner" sideOffset={8} align="start">
                <Popover.Popup className="save-detail" aria-label="Save details">
                  <Popover.Title>Save details</Popover.Title>
                  <p>{state.message}</p>
                  {state.failed && state.dirty && (
                    <button type="button" onClick={onRetry}>
                      Retry saving
                    </button>
                  )}
                  <Popover.Close aria-label="Close save details">Close</Popover.Close>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>,
          target,
        )}
    </>
  );
}
