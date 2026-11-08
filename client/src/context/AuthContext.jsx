import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStorage } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(() => {
    tokenStorage.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => clearSession();
    window.addEventListener('nivhr:unauthorized', handleUnauthorized);
    const token = tokenStorage.get();
    if (!token) {
      setLoading(false);
    } else {
      api.get('/auth/me')
        .then(({ data }) => setUser(data.user))
        .catch(() => clearSession())
        .finally(() => setLoading(false));
    }
    return () => window.removeEventListener('nivhr:unauthorized', handleUnauthorized);
  }, [clearSession]);

  const login = useCallback(async (credentials) => {
    const { data } = await api.post('/auth/login', credentials);
    tokenStorage.set(data.token);
    try {
      const profile = await api.get('/auth/me');
      setUser(profile.data.user);
      return profile.data.user;
    } catch (error) {
      clearSession();
      throw error;
    }
  }, [clearSession]);

  const logout = useCallback(() => clearSession(), [clearSession]);
  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
