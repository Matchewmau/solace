import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AUTH_UNAUTHORIZED_EVENT,
  clearStoredAuth,
  getStoredAuth,
  loginRequest,
  setStoredAuth,
} from "../lib/auth";

interface AuthContextValue {
  loggedIn: boolean;
  login: (
    username: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  loggedIn: false,
  login: async () => ({ ok: false, error: "Unavailable." }),
  logout: () => {},
});

/**
 * In-memory session (+ localStorage mirror) for the shared login.
 * Any /api 401 clears the stored credential and fires the unauthorized
 * event, which drops the context back to logged-out so the route guard
 * redirects to /login.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [credential, setCredential] = useState<string | null>(() =>
    getStoredAuth(),
  );

  useEffect(() => {
    function onUnauthorized() {
      setCredential(null);
    }
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await loginRequest(username, password);
    if (result.ok) {
      setStoredAuth(password);
      setCredential(password);
    }
    return result;
  }, []);

  const logout = useCallback(() => {
    clearStoredAuth();
    setCredential(null);
  }, []);

  const value = useMemo(
    () => ({ loggedIn: credential !== null, login, logout }),
    [credential, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
