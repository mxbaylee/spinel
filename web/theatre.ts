export function shouldExitTheatre({
  key,
  prevented,
  composing,
  editing,
  interactive,
  overlay,
}: {
  key: string;
  prevented: boolean;
  composing: boolean;
  editing: boolean;
  interactive: boolean;
  overlay: boolean;
}) {
  return key === 'Escape' && !prevented && !composing && !editing && !interactive && !overlay;
}
