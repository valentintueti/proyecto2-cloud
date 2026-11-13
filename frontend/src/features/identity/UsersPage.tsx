import { KeyRound, Pencil, Plus, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { identityApi } from '../../api/identity';
import type { User } from '../../api/types';
import { useSession } from '../../auth/AuthContext';
import { RoleBadge, UserStatusBadge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Avatar, Card, LoadMore, PageHeader } from '../../components/ui/Page';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../hooks/useAsync';
import { useCursorList } from '../../hooks/useCursorList';
import { formatDate } from '../../utils/format';
import { PasswordModal, UserFormModal } from './UserForms';

const PAGE_SIZE = 20;

export function UsersPage() {
  const { user: me } = useSession();
  const toast = useToast();
  const list = useCursorList((cursor, signal) => identityApi.listUsers({ limit: PAGE_SIZE, cursor }, signal), []);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [passwordFor, setPasswordFor] = useState<User | null>(null);
  const [toggleTarget, setToggleTarget] = useState<User | null>(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const replace = (updated: User) =>
    list.setItems((items) => items.map((u) => (u.email === updated.email ? updated : u)));

  const toggleStatus = async () => {
    if (!toggleTarget) return;
    const next = toggleTarget.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED';
    setToggling(true);
    setToggleError(null);
    try {
      const updated = await identityApi.updateUser(toggleTarget.email, { status: next });
      replace(updated);
      toast.success(next === 'ACTIVE' ? 'Usuario activado' : 'Usuario desactivado', updated.email);
      setToggleTarget(null);
    } catch (error) {
      setToggleError(errorMessage(error));
    } finally {
      setToggling(false);
    }
  };

  const columns: Column<User>[] = [
    {
      key: 'user',
      header: 'Usuario',
      render: (u) => (
        <div className="cell-main">
          <Avatar name={u.name} size={34} />
          <div>
            <strong>
              {u.name} {u.email === me.email && <span className="muted">(tú)</span>}
            </strong>
            <span>{u.email}</span>
          </div>
        </div>
      ),
    },
    { key: 'role', header: 'Rol', render: (u) => <RoleBadge role={u.role} /> },
    { key: 'status', header: 'Estado', render: (u) => <UserStatusBadge status={u.status} /> },
    { key: 'created', header: 'Creado', hideOnMobile: true, render: (u) => formatDate(u.createdAt) },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      render: (u) => {
        const self = u.email === me.email;
        return (
          <div className="table-actions">
            <IconButton label="Editar nombre y rol" icon={<Pencil size={15} />} onClick={() => setEditing(u)} />
            <IconButton label="Cambiar contraseña" icon={<KeyRound size={15} />} onClick={() => setPasswordFor(u)} />
            {!self && (
              <IconButton
                label={u.status === 'DISABLED' ? 'Activar usuario' : 'Desactivar usuario'}
                icon={u.status === 'DISABLED' ? <UserCheck size={15} /> : <UserX size={15} />}
                onClick={() => {
                  setToggleError(null);
                  setToggleTarget(u);
                }}
              />
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Usuarios y roles"
        description="Gestiona quién accede a la plataforma de tu empresa y con qué rol."
        actions={
          <Button icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Nuevo usuario
          </Button>
        }
      />
      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={list.items}
          rowKey={(u) => u.email}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={{ title: 'Aún no hay usuarios', description: 'Crea el primer usuario de tu empresa.', icon: <ShieldCheck size={26} /> }}
          footer={
            list.items.length > 0 && (
              <LoadMore hasMore={!!list.nextCursor} loading={list.loadingMore} onClick={list.loadMore} count={list.items.length} />
            )
          }
        />
      </Card>

      {editing && (
        <UserFormModal
          user={editing === 'new' ? null : editing}
          isSelf={editing !== 'new' && editing.email === me.email}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            if (created) list.setItems((items) => [saved, ...items]);
            else replace(saved);
            toast.success(created ? 'Usuario creado' : 'Usuario actualizado', saved.email);
            setEditing(null);
          }}
        />
      )}
      {passwordFor && (
        <PasswordModal
          user={passwordFor}
          onClose={() => setPasswordFor(null)}
          onSaved={(saved) => {
            replace(saved);
            toast.success('Contraseña actualizada', saved.email);
            setPasswordFor(null);
          }}
        />
      )}
      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.status === 'DISABLED' ? 'Activar usuario' : 'Desactivar usuario'}
        message={
          toggleTarget?.status === 'DISABLED' ? (
            <>
              <strong>{toggleTarget?.email}</strong> podrá volver a iniciar sesión.
            </>
          ) : (
            <>
              <strong>{toggleTarget?.email}</strong> no podrá iniciar sesión hasta que lo vuelvas a activar.
            </>
          )
        }
        confirmLabel={toggleTarget?.status === 'DISABLED' ? 'Activar' : 'Desactivar'}
        tone={toggleTarget?.status === 'DISABLED' ? 'primary' : 'danger'}
        busy={toggling}
        error={toggleError}
        onConfirm={toggleStatus}
        onCancel={() => setToggleTarget(null)}
      />
    </>
  );
}
