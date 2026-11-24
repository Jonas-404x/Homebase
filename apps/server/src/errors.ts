/** Fehler mit maschinenlesbarem Code und deutscher Meldung für die Oberfläche. */
export class HomebaseError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'HomebaseError';
    this.code = code;
    this.status = status;
  }
}
