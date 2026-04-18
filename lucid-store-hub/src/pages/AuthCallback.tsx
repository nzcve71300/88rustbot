import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import LoadingScreen from '@/components/LoadingScreen';

const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // The actual OAuth handling is done in AuthContext
    // This component just shows loading while the redirect happens
    const timer = setTimeout(() => {
      navigate('/');
    }, 2000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return <LoadingScreen onComplete={() => navigate('/')} />;
};

export default AuthCallback;

