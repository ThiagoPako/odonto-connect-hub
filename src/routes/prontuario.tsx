import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Search, FileText, Camera, FlaskConical, Upload, ChevronRight,
  AlertCircle, Pill, Heart, User, Calendar, Phone,
} from "lucide-react";
import { useState } from "react";
import { mockPatientRecords, type PatientRecord, type ClinicalEntry } from "@/data/prontuarioMockData";

export const Route = createFileRoute("/prontuario")({
  component: ProntuarioPage,
});

const entryTypeConfig: Record<ClinicalEntry["type"], { label: string; color: string }> = {
  anamnese: { label: "Anamnese", color: "bg-chart-1/15 text-chart-1" },
  evolucao: { label: "Evolução", color: "bg-dental-cyan/15 text-dental-cyan" },
  procedimento: { label: "Procedimento", color: "bg-primary/15 text-primary" },
  receita: { label: "Receita", color: "bg-chart-3/15 text-chart-3" },
  atestado: { label: "Atestado", color: "bg-chart-4/15 text-chart-4" },
};

const docTypeIcons: Record<string, React.ElementType> = {
  raio_x: FlaskConical,
  foto: Camera,
  exame: FileText,
  documento: FileText,
};

function ProntuarioPage() {
  const [selectedPatient, setSelectedPatient] = useState<PatientRecord | null>(mockPatientRecords[0]);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredPatients = mockPatientRecords.filter(
    (p) => !searchTerm || p.patientName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Prontuário Eletrônico" />
      <main className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-full">
          {/* Patient list */}
          <div className="lg:col-span-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar paciente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-9 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              {filteredPatients.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPatient(p)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    selectedPatient?.id === p.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted border border-transparent"
                  }`}
                >
                  <div className={`h-8 w-8 rounded-full ${p.avatarColor} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                    {p.patientInitials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{p.patientName}</p>
                    <p className="text-[10px] text-muted-foreground">{p.entries.length} registros · {p.lastVisit}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Patient details */}
          <div className="lg:col-span-9 space-y-4">
            {selectedPatient ? (
              <>
                {/* Header card */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-start gap-4">
                    <div className={`h-14 w-14 rounded-full ${selectedPatient.avatarColor} flex items-center justify-center text-lg font-bold text-white shrink-0`}>
                      {selectedPatient.patientInitials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-foreground">{selectedPatient.patientName}</h3>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><User className="h-3 w-3" /> CPF: {selectedPatient.cpf}</span>
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Nasc: {selectedPatient.birthDate}</span>
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {selectedPatient.phone}</span>
                      </div>
                    </div>
                    <button className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
                      <FileText className="h-3.5 w-3.5" /> Nova Evolução
                    </button>
                  </div>

                  {/* Alerts */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    {selectedPatient.allergies.length > 0 && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-destructive/10 text-destructive text-[11px] font-medium">
                        <AlertCircle className="h-3 w-3" /> Alergias: {selectedPatient.allergies.join(", ")}
                      </div>
                    )}
                    {selectedPatient.medications.length > 0 && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-warning/10 text-warning text-[11px] font-medium">
                        <Pill className="h-3 w-3" /> {selectedPatient.medications.join(", ")}
                      </div>
                    )}
                    {selectedPatient.conditions.length > 0 && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-chart-3/10 text-chart-3 text-[11px] font-medium">
                        <Heart className="h-3 w-3" /> {selectedPatient.conditions.join(", ")}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  {/* Clinical history */}
                  <div className="xl:col-span-2 bg-card rounded-xl border border-border p-5">
                    <h4 className="text-sm font-semibold text-card-foreground mb-4">Histórico Clínico</h4>
                    <div className="space-y-3">
                      {selectedPatient.entries.map((entry) => {
                        const cfg = entryTypeConfig[entry.type];
                        return (
                          <div key={entry.id} className="border border-border/50 rounded-lg p-3 space-y-2 hover:bg-muted/30 transition-colors">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
                                <span className="text-xs font-medium text-foreground">{entry.title}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{entry.date}</span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{entry.description}</p>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span>{entry.professional}</span>
                              {entry.tooth && <><span>·</span><span>Dente: {entry.tooth}</span></>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Documents */}
                  <div className="bg-card rounded-xl border border-border p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-semibold text-card-foreground">Documentos</h4>
                      <button className="p-1.5 rounded-lg hover:bg-muted" title="Upload">
                        <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {selectedPatient.documents.map((doc) => {
                        const Icon = docTypeIcons[doc.type] || FileText;
                        return (
                          <div key={doc.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
                            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-medium text-foreground truncate">{doc.name}</p>
                              <p className="text-[10px] text-muted-foreground">{doc.date} · {doc.size}</p>
                            </div>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 flex flex-col items-center justify-center text-center min-h-[400px]">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um paciente</h3>
                <p className="text-xs text-muted-foreground">Escolha um paciente ao lado para ver o prontuário completo.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
