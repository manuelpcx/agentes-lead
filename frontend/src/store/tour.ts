import { create } from 'zustand';

/**
 * Estado del tour de bienvenida. Va en un store y no dentro del layout porque
 * se abre desde dos lados: solo, la primera vez que alguien entra, y a mano
 * desde el botón de la pestaña Ayuda.
 */
interface TourState {
  open: boolean;
  start: () => void;
  close: () => void;
}

export const useTour = create<TourState>((set) => ({
  open: false,
  start: () => set({ open: true }),
  close: () => set({ open: false }),
}));
