import { Bot, Box, Music, Pickaxe, Shield, type LucideIcon } from 'lucide-react';

const icons: Record<string, LucideIcon> = { shield: Shield, box: Box, pickaxe: Pickaxe, music: Music, bot: Bot };

export function AppIcon({ name, size = 24 }: { name: string; size?: number }) {
  const Icon = icons[name] ?? Box;
  return (
    <span className="app-icon" aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}
