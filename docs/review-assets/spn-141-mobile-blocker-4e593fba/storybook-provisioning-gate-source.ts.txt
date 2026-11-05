import { reviewViewports } from './storybook-review.ts';
import type { ReviewViewport } from './storybook-review.ts';

type ReviewResults = {
  classification?: string;
  build?: string;
  docsOnly?: string;
  captureScreenshots?: string;
  viewports: Partial<Record<ReviewViewport, string>>;
};

export function checkStorybookReviewResults(results: ReviewResults): string {
  if (results.classification !== 'success' || results.build !== 'success') {
    throw new Error('Storybook classification and build must both succeed.');
  }
  if (results.docsOnly !== 'true' && results.docsOnly !== 'false') {
    throw new Error('Storybook change classification is missing.');
  }
  if (results.captureScreenshots !== 'true' && results.captureScreenshots !== 'false') {
    throw new Error('Storybook screenshot policy is missing.');
  }
  const skip = results.docsOnly === 'true' && results.captureScreenshots === 'false';
  const expected = skip ? 'skipped' : 'success';
  for (const viewport of reviewViewports) {
    if (results.viewports[viewport] !== expected) {
      throw new Error(
        `Storybook ${viewport} review: expected ${expected}, received ${results.viewports[viewport] ?? 'missing'}.`,
      );
    }
  }
  return skip
    ? 'Not applicable — only allowlisted documentation changed; existing catalogue is unchanged.'
    : results.captureScreenshots === 'true'
      ? 'All desktop, tablet, and mobile Storybook captures and interactions passed.'
      : 'All desktop, tablet, and mobile Storybook checks passed; routine screenshots were not requested.';
}

if (import.meta.main) {
  console.log(
    checkStorybookReviewResults({
      classification: process.env.CLASSIFICATION_RESULT,
      build: process.env.BUILD_RESULT,
      docsOnly: process.env.DOCS_ONLY,
      captureScreenshots: process.env.CAPTURE_SCREENSHOTS,
      viewports: {
        desktop: process.env.DESKTOP_RESULT,
        tablet: process.env.TABLET_RESULT,
        mobile: process.env.MOBILE_RESULT,
      },
    }),
  );
}
