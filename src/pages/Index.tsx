import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Auth from "./Auth";
import Home from "./Home";
import { Loader2 } from "lucide-react";

export default function Index() {
  const { user, loading } = useAuth();

  useEffect(() => {
    document.title = "DOMINO MGA — Milalao sy mahazo vola";
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement("meta"); m.setAttribute("name","description"); document.head.appendChild(m); }
    m.setAttribute("content", "DOMINO MGA: lalao Domino Madagasikara, mise MVOLA, cote x2. Inscription tsotra amin'ny numéro Telma.");
  }, []);

  if (loading) return <div className="min-h-screen felt-bg flex items-center justify-center"><Loader2 className="text-primary animate-spin" /></div>;
  return user ? <Home /> : <Auth />;
}
