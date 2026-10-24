import { useAuth } from '../context/AuthContext';

export const ROLE_HEX = { student: '#3B82F6', faculty: '#14B8A6', admin: '#8B5CF6' };

/** The current role's accent as a hex colour (for SVG/Recharts, which can't read CSS variables). */
export default function useAccent() {
  const { user } = useAuth() ?? {};
  return ROLE_HEX[user?.role] ?? ROLE_HEX.student;
}
