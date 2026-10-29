import { resolve } from 'node:path';

/** Trusted startup configuration shared by app and supervisor. Never deserialize
 * this policy from a browser request or a recovery archive's environment file.
 */
export interface ApplicationPolicy {
  origin: string;
  image: string | undefined;
  spaceReview: boolean;
  staticDirectory: string;
}
export function applicationPolicy(
  port: number,
  environment: NodeJS.ProcessEnv = process.env,
): ApplicationPolicy {
  return {
    origin: environment.APP_ORIGIN ?? `http://localhost:${port}`,
    image: environment.SPINEL_IMAGE,
    spaceReview: environment.SPINEL_SPACE_REVIEW !== '0',
    staticDirectory:
      environment.SPINEL_STATIC_DIRECTORY === undefined
        ? resolve(import.meta.dirname, '../dist')
        : resolve(environment.SPINEL_STATIC_DIRECTORY),
  };
}
