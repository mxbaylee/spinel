import type { Univer, IDisposable } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import type { IMember } from '@univerjs/protocol';
import { CollaborationSessionService, SessionStatus } from '@univerjs-pro/collaboration-client';
import { IRenderManagerService } from '@univerjs/engine-render';
import { DocSelectionRenderService } from '@univerjs/docs-ui';
import { drawPresence, setLocalSelectionColor, boundedSheetRange } from '@spinel/presence-ui';
import { serializeRange } from '@univerjs/engine-formula';
import { RANGE_TYPE } from '@univerjs/core';
import { SheetsScrollRenderController } from '@univerjs/sheets-ui';
import { avatarProfile } from '../src/profile/profile.ts';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { palettes, presenceFallbackColors } from '../src/ui/palette.ts';
import { getTheme, watchTheme } from '../src/ui/theme.ts';
import { PresenceLabel, presencePopupZIndex } from './PresenceLabel.tsx';
import { presenceRenderColors } from './presenceColors.ts';
import { useState } from 'react';
import { Modal } from '../src/ui/redesign/Controls.tsx';
import './editorFrame.css';

export interface Collaborator {
  id: string;
  name: string;
  color: string;
  foreground?: string;
  icon?: string;
  selection?: string;
  jump?: () => void;
}
function Badge({ person, onJump }: { person: Collaborator; onJump(): void }) {
  return (
    <button
      className="collaborator-badge"
      style={{
        backgroundColor: person.color,
        color: person.foreground ?? '#ffffff',
        borderRadius: 8,
      }}
      aria-label={person.jump ? `Go to ${person.name}` : `${person.name} is here`}
      data-selection={person.selection}
      onClick={onJump}
      aria-disabled={!person.jump}
    >
      <ProfileIcon icon={person.icon ?? 'lucide:user-round'} />
    </button>
  );
}
export function Collaborators({ people }: { people: Collaborator[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="sp-control sp-quiet"
        aria-label="People in this document"
        onClick={() => setOpen(true)}
      >
        <ProfileIcon icon="lucide:users" size={20} />
        <span aria-hidden="true">{people.length}</span>
      </button>
      <Modal title="People in this document" icon="person" open={open} onOpenChange={setOpen}>
        <div role="group" aria-label="People in this document">
          {!people.length && <p>No one is connected yet.</p>}
          <ul className="editor-people-list">
            {people.map((person) => (
              <li key={person.id}>
                <Badge
                  person={person}
                  onJump={() => {
                    if (!person.jump) return;
                    setOpen(false);
                    requestAnimationFrame(() => person.jump?.());
                  }}
                />
                <div className="editor-people-detail">
                  <strong>{person.name}</strong>
                  <span>{person.selection ?? 'No shared cursor position'}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </>
  );
}

// Stable, identity-free defaults for rooms with guest links.
export function collaboratorColor(id: string) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return presenceFallbackColors[hash % presenceFallbackColors.length];
}

export async function watchPresence(
  univer: Univer,
  api: FUniver,
  id: string,
  publish: (people: Collaborator[]) => void,
) {
  const session = await univer.__getInjector().get(CollaborationSessionService).requireSession(id);
  let members: IMember[] = [];
  let previous = '',
    activeSheet = '';
  let sentAt = 0;
  const selections = new Map<string, string>();
  const popups = new Map<string, IDisposable>();
  const update = () => {
    for (const popup of popups.values()) popup.dispose();
    popups.clear();
    const people = members.map((member) => {
      const profile = avatarProfile(member.avatar);
      const palette = palettes[getTheme()];
      const person: Collaborator = {
        id: member.memberID,
        name: member.name,
        color: profile ? palette[`fill-${profile.color}-bg`] : collaboratorColor(member.userID),
        foreground: profile ? palette[`fill-${profile.color}-fg`] : '#ffffff',
        icon: profile?.icon ?? 'lucide:user-round',
      };
      if (member.memberID === session.getMemberID() && api.getActiveWorkbook?.()?.getId() === id)
        setLocalSelectionColor(
          univer,
          id,
          person.color,
          presenceRenderColors(profile?.color ?? person.color, 'local'),
        );
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
          const length = document.getDocumentDataModel().getSnapshot().body?.dataStream.length ?? 0;
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
              univer
                .__getInjector()
                .get(IRenderManagerService)
                .getRenderUnitById(id)
                ?.with(SheetsScrollRenderController)
                .scrollToRange(range.getRange());
            };
          } catch {
            /* Malformed or removed remote ranges never break the local editor. */
          }
        }
      }
      if (selection && book?.getId() === id && member.memberID !== session.getMemberID()) {
        try {
          popups.set(
            member.memberID,
            drawPresence(
              univer,
              api,
              id,
              selection,
              person.color,
              () => <PresenceLabel {...person} />,
              presenceRenderColors(profile?.color ?? person.color, 'remote'),
              { zIndex: presencePopupZIndex },
            ),
          );
        } catch {
          /* Stale or unsupported remote ranges must not interrupt editing. */
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
  const cursor = session.event$.subscribe((event) => {
    if (event.eventID !== 'update_cursor' || !('data' in event)) return;
    const data = event.data as { memberID?: unknown; selection?: unknown; unitID?: unknown };
    if (
      data.unitID === id &&
      typeof data.memberID === 'string' &&
      typeof data.selection === 'string' &&
      data.selection.length < 4096 &&
      selections.get(data.memberID) !== data.selection
    ) {
      selections.set(data.memberID, data.selection);
      update();
    }
  });
  const stopTheme = watchTheme(update);
  let frame = 0;
  const resize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };
  window.addEventListener('resize', resize);
  // Offscreen popup attachment can be empty; retry when its cell enters view.
  const scrolling = api.addEvent(api.Event.Scroll, ({ workbook }) => {
    if (workbook.getId() === id) resize();
  });
  // Keep the established cursor-only payload, including in anonymous rooms.
  const timer = window.setInterval(() => {
    const memberID = session.getMemberID();
    if (!memberID || api.getActiveWorkbook?.()?.getId() !== id) return;
    const book = api.getActiveWorkbook?.();
    const sheet = book?.getId() === id ? book.getActiveSheet() : undefined;
    const range = sheet?.getActiveRange();
    if (sheet?.getSheetId() !== activeSheet) {
      activeSheet = sheet?.getSheetId() ?? '';
      update();
    }
    const me = members.find((member) => member.memberID === memberID);
    if (me) {
      const profile = avatarProfile(me.avatar);
      setLocalSelectionColor(
        univer,
        id,
        profile ? palettes[getTheme()][`fill-${profile.color}-bg`] : collaboratorColor(me.userID),
        presenceRenderColors(profile?.color ?? collaboratorColor(me.userID), 'local'),
      );
    }
    const selection = range
      ? `${sheet!.getSheetId()}!${serializeRange({ ...boundedSheetRange(range.getRange(), sheet!.getMaxRows(), sheet!.getMaxColumns()), rangeType: RANGE_TYPE.NORMAL })}`
      : '';
    if (session.sessionStatus !== SessionStatus.ONLINE) {
      previous = '';
      return;
    }
    const fingerprint = memberID + ':' + selection;
    // A new peer can finish mounting after the membership event. Refresh idle
    // cursors too, without extending the transport or retaining them server-side.
    const now = Date.now();
    if (fingerprint === previous && now - sentAt < 2000) return;
    previous = fingerprint;
    sentAt = now;
    void session
      .send({ eventID: 'update_cursor', data: { unitID: id, memberID, selection } }, id)
      .catch(() => {
        previous = '';
      });
  }, 150);
  return () => {
    clearInterval(timer);
    stopTheme();
    scrolling.dispose();
    window.removeEventListener('resize', resize);
    cancelAnimationFrame(frame);
    membership.dispose();
    cursor.unsubscribe();
    for (const popup of popups.values()) popup.dispose();
  };
}
