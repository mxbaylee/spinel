import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../src/ui/redesign/Controls.tsx';

/** A copy failure leaves a selectable address; secrets exist only in the owning dialog. */
export function SharingAddress({ value, guest = false }: { value: string; guest?: boolean }) {
  const [fallback, setFallback] = useState(false);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  useLayoutEffect(() => {
    generation.current++;
    setFallback(false);
    setNotice('');
    return () => {
      generation.current++;
    };
  }, [value]);
  async function copy() {
    const request = generation.current;
    try {
      await navigator.clipboard.writeText(value);
      if (request === generation.current) setNotice(`${guest ? 'Guest' : 'Account'} link copied.`);
    } catch {
      if (request === generation.current) {
        setFallback(true);
        setNotice('Could not copy automatically. Select and copy the address below.');
      }
    }
  }
  return (
    <div className="sharing-address">
      <Button onClick={() => void copy()}>{guest ? 'Copy guest link' : 'Copy account link'}</Button>
      {(guest || fallback) && (
        <label>
          {guest ? 'Guest link address' : 'Share address'}
          <input readOnly value={value} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
