import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import LoadingScreen from '@/components/LoadingScreen';
import HomePage from '@/components/HomePage';
import Navbar from '@/components/Navbar';
import CartDrawer from '@/components/CartDrawer';
import { useAuth } from '@/context/AuthContext';

const Index = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [showContent, setShowContent] = useState(false);
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  useEffect(() => {
    // Skip loading screen if coming from OAuth callback or if already authenticated
    const urlParams = new URLSearchParams(window.location.search);
    const fromLogin = urlParams.get('logged_in') === 'true';
    
    if (fromLogin || (isAuthenticated && !authLoading)) {
      setIsLoading(false);
      setShowContent(true);
      // Clean up URL
      if (fromLogin) {
        window.history.replaceState({}, document.title, '/');
      }
    }
  }, [isAuthenticated, authLoading]);

  const handleLoadingComplete = () => {
    setIsLoading(false);
    setTimeout(() => setShowContent(true), 100);
  };

  return (
    <div className="min-h-screen bg-background">
      <AnimatePresence mode="wait">
        {isLoading ? (
          <LoadingScreen key="loading" onComplete={handleLoadingComplete} />
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
          >
            {/* Show navbar on homepage only if authenticated */}
            {isAuthenticated && <Navbar />}
            <CartDrawer />
            <HomePage />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Index;
