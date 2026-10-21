import { icons } from 'lucide';
import { validIcon } from './profile.ts';
export function iconNodes(value: string) {
  const name = (validIcon(value) ? value.slice(7) : 'user-round')
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
  return icons[name as keyof typeof icons] ?? icons.UserRound;
}
