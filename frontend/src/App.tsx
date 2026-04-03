import Chatbot from "./Chatbot";
import { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, ShieldCheck, Package, CreditCard, TrendingUp,
  FileCheck, Bell, Command, Menu, X, Settings as SettingsIcon, LogOut, Users
} from 'lucide-react';
import HomeDashboard from './features/dashboard/HomeDashboard';
import BusinessCatalog from './features/dashboard/BusinessCatalog';
import Settings from './features/dashboard/Settings';
import LegalPage from './features/dashboard/LegalPage';
import NotFound from './features/dashboard/NotFound';
import NSICDashboard from './features/nsic/NSICDashboard';
import SNPDashboard from './features/snp/SNPDashboard';
import OnboardingWizard from './features/onboarding/OnboardingWizard';
import TransactionLedger from './features/ledger/TransactionLedger';
import MatchingDashboard from './features/matching/MatchingDashboard';
import SNPPerformance from './features/dashboard/SNPPerformance';
import ArchitectureDiagram from './features/dashboard/ArchitectureDiagram';
import ArchitectureHighLevel from './features/dashboard/ArchitectureHighLevel';
import { useMSE } from './context/MSEContext';
import { useAuth } from './context/AuthContext';
import { useNotifications } from './context/NotificationContext';
import LoginView from './features/auth/LoginView';
import AdminLoginView from './features/auth/AdminLoginView';
import SnpRegistration from './features/snp/SnpRegistration';
import VoiceNavigator from './components/VoiceNavigator';
import Breadcrumbs from './components/Breadcrumbs';
import ErrorBoundary from './components/ErrorBoundary';

