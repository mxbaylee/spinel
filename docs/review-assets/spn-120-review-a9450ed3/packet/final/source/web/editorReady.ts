import type { FUniver } from '@univerjs/core/facade';

// Loading a snapshot returns before the render controllers are mounted. Do not
// expose a ready viewer (or apply permissions that initialization can replace)
// until the SDK's documented Rendered lifecycle stage has finished.
export async function editorReady(api: FUniver) {
  const rendered = api.Enum.LifecycleStages.Rendered;
  if (api.getCurrentLifecycleStage() >= rendered) return;
  await new Promise<void>((resolve) => {
    const listener = api.addEvent(api.Event.LifeCycleChanged, ({ stage }) => {
      if (stage >= rendered) {
        listener.dispose();
        resolve();
      }
    });
  });
}
