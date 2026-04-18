import { useLocation, useNavigate } from "react-router-dom";
import { LogIn } from "lucide-react";
import { startDiscordLogin } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/lib/auth";
import loginVideo from "../../assets/The_Beauty_of_Rust.mp4";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { data } = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false, staleTime: 5_000 });

  const handleLogin = () => {
    const returnTo = typeof location.state === "string" ? location.state : "/";
    startDiscordLogin(returnTo);
  };

  if (data?.ok) {
    // If already authed (cookie session), bounce home.
    navigate("/");
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 overflow-hidden">
      {/* Video background */}
      <div className="absolute inset-0">
        <video
          className="h-full w-full object-cover"
          src={loginVideo}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
        {/* Theme overlays for readability */}
        <div className="absolute inset-0 bg-background/60" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/50 to-background/80" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(234,179,8,0.18),rgba(0,0,0,0))]" />
      </div>

      <div className="relative animate-fade-up flex flex-col items-center text-center">
        <h1 className="text-7xl md:text-9xl font-rajdhani font-bold text-primary text-glow mb-2">
          88
        </h1>
        <p className="text-muted-foreground text-sm md:text-base tracking-widest uppercase mb-12">
          Your Rust Console Command Center
        </p>

        <button
          onClick={handleLogin}
          className="group flex items-center gap-3 rounded-lg bg-primary px-8 py-4 text-primary-foreground font-rajdhani font-bold text-lg uppercase tracking-wider transition-all duration-300 hover:glow-yellow-hover hover:scale-105"
        >
          <LogIn className="h-5 w-5" />
          Login with Discord
        </button>
      </div>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/3 blur-[120px]" />
      </div>
    </div>
  );
};

export default Login;
