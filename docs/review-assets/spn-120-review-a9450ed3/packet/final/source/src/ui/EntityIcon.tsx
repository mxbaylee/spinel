import { entityIconPaths } from './entityIconGeometry.ts';
import type { EntityKind } from './entityIconGeometry.ts';

/** Decorative beside a type/name label; supply label for a meaningful standalone image. */
export function EntityIcon({
  kind,
  size = 24,
  label,
  monochrome = false,
}: {
  kind: EntityKind;
  size?: number;
  label?: string;
  monochrome?: boolean;
}) {
  const color = (token: string) => (token === 'none' ? token : `var(--${token})`);
  return (
    <svg
      className="entity-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      focusable="false"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {entityIconPaths(kind, monochrome).map((path, index) => (
        <path
          key={index}
          {...path}
          fill={color(path.fill)}
          stroke={path.stroke ? color(path.stroke) : undefined}
        />
      ))}
    </svg>
  );
}
