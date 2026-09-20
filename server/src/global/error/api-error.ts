export class ApiError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 503, readonly code: string, message: string, readonly retryable = false) { super(message); }
  get body(): { error: { code: string; message: string; retryable: boolean } } { return { error: { code: this.code, message: this.message, retryable: this.retryable } }; }
}
export const bad = (code: string, message: string) => new ApiError(400, code, message);
export const missing = (code: string, message: string) => new ApiError(404, code, message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
