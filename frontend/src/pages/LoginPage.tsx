import { Building, CalendarCheck, Eye, EyeOff, FlaskConical, Lock, Mail, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { sessionStore } from '../auth/sessionStore';
import { BrandMark } from '../components/layout/AppLayout';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Feedback';
import { Field, Input } from '../components/ui/Form';
import { SERVICE_ENV, USE_MOCKS, missingServices } from '../config/env';
import { errorMessage } from '../hooks/useAsync';
import { TENANT_ID, isEmail, type Errors } from '../utils/validation';

interface LoginForm {
  tenantId: string;
  email: string;
  password: string;
}

const LOGOUT_MESSAGE = {
  expired: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  unauthorized: 'Tu sesión ya no es válida. Vuelve a iniciar sesión.',
  manual: 'Cerraste sesión correctamente.',
} as const;

function validate(form: LoginForm): Errors<LoginForm> {
  const errors: Errors<LoginForm> = {};
  const tenant = form.tenantId.trim().toLowerCase();
  if (!tenant) errors.tenantId = 'Ingresa el código de tu empresa.';
  else if (!TENANT_ID.test(tenant)) errors.tenantId = 'Usa minúsculas, números o "_" (empieza con una letra).';
  if (!form.email.trim()) errors.email = 'Ingresa tu email.';
  else if (!isEmail(form.email)) errors.email = 'Ingresa un email válido.';
  if (!form.password) errors.password = 'Ingresa tu contraseña.';
  return errors;
}

export function LoginPage() {
  const { session, login, lastLogout, acknowledgeLogout } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [form, setForm] = useState<LoginForm>({ tenantId: '', email: '', password: '' });
  const [errors, setErrors] = useState<Errors<LoginForm>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [logoutNotice] = useState(lastLogout);
  const missing = missingServices();

  useEffect(() => {
    if (lastLogout) acknowledgeLogout();
  }, [lastLogout, acknowledgeLogout]);

  if (session) {
    // La URL previa solo se reutiliza si vuelve a entrar el mismo usuario del mismo tenant.
    const previous = sessionStore.getState().previous;
    const sameIdentity = !previous || (previous.tenantId === session.claims.tenantId && previous.sub === session.claims.sub);
    return <Navigate to={sameIdentity ? from : '/'} replace />;
  }

  const update = (key: keyof LoginForm) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: event.target.value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validate(form);
    setErrors(found);
    setSubmitError(null);
    if (Object.values(found).some(Boolean)) return;
    setSubmitting(true);
    try {
      await login(form.tenantId, form.email, form.password);
      // La redirección la hace el bloque `if (session)` al re-renderizar.
    } catch (error) {
      setSubmitError(errorMessage(error));
      setForm((f) => ({ ...f, password: '' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-hero" aria-hidden>
        <BrandMark />
        <div className="login-hero-copy">
          <h2>Gestiona a tu equipo desde un solo lugar.</h2>
          <p>Empleados, reclutamiento, asistencia y ausencias para cada empresa, con sus datos siempre separados.</p>
          <ul>
            <li>
              <Users size={18} /> Fichas de empleados, departamentos y puestos
            </li>
            <li>
              <ShieldCheck size={18} /> Permisos por rol: Admin RR. HH., Manager y Empleado
            </li>
            <li>
              <CalendarCheck size={18} /> Asistencia, vacaciones y aprobaciones
            </li>
          </ul>
        </div>
        <span className="login-hero-foot">Plataforma multi-empresa (multi-tenant)</span>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={onSubmit} noValidate>
          <div className="login-mobile-brand">
            <BrandMark />
          </div>
          <h1>Iniciar sesión</h1>
          <p className="login-sub">Ingresa con el código de tu empresa y tus credenciales.</p>

          {logoutNotice && (
            <Alert tone={logoutNotice === 'manual' ? 'success' : 'warning'}>{LOGOUT_MESSAGE[logoutNotice]}</Alert>
          )}
          {missing.length > 0 && (
            <Alert tone="warning" title="Configuración incompleta">
              Faltan variables de entorno: {missing.map((s) => SERVICE_ENV[s]).join(', ')}. Copia{' '}
              <code>.env.example</code> a <code>.env</code> y completa las URLs.
            </Alert>
          )}
          {submitError && <Alert tone="danger">{submitError}</Alert>}

          <Field label="Código de empresa" error={errors.tenantId} required>
            <div className="input-icon">
              <Building size={16} />
              <Input
                value={form.tenantId}
                onChange={update('tenantId')}
                placeholder="ej. acme"
                autoComplete="organization"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
          </Field>
          <Field label="Email" error={errors.email} required>
            <div className="input-icon">
              <Mail size={16} />
              <Input type="email" value={form.email} onChange={update('email')} placeholder="tu@empresa.com" autoComplete="username" />
            </div>
          </Field>
          <Field label="Contraseña" error={errors.password} required>
            <div className="input-icon">
              <Lock size={16} />
              <Input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={update('password')}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="input-suffix"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>

          <Button type="submit" block loading={submitting}>
            Ingresar
          </Button>

          {USE_MOCKS && (
            <div className="demo-hint">
              <FlaskConical size={16} />
              <div>
                <strong>Modo demo (solo desarrollo)</strong>
                <span>
                  Empresas <code>acme</code> y <code>globex</code>. Usuarios <code>admin@</code>, <code>manager@</code> y{' '}
                  <code>empleado@</code> + <code>&lt;empresa&gt;.com</code>, contraseña <code>demo1234</code>.
                </span>
              </div>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
