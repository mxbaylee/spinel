import type { Univer, IDisposable } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import type { IMember } from '@univerjs/protocol';
import { CollaborationSessionService, SessionStatus } from '@univerjs-pro/collaboration-client';
import { IRenderManagerService } from '@univerjs/engine-render';
import { DocSelectionRenderService } from '@univerjs/docs-ui';
import { DocSelectionManagerService, DocSkeletonManagerService } from '@univerjs/docs';
import {
  drawPresence,
  setLocalSelectionColor,
  setLocalDocSelectionColor,
  boundedSheetRange,
  parseDocSelection,
} from '@spinel/presence-ui';
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
import {
  getSyncPresence,
  type SyncPresenceChannel,
  type SyncPresenceState,
} from './syncPresence.ts';
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
function cursorDescription(selection?: string) {
  if (!selection) return 'No shared cursor position';
  if (/^\d+:\d+:\d+:TEXT::-1$/.test(selection)) return 'Shared text cursor';
  const address = selection.slice(selection.lastIndexOf('!') + 1);
  return /^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(address) ? address : 'Shared cursor position';
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
                  <span>{cursorDescription(person.selection)}</span>
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
  const channel = getSyncPresence(univer, id);
  if (channel) return watchSyncPresence(univer, api, id, channel, publish);
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

/** The flagged transport owns identities and liveness; this adapter owns ephemeral UI only. */
function watchSyncPresence(
  univer: Univer,
  api: FUniver,
  id: string,
  channel: SyncPresenceChannel,
  publish: (people: Collaborator[]) => void,
) {
  let state: SyncPresenceState = { selfId: '', members: [], connected: false };
  let disposed = false;
  let active = true;
  let frame = 0;
  let previous = '';
  let activeSheet = '';
  const popups: IDisposable[] = [];
  const cleanups: (() => void)[] = [];
  const injector = univer.__getInjector();
  const render = injector.get(IRenderManagerService).getRenderUnitById(id);
  const docSelections =
    api.getActiveDocument?.()?.getId() === id
      ? injector.get(DocSelectionManagerService)
      : undefined;
  let docSelection = docSelections?.getSelectionInfo({ unitId: id, subUnitId: id });
  const clearPopups = () => {
    for (const popup of popups.splice(0)) popup.dispose();
  };
  const localColor = () => {
    const me = state.connected && state.members.find((member) => member.id === state.selfId);
    if (!me || !active) return;
    const profile = avatarProfile(me.avatar);
    const color = profile
      ? palettes[getTheme()][`fill-${profile.color}-bg`]
      : collaboratorColor(me.id);
    const colors = presenceRenderColors(profile?.color ?? color, 'local');
    if (api.getActiveWorkbook?.()?.getId() === id)
      setLocalSelectionColor(univer, id, color, colors);
    else if (api.getActiveDocument?.()?.getId() === id)
      setLocalDocSelectionColor(univer, id, color, colors);
  };
  const update = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (disposed) return;
    clearPopups();
    if (!active || !state.connected) {
      publish([]);
      return;
    }
    const book = api.getActiveWorkbook?.();
    const document = api.getActiveDocument?.();
    const people = state.members.map((member) => {
      const profile = avatarProfile(member.avatar);
      const palette = palettes[getTheme()];
      const person: Collaborator = {
        id: member.id,
        name: member.name,
        color: profile ? palette[`fill-${profile.color}-bg`] : collaboratorColor(member.id),
        foreground: profile ? palette[`fill-${profile.color}-fg`] : '#ffffff',
        icon: profile?.icon ?? 'lucide:user-round',
        selection:
          member.selection && member.selection.length <= 160 ? member.selection : undefined,
      };
      const selection = person.selection;
      if (!selection || member.id === state.selfId) return person;
      if (document?.getId() === id) {
        const range = parseDocSelection(
          selection,
          document.getDocumentDataModel().getSnapshot().body?.dataStream.length ?? 0,
        );
        if (range)
          person.jump = () => {
            if (disposed || !state.connected || api.getActiveDocument?.()?.getId() !== id) return;
            // Following is the explicit user action that changes the local selection.
            const selections = render?.with(DocSelectionRenderService);
            selections?.setSegment('');
            selections?.setSegmentPage(-1);
            document.setSelection(range.startOffset, range.endOffset);
            selections?.focus();
          };
      } else if (book?.getId() === id) {
        const separator = selection.lastIndexOf('!');
        const sheet = book.getSheetBySheetId(selection.slice(0, separator));
        const address = selection.slice(separator + 1);
        if (sheet && /^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(address)) {
          try {
            const range = sheet.getRange(address);
            const bounds = range.getRange();
            if (
              bounds.startRow >= 0 &&
              bounds.endRow < sheet.getMaxRows() &&
              bounds.startColumn >= 0 &&
              bounds.endColumn < sheet.getMaxColumns()
            )
              person.jump = () => {
                if (disposed || !state.connected || api.getActiveWorkbook?.()?.getId() !== id)
                  return;
                book.setActiveSheet(sheet);
                render?.with(SheetsScrollRenderController).scrollToRange(bounds);
              };
          } catch {
            /* A deleted worksheet or invalid address has no follow destination. */
          }
        }
      }
      if (person.jump) {
        try {
          popups.push(
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
          /* Layout can be between skeletons; the next layout/scroll redraw retries it. */
        }
      }
      return person;
    });
    localColor();
    publish(people);
  };
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(update);
  };
  const sendCursor = () => {
    if (disposed || !state.connected || !state.selfId || !active) {
      previous = '';
      return;
    }
    let selection = '';
    const book = api.getActiveWorkbook?.();
    const document = api.getActiveDocument?.();
    if (book?.getId() === id) {
      const sheet = book.getActiveSheet();
      if (sheet.getSheetId() !== activeSheet) {
        activeSheet = sheet.getSheetId();
        schedule();
      }
      const range = sheet.getActiveRange();
      if (range)
        selection = `${sheet.getSheetId()}!${serializeRange({
          ...boundedSheetRange(range.getRange(), sheet.getMaxRows(), sheet.getMaxColumns()),
          rangeType: RANGE_TYPE.NORMAL,
        })}`;
    } else if (document?.getId() === id && docSelections) {
      const info = docSelection;
      const range = info?.textRanges.find((value) => value.isActive) ?? info?.textRanges.at(-1);
      if (
        info &&
        !info.segmentId &&
        info.segmentPage === -1 &&
        !info.rectRanges.length &&
        range &&
        !range.segmentId &&
        (range.segmentPage === undefined || range.segmentPage === -1) &&
        (range.rangeType === undefined || range.rangeType === 'TEXT')
      ) {
        const value = `${Math.min(range.startOffset, range.endOffset)}:${Math.max(range.startOffset, range.endOffset)}:1:TEXT::-1`;
        if (
          parseDocSelection(
            value,
            document.getDocumentDataModel().getSnapshot().body?.dataStream.length ?? 0,
          )
        )
          selection = value;
      }
    }
    localColor();
    // Match the server's cursor-only grammar; unsupported positions clear the cursor.
    // A long/native worksheet ID must never send repeated invalid protocol frames.
    if (
      selection.length > 160 ||
      (selection &&
        !(
          /^\d{1,7}:\d{1,7}:\d{1,7}:TEXT::-1$/.test(selection) ||
          /^[A-Za-z0-9_-]{1,64}![A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/.test(selection)
        ))
    )
      selection = '';
    const fingerprint = `${state.selfId}:${selection}`;
    if (previous === fingerprint) return;
    previous = fingerprint;
    channel.setCursor(selection);
  };
  cleanups.push(
    channel.subscribe((next) => {
      if (disposed) return;
      if (!next.connected || next.selfId !== state.selfId) previous = '';
      state = next;
      // Disconnect cleanup is immediate: stale labels never imply a live peer.
      if (!state.connected) update();
      else schedule();
    }),
  );
  cleanups.push(watchTheme(schedule));
  window.addEventListener('resize', schedule);
  cleanups.push(() => window.removeEventListener('resize', schedule));
  const scrolling = api.addEvent(api.Event.Scroll, ({ workbook }) => {
    if (workbook.getId() === id) schedule();
  });
  cleanups.push(() => scrolling.dispose());
  if (render) {
    const activation = render.activated$.subscribe((value) => {
      active = value;
      if (!value) update();
      else schedule();
    });
    cleanups.push(() => activation.unsubscribe());
    const transform = render.scene.onTransformChange$.subscribeEvent(schedule);
    const engine = render.engine.onTransformChange$.subscribeEvent(schedule);
    cleanups.push(
      () => transform.unsubscribe(),
      () => engine.unsubscribe(),
    );
    for (const viewport of render.scene.getViewports()) {
      const scrolling = viewport.onScrollAfter$.subscribeEvent(schedule);
      cleanups.push(() => scrolling.unsubscribe());
    }
    if (docSelections) {
      const skeletons = render.with(DocSkeletonManagerService);
      const position = render.mainComponent?.onTransformChange$.subscribeEvent(schedule);
      cleanups.push(() => position?.unsubscribe());
      let stopLayout: (() => void) | undefined;
      const skeleton = skeletons.currentSkeleton$.subscribe((current) => {
        stopLayout?.();
        const updates = [
          current?.dirty$.subscribe(schedule),
          current?.layoutProgress$.subscribe(schedule),
          current?.layoutPageMaterialized$.subscribe(schedule),
        ];
        stopLayout = () => updates.forEach((update) => update?.unsubscribe());
        schedule();
      });
      const selection = docSelections.textSelection$.subscribe((event) => {
        // Capture every native move, coalescing transport to the 150 ms timer.
        if (event.unitId === id) docSelection = event;
      });
      cleanups.push(
        () => {
          skeleton.unsubscribe();
          stopLayout?.();
        },
        () => selection.unsubscribe(),
      );
    }
  }
  // Sheet header selections and editor activation also use the same bounded payload.
  const timer = window.setInterval(sendCursor, 150);
  sendCursor();
  return () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    cancelAnimationFrame(frame);
    cleanups.reverse().forEach((close) => close());
    clearPopups();
    publish([]);
  };
}
