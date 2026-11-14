import { expect, test } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from './store.ts';
import { Profiles } from './profile.ts';

test('profile defaults, persistence, account isolation and validation', () => {
  const db = openDatabase(':memory:');
  try {
    const auth = new AuthStore(db),
      profiles = new Profiles(auth);
    const bee = auth.createUser('Bee'),
      other = auth.createUser('Other');
    const original = profiles.get(other.id);
    expect(profiles.get(bee.id).icon).toBe('lucide:user-round');
    profiles.save(bee.id, { name: ' Bee Garden ', icon: 'lucide:flower', color: 'info-strong' });
    expect(new Profiles(auth).get(bee.id)).toEqual({
      name: 'Bee Garden',
      icon: 'lucide:flower',
      color: 'info-strong',
    });
    expect(profiles.get(other.id)).toEqual(original);
    for (const invalid of [
      { name: '' },
      { icon: 'lucide:not-real' },
      { color: '#123456' },
      { name: 'x'.repeat(81) },
      { name: 'a\nb' },
      { userId: other.id },
    ]) {
      expect(() => profiles.save(bee.id, { ...profiles.get(bee.id), ...invalid })).toThrow();
      expect(profiles.get(other.id)).toEqual(original);
    }
  } finally {
    db.close();
  }
});
