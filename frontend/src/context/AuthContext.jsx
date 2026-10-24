import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, tokenStore } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(tokenStore.get()));

  // On page load: if we have a token, ask the backend who we are (GET /auth/me)
  useEffect(() => {
    if (!tokenStore.get()) return;
    api.me()
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setChecking(false));
  }, []);

  // Any 401 anywhere logs the user out
  useEffect(() => {
    const onExpired = () => { tokenStore.clear(); setUser(null); };
    window.addEventListener('cloudlab:unauthenticated', onExpired);
    return () => window.removeEventListener('cloudlab:unauthenticated', onExpired);
  }, []);

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await api.login(email, password);
    tokenStore.set(token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* token may already be gone */ }
    tokenStore.clear();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, checking, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
