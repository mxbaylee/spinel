import type { Univer, IDisposable } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import type { IMember } from '@univerjs/protocol';
import { CollaborationSessionService } from '@univerjs-pro/collaboration-client';
import { IRenderManagerService } from '@univerjs/engine-render';
import { DocSelectionRenderService } from '@univerjs/docs-ui';

export interface Collaborator {
  id: string;
  name: string;
  color: string;
  selection?: string;
  jump?: () => void;
}
function Badge({ person }: { person: Collaborator }) {
  return (
    <button
      className="collaborator-badge"
      style={{ backgroundColor: person.color }}
      aria-label={person.jump ? `Go to ${person.name}` : `${person.name} is here`}
      data-selection={person.selection}
      onClick={person.jump}
      aria-disabled={!person.jump}
    >
      <span aria-hidden="true">{person.name.trim().slice(0, 1).toLocaleUpperCase() || '●'}</span>
      <span className="collaborator-name">{person.name}</span>
    </button>
  );
}
export function Collaborators({ people }: { people: Collaborator[] }) {
  return (
    <div className="collaborators" role="group" aria-label="People in this document">
      {people.map((person) => (
        <Badge key={person.id} person={person} />
      ))}
    </div>
  );
}

// Stable defaults until SPN-036 adds user-chosen profile colours and icons.
export function collaboratorColor(id: string) {
  const colors = ['#7046a5', '#23736a', '#a24457', '#3868a1', '#826126', '#8c4c8b'];
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

export function watchPresence(
  univer: Univer,
  api: FUniver,
  id: string,
  publish: (people: Collaborator[]) => void,
  unavailable: () => void,
) {
  let disposed = false;
  let stop = () => {};
  // Presence is optional. Never hold local save/input guards behind a connection.
  async function start() {
    const session = await univer
      .__getInjector()
      .get(CollaborationSessionService)
      .requireSession(id);
    if (disposed) return;
    let members: IMember[] = [];
    const selections = new Map<string, string>();
    const popups = new Map<string, IDisposable>();
    const update = () => {
      if (disposed) return;
      for (const popup of popups.values()) popup.dispose();
      popups.clear();
      const people = members.map((member) => {
        const person: Collaborator = {
          id: member.memberID,
          name: member.name,
          color: collaboratorColor(member.userID),
        };
        const selection = selections.get(member.memberID);
        person.selection = selection;
        const book = api.getActiveWorkbook?.();
        const document = api.getActiveDocument?.();
        if (selection && document?.getId() === id && member.memberID !== session.getMemberID()) {
          // Public cursor events encode body text ranges this way. Unsupported
          // segments remain visible as presence, without guessing a destination.
          const match = /^(\d+):(\d+):\d+:TEXT::-1$/.exec(selection);
          if (match) {
            const start = Number(match[1]),
              end = Number(match[2]);
            const length =
              document.getDocumentDataModel().getSnapshot().body?.dataStream.length ?? 0;
            if (
              Number.isSafeInteger(start) &&
              Number.isSafeInteger(end) &&
              start <= end &&
              end < length
            )
              person.jump = () => {
                document.setSelection(start, end);
                univer
                  .__getInjector()
                  .get(IRenderManagerService)
                  .getRenderUnitById(id)
                  ?.with(DocSelectionRenderService)
                  .focus();
              };
          }
        }
        if (selection && book?.getId() === id && member.memberID !== session.getMemberID()) {
          const separator = selection.lastIndexOf('!');
          const sheet = book.getSheetBySheetId(selection.slice(0, separator));
          const address = selection.slice(separator + 1);
          if (sheet && /^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(address)) {
            try {
              const range = sheet.getRange(address);
              person.jump = () => {
                book.setActiveSheet(sheet);
                sheet.scrollToCell(range.getRow(), range.getColumn());
                sheet.setActiveRange(range);
              };
              const popup = range.attachPopup({
                componentKey: () => <Badge person={person} />,
                direction: 'top-left',
                showOnSelectionMoving: true,
                hideOnInvisible: true,
              });
              if (popup) popups.set(member.memberID, popup);
            } catch {
              /* Malformed or removed remote ranges never break the local editor. */
            }
          }
        }
        return person;
      });
      publish(people);
    };
    const membership = api.getCollaboration().subscribeCollaborators(id, (value) => {
      members = value;
      const present = new Set(members.map((member) => member.memberID));
      for (const member of selections.keys()) if (!present.has(member)) selections.delete(member);
      update();
    });
    let stopCursor = () => {};
    stop = () => {
      membership.dispose();
      stopCursor();
      for (const popup of popups.values()) popup.dispose();
      popups.clear();
    };
    const cursor = session.event$.subscribe((event) => {
      if (event.eventID !== 'update_cursor' || !('data' in event)) return;
      const data = event.data as { memberID?: unknown; selection?: unknown; unitID?: unknown };
      if (
        data.unitID === id &&
        typeof data.memberID === 'string' &&
        typeof data.selection === 'string' &&
        data.selection.length < 4096
      ) {
        selections.set(data.memberID, data.selection);
        update();
      }
    });
    stopCursor = () => cursor.unsubscribe();
  }
  const cleanup = () => {
    const current = stop;
    stop = () => {};
    current();
  };
  void start().catch(() => {
    cleanup();
    if (!disposed) {
      publish([]);
      unavailable();
    }
  });
  return () => {
    if (disposed) return;
    disposed = true;
    cleanup();
  };
}
