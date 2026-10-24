import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/** Only lets a user in when logged in with one of `roles`. Admin can also read faculty pages (contract section 4). */
export default function ProtectedRoute({ roles, children }) {
  const { user, checking } = useAuth();
  const location = useLocation();
  if (checking) {
    return <div className="flex min-h-screen items-center justify-center bg-bg"><Loader2 className="h-6 w-6 animate-spin text-brand-from" /></div>;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to={`/${user.role}`} replace />;
  return children;
}