const NavLink = ({ to, children, onClick }: { to: string, children: React.ReactNode, onClick?: () => void }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
        isActive
          ? 'bg-[#1E3A8A] text-white shadow-lg shadow-blue-900/20'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
      }`}
    >
      {children}
    </Link>
  );
};

function AppContent() {
  const { isAuthenticated, role, logout } = useAuth();
  const { mses, selectedMseId, setSelectedMseId } = useMSE();
  const { unreadCount } = useNotifications();
  const { t , i18n } = useTranslation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const toggleMenu = () => setIsMenuOpen(prev => !prev);
  const location = useLocation();
  const path = location.pathname;
  if (path === '/snp/register')return<SnpRegistration />;
  if (!isAuthenticated) {
    if (path === '/staff') return <AdminLoginView />;
    if (path === '/onboarding' || path === '/register') return <OnboardingWizard />;
    return <LoginView />;
  }

  
const numericSelectedMseId = Number(selectedMseId || 0); // convert to number safely
const currentMse = mses.find(m => m.mse_id === numericSelectedMseId);
const userName = role === 'mse' ? (currentMse?.name || 'Enterprise') : role?.toUpperCase() || 'Guest';
const currentRole = role || 'guest';
const isBusinessUser = ['mse', 'nsic', 'admin'].includes(currentRole);
const isAuditor = currentRole === 'nsic' || currentRole === 'admin';

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col font-sans selection:bg-blue-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4 lg:gap-8">
            <button 
              onClick={toggleMenu}
              aria-expanded={isMenuOpen}
              aria-label="Toggle navigation menu"
              aria-controls="mobile-menu"
              className="lg:hidden p-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors focus:ring-2 focus:ring-slate-300 outline-none"
            >
              {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            <Link to="/" className="flex items-center gap-2.5" aria-label="TEAM Portal Home">
              <div className="w-9 h-9 bg-[#002147] rounded-xl flex items-center justify-center text-white shadow-inner">
                <Command size={20} />
              </div>
              <span className="text-lg font-black text-[#002147] tracking-tighter uppercase">Team<span className="text-blue-600">.</span></span>
            </Link>

            <nav className="hidden lg:flex items-center gap-1" aria-label="Main Navigation">
              <NavLink to="/"><LayoutDashboard size={16} aria-hidden="true" /> {t("dashboard")} </NavLink>
              {currentRole === 'snp' && <NavLink to="/snp/dashboard"><Users size={16} aria-hidden="true" /> {t("network")} </NavLink>}
              {currentRole === 'mse' && <NavLink to="/onboarding"><ShieldCheck size={16} aria-hidden="true" /> {t("compliance")} </NavLink>}
              {isBusinessUser && <NavLink to="/catalog"><Package size={16} aria-hidden="true" /> {t("catalogue")} </NavLink>}
              {isBusinessUser && <NavLink to="/ledger"><CreditCard size={16} aria-hidden="true" /> {t("ledger")} </NavLink>}
              {isBusinessUser && <NavLink to="/matching"><TrendingUp size={16} aria-hidden="true" /> {t("partners")} </NavLink>}
              {(currentRole === 'nsic' || currentRole === 'admin') && <NavLink to="/nsic"><FileCheck size={16} aria-hidden="true" /> {t("audit")} </NavLink>}
              {(currentRole === 'nsic' || currentRole === 'admin') && <NavLink to="/performance"><TrendingUp size={16} aria-hidden="true" /> {t("performance")} </NavLink>}
            </nav>
          </div>

            <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center gap-2">
              <select 
                value={i18n.language} 
                onChange={(e) => i18n.changeLanguage(e.target.value)}
                aria-label="Select Language"
                className="bg-slate-100 border-none text-[10px] font-black text-slate-700 rounded-lg px-2 py-1 outline-none cursor-pointer uppercase focus:ring-2 focus:ring-blue-300"
              >
                <option value="en">EN</option>
                <option value="hi">HI</option>
                <option value="ta">TA</option>
                <option value="te">TE</option>
                <option value="bn">BN</option>
                <option value="mr">MR</option>
                <option value="gu">GU</option>
              </select>

              {currentRole === 'mse' && mses.length > 1 && (
                <select 
                  value={selectedMseId || ''} 
                  onChange={(e) => setSelectedMseId(Number(e.target.value))}
                  aria-label="Select Enterprise Context"
                  className="hidden md:block bg-blue-50 border-none text-xs font-bold text-blue-800 rounded-lg px-3 py-1.5 outline-none max-w-[150px] truncate focus:ring-2 focus:ring-blue-300"
                >
                  {mses.map(m => (
                    <option key={m.mse_id} value={m.mse_id}>{m.name}</option>
                  ))}
                </select>
              )}

              <Link 
                to="/notifications" 
                aria-label={`View notifications, ${unreadCount} unread`}
                className="p-2 text-slate-600 hover:text-[#1E3A8A] relative rounded-lg hover:bg-slate-100 transition-colors focus:ring-2 focus:ring-blue-300 outline-none"
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[8px] font-black flex items-center justify-center rounded-full border-2 border-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
            </div>

            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <Link to="/settings" className="text-sm font-bold text-[#1E3A8A] hidden md:block hover:underline transition-colors truncate max-w-[120px] focus:ring-2 focus:ring-blue-100 outline-none rounded">{userName}</Link>
              <button 
                onClick={logout} 
                aria-label="Sign out"
                className="p-2 text-slate-500 hover:text-red-700 rounded-lg hover:bg-red-50 transition-all focus:ring-2 focus:ring-red-100 outline-none" 
                title="Sign out"
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {isMenuOpen && (
          <div id="mobile-menu" className="lg:hidden absolute top-16 left-0 w-full bg-white border-b border-slate-200 shadow-xl z-50 animate-in slide-in-from-top-4 duration-200">
            <nav className="flex flex-col p-4 gap-2" aria-label="Mobile Navigation">
              <NavLink to="/" onClick={() => setIsMenuOpen(false)}><LayoutDashboard size={18} aria-hidden="true" /> {t("dashboard")} </NavLink>
              {currentRole === 'snp' && <NavLink to="/snp/dashboard" onClick={() => setIsMenuOpen(false)}><Users size={18} /> {t("network")} </NavLink>}
              {currentRole === 'mse' && <NavLink to="/onboarding" onClick={() => setIsMenuOpen(false)}><ShieldCheck size={18} /> {t("compliance")} </NavLink>}
              {isBusinessUser && <NavLink to="/catalog" onClick={() => setIsMenuOpen(false)}><Package size={18} /> {t("catalogue")} </NavLink>}
              {isBusinessUser && <NavLink to="/ledger" onClick={() => setIsMenuOpen(false)}><CreditCard size={18} /> {t("ledger")} </NavLink>}
              {isBusinessUser && <NavLink to="/matching" onClick={() => setIsMenuOpen(false)}><TrendingUp size={18} /> {t("partners")} </NavLink>}
              {isAuditor && <NavLink to="/nsic" onClick={() => setIsMenuOpen(false)}><FileCheck size={18} /> {t("audit")} </NavLink>}
              {isAuditor && <NavLink to="/performance" onClick={() => setIsMenuOpen(false)}><TrendingUp size={18} /> {t("performance")} </NavLink>}
              <hr className="my-2 border-slate-100" />
              <NavLink to="/settings" onClick={() => setIsMenuOpen(false)}><SettingsIcon size={18} aria-hidden="true" /> {t("settings")} </NavLink>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">
        <Breadcrumbs />
        <Routes>
          <Route path="/" element={<HomeDashboard />} />
          {currentRole === 'mse' && <Route path="/onboarding" element={<OnboardingWizard />} />}
          <Route path="/ledger" element={<TransactionLedger />} />
          <Route path="/notifications" element={<div className="p-8 text-center text-slate-500 font-bold">Notifications View (Connect to Notification List)</div>} />
          {(currentRole === 'mse' || currentRole === 'nsic' || currentRole === 'admin') && (
            <Route path="/matching" element={<MatchingDashboard />} />
          )}
          {(currentRole === 'nsic' || currentRole === 'admin') && (
            <Route path="/performance" element={<SNPPerformance />} />
          )}
          {(currentRole === 'mse' || currentRole === 'nsic' || currentRole === 'admin') && <Route path="/catalog" element={<BusinessCatalog />} />}
          {(currentRole === 'nsic' || currentRole === 'admin') && (
            <Route path="/nsic" element={<NSICDashboard />} />
          )}
          {(currentRole === 'snp' || currentRole === 'admin') && (
            <Route path="/snp/dashboard" element={<SNPDashboard />} />
          )}
          <Route path="/settings" element={<Settings />} />
          <Route path="/privacy" element={<LegalPage />} />
          <Route path="/terms" element={<LegalPage />} />
          <Route path="/help" element={<LegalPage />} />
          <Route path="/architecture" element={<ArchitectureDiagram />} />
          <Route path="/architecture/highlevel" element={<ArchitectureHighLevel />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="border-t border-slate-200 py-8 bg-slate-50 mt-auto">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Command size={14} aria-hidden="true" />
            <span className="font-black text-slate-700 uppercase tracking-tighter">Team Portal</span>
            <span className="font-medium">© 2026 Ministry of MSME</span>
          </div>
          <nav className="flex items-center gap-6" aria-label="Legal Navigation">
            <Link to="/privacy" className="hover:text-[#002147] font-bold transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-[#002147] font-bold transition-colors">Terms</Link>
            <Link to="/help" className="hover:text-[#002147] font-bold transition-colors">Help</Link>
          </nav>
        </div>
      </footer>

      <div className="fixed bottom-20 right-6 md:bottom-24 md:right-8 z-40 flex flex-col gap-3">
  <VoiceNavigator />
</div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
