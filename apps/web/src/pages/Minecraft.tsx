import { Pickaxe } from 'lucide-react';

export function Minecraft() {
  return (
    <section className="page">
      <h1>Minecraft</h1>
      <div className="card empty">
        <Pickaxe aria-hidden="true" size={32} />
        <p>Kommt bald: hier steuerst du deinen Minecraft-Server.</p>
      </div>
    </section>
  );
}
