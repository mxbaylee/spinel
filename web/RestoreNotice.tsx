import { useState } from 'react';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { validRestoreNotice } from '../src/shared/restore.ts';
import type { RestoreNotice as Notice } from '../src/shared/restore.ts';
import { Button } from '../src/ui/redesign/Controls.tsx';
import './restoreNotice.css';

export const restoreNoticeStorageKey = 'spinel:restore-notice-dismissed:v1';

/** One nonsecret value per browser; another device shows the notice again. */
function dismissedAt() {
  try {
    return Number(localStorage.getItem(restoreNoticeStorageKey)) || null;
  } catch {
    return null;
  }
}
const day = (value: number | string) =>
  new Date(value).toLocaleDateString(undefined, { dateStyle: 'long' });

/** Owners and Collaborators learn why they were signed out and what changed,
 * without any document names, counts or the Operator's private preview. */
export function RestoreNotice({ notice }: { notice: Notice | null }) {
  const [dismissed, setDismissed] = useState(dismissedAt);
  if (!validRestoreNotice(notice) || dismissed === notice.at) return null;
  const label = notice.outcome === 'restored' ? 'Workspace restored' : 'Workspace restore undone';
  return (
    <section className="restore-notice banner sp-ui" aria-label={label}>
      <ProfileIcon icon="lucide:history" size={18} />
      {notice.outcome === 'restored' ? (
        <p role="status">
          <strong>{label}.</strong> On {day(notice.at)}, it went back to a backup from{' '}
          {day(notice.backupCreatedAt)}. Changes made after that backup were discarded, everyone was
          signed out, and personal filing, links or sharing may have changed.
        </p>
      ) : (
        <p role="status">
          <strong>{label}.</strong> On {day(notice.at)}, a restore did not finish, so the workspace
          kept its own content. Everyone was signed out, and links or sharing may have changed.
        </p>
      )}
      <Button
        type="button"
        className="restore-notice-dismiss"
        aria-label="Dismiss restore notice"
        title="Dismiss"
        onClick={() => {
          try {
            localStorage.setItem(restoreNoticeStorageKey, String(notice.at));
          } catch {
            // Blocked storage only means the notice returns on the next visit.
          }
          setDismissed(notice.at);
        }}
      >
        <ProfileIcon icon="lucide:x" size={18} />
      </Button>
    </section>
  );
}
