import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Menu, X, LogOut, User, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { categories } from '@/data/products';

const Navbar = () => {
  const { user, logout, isAuthenticated, login } = useAuth();
  const { totalItems, openCart } = useCart();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    setIsProfileOpen(false);
    navigate('/');
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 glass">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16 sm:h-20">
          {/* Left: User Profile or Login */}
          <div className="relative">
            {isAuthenticated && user ? (
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-2 sm:gap-3 touch-target p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <img
                  src={user.avatar}
                  alt={user.username}
                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 border-primary/50"
                />
                <span className="hidden sm:block font-medium text-sm">{user.username}</span>
              </button>
            ) : (
              <Button
                onClick={login}
                variant="ghost"
                size="sm"
                className="touch-target flex items-center gap-2"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
                <span className="hidden sm:inline">Login</span>
              </Button>
            )}

            {/* Profile Dropdown */}
            <AnimatePresence>
              {isProfileOpen && user && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="absolute top-full left-0 mt-2 w-64 sm:w-72 glass rounded-xl overflow-hidden shadow-lg"
                >
                  <div className="p-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <img
                        src={user.avatar}
                        alt={user.username}
                        className="w-12 h-12 rounded-full border-2 border-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-display font-semibold text-foreground truncate">
                          {user.username}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                          <Mail className="w-3 h-3 flex-shrink-0" />
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="p-2">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors touch-target"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Center: Logo/Brand */}
          <Link to="/" className="absolute left-1/2 -translate-x-1/2">
            <h1 className="font-display text-lg sm:text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              LUCID CLANS
            </h1>
          </Link>

          {/* Right: Cart & Menu */}
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={openCart}
              className="relative touch-target p-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <ShoppingCart className="w-5 h-5 sm:w-6 sm:h-6" />
              {totalItems > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-xs font-bold 
                           bg-accent text-accent-foreground rounded-full"
                >
                  {totalItems}
                </motion.span>
              )}
            </button>

            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="touch-target p-2 rounded-lg hover:bg-muted/50 transition-colors sm:hidden"
            >
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Desktop nav links */}
            <div className="hidden sm:flex items-center gap-4">
              <Link
                to="/store"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Store
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="sm:hidden border-t border-border overflow-hidden max-h-[80vh] overflow-y-auto"
          >
            <div className="p-4 space-y-2">
              <Link
                to="/store"
                onClick={() => setIsMenuOpen(false)}
                className="block w-full text-left px-4 py-3 text-sm font-medium hover:bg-muted/50 rounded-lg transition-colors touch-target"
              >
                Store
              </Link>
              
              {/* Categories Section */}
              <div className="pt-2 border-t border-border mt-2">
                <p className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Categories
                </p>
                <div className="space-y-1">
                  {categories.map((category) => {
                    const isActive = location.pathname === '/store' && 
                      new URLSearchParams(location.search).get('category') === category;
                    return (
                      <Link
                        key={category}
                        to={`/store?category=${encodeURIComponent(category)}`}
                        onClick={() => setIsMenuOpen(false)}
                        className={`block w-full text-left px-4 py-3 text-sm font-medium rounded-lg transition-colors touch-target
                          ${isActive 
                            ? 'bg-primary text-primary-foreground' 
                            : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground'
                          }`}
                      >
                        {category}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click outside to close profile */}
      {isProfileOpen && (
        <div
          className="fixed inset-0 z-[-1]"
          onClick={() => setIsProfileOpen(false)}
        />
      )}
    </nav>
  );
};

export default Navbar;
