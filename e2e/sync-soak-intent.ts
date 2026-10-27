export interface DocSoakInsertion {
  label: string;
  text: string;
}

/** Each authored character has a unique identity, including across authors. */
export function docSoakInsertion(round: number, author: 'owner' | 'peer'): DocSoakInsertion {
  const first = 0x4e00 + (round * 2 + (author === 'owner' ? 0 : 1)) * 10;
  return {
    label: `${author}-${round.toString().padStart(3, '0')}`,
    text: Array.from({ length: 10 }, (_, index) => String.fromCodePoint(first + index)).join(''),
  };
}

/**
 * Later native insertions may split earlier text. Prove the exact authored
 * character inventory and each insertion's order without assuming adjacency
 * or importing the synchronization implementation into this independent oracle.
 */
export function assertDocSoakContent(stream: string, insertions: readonly DocSoakInsertion[]) {
  if (!stream.endsWith('\r\n')) throw new Error('The native Doc terminator was not preserved.');
  const expected = insertions.flatMap(({ text }) => [...text]);
  const inventory = new Set(expected);
  if (inventory.size !== expected.length)
    throw new Error('The Doc intent fixture reused an authored character identity.');
  const body = stream.slice(0, -2);
  const actual = [...body];
  if (actual.length !== expected.length)
    throw new Error(`Expected ${expected.length} authored characters, received ${actual.length}.`);
  const positions = new Map<string, number>();
  for (const [index, character] of actual.entries()) {
    const identity = `U+${character.codePointAt(0)!.toString(16)}`;
    if (!inventory.has(character)) throw new Error(`Unexpected authored character ${identity}.`);
    if (positions.has(character)) throw new Error(`Duplicated authored character ${identity}.`);
    positions.set(character, index);
  }
  for (const insertion of insertions) {
    let previous = -1;
    for (const character of insertion.text) {
      const position = positions.get(character);
      if (position === undefined) throw new Error(`Missing a character from ${insertion.label}.`);
      if (position <= previous)
        throw new Error(`Character order changed within ${insertion.label}.`);
      previous = position;
    }
  }
}
