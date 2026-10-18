// SPN-010 disposable client, using the documented public collaboration API.
import { LocaleType, UserManagerService } from '@univerjs/core';
import { createUniver, defaultTheme, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import SheetsEnglish from '@univerjs/preset-sheets-core/locales/en-US';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import DocsEnglish from '@univerjs/preset-docs-core/locales/en-US';
import { UniverLicensePlugin } from '@univerjs-pro/license';
import { UniverCollaborationPlugin } from '@univerjs-pro/collaboration';
import { UniverCollaborationClientPlugin } from '@univerjs-pro/collaboration-client';
import ClientEnglish from '@univerjs-pro/collaboration-client/locale/en-US';
import {
  BrowserCollaborationSocketService,
  UniverCollaborationClientUIPlugin,
} from '@univerjs-pro/collaboration-client-ui';
import UIEnglish from '@univerjs-pro/collaboration-client-ui/locale/en-US';
import '@univerjs-pro/collaboration-client/facade';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-docs-core/lib/index.css';
import '@univerjs-pro/collaboration-client-ui/lib/index.css';
const unit = new URLSearchParams(location.search).get('unit') ?? 'sheet-1';
const user = /(?:^|;\s*)spike-user=(user-\d+)/.exec(document.cookie)?.[1];
if (!user) throw new Error('Set disposable browser identity before loading');
const base = location.origin + '/universer-api';
const { univer, univerAPI } = createUniver({
  locale: LocaleType.EN_US,
  locales: {
    [LocaleType.EN_US]: mergeLocales(SheetsEnglish, DocsEnglish, ClientEnglish, UIEnglish),
  },
  theme: defaultTheme,
  collaboration: true,
  presets: [
    unit.startsWith('doc-')
      ? UniverDocsCorePreset({ container: 'editor' })
      : UniverSheetsCorePreset({ container: 'editor' }),
  ],
  plugins: [
    [UniverLicensePlugin, {}],
    UniverCollaborationPlugin,
    [
      UniverCollaborationClientPlugin,
      {
        socketService: BrowserCollaborationSocketService,
        sendChangesetTimeout: 200,
        authzUrl: base + '/authz',
        snapshotServerUrl: base + '/snapshot',
        collabSubmitChangesetUrl: base + '/comb',
        collabWebSocketUrl: 'ws://' + location.host + '/universer-api/comb/connect',
        wsSessionTicketUrl: base + '/user/session-ticket',
      },
    ],
    [UniverCollaborationClientUIPlugin, { enableUrlUnitLoader: false }],
  ],
});
univer
  .__getInjector()
  .get(UserManagerService)
  .setCurrentUser({ userID: user, name: user, avatar: '' });
const status = document.querySelector('#status')!;
try {
  const collab = univerAPI.getCollaboration();
  const doc = unit.startsWith('doc-')
    ? await collab.loadDocAsync(unit)
    : await collab.loadSheetAsync(unit);
  if (!doc) throw new Error('No document loaded');
  // Read-only observation for assertions. All edits are keyboard/pointer actions.
  Object.defineProperty(window, 'readSpikeSnapshot', { value: () => doc.save() });
  status.textContent = `Ready: ${unit} / ${user}`;
} catch (error) {
  status.textContent = String(error);
  console.error(error);
}
