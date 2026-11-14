import { ThemeMenu } from './redesign/ThemeMenu.tsx';
export function ThemeSettings() {
  return (
    <section className="theme-settings" aria-labelledby="device-appearance-heading">
      <h2 id="device-appearance-heading">Appearance on this device</h2>
      <p>
        Saved in this browser. Defaults to System and follows your device’s appearance. Signing in
        does not change it.
      </p>
      <ThemeMenu />
      <p>
        Your documents stay the same for everyone. Your saved profile name, color and icon are
        separate.
      </p>
    </section>
  );
}
