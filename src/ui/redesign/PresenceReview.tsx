import { useState } from 'react';
import type { Collaborator } from '../../../web/Collaborators.tsx';
import { ProfileIcon } from '../../profile/ProfileIcon.tsx';
import { Button, Modal } from './Controls.tsx';
import './presenceReview.css';

function PersonIcon({ person }: { person: Collaborator }) {
  return (
    <span
      className="rd-person-icon"
      style={{ backgroundColor: person.color, color: person.foreground ?? '#ffffff' }}
      aria-hidden="true"
    >
      <ProfileIcon icon={person.icon ?? 'lucide:user-round'} size={18} />
    </span>
  );
}

/** Presentation only: the caller supplies real navigation or clearly simulated callbacks. */
export function PresenceReview({ people, selfId }: { people: Collaborator[]; selfId?: string }) {
  const [open, setOpen] = useState(false);
  if (!people.length) return null;
  return (
    <div className="rd-people">
      <Button
        className="rd-presence-trigger sp-quiet"
        aria-label={`People in this document (${people.length})`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="People in this document"
        onClick={() => setOpen(true)}
      >
        <PersonIcon person={people[0]} />
        <span aria-hidden="true">{people.length}</span>
      </Button>
      <Modal
        icon="person"
        title="People in this document"
        description="Go to a person’s shared cursor position when one is available."
        open={open}
        onOpenChange={setOpen}
      >
        <ul className="rd-people-list">
          {people.map((person) => (
            <li key={person.id}>
              <PersonIcon person={person} />
              <div className="rd-person-details">
                <strong>{person.name}</strong>
                <span className="sp-muted">
                  {person.id === selfId
                    ? 'You'
                    : person.jump
                      ? person.selection
                        ? `Shared position: ${person.selection}`
                        : 'Shared cursor available'
                      : 'No shared cursor position'}
                </span>
              </div>
              {person.id !== selfId && person.jump && (
                <Button
                  aria-label={`Go to ${person.name}`}
                  onClick={() => {
                    person.jump?.();
                    setOpen(false);
                  }}
                >
                  Go to
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
