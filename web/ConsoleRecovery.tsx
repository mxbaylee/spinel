type Props = {
  name: string;
  loading: boolean;
  validLink: boolean;
  busy: boolean;
  error: string;
  notice: string;
  onRecover: () => void;
  onCancel: () => void;
};

/** The console claim uses the existing single-purpose recovery entry pattern. */
export function ConsoleRecovery({
  name,
  loading,
  validLink,
  busy,
  error,
  notice,
  onRecover,
  onCancel,
}: Props) {
  return (
    <>
      <p className="eyebrow">Workspace administration</p>
      <h1>Recover admin access</h1>
      <section className="welcome">
        {loading ? (
          <p role="status">Checking the recovery link…</p>
        ) : name ? (
          <>
            <h2>{name}</h2>
            <p>
              Add a new passkey to this existing admin account. This replaces all its old passkeys
              and signs out its other devices. Accounts and documents stay unchanged.
            </p>
            <button className="primary" disabled={busy} onClick={onRecover}>
              Recover admin with a passkey
            </button>
          </>
        ) : (
          <p role={error ? undefined : 'alert'}>
            {validLink
              ? 'This recovery link could not be opened. Open a new one-time recovery link from the server console.'
              : 'Open the one-time recovery link printed on the server. If it expired, run the recovery command again.'}
          </p>
        )}
        {busy && (
          <p role="status">
            Follow the instructions from your passkey manager.{' '}
            <button onClick={onCancel}>Cancel</button>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
    </>
  );
}
