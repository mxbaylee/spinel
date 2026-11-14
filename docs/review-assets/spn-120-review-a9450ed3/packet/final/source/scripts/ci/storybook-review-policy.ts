import { appendFile } from 'node:fs/promises';

export function resolveStorybookReviewPolicy(options: {
  eventName: string;
  docsOnly?: string;
  visualReview: boolean;
  manualCapture: boolean;
}) {
  if (!['pull_request', 'push', 'workflow_dispatch'].includes(options.eventName)) {
    throw new Error(`Unsupported Storybook event: ${options.eventName}`);
  }
  if (options.docsOnly !== 'true' && options.docsOnly !== 'false') {
    throw new Error('Storybook change classification is missing.');
  }
  const captureScreenshots =
    (options.eventName === 'pull_request' && options.visualReview) ||
    (options.eventName === 'workflow_dispatch' && options.manualCapture);
  return {
    captureScreenshots,
    // An explicit visual request also works on a documentation-only PR.
    reviewRequired: options.docsOnly === 'false' || captureScreenshots,
  };
}

if (import.meta.main) {
  const booleanInput = (name: string) => {
    const value = process.env[name];
    if (value !== 'true' && value !== 'false') {
      throw new Error(`Storybook ${name} must be true or false.`);
    }
    return value === 'true';
  };
  const policy = resolveStorybookReviewPolicy({
    eventName: process.env.GITHUB_EVENT_NAME ?? '',
    docsOnly: process.env.DOCS_ONLY,
    visualReview: booleanInput('VISUAL_REVIEW'),
    manualCapture: booleanInput('MANUAL_CAPTURE'),
  });
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('GITHUB_OUTPUT is required.');
  await appendFile(
    output,
    `capture_screenshots=${policy.captureScreenshots}\nreview_required=${policy.reviewRequired}\n`,
  );
}
