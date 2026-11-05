/** Shared execution identity only: safe to import before dependencies or devices exist. */
type ScopeDefinition = {
  browser: 'chrome' | 'firefox' | 'safari' | null;
  authored: boolean;
  context: 'installed' | 'ordinary-tab';
  completionStage: string;
};

const definitions = {
  all: {
    browser: null,
    authored: false,
    context: 'installed',
    completionStage: 'capability-complete',
  },
  'chrome-navigation-diagnostic': {
    browser: 'chrome',
    authored: false,
    context: 'installed',
    completionStage: 'capability-complete',
  },
  'safari-acceptance': {
    browser: 'safari',
    authored: true,
    context: 'installed',
    completionStage: 'safari-acceptance-complete',
  },
  'chrome-acceptance': {
    browser: 'chrome',
    authored: true,
    context: 'installed',
    completionStage: 'chrome-acceptance-complete',
  },
  'chrome-tab-acceptance': {
    browser: 'chrome',
    authored: true,
    context: 'ordinary-tab',
    completionStage: 'chrome-tab-acceptance-complete',
  },
  'firefox-tab-acceptance': {
    browser: 'firefox',
    authored: true,
    context: 'ordinary-tab',
    completionStage: 'firefox-tab-acceptance-complete',
  },
  'safari-tab-acceptance': {
    browser: 'safari',
    authored: true,
    context: 'ordinary-tab',
    completionStage: 'safari-tab-acceptance-complete',
  },
} as const satisfies Record<string, ScopeDefinition>;

export type CapabilityScope = keyof typeof definitions;

export function readCapabilityScope(value: unknown): CapabilityScope {
  if (value === undefined) return 'all';
  if (typeof value !== 'string' || !Object.hasOwn(definitions, value))
    throw new Error('capability-invalid-scope');
  return value as CapabilityScope;
}

export function capabilityScopeDefinition(scope: CapabilityScope): ScopeDefinition {
  return definitions[scope];
}
