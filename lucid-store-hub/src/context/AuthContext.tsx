import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/types/store';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function normalizeUser(partial: Partial<User> | null | undefined): User | null {
  if (!partial || !partial.id) return null;
  const lucids =
    typeof partial.lucids === 'number' && Number.isFinite(partial.lucids)
      ? Math.max(0, Math.floor(partial.lucids))
      : 0;
  return {
    id: partial.id,
    username: partial.username || '',
    email: partial.email || '',
    avatar: partial.avatar || '',
    lucids,
  };
}

// Discord OAuth Configuration
const DEFAULT_DISCORD_CLIENT_ID = '1434906266920288319';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const DISCORD_CLIENT_ID =
    (import.meta as any)?.env?.VITE_DISCORD_CLIENT_ID || DEFAULT_DISCORD_CLIENT_ID;

  // Build redirect URI from the current deployed site origin so it keeps working
  // even if you change Netlify subdomains.
  const DISCORD_REDIRECT_URI =
    (import.meta as any)?.env?.VITE_DISCORD_REDIRECT_URI || `${window.location.origin}/auth/callback`;
  const DISCORD_AUTH_URL = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(
    DISCORD_REDIRECT_URI
  )}&response_type=code&scope=identify%20email`;

  const generateSessionToken = () => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;
  };

  const verifySession = async (token: string) => {
    try {
      const response = await fetch(`/.netlify/functions/get-session?token=${encodeURIComponent(token)}`);
      if (response.ok) {
        const fromApi = await response.json();
        let prev: Partial<User> = {};
        try {
          prev = JSON.parse(localStorage.getItem('lucid-clans-user') || '{}');
        } catch {
          prev = {};
        }
        const merged = normalizeUser({
          ...fromApi,
          lucids: (fromApi as User).lucids ?? prev.lucids ?? 0,
        });
        if (merged) {
          setUser(merged);
          localStorage.setItem('lucid-clans-user', JSON.stringify(merged));
        }
        return true;
      }
      // Don't clear session on verification failure - keep using localStorage
      return false;
    } catch (error) {
      console.warn('Session verification failed (using localStorage):', error);
      // Don't clear session - keep using what's in localStorage
      return false;
    }
  };

  const refreshLucids = async (discordId: string) => {
    try {
      const res = await fetch(`/.netlify/functions/get-lucids?discordId=${encodeURIComponent(discordId)}`);
      if (!res.ok) return false;
      const data = await res.json();
      if (!data?.ok) return false;
      const lucidsRaw = typeof data.lucids === 'string' ? parseInt(data.lucids, 10) : Number(data.lucids ?? 0);
      const lucids = Number.isFinite(lucidsRaw) ? Math.max(0, Math.floor(lucidsRaw)) : 0;
      setUser((prev) => {
        const merged = normalizeUser({ ...(prev || { id: discordId }), lucids });
        if (merged) localStorage.setItem('lucid-clans-user', JSON.stringify(merged));
        return merged;
      });
      return true;
    } catch (e) {
      console.warn('Lucids refresh failed:', e);
      return false;
    }
  };

  useEffect(() => {
    // Check if we're on the callback page and handle OAuth callback first
    if (window.location.pathname === '/auth/callback') {
      handleOAuthCallback();
      return; // Don't check for existing session yet, let callback handle it
    }

    // Check for existing session from localStorage
    const savedUser = localStorage.getItem('lucid-clans-user');
    const sessionToken = localStorage.getItem('lucid-clans-session-token');
    
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        const userData = normalizeUser(parsed);
        if (userData) setUser(userData);
        setIsLoading(false);

        // Always refresh Lucids from Hetzner (non-blocking).
        if (userData?.id) {
          refreshLucids(userData.id).catch(() => {});
        }
        
        // Verify session with database in background (non-blocking, don't clear on failure)
        if (sessionToken) {
          verifySession(sessionToken).catch((error) => {
            console.warn('Session verification failed, but keeping local session:', error);
            // Don't clear the session - keep using localStorage
          });
        }
      } catch (e) {
        console.error('Failed to load user:', e);
        localStorage.removeItem('lucid-clans-user');
        localStorage.removeItem('lucid-clans-session-token');
        setUser(null);
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  }, []);

  const handleOAuthCallback = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    if (error) {
      console.error('Discord OAuth error:', error);
      window.history.replaceState({}, document.title, '/');
      return;
    }

    if (code) {
      try {
        // Exchange code for token using Netlify function
        const response = await fetch('/.netlify/functions/discord-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code, redirect_uri: DISCORD_REDIRECT_URI }),
        });

        if (!response.ok) {
          throw new Error('Failed to exchange code for token');
        }

        const { access_token } = await response.json();

        // Get user info from Discord
        const userResponse = await fetch('https://discord.com/api/users/@me', {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        });

        if (!userResponse.ok) {
          throw new Error('Failed to fetch user info');
        }

        const discordUser = await userResponse.json();
        
        const userData = normalizeUser({
          id: discordUser.id,
          username: discordUser.username,
          email: discordUser.email || '',
          avatar: discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordUser.discriminator) % 5}.png`,
          lucids: 0,
        });
        if (!userData) throw new Error('Invalid user payload');

        // Generate session token
        const sessionToken = generateSessionToken();

        // CRITICAL: Save to localStorage SYNCHRONOUSLY before ANY redirects or delays
        // This must happen immediately to prevent the loading screen from clearing it
        localStorage.setItem('lucid-clans-user', JSON.stringify(userData));
        localStorage.setItem('lucid-clans-session-token', sessionToken);
        
        // Set user state
        setUser(userData);
        setIsLoading(false);

        // Fetch Lucids balance immediately (non-blocking).
        refreshLucids(userData.id).catch(() => {});
        
        // Save to database (fire and forget - don't wait)
        fetch('/.netlify/functions/save-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            discordId: userData.id,
            username: userData.username,
            email: userData.email,
            avatar: userData.avatar,
            sessionToken: sessionToken,
          }),
        }).catch((error) => {
          console.warn('Failed to save session to database (using localStorage only):', error);
        });
        
        // Redirect with flag to skip loading screen
        window.location.href = '/?logged_in=true';
      } catch (error) {
        console.error('OAuth callback error:', error);
        // Fallback: redirect to login
        window.location.href = '/';
      }
    }
  };

  const login = () => {
    // Redirect to Discord OAuth
    window.location.href = DISCORD_AUTH_URL;
  };

  const logout = async () => {
    const sessionToken = localStorage.getItem('lucid-clans-session-token');
    
    // Delete from database
    if (sessionToken) {
      try {
        await fetch('/.netlify/functions/delete-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionToken }),
        });
      } catch (error) {
        console.error('Failed to delete session from database:', error);
      }
    }
    
    // Clear local storage
    setUser(null);
    localStorage.removeItem('lucid-clans-user');
    localStorage.removeItem('lucid-clans-session-token');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
