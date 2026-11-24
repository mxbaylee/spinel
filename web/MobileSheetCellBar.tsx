import { Popover } from '@base-ui/react/popover';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import type { MobileSheetCell } from './mobileSheetCell.ts';
import '../src/ui/redesign/controls.css';
import './mobileSheetCell.css';

/** A readout and entry point; native Univer alone owns the mutable cell input. */
export function MobileSheetCellBar({
  cell,
  onEdit,
}: {
  cell: MobileSheetCell;
  onEdit: () => void;
}) {
  return (
    <div className="mobile-sheet-cell-slot sp-ui" data-editing={cell.editing}>
      <div className="mobile-sheet-cell-bar" aria-label="Selected cell" role="group">
        <span className="mobile-sheet-cell-address">{cell.address || '—'}</span>
        {cell.viewable ? (
          <Popover.Root key={`${cell.identity}/${cell.editing}`}>
            <Popover.Trigger className="mobile-sheet-cell-text" aria-label={`Read ${cell.address}`}>
              {cell.text || <span className="sp-muted">Empty cell</span>}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner className="sp-positioner" side="top" sideOffset={8}>
                <Popover.Popup className="sp-popup sp-ui mobile-sheet-cell-detail">
                  <Popover.Title>{cell.address}</Popover.Title>
                  <p>{cell.text || 'Empty cell'}</p>
                  <Popover.Close className="sp-control">Close</Popover.Close>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        ) : (
          <span className="mobile-sheet-cell-text sp-muted">
            {cell.address ? 'Protected cell' : 'Select a cell'}
          </span>
        )}
        {cell.editable && (
          <button
            className="sp-control sp-quiet"
            aria-label={`Edit ${cell.address}`}
            onClick={onEdit}
          >
            <ProfileIcon icon="lucide:pencil" size={18} />
            <span>Edit</span>
          </button>
        )}
      </div>
    </div>
  );
}
