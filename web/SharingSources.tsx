import { useLayoutEffect, useRef, useState } from 'react';
import type { GrantRole, SharePerson } from '../src/shared/workspace.ts';
import { accessLabel } from '../src/shared/workspace.ts';
import type { SourceSharingReview, SourceSharingTarget } from '../src/shared/sourceSharing.ts';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { itemsRequest } from './itemsApi.ts';

function targetStatus(target: SourceSharingTarget, checked: boolean) {
  if (target.state === 'included') return 'Included with this Space';
  if (target.state === 'requires-owner') return 'Owner or File admin must share';
  if (target.state === 'grant') return checked ? 'Can view · Proposed' : 'No access';
  return `${target.access === 'viewer' ? 'Can view' : accessLabel(target.access!)} · Kept`;
}

/** A source review belongs to one recipient and one staged host-role choice. */
export function SharingSources({
  itemId,
  person,
  role,
  busy,
  checked,
  refresh,
  onChecked,
  onReview,
}: {
  itemId: string;
  person: SharePerson;
  role: GrantRole | null;
  busy: boolean;
  checked: boolean;
  refresh: number;
  onChecked: (checked: boolean) => void;
  onReview: (personId: string, review: SourceSharingReview | null) => void;
}) {
  const [review, setReview] = useState<SourceSharingReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const heading = useRef<HTMLElement | null>(null);
  const retryFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (loading || !retryFocus.current) return;
    (heading.current ?? retryFocus.current.querySelector<HTMLSelectElement>('select'))?.focus();
    retryFocus.current = null;
  }, [loading]);
  useLayoutEffect(() => {
    const request = ++generation.current;
    setReview(null);
    setLoading(true);
    setError('');
    onReview(person.id, null);
    const current = () => {
      if (request !== generation.current)
        throw new Error('This source review is no longer current.');
    };
    void itemsRequest<{ review: SourceSharingReview }>(
      `/${itemId}/sharing/review`,
      'POST',
      { userId: person.id, role },
      current,
    )
      .then((body) => {
        if (request !== generation.current) return;
        if (body.review.userId !== person.id || body.review.hostRole !== role)
          throw new Error('Review the selected person’s source access again.');
        setReview(body.review);
        onReview(person.id, body.review);
      })
      .catch((cause) => {
        if (request === generation.current)
          setError(cause instanceof Error ? cause.message : 'Could not check formula sources.');
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [itemId, person.id, role, refresh, retry, onReview]);

  if (!loading && !error && review && !review.unavailable && !review.targets.length) return null;
  const canInclude =
    !!review?.hostAccess && review.targets.some((target) => target.state === 'grant');
  const missing = review?.targets.some(
    (target) => target.state === 'grant' || target.state === 'requires-owner',
  );
  const onlyIncluded =
    !!review?.targets.length &&
    !review.unavailable &&
    review.targets.every((target) => target.state === 'included');
  return (
    <div
      className="sharing-sources"
      role="group"
      aria-label={`Formula sources for ${person.name}`}
      aria-busy={loading}
    >
      <strong ref={heading} tabIndex={-1}>
        Formula sources
      </strong>
      {loading ? (
        <p role="status">Checking formula sources… You can share the report alone.</p>
      ) : error ? (
        <>
          <p role="alert">
            Could not check formula sources. {error} Source permissions will stay unchanged when
            sharing the report alone.
          </p>
          <Button
            disabled={busy}
            onClick={(event) => {
              retryFocus.current = event.currentTarget.closest<HTMLElement>('.sharing-person');
              setRetry((value) => value + 1);
            }}
          >
            Retry source check
          </Button>
        </>
      ) : (
        review && (
          <>
            {onlyIncluded ? (
              <p className="sp-muted">
                Sources in this Space inherit access. No separate sharing is needed.
              </p>
            ) : (
              <>
                {missing && (
                  <p className="sp-muted">
                    Some formulas will be unavailable to {person.name} without access to their
                    sources.
                  </p>
                )}
                {review.unavailable && (
                  <p className="sp-muted">
                    Another source is unavailable to you. Its name is hidden; check its access or
                    whether it still exists.
                  </p>
                )}
                {canInclude && (
                  <label className="sharing-source-choice">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={(event) => onChecked(event.target.checked)}
                    />
                    <span>Also share source spreadsheets</span>
                  </label>
                )}
                {!!review.targets.length && (
                  <ul
                    className="sharing-source-list"
                    aria-label="Reviewed source access"
                    tabIndex={0}
                  >
                    {review.targets.map((target) => (
                      <li key={target.id}>
                        <div>
                          <strong>{target.name}</strong>
                          <span className="sp-muted">
                            {target.kind === 'space' ? 'Entire Space' : 'Spreadsheet'}
                          </span>
                          {target.kind === 'space' && (
                            <>
                              <ul aria-label={`Source spreadsheets in ${target.name}`}>
                                {target.sources.map((source) => (
                                  <li key={source.id}>{source.name}</li>
                                ))}
                              </ul>
                              {target.state === 'grant' && (
                                <span className="sp-muted">
                                  Can view every current and future page and folder in this Space.
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        <span className="sharing-source-status">
                          {targetStatus(target, checked && canInclude)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {checked && canInclude && (
                  <p className="sp-muted">
                    Only the listed targets marked Proposed will be shared with {person.name}.
                    Existing access is kept.
                  </p>
                )}
                {!review.hostAccess && missing && (
                  <p className="sp-muted">
                    Choose access to the report before also sharing sources.
                  </p>
                )}
              </>
            )}
          </>
        )
      )}
    </div>
  );
}
