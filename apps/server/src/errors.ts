/** Fehler mit maschinenlesbarem Code und deutscher Meldung für die Oberfläche. */
export class MainframeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'MainframeError';
    this.code = code;
    this.status = status;
  }
}
