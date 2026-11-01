import { create } from 'zustand';
import { ApiError, api, getToken, setToken, type AuthResult, type User } from '../api/client';

interface AuthState {
  user: User | null;
  ready: boolean;
  init(): Promise<void>;
  login(username: string, password: string): Promise<void>;
  register(username: string, password: string): Promise<void>;
  upgrade(username: string, password: string): Promise<void>;
  /** Make sure someone is signed in — silently creates a guest if needed. */
  ensure(): Promise<User>;
  logout(): void;
}

export const useAuth = create<AuthState>((set, get) => {
  const remember = (user: User | null) => {
    try {
      if (user) localStorage.setItem('bz.user', JSON.stringify(user));
      else localStorage.removeItem('bz.user');
    } catch {
      /* storage unavailable */
    }
  };
  const accept = ({ token, user }: AuthResult) => {
    setToken(token);
    remember(user);
    set({ user });
    return user;
  };
  return {
    user: null,
    ready: false,
    async init() {
      if (!getToken()) return set({ ready: true });
      try {
        const { user } = await api.me();
        remember(user);
        set({ user, ready: true });
      } catch (err) {
        // Offline is not "signed out": keep the session and use the remembered user.
        if (!(err instanceof ApiError) || err.status >= 500) {
          let cached: User | null = null;
          try {
            cached = JSON.parse(localStorage.getItem('bz.user') ?? 'null') as User | null;
          } catch {
            /* ignore */
          }
          return set({ user: cached, ready: true });
        }
        setToken(null);
        remember(null);
        set({ user: null, ready: true });
      }
    },
    login: async (u, p) => void accept(await api.login(u, p)),
    register: async (u, p) => void accept(await api.register(u, p)),
    upgrade: async (u, p) => void accept(await api.upgrade(u, p)),
    async ensure() {
      return get().user ?? accept(await api.guest());
    },
    logout() {
      setToken(null);
      remember(null);
      set({ user: null });
    },
  };
});
