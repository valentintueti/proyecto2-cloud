import { Building, FlaskConical, LogOut, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../../auth/AuthContext';
import { ROLE_LABEL } from '../../auth/permissions';
import { USE_MOCKS } from '../../config/env';
import { Avatar } from '../ui/Page';
import { RoleBadge } from '../ui/Badge';
import { NAVIGATION } from './navigation';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-logo" aria-hidden>
        <svg viewBox="0 0 32 32" width="20" height="20">
          <path d="M9 21c2-5 5-8 7-8s5 3 7 8" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <circle cx="16" cy="10" r="3" fill="currentColor" />
        </svg>
      </span>
      {!compact && (
        <span className="brand-text">
          TalentCloud <small>HCM</small>
        </span>
      )}
    </div>
  );
}

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { can, tenantId } = useSession();
  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Navegación principal">
      <div className="sidebar-top">
        <BrandMark />
      </div>
      <div className="sidebar-tenant" title="Empresa (tenant) actual">
        <Building size={16} />
        <div>
          <small>Empresa</small>
          <strong>{tenantId}</strong>
        </div>
      </div>
      <nav className="sidebar-nav">
        {NAVIGATION.map((section) => {
          const items = section.items.filter((item) => !item.permission || can(item.permission));
          if (items.length === 0) return null;
          return (
            <div className="nav-section" key={section.title}>
              <span className="nav-section-title">{section.title}</span>
              {items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="nav-link" onClick={onNavigate}>
                  <Icon size={18} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      {USE_MOCKS && (
        <div className="sidebar-demo">
          <FlaskConical size={15} />
          <span>Modo demo: datos simulados (solo desarrollo)</span>
        </div>
      )}
    </aside>
  );
}

function Header({ onToggleMenu, menuOpen }: { onToggleMenu: () => void; menuOpen: boolean }) {
  const { user, role, tenantId, logout } = useSession();
  return (
    <header className="topbar">
      <button
        type="button"
        className="menu-toggle"
        onClick={onToggleMenu}
        aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={menuOpen}
      >
        {menuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      <div className="topbar-mobile-brand">
        <BrandMark compact />
      </div>
      <div className="topbar-tenant">
        <span className="tenant-pill" title="Empresa (tenant)">
          <Building size={14} />
          <span className="tenant-label">Empresa:</span> <strong>{tenantId}</strong>
        </span>
        {USE_MOCKS && <span className="demo-pill">DEMO</span>}
      </div>
      <div className="topbar-user">
        <div className="topbar-user-text">
          <strong>{user.name}</strong>
          <span>
            <span className="hide-mobile">{user.email}</span>
            <span className="role-inline">{ROLE_LABEL[role]}</span>
          </span>
        </div>
        <span className="hide-mobile">
          <RoleBadge role={role} />
        </span>
        <Avatar name={user.name} />
        <button type="button" className="btn btn-ghost btn-sm logout-btn" onClick={logout} title="Cerrar sesión">
          <LogOut size={16} />
          <span className="hide-mobile">Salir</span>
        </button>
      </div>
    </header>
  );
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    document.querySelector('.main')?.scrollTo?.({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-hidden />}
      <div className="app-main">
        <Header onToggleMenu={() => setMenuOpen((o) => !o)} menuOpen={menuOpen} />
        <main className="main" id="main">
          <div className="main-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
