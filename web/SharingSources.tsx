import { useLayoutEffect, useRef, useState } from 'react';
import type { GrantRole, SharePerson } from '../src/shared/workspace.ts';
import { accessLabel } from '../src/shared/workspace.ts';
import type { SourceSharingReview, SourceSharingTarget } from '../src/shared/sourceSharing.ts';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { itemsRequest } from './itemsApi.ts';

function SourceList({
  targets,
  proposed = false,
  sharedIds = [],
}: {
  targets: SourceSharingTarget[];
  proposed?: boolean;
  sharedIds?: string[];
}) {
  return (
    <ul
      className="sharing-source-list"
      aria-label={proposed ? 'Proposed source access' : 'Reviewed source access'}
      tabIndex={0}
    >
      {targets.map((target) => (
        <li key={target.id}>
          <div>
            <strong>{target.name}</strong>
            {target.kind === 'space' && (
              <>
                <span className="sp-muted">Entire Space</span>
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
            {target.state === 'included'
              ? 'Included with this Space'
              : target.state === 'requires-owner'
                ? 'Owner or File admin must share'
                : target.state === 'grant'
                  ? proposed
                    ? 'Can view · Proposed'
                    : 'No access'
                  : `${accessLabel(target.access!)}${sharedIds.includes(target.id) ? ' · Shared' : ''}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Only the active recipient owns a current identity/role-bound source review. */
export function SharingSources({
  itemId,
  person,
  role,
  busy,
  checked,
  refresh,
  sharedIds,
  onChecked,
  onReview,
}: {
  itemId: string;
  person: SharePerson;
  role: GrantRole | null;
  busy: boolean;
  checked: boolean;
  refresh: number;
  sharedIds: string[];
  onChecked: (checked: boolean) => void;
  onReview: (review: SourceSharingReview | null) => void;
}) {
  const [review, setReview] = useState<SourceSharingReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const retryFocus = useRef<HTMLSelectElement | null>(null);
  useLayoutEffect(() => {
    if (loading || !retryFocus.current) return;
    const request = generation.current;
    const frame = requestAnimationFrame(() => {
      if (request !== generation.current) return;
      retryFocus.current?.focus();
      retryFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [loading]);
  useLayoutEffect(() => {
    const request = ++generation.current;
    setReview(null);
    setLoading(true);
    setError(false);
    onReview(null);
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
        onReview(body.review);
      })
      .catch(() => {
        if (request === generation.current) setError(true);
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [itemId, person.id, role, refresh, retry, onReview]);

  if (!loading && !error && review && !review.unavailable && !review.targets.length) return null;
  const grants = review?.targets.filter((target) => target.state === 'grant') ?? [];
  const blocked = review?.targets.some((target) => target.state === 'requires-owner');
  const canInclude = !!review?.hostAccess && grants.length > 0;
  const proposed = checked && canInclude;
  const details = review?.targets.filter((target) => !proposed || target.state !== 'grant') ?? [];
  const accessible =
    details.length > 0 &&
    details.every((target) => target.state === 'kept' || target.state === 'included');
  const onlyIncluded =
    !!review?.targets.length &&
    !review.unavailable &&
    review.targets.every((target) => target.state === 'included');
  const warning = blocked
    ? `Some formulas need source access from the Owner or File admin.${review?.unavailable ? ' Other sources are unavailable to you.' : ''}`
    : `${grants.length && !proposed ? 'Some formulas won’t work without source access.' : ''}${review?.unavailable ? `${grants.length && !proposed ? ' ' : ''}Some sources are unavailable to you.` : ''}`;
  return (
    <div
      className="sharing-sources"
      role="group"
      aria-label={`Formula sources for ${person.name}`}
      aria-busy={loading}
    >
      {loading ? (
        <p role="status" className="sp-muted">
          Checking sources…
        </p>
      ) : error ? (
        <>
          <p role="alert">
            Could not check formula sources. Sharing without them leaves source access unchanged.
          </p>
          <Button
            disabled={busy}
            onClick={(event) => {
              retryFocus.current =
                event.currentTarget.closest('.sharing-editor')?.querySelector('select') ?? null;
              setRetry((value) => value + 1);
            }}
          >
            Retry source check
          </Button>
        </>
      ) : (
        review &&
        (onlyIncluded ? (
          <p className="sp-muted">Sources in this Space inherit access.</p>
        ) : (
          <>
            {canInclude && (
              <label className="sharing-source-choice">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={(event) => onChecked(event.target.checked)}
                />
                <span>Include formula sources</span>
              </label>
            )}
            {warning && <p className="sp-muted">{warning}</p>}
            {!review.hostAccess && grants.length > 0 && (
              <p className="sp-muted">Choose access to the report to include its sources.</p>
            )}
            {proposed && <SourceList targets={grants} proposed />}
            {!!details.length && (
              <details
                className="sharing-details"
                key={`${review.version}:${proposed}`}
                open={sharedIds.length > 0}
              >
                <summary>
                  {accessible ? `Already accessible (${details.length})` : 'Source details'}
                </summary>
                <SourceList targets={details} sharedIds={sharedIds} />
              </details>
            )}
          </>
        ))
      )}
    </div>
  );
}
