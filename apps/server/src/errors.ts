export class AppError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED') { super(message); }
}
export const forbidden = () => new AppError(403, 'No tenés permiso para realizar esta acción.', 'FORBIDDEN');
export const unauthorized = () => new AppError(401, 'Tu sesión terminó. Volvé a conectar.', 'UNAUTHORIZED');
