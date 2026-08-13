import { ReactNode } from 'react';
import { SparkIcon } from './icons';

/** Marco de las pantallas públicas (login/registro): hero de marca + formulario. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      {/* Hero de marca (oculto en móvil) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand-700 p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, white 0, transparent 40%), radial-gradient(circle at 80% 60%, white 0, transparent 35%)',
          }}
        />
        <div className="relative flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-sm font-bold">
            AL
          </span>
          <span className="text-lg font-semibold">Agentes Lead</span>
        </div>
        <div className="relative">
          <SparkIcon className="mb-4 h-8 w-8 text-brand-200" />
          <h2 className="text-3xl font-semibold leading-tight">
            Tu agente que capta,
            <br />
            responde y agenda.
          </h2>
          <p className="mt-3 max-w-sm text-brand-100">
            Atiende cada lead al instante por WhatsApp, correo y llamada — con
            tu conocimiento, no con inventos.
          </p>
        </div>
        <p className="relative text-sm text-brand-200">
          Multi-tenant · Chile / LATAM
        </p>
      </div>

      {/* Formulario */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 p-6">
        {children}
      </div>
    </div>
  );
}
