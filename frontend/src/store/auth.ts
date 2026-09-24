import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser, LoginResponse, Membership } from '../types';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  memberships: Membership[];
  selectedCompanyId: string | null;
  setSession: (data: LoginResponse) => void;
  /** Reemplaza solo el token (tras cambiar la contraseña). */
  setToken: (token: string) => void;
  /** Marca el tour de bienvenida como visto (el backend ya lo guardó). */
  markOnboardingDone: () => void;
  selectCompany: (companyId: string) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      memberships: [],
      selectedCompanyId: null,
      setSession: (data) =>
        set({
          token: data.accessToken,
          user: data.user,
          memberships: data.memberships,
          // Selecciona automáticamente si hay una sola empresa.
          selectedCompanyId:
            data.memberships.length === 1
              ? data.memberships[0].companyId
              : null,
        }),
      setToken: (token) => set({ token }),
      markOnboardingDone: () =>
        set((state) =>
          state.user
            ? {
                user: {
                  ...state.user,
                  onboardingCompletedAt: new Date().toISOString(),
                },
              }
            : {},
        ),
      selectCompany: (companyId) => set({ selectedCompanyId: companyId }),
      logout: () =>
        set({
          token: null,
          user: null,
          memberships: [],
          selectedCompanyId: null,
        }),
    }),
    { name: 'agentes-lead-auth' },
  ),
);

/** Rol del usuario en la empresa seleccionada. */
export function useCurrentRole(): Membership['role'] | null {
  const { memberships, selectedCompanyId } = useAuth();
  return (
    memberships.find((m) => m.companyId === selectedCompanyId)?.role ?? null
  );
}
