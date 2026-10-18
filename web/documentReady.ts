import type { Univer } from '@univerjs/core';
import { DocSkeletonManagerService } from '@univerjs/docs';
import { DocBackScrollRenderController, DocSelectionRenderService } from '@univerjs/docs-ui';
import { IRenderManagerService } from '@univerjs/engine-render';

// The global Rendered stage precedes asynchronous page layout. setSelection can
// deliberately blur an unresolved range, so wait for the actual document before
// calling it or advertising a usable editor. Only public render APIs are used.
export async function documentReady(univer: Univer, id: string, signal: AbortSignal) {
  const render = univer.__getInjector().get(IRenderManagerService).getRenderUnitById(id);
  if (!render) throw new Error('The document renderer did not start. Reload to try again.');
  const viewport = render.with(DocBackScrollRenderController);
  const skeletons = render.with(DocSkeletonManagerService);
  const selection = render.with(DocSelectionRenderService);
  await new Promise<void>((resolve, reject) => {
    let frame = 0;
    const finish = (error?: Error) => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancelled);
      if (error) reject(error);
      else resolve();
    };
    const cancelled = () => finish(new Error('Document loading cancelled.'));
    const timeout = window.setTimeout(
      () => finish(new Error('The document layout did not finish. Reload to try again.')),
      30_000,
    );
    const check = () => {
      if (signal.aborted) return cancelled();
      if (
        viewport.isViewportReady() &&
        skeletons.getSkeleton()?.findNodePositionByCharIndex(0) &&
        selection.inputElement?.isConnected
      )
        return finish();
      frame = requestAnimationFrame(check);
    };
    signal.addEventListener('abort', cancelled, { once: true });
    check();
  });
}
