import { reviewViewports } from './storybook-review.ts';
import type { ReviewViewport } from './storybook-review.ts';

type ReviewResults = {
  classification?: string;
  build?: string;
  docsOnly?: string;
  viewports: Partial<Record<ReviewViewport, string>>;
};

export function checkStorybookReviewResults(results: ReviewResults): string {
  if (results.classification !== 'success' || results.build !== 'success') {
    throw new Error('Storybook classification and build must both succeed.');
  }
  if (results.docsOnly !== 'true' && results.docsOnly !== 'false') {
    throw new Error('Storybook change classification is missing.');
  }
  const expected = results.docsOnly === 'true' ? 'skipped' : 'success';
  for (const viewport of reviewViewports) {
    if (results.viewports[viewport] !== expected) {
      throw new Error(
        `Storybook ${viewport} review: expected ${expected}, received ${results.viewports[viewport] ?? 'missing'}.`,
      );
    }
  }
  return results.docsOnly === 'true'
    ? 'Not applicable — only allowlisted documentation changed; existing catalogue is unchanged.'
    : 'All desktop, tablet, and mobile Storybook captures and interactions passed.';
}

if (import.meta.main) {
  console.log(
    checkStorybookReviewResults({
      classification: process.env.CLASSIFICATION_RESULT,
      build: process.env.BUILD_RESULT,
      docsOnly: process.env.DOCS_ONLY,
      viewports: {
        desktop: process.env.DESKTOP_RESULT,
        tablet: process.env.TABLET_RESULT,
        mobile: process.env.MOBILE_RESULT,
      },
    }),
  );
}
