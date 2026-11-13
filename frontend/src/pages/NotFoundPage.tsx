import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/Feedback';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass size={26} />}
      title="Página no encontrada"
      description="La dirección no existe o fue movida."
      action={
        <Link className="btn btn-primary btn-md" to="/">
          Volver al inicio
        </Link>
      }
    />
  );
}
