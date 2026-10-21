/** Connected review fixtures only. Never mounts the application or calls its APIs. */
import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Choice, Modal } from './Controls.tsx';
import {
  AdminMockup,
  DashboardMockup,
  EditorMockup,
  EntryMockup,
  HistoryMockup,
  ProfileMockup,
  ReviewProfileContext,
} from './Mockups.tsx';
import { EntryJourney } from './EntryJourney.tsx';
import type { EntryScreen, EntryOutcome } from './EntryJourney.tsx';
import './walkthrough.css';
import { defaultProfile } from '../../profile/profile.ts';

type Persona = 'owner' | 'collaborator' | 'operator' | 'guest';
type Screen =
  EntryScreen | 'files' | 'editor' | 'profile' | 'admin' | 'history' | 'revoked' | 'offline';
type File = {
  name: string;
  kind: 'doc' | 'sheet' | 'space';
  access: 'owner' | 'editor' | 'viewer';
};
const entryScreens = ['home', 'sign-in', 'invite', 'recovery', 'setup'];
const firstFile: File = { name: 'Quarterly budget', kind: 'sheet', access: 'editor' };

export function Walkthrough({
  persona = 'owner',
  start = 'home',
  initialOutcome = 'ready',
}: {
  persona?: Persona;
  start?: Screen;
  initialOutcome?: EntryOutcome;
}) {
  const [profile, setProfile] = useState(
    defaultProfile(
      persona === 'operator' ? 'Operator' : persona === 'collaborator' ? 'Alex Kim' : 'Alex Baylee',
    ),
  );
  const [screen, setScreen] = useState<Screen>(start);
  const [outcome, setOutcome] = useState<EntryOutcome>(initialOutcome);
  const [file, setFile] = useState<File>(
    persona === 'guest' ? { name: 'Autumn plans', kind: 'doc', access: 'viewer' } : firstFile,
  );
  const [signedIn, setSignedIn] = useState(
    ['files', 'editor', 'profile', 'admin', 'history'].includes(start) && persona !== 'guest',
  );
  const [firstRun, setFirstRun] = useState(start === 'setup');
  const [returnTo, setReturnTo] = useState<Screen>(persona === 'operator' ? 'admin' : 'files');
  const [save, setSave] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [offline, setOffline] = useState(false);
  const [leaveTo, setLeaveTo] = useState<Screen>();
  const [generation, setGeneration] = useState(0);
  const [credential, setCredential] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [event, setEvent] = useState('');
  const pageRef = useRef<HTMLDivElement>(null);
  const fileFocus = useRef<HTMLElement | null>(null);
  const fileScroll = useRef(0);
  const commitNavigation = (next: Screen) => {
    if (next === 'profile') setReturnTo(screen === 'history' ? 'editor' : screen);
    setScreen(next);
    setOutcome('ready');
  };
  const navigate = (next: Screen) => {
    if (
      (screen === 'editor' || screen === 'history') &&
      save !== 'saved' &&
      !['history', 'editor'].includes(next)
    ) {
      setLeaveTo(next);
      return;
    }
    commitNavigation(next);
  };
  const openFile = (next: File) => {
    fileFocus.current = document.activeElement as HTMLElement;
    fileScroll.current = window.scrollY;
    setFile(next);
    setSave('saved');
    setScreen('editor');
  };
  useLayoutEffect(() => {
    if (screen === 'files' && fileFocus.current?.isConnected) {
      fileFocus.current.focus({ preventScroll: true });
      window.scrollTo(0, fileScroll.current);
    } else {
      window.scrollTo(0, 0);
      const heading = Array.from(pageRef.current?.querySelectorAll<HTMLElement>('h1') ?? []).find(
        (node) => node.getClientRects().length > 0,
      );
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: true });
    }
  }, [screen, generation]);
  const finishPasskey = () => {
    setSignedIn(true);
    setOutcome('ready');
    setScreen(persona === 'operator' ? 'admin' : persona === 'collaborator' ? 'editor' : 'files');
  };
  const reset = () => {
    setScreen(start);
    setOutcome(initialOutcome);
    setSave('saved');
    setOffline(false);
    setFile(
      persona === 'guest' ? { name: 'Autumn plans', kind: 'doc', access: 'viewer' } : firstFile,
    );
    setSignedIn(
      ['files', 'editor', 'profile', 'admin', 'history'].includes(start) && persona !== 'guest',
    );
    setFirstRun(start === 'setup');
    setGeneration(generation + 1);
    setEvent('');
  };
  const entry = entryScreens.includes(screen);
  const simulate = (value: string) => {
    setEvent(value);
    if (screen === 'profile' && value === 'passkey-success') setCredential('success');
    else if (screen === 'profile' && value === 'passkey-error') setCredential('error');
    else if (value === 'passkey-success') finishPasskey();
    else if (value === 'passkey-cancel') setOutcome('cancelled');
    else if (value === 'passkey-error') setOutcome('error');
    else if (value === 'saving') setSave('saving');
    else if (value === 'save-error') setSave('failed');
    else if (value === 'saved') {
      setSave('saved');
      setOffline(false);
    } else if (value === 'offline') setOffline(true);
    else if (value === 'revoked') {
      setScreen('revoked');
      setFile({ name: '', kind: 'doc', access: 'viewer' });
    } else if (value === 'guest-doc' || value === 'guest-sheet') {
      setFile({
        name: value === 'guest-sheet' ? 'Quarterly budget' : 'Autumn plans',
        kind: value === 'guest-sheet' ? 'sheet' : 'doc',
        access: file.access,
      });
      setScreen('editor');
    } else if (value === 'guest-viewer' || value === 'guest-editor')
      setFile({ ...file, access: value === 'guest-editor' ? 'editor' : 'viewer' });
    else if (value === 'cold-offline') setScreen('offline');
    else if (value === 'invalid-link') setOutcome('invalid');
  };
  return (
    <div className="sp-ui rd-walkthrough">
      <details className="rd-review-tools">
        <summary>
          Design walkthrough · {persona === 'guest' ? 'Link guest' : persona} · local preview
        </summary>
        <div className="rd-review-controls">
          <p>
            No accounts or documents are changed. Browser passkey prompts and save results are
            simulated here.
          </p>
          <Choice
            label="Preview event"
            value={event}
            onChange={simulate}
            options={[
              { value: '', label: 'Choose an event…' },
              ...(entry || screen === 'profile'
                ? [
                    { value: 'passkey-success', label: 'Passkey succeeded' },
                    { value: 'passkey-cancel', label: 'Passkey cancelled' },
                    { value: 'passkey-error', label: 'Passkey failed' },
                    ...(['setup', 'invite', 'recovery'].includes(screen)
                      ? [{ value: 'invalid-link', label: 'Link invalid or expired' }]
                      : []),
                  ]
                : []),
              ...(screen === 'editor'
                ? [
                    { value: 'saving', label: 'Edit is saving' },
                    { value: 'save-error', label: 'Save failed' },
                    { value: 'saved', label: 'Save succeeded / reconnected' },
                    { value: 'offline', label: 'Connection lost' },
                  ]
                : []),
              ...(persona === 'guest'
                ? [
                    { value: 'guest-doc', label: 'Open shared Doc' },
                    { value: 'guest-sheet', label: 'Open shared Sheet' },
                    { value: 'guest-viewer', label: 'Viewer access' },
                    { value: 'guest-editor', label: 'Editor access' },
                    { value: 'revoked', label: 'Owner turns off link' },
                    { value: 'cold-offline', label: 'Open link while offline' },
                  ]
                : []),
            ]}
          />
          <Button onClick={reset}>Restart walkthrough</Button>
        </div>
      </details>
      <ReviewProfileContext.Provider value={{ profile, save: setProfile }}>
        <div ref={pageRef} className="rd-walkthrough-page" key={generation}>
          {entry && (
            <EntryJourney
              screen={screen as EntryScreen}
              accountName={profile.name}
              outcome={outcome}
              onNavigate={(next) => {
                setScreen(next);
                setOutcome('ready');
              }}
              onPasskey={(name) => {
                if (name) setProfile({ ...profile, name });
                setOutcome('pending');
                setEvent('');
              }}
            />
          )}
          {signedIn && persona !== 'operator' && (
            <div hidden={screen !== 'files'}>
              <DashboardMockup
                state={persona === 'collaborator' ? 'shared' : 'populated'}
                onOpen={openFile}
                onProfile={() => navigate('profile')}
              />
            </div>
          )}
          {(signedIn || persona === 'guest') &&
            !['revoked', 'offline'].includes(screen) &&
            persona !== 'operator' && (
              <div hidden={screen !== 'editor'}>
                <EditorMockup
                  key={`${file.kind}:${file.name}:${file.access}`}
                  title={file.name}
                  sheet={file.kind === 'sheet'}
                  space={file.kind === 'space'}
                  guest={persona === 'guest'}
                  viewOnly={file.access === 'viewer'}
                  collaborator={file.access === 'editor'}
                  offline={offline}
                  saveState={save}
                  onRetrySave={() => {
                    setSave('saved');
                    setOffline(false);
                  }}
                  onBack={() => navigate('files')}
                  onProfile={() => navigate('profile')}
                  onHistory={() => navigate('history')}
                />
              </div>
            )}
          {signedIn && (
            <div hidden={screen !== 'profile'}>
              <ProfileMockup
                credential={credential}
                onCredential={(next) => {
                  setCredential(next);
                  setEvent('');
                }}
                operator={persona === 'operator'}
                onBack={() => navigate(returnTo)}
                returnLabel={
                  returnTo === 'editor'
                    ? 'Back to document'
                    : persona === 'operator'
                      ? 'Back to Administration'
                      : 'Back to files'
                }
                onSignOut={() => {
                  setSignedIn(false);
                  setScreen('home');
                  setGeneration(generation + 1);
                }}
              />
            </div>
          )}
          {signedIn && persona === 'operator' && (
            <div hidden={screen !== 'admin'}>
              <AdminMockup firstRun={firstRun} onProfile={() => navigate('profile')} />
            </div>
          )}
          {screen === 'history' && (
            <HistoryMockup
              title={file.name}
              sheet={file.kind === 'sheet'}
              viewOnly={file.access === 'viewer'}
              onBack={() => navigate('editor')}
              onFiles={() => navigate('files')}
              onProfile={() => navigate('profile')}
            />
          )}
          {screen === 'revoked' && <EntryMockup kind="revoked" />}
          {screen === 'offline' && <EntryMockup kind="offline" />}
        </div>
      </ReviewProfileContext.Provider>
      <Modal
        title="Leave with unsaved changes?"
        description="Your latest changes have not been saved. Stay here to retry saving before leaving."
        open={Boolean(leaveTo)}
        onOpenChange={(open) => {
          if (!open) setLeaveTo(undefined);
        }}
      >
        <div className="sp-actions">
          <Button primary onClick={() => setLeaveTo(undefined)}>
            Keep editing
          </Button>
          <Button
            onClick={() => {
              if (leaveTo) commitNavigation(leaveTo);
              setLeaveTo(undefined);
              setSave('saved');
            }}
          >
            Leave without saving
          </Button>
        </div>
      </Modal>
    </div>
  );
}
