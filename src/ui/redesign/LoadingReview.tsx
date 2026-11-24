import { LoadingRunner } from '../LoadingRunner.ts';
import './loadingReview.css';

export type LoadingReviewProps = {
  label?: string;
  size?: 'compact' | 'page';
  /** Omit to follow the application's current theme. */
  scheme?: 'light' | 'dark';
  /** A still specimen; the system reduced-motion preference always wins. */
  motion?: 'running' | 'still';
};

/** Decorative running silhouette; only the visible label is announced. */
export function LoadingReview({
  label = 'Loading…',
  size = 'page',
  scheme,
  motion = 'running',
}: LoadingReviewProps) {
  return (
    <div
      className={`sp-ui rd-loading rd-loading-${size}`}
      data-scheme={scheme}
      data-motion={motion}
      role="status"
    >
      <LoadingRunner />
      <span className="rd-loading-label">{label}</span>
    </div>
  );
}
