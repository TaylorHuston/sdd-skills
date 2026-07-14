export class SddError extends Error {
  constructor(message, { code = "SDD_ERROR", details = [] } = {}) {
    super(message);
    this.name = "SddError";
    this.code = code;
    this.details = details;
  }
}
