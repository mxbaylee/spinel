import { IUniverInstanceService, UniverInstanceType } from '@univerjs/core';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import enUS from '@univerjs/preset-docs-core/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
const { univer } = createUniver({
  locale: LocaleType.EN_US,
  locales: { [LocaleType.EN_US]: mergeLocales(enUS) },
  presets: [UniverDocsCorePreset({ container: 'app' })],
});
univer.createUnit(UniverInstanceType.UNIVER_DOC, {});
(window as any).__len = () =>
  univer
    .__getInjector()
    .get(IUniverInstanceService)
    .getAllUnitsForType<any>(UniverInstanceType.UNIVER_DOC)[0]
    ?.getSnapshot().body?.dataStream.length;
(window as any).__ready = true;
