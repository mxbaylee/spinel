import { AuthError, type AuthStore } from './store.ts';
import { defaultProfile, validColor, validIcon, type Profile } from '../../profile/profile.ts';
export class Profiles {
  private store: AuthStore;
  constructor(store: AuthStore) {
    this.store = store;
    store.database.exec(`CREATE TABLE IF NOT EXISTS auth_profiles (
      user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
      icon TEXT NOT NULL, color TEXT NOT NULL
    ) STRICT;`);
  }
  get(id: string): Profile {
    const user = this.store.user(id);
    if (!user) throw new AuthError(401, 'Sign in again.');
    const saved = this.store.database
      .prepare('SELECT icon,color FROM auth_profiles WHERE user_id=?')
      .get(id);
    return { ...defaultProfile(user.name), ...saved } as Profile;
  }
  save(id: string, value: unknown) {
    if (!value || typeof value !== 'object')
      throw new AuthError(400, 'Choose a name, colour and icon.');
    const { name, color, icon } = value as Record<string, unknown>;
    if (
      Object.keys(value).some((key) => !['name', 'color', 'icon'].includes(key)) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.trim().length > 80 ||
      /[\p{Cc}]/u.test(name) ||
      !validColor(color) ||
      !validIcon(icon)
    )
      throw new AuthError(
        400,
        'Use a name of 1–80 characters and choose a listed colour and icon.',
      );
    this.get(id);
    this.store.transaction(() => {
      this.store.database.prepare('UPDATE auth_users SET name=? WHERE id=?').run(name.trim(), id);
      this.store.database
        .prepare(
          'INSERT INTO auth_profiles(user_id,icon,color) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET icon=excluded.icon,color=excluded.color',
        )
        .run(id, icon, color);
    });
    return this.get(id);
  }
}
