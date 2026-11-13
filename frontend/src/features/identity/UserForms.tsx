import { useState } from 'react';
import { identityApi } from '../../api/identity';
import { ROLES, type Role, type UpdateUserRequest, type User } from '../../api/types';
import { ROLE_LABEL } from '../../auth/permissions';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Field, FormGrid, Input, Select } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { errorMessage } from '../../hooks/useAsync';
import { MIN_PASSWORD, hasErrors, isEmail, required, type Errors } from '../../utils/validation';

const ROLE_HELP: Record<Role, string> = {
  ADMIN_RRHH: 'Acceso total: usuarios, empleados, vacantes y aprobaciones.',
  MANAGER: 'Ve a su equipo, gestiona postulaciones y aprueba solicitudes.',
  EMPLOYEE: 'Ve su ficha, marca asistencia y solicita vacaciones o permisos.',
};

interface UserForm {
  email: string;
  name: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  password: string;
  confirm: string;
}

export function UserFormModal({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: User | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (user: User, created: boolean) => void;
}) {
  const creating = !user;
  const [form, setForm] = useState<UserForm>({
    email: user?.email ?? '',
    name: user?.name ?? '',
    role: user?.role ?? 'EMPLOYEE',
    status: user?.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<Errors<UserForm>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof UserForm>(key: K, value: UserForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = (): Errors<UserForm> => {
    const e: Errors<UserForm> = {};
    e.name = required(form.name, 'El nombre', 120);
    if (creating) {
      if (!form.email.trim()) e.email = 'El email es obligatorio.';
      else if (!isEmail(form.email)) e.email = 'Ingresa un email válido.';
      if (form.password.length < MIN_PASSWORD) e.password = `Mínimo ${MIN_PASSWORD} caracteres.`;
      if (form.confirm !== form.password) e.confirm = 'Las contraseñas no coinciden.';
    }
    return e;
  };

  const submit = async () => {
    const found = validate();
    setErrors(found);
    if (hasErrors(found)) return;
    setSaving(true);
    setSubmitError(null);
    try {
      if (creating) {
        const created = await identityApi.createUser({
          email: form.email.trim().toLowerCase(),
          name: form.name.trim(),
          role: form.role,
          password: form.password,
        });
        onSaved(created, true);
      } else {
        const changes: UpdateUserRequest = {};
        if (form.name.trim() !== user.name) changes.name = form.name.trim();
        if (!isSelf && form.role !== user.role) changes.role = form.role;
        const currentStatus = user.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE';
        if (!isSelf && form.status !== currentStatus) changes.status = form.status;
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        onSaved(await identityApi.updateUser(user.email, changes), false);
      }
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={creating ? 'Nuevo usuario' : 'Editar usuario'}
      description={creating ? 'El usuario podrá iniciar sesión con este email y contraseña.' : user.email}
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            {creating ? 'Crear usuario' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      {submitError && <Alert tone="danger">{submitError}</Alert>}
      {isSelf && <Alert tone="info">No puedes quitarte tu propio rol ni desactivarte.</Alert>}
      <FormGrid>
        <Field label="Nombre completo" error={errors.name} required className="span-2">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />
        </Field>
        {creating && (
          <Field label="Email" error={errors.email} required className="span-2">
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" />
          </Field>
        )}
        <Field label="Rol" required hint={ROLE_HELP[form.role]} className={creating ? 'span-2' : undefined}>
          <Select value={form.role} onChange={(e) => set('role', e.target.value as Role)} disabled={isSelf}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        {!creating && (
          <Field label="Estado">
            <Select
              value={form.status}
              onChange={(e) => set('status', e.target.value as UserForm['status'])}
              disabled={isSelf}
            >
              <option value="ACTIVE">Activo</option>
              <option value="DISABLED">Desactivado</option>
            </Select>
          </Field>
        )}
        {creating && (
          <>
            <Field label="Contraseña" error={errors.password} required hint={`Mínimo ${MIN_PASSWORD} caracteres.`}>
              <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirmar contraseña" error={errors.confirm} required>
              <Input type="password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} autoComplete="new-password" />
            </Field>
          </>
        )}
      </FormGrid>
    </Modal>
  );
}

export function PasswordModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (user: User) => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const found = {
      password: password.length < MIN_PASSWORD ? `Mínimo ${MIN_PASSWORD} caracteres.` : undefined,
      confirm: confirm !== password ? 'Las contraseñas no coinciden.' : undefined,
    };
    setErrors(found);
    if (found.password || found.confirm) return;
    setSaving(true);
    setSubmitError(null);
    try {
      onSaved(await identityApi.updateUser(user.email, { password }));
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      size="sm"
      title="Cambiar contraseña"
      description={user.email}
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Guardar contraseña
          </Button>
        </>
      }
    >
      {submitError && <Alert tone="danger">{submitError}</Alert>}
      <Field label="Nueva contraseña" error={errors.password} required hint={`Mínimo ${MIN_PASSWORD} caracteres.`}>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label="Confirmar contraseña" error={errors.confirm} required>
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </Field>
    </Modal>
  );
}
