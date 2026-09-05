import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import HomePage from './components/HomePage.jsx';

// Everything past the home page is code-split: none of it is needed for the
// first paint of the marketing page, which is the route search engines and
// most first-time visitors actually land on.
const LoginPage = lazy(() => import('./components/auth/LoginPage.jsx'));
const AuthCallback = lazy(() => import('./components/auth/AuthCallback.jsx'));
const OnboardingForm = lazy(() => import('./components/auth/OnboardingForm.jsx'));
const SafetyAddendumGate = lazy(() => import('./components/auth/SafetyAddendumGate.jsx'));
const ChatPage = lazy(() => import('./components/ChatPage.jsx'));
const BrandKitHome = lazy(() => import('./components/brandKit/BrandKitHome.jsx'));
const BrandKitReview = lazy(() => import('./components/brandKit/BrandKitReview.jsx'));
const DocumentsPage = lazy(() => import('./components/brandKit/DocumentsPage.jsx'));
const HowWeWork = lazy(() => import('./components/HowWeWork.jsx'));
const TermsOfUsePage = lazy(() => import('./components/legal/TermsOfUsePage.jsx'));
const PrivacyPolicyPage = lazy(() => import('./components/legal/PrivacyPolicyPage.jsx'));
const NotFoundPage = lazy(() => import('./components/NotFoundPage.jsx'));

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
      <ThemeProvider>
        <AuthProvider>
          <Suspense fallback={<div className="min-h-svh bg-delft" />}>
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
                path="/brand-kit"
                element={
                  <ProtectedRoute>
                    <div className="min-h-svh bg-delft px-4 py-8 sm:px-8">
                      <BrandKitHome />
                    </div>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/brand-kit/review/:id"
                element={
                  <ProtectedRoute>
                    <div className="min-h-svh bg-delft px-4 py-8 sm:px-8">
                      <BrandKitReview />
                    </div>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/documents"
                element={
                  <ProtectedRoute>
                    <div className="min-h-svh bg-delft px-4 py-8 sm:px-8">
                      <DocumentsPage />
                    </div>
                  </ProtectedRoute>
                }
              />
              {/* React Router v6+ ranks a static segment ("brand-kit") above
                  a dynamic one (":category") regardless of declaration
                  order, so /brand-kit and /documents above and /:category
                  below can't collide — but /:category is still the
                  KNOWN_CATEGORIES catch-all in server/index.js's SSR meta
                  table, which only recognizes features/job-roles/
                  departments/startups; that table doesn't need entries for
                  either static route for the same reason. */}
              <Route
                path="/:category"
                element={
                  <ProtectedRoute>
                    <ChatPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
