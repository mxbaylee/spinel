export type EditDescription = { family: string; action: 'edit' | 'undo' | 'redo' };
type Outcome = 'accepted' | 'refused' | 'discarded';

const newCounts = () => ({
  generated: 0,
  accepted: 0,
  refused: 0,
  discarded: 0,
  edit: 0,
  undo: 0,
  redo: 0,
  acceptedUndo: 0,
  acceptedRedo: 0,
});
export type FamilyCounts = ReturnType<typeof newCounts>;

/** Counts original mutations, never a transformed batch's expanded length. */
export class FamilyCoverage {
  readonly families = new Map<string, FamilyCounts>();
  private readonly originals = new Map<string, EditDescription & { outcome?: Outcome }>();

  generated(label: string, description: EditDescription) {
    if (this.originals.has(label)) throw new Error(`Duplicate generated mutation ${label}`);
    const counts = this.families.get(description.family) ?? newCounts();
    counts.generated++;
    counts[description.action]++;
    this.families.set(description.family, counts);
    this.originals.set(label, { ...description });
  }

  finish(labels: string[], outcome: Outcome) {
    for (const label of labels) {
      const original = this.originals.get(label);
      if (!original || original.outcome) continue;
      original.outcome = outcome;
      const counts = this.families.get(original.family)!;
      counts[outcome]++;
      if (outcome === 'accepted' && original.action === 'undo') counts.acceptedUndo++;
      if (outcome === 'accepted' && original.action === 'redo') counts.acceptedRedo++;
    }
  }

  assertSettled() {
    for (const [label, original] of this.originals) {
      if (!original.outcome) throw new Error(`Mutation ${label} has no terminal outcome`);
    }
  }

  add(other: FamilyCoverage) {
    other.assertSettled();
    for (const [family, values] of other.families) {
      const counts = this.families.get(family) ?? newCounts();
      for (const key of Object.keys(values) as (keyof FamilyCounts)[]) counts[key] += values[key];
      this.families.set(family, counts);
    }
  }
}
