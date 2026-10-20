import { createElement } from 'react';
import { Flower, Cat } from 'lucide';
import type { Univer, IDisposable } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import type { IMember } from '@univerjs/protocol';
import { DocSelectionManagerService } from '@univerjs/docs';
import { CollaborationSessionService } from '@univerjs-pro/collaboration-client';
import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { drawPresence } from '@spinel/presence-ui';
import { getTheme, watchTheme } from '../src/ui/theme.ts';
import { palettes } from '../src/ui/palette.ts';
import { guestItemId } from './documentAccess.ts';

export function presencePrototypeEnabled() {
  return !guestItemId() && new URLSearchParams(location.search).get('presencePrototype') === '1';
}

export function PrototypeLabel({ name, alternate = false }: { name: string; alternate?: boolean }) {
  const preset = alternate ? 'success-strong' : 'info-strong';
  return (
    <span
      data-presence-prototype="label"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderRadius: 6,
        background: `var(--fill-${preset}-bg)`,
        color: `var(--fill-${preset}-fg)`,
        font: '12px system-ui',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      <svg
        aria-hidden="true"
        data-profile-icon={alternate ? 'cat' : 'flower'}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {(alternate ? Cat : Flower).map(([tag, props], index) =>
          createElement(tag, { ...props, key: index }),
        )}
      </svg>
      {name}
    </span>
  );
}

/** Opt-in experiment. Profiles are fixtures, and cursor offsets are not OT-transformed. */
export async function startPresencePrototype(univer: Univer, api: FUniver, id: string) {
  const injector = univer.__getInjector();
  const session = await injector.get(CollaborationSessionService).requireSession(id);
  const selections = new Map<string, string>();
  const drawings = new Map<string, IDisposable>();
  let members: IMember[] = [];
  const clear = () => {
    for (const drawing of drawings.values()) drawing.dispose();
    drawings.clear();
  };
  const render = () => {
    clear();
    for (const member of members) {
      const selection = selections.get(member.memberID);
      if (!selection || member.memberID === session.getMemberID()) continue;
      // Never introduce fixture identity into rooms whose server masks identities.
      if (member.name === 'Guest' || member.name === 'Collaborator') continue;
      const alternate = member.name.includes('Moss');
      const color = palettes[getTheme()][`fill-${alternate ? 'success' : 'info'}-strong-bg`];
      try {
        drawings.set(
          member.memberID,
          drawPresence(univer, api, id, selection, color, () => (
            <PrototypeLabel name={member.name} alternate={alternate} />
          )),
        );
      } catch (error) {
        // A stale remote range must not interrupt the local editor or other peers.
        console.warn('Presence prototype could not draw a remote range', error);
      }
    }
  };
  const membership = api.getCollaboration().subscribeCollaborators(id, (value) => {
    members = value;
    render();
  });
  const events = session.event$.subscribe((event) => {
    if (event.eventID !== CollaborationEvent.UPDATE_CURSOR || !('data' in event)) return;
    const data = event.data as { unitID?: unknown; memberID?: unknown; selection?: unknown };
    if (
      data.unitID !== id ||
      typeof data.memberID !== 'string' ||
      typeof data.selection !== 'string' ||
      data.selection.length > 4096
    )
      return;
    selections.set(data.memberID, data.selection);
    render();
  });
  const theme = watchTheme(render);
  let resizeFrame = 0;
  const resize = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(render);
  };
  window.addEventListener('resize', resize);
  // The disabled SDK UI normally publishes these. Reuse its public wire event,
  // without adding profile data to the guest-sensitive presence payload.
  let previous = '';
  let docSelection = '';
  const documentSelections =
    api.getActiveDocument?.()?.getId() === id
      ? injector.get(DocSelectionManagerService).textSelection$.subscribe((event) => {
          if (event.unitId !== id) return;
          const range = event.textRanges[0];
          docSelection =
            range && !event.segmentId ? `${range.startOffset}:${range.endOffset}:1:TEXT::-1` : '';
        })
      : null;
  const timer = window.setInterval(() => {
    const memberID = session.getMemberID();
    if (!memberID) return;
    let selection = '';
    const book = api.getActiveWorkbook?.();
    if (book?.getId() === id) {
      const sheet = book.getActiveSheet(),
        range = sheet.getActiveRange();
      if (range) selection = `${sheet.getSheetId()}!${range.getA1Notation()}`;
    } else {
      selection = docSelection;
    }
    if (selection === previous) return;
    previous = selection;
    void session
      .send(
        { eventID: CollaborationEvent.UPDATE_CURSOR, data: { unitID: id, memberID, selection } },
        id,
      )
      .catch(() => {
        previous = '';
      });
  }, 150);
  return () => {
    clearInterval(timer);
    documentSelections?.unsubscribe();
    events.unsubscribe();
    membership.dispose();
    theme();
    window.removeEventListener('resize', resize);
    cancelAnimationFrame(resizeFrame);
    clear();
  };
}
