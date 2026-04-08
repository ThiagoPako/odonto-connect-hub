import { useState, useEffect } from "react";
import { getResetRequests, adminResetPassword } from "@/lib/vpsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { KeyRound, RefreshCcw, Shield, Clock, CheckCircle2 } from "lucide-react";

interface ResetRequest {
  id: string;
  email: string;
  user_id: string;
  status: string;
  created_at: string;
}

export function AdminResetPanel() {
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<string | null>(null);

  const fetchRequests = async () => {
    setLoading(true);
    const { data, error } = await getResetRequests();
    if (error) {
      toast.error("Erro ao carregar solicitações: " + error);
    } else if (data) {
      setRequests(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const handleReset = async (userId: string, email: string) => {
    const newPassword = passwords[userId];
    if (!newPassword || newPassword.length < 6) {
      toast.error("A nova senha deve ter pelo menos 6 caracteres");
      return;
    }
    setResetting(userId);
    const { error } = await adminResetPassword(userId, newPassword);
    if (error) {
      toast.error("Erro ao redefinir senha: " + error);
    } else {
      toast.success(`Senha de ${email} redefinida com sucesso`);
      setPasswords((prev) => ({ ...prev, [userId]: "" }));
      fetchRequests();
    }
    setResetting(null);
  };

  const pending = requests.filter((r) => r.status === "pending");
  const resolved = requests.filter((r) => r.status !== "pending");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Recuperação de Senhas</CardTitle>
              <CardDescription>
                Solicitações de redefinição de senha dos usuários
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchRequests} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
        ) : pending.length === 0 && resolved.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <CheckCircle2 className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">Nenhuma solicitação encontrada</p>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4 text-yellow-500" />
                  Pendentes ({pending.length})
                </h3>
                {pending.map((req) => (
                  <div
                    key={req.id}
                    className="border rounded-xl p-4 space-y-3 bg-card"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{req.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(req.created_at).toLocaleString("pt-BR")}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-yellow-600 border-yellow-300 bg-yellow-50">
                        Pendente
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="Nova senha (mín. 6 caracteres)"
                        value={passwords[req.user_id] || ""}
                        onChange={(e) =>
                          setPasswords((prev) => ({ ...prev, [req.user_id]: e.target.value }))
                        }
                        className="flex-1"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleReset(req.user_id, req.email)}
                        disabled={resetting === req.user_id}
                      >
                        <KeyRound className="h-4 w-4 mr-1" />
                        {resetting === req.user_id ? "Redefinindo..." : "Redefinir"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {resolved.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Resolvidas ({resolved.length})
                </h3>
                {resolved.map((req) => (
                  <div
                    key={req.id}
                    className="border rounded-xl p-3 flex items-center justify-between opacity-60"
                  >
                    <div>
                      <p className="text-sm">{req.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(req.created_at).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <Badge variant="secondary">Resolvida</Badge>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
