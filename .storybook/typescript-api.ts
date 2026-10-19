import { registerHooks } from 'node:module';

// TypeScript 7's package exports only its version, but Storybook's React preset
// and react-docgen-typescript load the classic compiler API when Storybook
// starts. Without it the preset fails, and with it the React renderer, so no
// story renders. Point those packages, and only those, at the TypeScript 5
// installed as `typescript-api`; everything else keeps TypeScript 7.
const consumers =
  /\/node_modules\/(?:@storybook\/react|react-docgen-typescript|@joshwooding\/vite-plugin-react-docgen-typescript)\//;

registerHooks({
  resolve(specifier, context, next) {
    if (
      (specifier === 'typescript' || specifier.startsWith('typescript/')) &&
      consumers.test(context.parentURL ?? '')
    )
      return next(specifier.replace(/^typescript/, 'typescript-api'), context);
    return next(specifier, context);
  },
});
