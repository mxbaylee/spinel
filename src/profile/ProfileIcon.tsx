import { createElement } from 'react';
import { iconNodes } from './iconNodes.ts';
export function ProfileIcon({ icon, size = 20 }: { icon: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      data-profile-icon={icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconNodes(icon).map(([tag, props], index) => createElement(tag, { ...props, key: index }))}
    </svg>
  );
}
