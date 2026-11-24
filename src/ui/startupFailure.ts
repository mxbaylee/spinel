/** Retain public branding, stop decorative motion and preserve the existing recovery wording. */
export function showStartupFailure(root: HTMLElement) {
  const loading = root.querySelector<HTMLElement>('.sp-startup-content');
  const message = loading?.querySelector('p');
  if (loading && message) {
    loading.parentElement?.classList.add('sp-startup-failed');
    loading.setAttribute('role', 'alert');
  }
  (message ?? root).textContent =
    'Spinel could not start. Connect and reload to try again. Your saved device data has not been changed.';
}
