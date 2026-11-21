import { ArrowLeft, ArrowRight, Building2, Check, Copy, Eye, EyeOff, KeyRound, Lock, Mail, PartyPopper } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { identityApi } from '../../api/identity';
import type { SignupResponse } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { sessionStore } from '../../auth/sessionStore';
import { BrandMark } from '../../components/layout/AppLayout';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Field, Input } from '../../components/ui/Form';
import { SERVICE_ENV, USE_MOCKS, serviceBaseUrl } from '../../config/env';
import { errorMessage } from '../../hooks/useAsync';
import { MIN_PASSWORD, type Errors } from '../../utils/validation';
import { COMPANY_NAME_MAX, toSignupRequest, validateSignup, type SignupForm } from './signupValidation';

/** Registro público de una empresa nueva (POST /signup en identity). */
export function SignupPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<SignupForm>({ companyName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Errors<SignupForm>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [result, setResult] = useState<SignupResponse | null>(null);
  const inFlight = useRef(false);
  const identityMissing = !USE_MOCKS && !serviceBaseUrl('identity');

  // Con una sesión previa (y sin un registro recién hecho) no tiene sentido registrarse.
  if (session && !result) return <Navigate to="/" replace />;

  if (result) {
    return <WelcomeScreen result={result} onContinue={() => navigate('/setup', { replace: true })} />;
  }

  const update = (key: keyof SignupForm) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: event.target.value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return; // POST /signup nunca se envía dos veces ni se reintenta solo
    const found = validateSignup(form);
    setErrors(found);
    setSubmitError(null);
    if (Object.values(found).some(Boolean)) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const response = await identityApi.signup(toSignupRequest(form));
      if (!response?.tenantId || !response.token || !response.user) {
        throw new Error('El servidor no devolvió el código de empresa ni la sesión.');
      }
      // Misma sesión que el login (sessionStore). El código queda visible hasta que el usuario continúe.
      // Primero se fija `result` para que al aparecer la sesión no se redirija antes de mostrarlo.
      setResult(response);
      try {
        sessionStore.start(response.token, response.user);
      } catch (error) {
        setResult(null);
        throw error;
      }
    } catch (error) {
      setSubmitError(errorMessage(error));
      setForm((f) => ({ ...f, password: '', confirmPassword: '' }));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-hero" aria-hidden>
        <BrandMark />
        <div className="login-hero-copy">
          <h2>Crea el espacio de tu empresa en minutos.</h2>
          <p>Registra tu empresa y empieza a gestionar empleados, reclutamiento, asistencia y planillas.</p>
          <ul>
            <li>
              <Building2 size={18} /> Un espacio aislado para tu empresa
            </li>
            <li>
              <KeyRound size={18} /> Tú serás el Admin RR. HH.
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
          <Link to="/login" className="back-link">
            <ArrowLeft size={14} /> Volver a iniciar sesión
          </Link>
          <h1>Registrar mi empresa</h1>
          <p className="login-sub">Crearemos tu empresa y tu usuario administrador.</p>

          {identityMissing && (
            <Alert tone="warning" title="Configuración incompleta">
              Falta la variable {SERVICE_ENV.identity}.
            </Alert>
          )}
          {submitError && <Alert tone="danger">{submitError}</Alert>}

          <Field label="Nombre de la empresa" error={errors.companyName} required>
            <div className="input-icon">
              <Building2 size={16} />
              <Input value={form.companyName} onChange={update('companyName')} placeholder="ej. Acme S.A.C." autoComplete="organization" maxLength={COMPANY_NAME_MAX} />
            </div>
          </Field>
          <Field label="Correo del administrador" error={errors.email} required>
            <div className="input-icon">
              <Mail size={16} />
              <Input type="email" value={form.email} onChange={update('email')} placeholder="tu@empresa.com" autoComplete="email" />
            </div>
          </Field>
          <Field label="Contraseña" error={errors.password} hint={`Mínimo ${MIN_PASSWORD} caracteres.`} required>
            <div className="input-icon">
              <Lock size={16} />
              <Input type={showPassword ? 'text' : 'password'} value={form.password} onChange={update('password')} autoComplete="new-password" />
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
          <Field label="Confirmar contraseña" error={errors.confirmPassword} required>
            <div className="input-icon">
              <Lock size={16} />
              <Input type={showPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={update('confirmPassword')} autoComplete="new-password" />
            </div>
          </Field>

          <Button type="submit" block loading={submitting}>
            Registrar empresa
          </Button>
          <p className="login-foot-link">
            ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
          </p>
        </form>
      </section>
    </div>
  );
}

function WelcomeScreen({ result, onContinue }: { result: SignupResponse; onContinue: () => void }) {
  const [copied, setCopied] = useState<'ok' | 'error' | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.tenantId);
      setCopied('ok');
    } catch {
      setCopied('error');
    }
  };

  return (
    <div className="login-page single">
      <section className="login-panel">
        <div className="login-card welcome-card">
          <div className="login-mobile-brand show">
            <BrandMark />
          </div>
          <span className="welcome-icon">
            <PartyPopper size={26} />
          </span>
          <h1>¡Tu empresa está registrada!</h1>
          <p className="login-sub">
            Hola {result.user.name || result.user.email}, ya eres el administrador de RR. HH.
          </p>
          <div className="tenant-code" aria-live="polite">
            <small>Código de empresa</small>
            <strong data-testid="tenant-code">{result.tenantId}</strong>
            <Button variant="secondary" size="sm" icon={copied === 'ok' ? <Check size={15} /> : <Copy size={15} />} onClick={copy}>
              {copied === 'ok' ? 'Copiado' : 'Copiar código'}
            </Button>
          </div>
          {copied === 'error' && <Alert tone="warning">No se pudo copiar automáticamente. Selecciona el código y cópialo a mano.</Alert>}
          <Alert tone="info" title="Guarda este código">
            Lo necesitarás junto con tu correo (<strong>{result.user.email}</strong>) y tu contraseña cada vez que inicies sesión. Compártelo
            con tu equipo para que también puedan ingresar.
          </Alert>
          <Button block icon={<ArrowRight size={16} />} onClick={onContinue}>
            Entrar al sistema
          </Button>
        </div>
      </section>
    </div>
  );
}
