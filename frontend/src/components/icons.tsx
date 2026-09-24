import { SVGProps } from 'react';
import {
  BookOpen,
  CalendarDots,
  CaretLeft,
  ChartLineUp,
  Buildings,
  ChatCircleDots,
  Eye,
  EyeSlash,
  GearSix,
  NotePencil,
  Paperclip,
  PaperPlaneRight,
  Plus,
  PlugsConnected,
  Question,
  Robot,
  SealCheck,
  SignOut,
  Sparkle,
  Tray,
  WhatsappLogo,
  X,
} from '@phosphor-icons/react';

/**
 * Íconos usados en la navegación y el chat del panel — Phosphor
 * (`@phosphor-icons/react`), peso "regular" fijo en todos para mantener un
 * mismo grosor de trazo en toda la app.
 */

type IconProps = SVGProps<SVGSVGElement>;

export const InboxIcon = (p: IconProps) => <Tray weight="regular" {...p} />;
export const CalendarIcon = (p: IconProps) => (
  <CalendarDots weight="regular" {...p} />
);
export const BookIcon = (p: IconProps) => <BookOpen weight="regular" {...p} />;
export const CheckIcon = (p: IconProps) => <SealCheck weight="regular" {...p} />;
export const PromptIcon = (p: IconProps) => <NotePencil weight="regular" {...p} />;
export const ChartIcon = (p: IconProps) => <ChartLineUp weight="regular" {...p} />;
export const AgentsIcon = (p: IconProps) => <Robot weight="regular" {...p} />;
export const WhatsappIcon = (p: IconProps) => (
  <WhatsappLogo weight="regular" {...p} />
);
export const IntegrationsIcon = (p: IconProps) => (
  <PlugsConnected weight="regular" {...p} />
);
export const CogIcon = (p: IconProps) => <GearSix weight="regular" {...p} />;
export const LogoutIcon = (p: IconProps) => <SignOut weight="regular" {...p} />;
export const SparkIcon = (p: IconProps) => <Sparkle weight="regular" {...p} />;
export const ChatIcon = (p: IconProps) => (
  <ChatCircleDots weight="regular" {...p} />
);
export const CloseIcon = (p: IconProps) => <X weight="regular" {...p} />;
export const HelpIcon = (p: IconProps) => <Question weight="regular" {...p} />;
export const PlatformIcon = (p: IconProps) => (
  <Buildings weight="regular" {...p} />
);
export const EyeIcon = (p: IconProps) => <Eye weight="regular" {...p} />;
export const EyeOffIcon = (p: IconProps) => <EyeSlash weight="regular" {...p} />;
export const SendIcon = (p: IconProps) => (
  <PaperPlaneRight weight="regular" {...p} />
);
export const PaperclipIcon = (p: IconProps) => (
  <Paperclip weight="regular" {...p} />
);
export const PlusIcon = (p: IconProps) => <Plus weight="regular" {...p} />;
export const ChevronLeftIcon = (p: IconProps) => (
  <CaretLeft weight="regular" {...p} />
);
