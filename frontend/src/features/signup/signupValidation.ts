import { MIN_PASSWORD, isEmail, type Errors } from '../../utils/validation';

export interface SignupForm {
  companyName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export const COMPANY_NAME_MAX = 100;

/** Validaciones del navegador para el registro de empresas (Issue #15). */
export function validateSignup(form: SignupForm): Errors<SignupForm> {
  const errors: Errors<SignupForm> = {};
  const company = form.companyName.trim();
  if (!company) errors.companyName = 'Ingresa el nombre de tu empresa.';
  else if (company.length < 2) errors.companyName = 'El nombre debe tener al menos 2 caracteres.';
  else if (company.length > COMPANY_NAME_MAX) errors.companyName = `El nombre admite máximo ${COMPANY_NAME_MAX} caracteres.`;

  if (!form.email.trim()) errors.email = 'Ingresa el correo del administrador.';
  else if (!isEmail(form.email)) errors.email = 'Ingresa un correo válido.';

  if (!form.password) errors.password = 'Crea una contraseña.';
  else if (form.password.length < MIN_PASSWORD) errors.password = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;

  if (!form.confirmPassword) errors.confirmPassword = 'Repite la contraseña.';
  else if (form.password !== form.confirmPassword) errors.confirmPassword = 'Las contraseñas no coinciden.';
  return errors;
}

export function toSignupRequest(form: SignupForm) {
  return { companyName: form.companyName.trim(), email: form.email.trim().toLowerCase(), password: form.password };
}
