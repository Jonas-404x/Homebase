import { AlertTriangle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  load,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: ReactNode;
  /** 0–100, zeichnet einen Balken. Ab 90 % gibt es den Hinweis „Fast voll“. */
  load?: number;
}) {
  const high = load !== undefined && load > 90;
  return (
    <div className="card stat">
      <div className="stat-label">
        <Icon aria-hidden="true" size={18} />
        <span>{label}</span>
      </div>
      <div className="stat-value mono">{value}</div>
      {load !== undefined && (
        <div className="meter" aria-hidden="true">
          <div className={high ? 'meter-fill meter-warn' : 'meter-fill'} style={{ width: `${Math.min(100, load)}%` }} />
        </div>
      )}
      {high && (
        <div className="stat-warn">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>Fast voll</span>
        </div>
      )}
      {detail && <div className="stat-detail secondary">{detail}</div>}
    </div>
  );
}
