import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { CollaborationSessionService, SessionStatus } from '@univerjs-pro/collaboration-client';

type Session = Awaited<ReturnType<CollaborationSessionService['requireSession']>>;

/** Public DI adapter: ephemeral cursor updates have no destination while offline. */
export class CollaborationSessions extends CollaborationSessionService {
  private readonly handles = new WeakMap<Session, Session>();

  override async requireSession(
    ...args: Parameters<CollaborationSessionService['requireSession']>
  ) {
    const session = await super.requireSession(...args);
    let handle = this.handles.get(session);
    if (!handle) {
      // Forward a handle instead of changing an SDK instance or its prototype.
      // Changesets, joins, status streams and all other methods retain SDK behavior.
      handle = new Proxy(session, {
        get(target, key) {
          if (key === 'send')
            return async (...args: Parameters<Session['send']>) => {
              if (
                args[0].eventID === CollaborationEvent.UPDATE_CURSOR &&
                target.sessionStatus !== SessionStatus.ONLINE
              )
                return;
              return target.send(...args);
            };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      this.handles.set(session, handle);
    }
    return handle;
  }
}
