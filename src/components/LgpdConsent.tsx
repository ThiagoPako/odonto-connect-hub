/**
 * LgpdConsent — checkbox de consentimento explícito (LGPD Lei 13.709/2018)
 * exigido antes de capturar assinatura eletrônica ou tratar dados sensíveis.
 *
 * Registra o timestamp exato em que o usuário marcou o aceite, o texto
 * apresentado e a versão — esses dados são enviados ao backend junto com
 * a assinatura para fins probatórios (Art. 8º §1º LGPD).
 */
import { useState, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";

export const LGPD_CONSENT_VERSION = "1.0";

export const LGPD_CONSENT_TEXT = `Declaro, para os fins da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), \
que autorizo expressa e livremente o tratamento dos meus dados pessoais e dados \
pessoais sensíveis (incluindo dados de saúde, odontograma, imagens clínicas, \
assinatura manuscrita digitalizada, geolocalização e endereço IP no momento \
da assinatura) pela clínica responsável, com as seguintes finalidades: \
(i) execução do contrato de prestação de serviços odontológicos; \
(ii) elaboração e arquivamento de prontuário clínico; \
(iii) comprovação da realização e aceite dos procedimentos; \
(iv) cumprimento de obrigações legais e regulatórias do Conselho Federal de Odontologia. \
Estou ciente dos meus direitos de acesso, correção, portabilidade e revogação \
do consentimento (Art. 18 LGPD), podendo solicitá-los a qualquer momento ao \
controlador. A presente assinatura eletrônica observa a MP nº 2.200-2/2001.`;

export interface LgpdConsentValue {
  accepted: boolean;
  acceptedAt: string | null; // ISO timestamp
  version: string;
  text: string;
}

interface Props {
  value: LgpdConsentValue;
  onChange: (v: LgpdConsentValue) => void;
  /** Texto curto exibido junto ao checkbox */
  shortLabel?: string;
}

export function LgpdConsent({ value, onChange, shortLabel }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Garante version/text iniciais
  useEffect(() => {
    if (!value.version || !value.text) {
      onChange({
        accepted: value.accepted,
        acceptedAt: value.acceptedAt,
        version: LGPD_CONSENT_VERSION,
        text: LGPD_CONSENT_TEXT,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (checked: boolean) => {
    onChange({
      accepted: checked,
      acceptedAt: checked ? new Date().toISOString() : null,
      version: LGPD_CONSENT_VERSION,
      text: LGPD_CONSENT_TEXT,
    });
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Checkbox
          id="lgpd-consent"
          checked={value.accepted}
          onCheckedChange={(c) => toggle(c === true)}
          className="mt-0.5"
        />
        <label
          htmlFor="lgpd-consent"
          className="text-xs leading-relaxed text-foreground cursor-pointer flex-1"
        >
          <span className="inline-flex items-center gap-1 font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" /> Consentimento LGPD —
          </span>{" "}
          {shortLabel ??
            "Li e autorizo expressamente o tratamento dos meus dados pessoais e dados de saúde para fins de prontuário e execução do tratamento odontológico."}
        </label>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="text-[11px] text-primary hover:underline flex items-center gap-1 ml-6"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? "Ocultar termo completo" : "Ler termo completo (LGPD + MP 2200-2)"}
      </button>

      {expanded && (
        <div className="ml-6 mt-1 p-2 bg-background border border-border rounded text-[10.5px] leading-relaxed text-muted-foreground max-h-40 overflow-y-auto">
          {LGPD_CONSENT_TEXT}
          <p className="mt-2 text-[10px] opacity-70">Versão do termo: {LGPD_CONSENT_VERSION}</p>
        </div>
      )}

      {value.accepted && value.acceptedAt && (
        <p className="ml-6 text-[10px] text-success flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          Consentimento registrado em{" "}
          {new Date(value.acceptedAt).toLocaleString("pt-BR", {
            dateStyle: "short",
            timeStyle: "medium",
          })}
        </p>
      )}
    </div>
  );
}

export const emptyLgpdConsent = (): LgpdConsentValue => ({
  accepted: false,
  acceptedAt: null,
  version: LGPD_CONSENT_VERSION,
  text: LGPD_CONSENT_TEXT,
});
