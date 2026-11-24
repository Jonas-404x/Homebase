import { WifiOff } from 'lucide-react';
import { useSocketStatus } from '../api/live.tsx';

export function ConnectionBanner() {
  const status = useSocketStatus();
  if (status !== 'reconnecting') return null;
  return (
    <div className="banner banner-warn" role="status">
      <WifiOff aria-hidden="true" size={18} />
      <span>Verbindung weg, versuche es erneut …</span>
    </div>
  );
}
