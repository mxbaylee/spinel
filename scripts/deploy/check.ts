import { verifyHost } from './preflight.ts';
try {
  const config = verifyHost(process.env);
  console.log(
    `Preflight passed for ${config.hostname}; encrypted storage and local image are available.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Deployment preflight failed.');
  process.exitCode = 1;
}
