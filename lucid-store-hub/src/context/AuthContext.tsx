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

// Discord OAuth Configuration
const DISCORD_CLIENT_ID = '1460597371863040112';
const DISCORD_REDIRECT_URI = 'https://lucidclans.netlify.app/auth/callback';
const DISCORD_AUTH_URL = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify%20email`;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const generateSessionToken = () => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;
  };

  const verifySession = async (token: string) => {
    try {
      const response = await fetch(`/.netlify/functions/get-session?token=${encodeURIComponent(token)}`);
      if (response.ok) {
        const userData = await response.json();
        // Update user data if it changed, but don't clear if verification fails
        setUser(userData);
        localStorage.setItem('lucid-clans-user', JSON.stringify(userData));
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
        const userData = JSON.parse(savedUser);
        setUser(userData);
        setIsLoading(false);
        
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
        
        const userData: User = {
          id: discordUser.id,
          username: discordUser.username,
          email: discordUser.email || '',
          avatar: discordUser.avatar 
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordUser.discriminator) % 5}.png`,
        };

        // Generate session token
        const sessionToken = generateSessionToken();

        // CRITICAL: Save to localStorage SYNCHRONOUSLY before ANY redirects or delays
        // This must happen immediately to prevent the loading screen from clearing it
        localStorage.setItem('lucid-clans-user', JSON.stringify(userData));
        localStorage.setItem('lucid-clans-session-token', sessionToken);
        
        // Set user state
        setUser(userData);
        setIsLoading(false);
        
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
