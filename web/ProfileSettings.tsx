import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { type Profile } from '../src/profile/profile.ts';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { ICON_CATEGORIES, searchPersonIcons } from '../src/profile/person-icon-search.ts';
import { Modal } from '../src/ui/redesign/Controls.tsx';
import './profile.css';
import { fillPresets } from '../src/ui/palette.ts';

export function IconPicker({
  value,
  choose,
  close,
  includeEmojis = false,
}: {
  value: string;
  choose: (value: string) => void;
  close: () => void;
  includeEmojis?: boolean;
}) {
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('All'),
    [limit, setLimit] = useState(60);
  const dialog = useRef<HTMLDialogElement>(null),
    grid = useRef<HTMLDivElement>(null);
  const select = (next: string) => {
    dialog.current?.close();
    choose(next);
  };
  const dismiss = () => {
    dialog.current?.close();
    close();
  };
  const results = searchPersonIcons(query, category, includeEmojis),
    visible = results.slice(0, limit);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const buttons = () =>
    Array.from(grid.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
  return (
    <dialog
      ref={dialog}
      className="profile-icon-dialog sp-ui"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation();
      }}
      aria-labelledby="icon-picker-title"
    >
      <h2 id="icon-picker-title" className="sp-modal-title">
        <span className="sp-modal-title-icon" aria-hidden="true">
          <ProfileIcon icon="lucide:shapes" size={20} />
        </span>
        <span>{includeEmojis ? 'Choose an icon or emoji' : 'Choose your icon'}</span>
      </h2>
      <label>
        {includeEmojis ? 'Search icons and emojis' : 'Search icons'}
        <input
          autoFocus
          maxLength={100}
          placeholder={includeEmojis ? 'Search a word or paste an emoji' : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(60);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              buttons()[0]?.focus();
            }
            if (event.key === 'Enter' && results.length === 1) {
              event.preventDefault();
              select(results[0].value);
            }
          }}
        />
      </label>
      <label>
        Category
        <select
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setLimit(60);
          }}
        >
          <option>All</option>
          {includeEmojis && <option>Emojis</option>}
          {ICON_CATEGORIES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <p role="status">{results.length} results</p>
      {!results.length && (
        <p>
          No {includeEmojis ? 'icons or emojis' : 'icons'} match. Try another name or description.
        </p>
      )}
      <div
        ref={grid}
        className="profile-icon-grid"
        aria-label={includeEmojis ? 'Icons and emojis' : 'Icons'}
        onKeyDown={(event) => {
          const all = buttons(),
            index = all.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          const columns = all.filter((button) => button.offsetTop === all[0].offsetTop).length;
          const next = (
            {
              ArrowRight: index + 1,
              ArrowLeft: index - 1,
              ArrowDown: index + columns,
              ArrowUp: index - columns,
              Home: 0,
              End: all.length - 1,
            } as Record<string, number>
          )[event.key];
          if (next !== undefined) {
            event.preventDefault();
            all[Math.max(0, Math.min(all.length - 1, next))]?.focus();
          }
        }}
      >
        {visible.map((icon) => (
          <button
            key={icon.value}
            className="sp-control"
            type="button"
            title={icon.label}
            aria-label={icon.label}
            aria-pressed={value === icon.value}
            onClick={() => select(icon.value)}
          >
            {icon.value.startsWith('lucide:') ? (
              <ProfileIcon icon={icon.value} />
            ) : (
              <span className="profile-picker-emoji" aria-hidden="true">
                {icon.value}
              </span>
            )}
          </button>
        ))}
      </div>
      {results.length > limit && (
        <button className="sp-control" type="button" onClick={() => setLimit(limit + 60)}>
          Show more
        </button>
      )}
      <button className="sp-control" type="button" onClick={dismiss}>
        Cancel
      </button>
    </dialog>
  );
}
export function ProfileSettings({
  onSaved,
  isAdmin = false,
}: {
  onSaved?: (profile: Profile) => void;
  isAdmin?: boolean;
}) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [picking, setPicking] = useState(false),
    [pickingColor, setPickingColor] = useState(false);
  const pickerButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let disposed = false;
    void api<Profile>('profile')
      .then((value) => {
        if (!disposed) setProfile(value);
      })
      .catch((cause) => {
        if (!disposed) setError(cause.message);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const close = () => {
    setPicking(false);
    // The modal must leave the top layer before its trigger can receive focus.
    requestAnimationFrame(() => pickerButton.current?.focus());
  };
  return (
    <section className="profile-settings" aria-labelledby="profile-heading">
      <h2 id="profile-heading">Make yourself at home</h2>
      <p>Your name and icon help collaborators recognize you.</p>
      {error && <p role="alert">{error}</p>}
      {!profile ? (
        <p role="status">{error ? 'Reload to try again.' : 'Loading profile…'}</p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            setNotice('');
            try {
              const saved = await api<Profile>('profile', profile);
              setProfile(saved);
              onSaved?.(saved);
              setNotice('Profile saved. Reopen your editors to update your presence.');
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not save your profile.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <legend className="profile-visually-hidden">Name and appearance</legend>
            <div className="profile-identity">
              <span
                className="profile-identity-avatar"
                style={{
                  background: `var(--fill-${profile.color}-bg)`,
                  color: `var(--fill-${profile.color}-fg)`,
                }}
              >
                <ProfileIcon icon={profile.icon} />
              </span>
              <div>
                <strong>{profile.name}</strong>
                <p>{isAdmin ? 'Operator account · No document access' : 'Your everyday account'}</p>
              </div>
              <button ref={pickerButton} type="button" onClick={() => setPicking(true)}>
                Choose icon
              </button>
              <button type="button" onClick={() => setPickingColor(true)}>
                Choose color
              </button>
            </div>
            <label>
              Display name
              <input
                required
                maxLength={80}
                value={profile.name}
                onChange={(event) => setProfile({ ...profile, name: event.target.value })}
              />
            </label>
            <button className="primary" type="submit">
              {busy ? 'Saving…' : 'Save profile'}
            </button>
          </fieldset>
          <p>
            Your name and icon appear in account-only documents. Documents with guest links keep
            generic identities.
          </p>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {profile && (
        <Modal
          title="Choose your color"
          icon="palette"
          open={pickingColor}
          onOpenChange={setPickingColor}
        >
          <div className="profile-colors" aria-label="Profile colour">
            {fillPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={profile.color === preset.id}
                aria-label={`Profile colour: ${preset.label}`}
                title={preset.label}
                style={{
                  background: `var(--fill-${preset.id}-bg)`,
                  color: `var(--fill-${preset.id}-fg)`,
                }}
                onClick={() => {
                  setProfile({ ...profile, color: preset.id });
                  setPickingColor(false);
                }}
              >
                <ProfileIcon icon={profile.icon} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {picking && profile && (
        <IconPicker
          value={profile.icon}
          close={close}
          choose={(icon) => {
            setProfile({ ...profile, icon });
            close();
          }}
        />
      )}
    </section>
  );
}
