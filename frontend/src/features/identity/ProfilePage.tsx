import { Building, Clock, IdCard, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { identityApi } from '../../api/identity';
import { useSession } from '../../auth/AuthContext';
import { sessionStore } from '../../auth/sessionStore';
import { RoleBadge, UserStatusBadge } from '../../components/ui/Badge';
import { ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { Avatar, Card, DescriptionList, PageHeader } from '../../components/ui/Page';
import { useAsync } from '../../hooks/useAsync';
import { formatDateTime } from '../../utils/format';

export function ProfilePage() {
  const { session, tenantId } = useSession();
  const profile = useAsync(async (signal) => {
    const me = await identityApi.me(signal);
    sessionStore.updateUser(me); // mantiene nombre y rol del header al día
    return me;
  }, []);

  const user = profile.data;
  const expires = new Date(session.claims.exp * 1000).toISOString();

  return (
    <>
      <PageHeader title="Mi perfil" description="Tus datos de acceso y de sesión en la plataforma." />
      {profile.loading && !user && <LoadingBlock label="Cargando perfil…" />}
      {profile.error && !user && <ErrorState message={profile.error} onRetry={profile.reload} />}
      {user && (
        <div className="grid grid-main-side">
          <Card>
            <div className="row" style={{ gap: 16, marginBottom: 24 }}>
              <Avatar name={user.name} size={64} />
              <div>
                <h2 style={{ fontSize: 20 }}>{user.name}</h2>
                <div className="row" style={{ marginTop: 6 }}>
                  <RoleBadge role={user.role} />
                  <UserStatusBadge status={user.status} />
                </div>
              </div>
            </div>
            <DescriptionList
              items={[
                { label: 'Email', value: user.email },
                { label: 'Empresa (tenant)', value: tenantId },
                { label: 'Usuario creado', value: formatDateTime(user.createdAt) },
                { label: 'Última actualización', value: formatDateTime(user.updatedAt) },
                {
                  label: 'Ficha de empleado',
                  value: user.employeeId ? <Link to={`/employees/${user.employeeId}`}>Ver mi ficha</Link> : 'Sin ficha vinculada',
                },
              ]}
            />
          </Card>
          <Card title="Sesión actual" subtitle="Datos leídos del token de acceso.">
            <div className="mini-list">
              <div className="info-row">
                <span className="row">
                  <Building size={15} /> Empresa
                </span>
                <strong>{session.claims.tenantId}</strong>
              </div>
              <div className="info-row">
                <span className="row">
                  <Mail size={15} /> Usuario
                </span>
                <strong>{session.claims.sub}</strong>
              </div>
              <div className="info-row">
                <span className="row">
                  <ShieldCheck size={15} /> Rol
                </span>
                <RoleBadge role={session.claims.role} />
              </div>
              <div className="info-row">
                <span className="row">
                  <Clock size={15} /> Expira
                </span>
                <strong>{formatDateTime(expires)}</strong>
              </div>
              <div className="info-row">
                <span className="row">
                  <IdCard size={15} /> ID de empleado
                </span>
                <span className="mono">{user.employeeId ?? '—'}</span>
              </div>
            </div>
            <p className="muted row" style={{ marginTop: 14, fontSize: 12.5 }}>
              <KeyRound size={14} /> Para cambiar tu contraseña o rol, contacta a un Admin RR. HH.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
