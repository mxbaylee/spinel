import { ICommandService } from '@univerjs/core';
import { expect, test } from 'vitest';
import { supportedMutationIds } from '../index.ts';
import { seededDoc } from './generate-docs.ts';
import { seededWorkbook } from './generate.ts';
import { Replica } from './harness.ts';

// The transforms name mutations by string so they load without Univer's
// plugins; a renamed mutation in a Univer upgrade must fail here, not pass
// through untransformed.
test('every supported id is a mutation Univer registers', () => {
  const replica = new Replica({ workbook: seededWorkbook(), doc: seededDoc() });
  const commands = replica.injector.get(ICommandService);
  const unknown = supportedMutationIds.filter((id) => !commands.hasCommand(id));
  expect(unknown).toEqual([]);
});
