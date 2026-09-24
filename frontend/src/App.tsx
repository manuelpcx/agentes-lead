import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './store/auth';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { InboxPage } from './pages/InboxPage';
import { AssistantHomePage } from './pages/AssistantHomePage';
import { LeadDetailPage } from './pages/LeadDetailPage';
import { CalendarPage } from './pages/CalendarPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { ApprovalPage } from './pages/ApprovalPage';
import { PromptsPage } from './pages/PromptsPage';
import { MetricsPage } from './pages/MetricsPage';
import { AgentsPage } from './pages/AgentsPage';
import { WhatsappTemplatesPage } from './pages/WhatsappTemplatesPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { CompanyConfigPage } from './pages/CompanyConfigPage';
import { HelpPage } from './pages/HelpPage';
import { PlatformPage } from './pages/PlatformPage';
import { AppLayout } from './components/AppLayout';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <AppLayout>{children}</AppLayout>;
}

function page(node: React.ReactNode) {
  return <RequireAuth>{node}</RequireAuth>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/" element={page(<AssistantHomePage />)} />
      <Route path="/platform" element={page(<PlatformPage />)} />
      <Route path="/leads" element={page(<InboxPage />)} />
      <Route path="/leads/:id" element={page(<LeadDetailPage />)} />
      <Route path="/calendar" element={page(<CalendarPage />)} />
      <Route path="/knowledge" element={page(<KnowledgePage />)} />
      <Route path="/approval" element={page(<ApprovalPage />)} />
      <Route path="/prompts" element={page(<PromptsPage />)} />
      <Route path="/metrics" element={page(<MetricsPage />)} />
      <Route path="/agents" element={page(<AgentsPage />)} />
      <Route path="/templates" element={page(<WhatsappTemplatesPage />)} />
      <Route path="/help" element={page(<HelpPage />)} />
      <Route path="/integrations" element={page(<IntegrationsPage />)} />
      <Route path="/config" element={page(<CompanyConfigPage />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
