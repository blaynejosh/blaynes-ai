import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import LoginPage from './components/auth/LoginPage.jsx';
import AuthCallback from './components/auth/AuthCallback.jsx';
import OnboardingForm from './components/auth/OnboardingForm.jsx';
import SafetyAddendumGate from './components/auth/SafetyAddendumGate.jsx';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import HomePage from './components/HomePage.jsx';
import ChatPage from './components/ChatPage.jsx';
import HowWeWork from './components/HowWeWork.jsx';
import TermsOfUsePage from './components/legal/TermsOfUsePage.jsx';
import PrivacyPolicyPage from './components/legal/PrivacyPolicyPage.jsx';

/**
 * Two surfaces: the public marketing home page, and the chat product at one
 * route per Product Map layer. The hero's Explore pills cross from one to
 * the other. Only the chat product sits behind ProtectedRoute — the home
 * page is reachable by anyone, signed in or not, and every auth step
 * (login, onboarding, safety addendum) lands back on it when done.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/terms" element={<TermsOfUsePage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute requireOnboarded={false} requireSafetyAddendum={false}>
                <OnboardingForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/safety-addendum"
            element={
              <ProtectedRoute requireSafetyAddendum={false}>
                <SafetyAddendumGate />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<HomePage />} />
          <Route
            path="/how-we-work"
            element={
              <ProtectedRoute>
                <HowWeWork />
              </ProtectedRoute>
            }
          />
          <Route
            path="/:category"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
