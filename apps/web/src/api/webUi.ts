/**
 * Der Server schickt nur ":<port><pfad>". Den Host nimmt der Browser von seiner eigenen Adresse,
 * damit der Link passt, egal ob man Mainframe über LAN, Tailscale oder localhost aufruft.
 */
export function webUiHref(address: string): string {
  return `http://${window.location.hostname}${address}`;
}
