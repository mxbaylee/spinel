import { DocsPrintMenuSchema } from '@univerjs-pro/docs-print';
import type { FUniver } from '@univerjs/core/facade';

/** Docs publishes its print menu rather than a facade. Resolve the command from
 * that public schema; never import a private service or reproduce license logic. */
export async function printDocument(api: FUniver) {
  const commands: string[] = [];
  const visit = (value: unknown, key = '') => {
    if (!value || typeof value !== 'object') return;
    if ('menuItemFactory' in value && typeof value.menuItemFactory === 'function')
      commands.push(key);
    else for (const [name, child] of Object.entries(value)) visit(child, name);
  };
  visit(DocsPrintMenuSchema);
  if (commands.length !== 1) throw new Error('Use Print in the document toolbar to save a PDF.');
  await api.executeCommand(commands[0]);
}
