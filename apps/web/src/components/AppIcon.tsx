import { Activity, Bell, Bot, Box, Film, House, KeyRound, Music, Pickaxe, Shield, type LucideIcon } from 'lucide-react';
import type { AppIconName } from '@mainframe/shared';

const icons: Record<AppIconName, LucideIcon> = {
  shield: Shield,
  box: Box,
  pickaxe: Pickaxe,
  music: Music,
  bot: Bot,
  activity: Activity,
  film: Film,
  key: KeyRound,
  bell: Bell,
  house: House,
};

export function AppIcon({ name, size = 24 }: { name: string; size?: number }) {
  const Icon = icons[name as AppIconName] ?? Box;
  return (
    <span className="app-icon" aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}
