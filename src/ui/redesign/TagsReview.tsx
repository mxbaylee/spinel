import { useId, useRef, useState } from 'react';
import { Button } from './Controls.tsx';
import './tagsReview.css';

export type TagsReviewState =
  | 'ready'
  | 'suggestions-loading'
  | 'suggestions-failed'
  | 'adding'
  | 'add-failed'
  | 'removing'
  | 'remove-failed';

export function TagLabelsReview({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="rd-tag-labels" title={`Your tags: ${tags.join(', ')}`}>
      <span className="rd-tags-sr-only">Your tags: {tags.join(', ')}</span>
      <span className="rd-tag-visible" aria-hidden="true">
        {tags.slice(0, 2).map((tag) => (
          <span className="rd-tag-label" key={tag}>
            #{tag}
          </span>
        ))}
        {tags.length > 2 && <span className="rd-tag-count">+{tags.length - 2}</span>}
      </span>
    </span>
  );
}

/** Personal-tag fixtures only. No file content or server metadata is changed. */
export function TagsReview({
  initialTags = [],
  state = 'ready',
  suggestions = ['budget', 'finance', 'q4', 'travel'],
  onChange,
  onClose,
}: {
  initialTags?: string[];
  state?: TagsReviewState;
  suggestions?: string[];
  onChange?: (tags: string[]) => void;
  onClose?: () => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState(initialTags);
  const [draft, setDraft] = useState(['adding', 'add-failed'].includes(state) ? 'budget' : '');
  const [suggestionsFailed, setSuggestionsFailed] = useState(state === 'suggestions-failed');
  const [mutationError, setMutationError] = useState(
    state === 'add-failed' ? 'Could not add the tag. Your entry is still here. Try again.' : '',
  );
  const [removeFailed, setRemoveFailed] = useState(
    state === 'remove-failed' ? initialTags[0] : undefined,
  );
  const [notice, setNotice] = useState('');
  const busy = state === 'adding' || state === 'removing';
  const suggested = [...new Set([...suggestions, ...tags])]
    .filter(
      (tag) => !tags.includes(tag) && tag.includes(draft.trim().replace(/^#/, '').toLowerCase()),
    )
    .slice(0, 4);
  function update(next: string[]) {
    setTags(next);
    onChange?.(next);
    requestAnimationFrame(() => input.current?.focus());
  }
  function add() {
    if (busy) return;
    const tag = draft
      .trim()
      .replace(/^#/, '')
      .trim()
      .normalize('NFC')
      .toLowerCase()
      .normalize('NFC');
    // Match the existing personal-tag contract, including one optional leading #.
    if (!tag || tag.length > 64 || tag.startsWith('#') || /[\p{Cc}\p{Cs}]/u.test(draft)) {
      setMutationError(
        'Use a tag of 1–64 characters, with at most one leading # and no control characters.',
      );
      return;
    }
    update([...new Set([...tags, tag])].sort());
    setDraft('');
    setMutationError('');
    setNotice(`#${tag} added to your tags in this preview.`);
  }
  return (
    <div className="rd-tags-review">
      <p className="sp-muted">
        Only you see these tags. They do not change the document or anyone else’s tags.
      </p>
      {tags.length ? (
        <ul className="rd-tag-editor-list" aria-label="Your tags">
          {tags.map((tag) => (
            <li key={tag}>
              <div className="rd-tag-editor-row">
                <span>#{tag}</span>
                <Button
                  disabled={busy}
                  aria-label={`${removeFailed === tag ? 'Retry removing' : 'Remove'} #${tag}`}
                  onClick={() => {
                    update(tags.filter((value) => value !== tag));
                    setRemoveFailed(undefined);
                    setNotice(`#${tag} removed from your tags in this preview.`);
                  }}
                >
                  {state === 'removing' && tag === initialTags[0]
                    ? 'Removing…'
                    : removeFailed === tag
                      ? 'Try again'
                      : 'Remove'}
                </Button>
              </div>
              {removeFailed === tag && (
                <p role="alert">Could not remove #{tag}. It is still on this file. Try again.</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No tags yet.</p>
      )}
      <form
        className="rd-tag-add"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label htmlFor={inputId}>Tag</label>
        <input
          id={inputId}
          ref={input}
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="For example, budget"
          required
        />
        <Button type="submit" disabled={busy || !draft.trim()}>
          {state === 'adding' ? 'Adding…' : mutationError ? 'Try again' : 'Add tag'}
        </Button>
      </form>
      {state === 'suggestions-loading' ? (
        <p role="status">Loading your tag suggestions… You can still type a tag.</p>
      ) : suggestionsFailed ? (
        <div>
          <p role="alert">Could not load your tag suggestions. You can still type a tag.</p>
          <Button onClick={() => setSuggestionsFailed(false)}>Retry suggestions</Button>
        </div>
      ) : (
        suggested.length > 0 && (
          <div className="rd-tag-suggestions" role="group" aria-label="Your tag suggestions">
            <span className="sp-muted">Suggestions</span>
            {suggested.map((tag) => (
              <Button
                key={tag}
                disabled={busy}
                onClick={() => {
                  setDraft(tag);
                  input.current?.focus();
                }}
              >
                #{tag}
              </Button>
            ))}
          </div>
        )
      )}
      {mutationError && <p role="alert">{mutationError}</p>}
      {busy && (
        <p role="status">{state === 'adding' ? 'Adding your tag…' : 'Removing your tag…'}</p>
      )}
      {notice && <p role="status">{notice}</p>}
      {onClose && (
        <div className="sp-actions">
          <Button disabled={busy} onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
