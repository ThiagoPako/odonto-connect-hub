export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agendamentos: {
        Row: {
          clinicorp_appointment_id: string | null
          created_at: string
          data: string
          dentista_id: string | null
          duracao: number | null
          hora: string
          id: string
          observacoes: string | null
          paciente_id: string | null
          procedimento: string | null
          status: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          clinicorp_appointment_id?: string | null
          created_at?: string
          data: string
          dentista_id?: string | null
          duracao?: number | null
          hora: string
          id?: string
          observacoes?: string | null
          paciente_id?: string | null
          procedimento?: string | null
          status?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          clinicorp_appointment_id?: string | null
          created_at?: string
          data?: string
          dentista_id?: string | null
          duracao?: number | null
          hora?: string
          id?: string
          observacoes?: string | null
          paciente_id?: string | null
          procedimento?: string | null
          status?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agendamentos_dentista_id_fkey"
            columns: ["dentista_id"]
            isOneToOne: false
            referencedRelation: "dentistas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamentos_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamentos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          api_key: string
          config: Json | null
          created_at: string
          enabled: boolean | null
          id: string
          model: string | null
          provider: string
          updated_at: string
        }
        Insert: {
          api_key: string
          config?: Json | null
          created_at?: string
          enabled?: boolean | null
          id?: string
          model?: string | null
          provider: string
          updated_at?: string
        }
        Update: {
          api_key?: string
          config?: Json | null
          created_at?: string
          enabled?: boolean | null
          id?: string
          model?: string | null
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      anamneses: {
        Row: {
          alergias: string[] | null
          cardiopatia: boolean | null
          cirurgias_anteriores: string[] | null
          created_at: string
          diabetes: boolean | null
          doencas_preexistentes: string[] | null
          epilepsia: boolean | null
          etilista: boolean | null
          fumante: boolean | null
          gestante: boolean | null
          hemofilia: boolean | null
          hepatite: boolean | null
          hiv: boolean | null
          id: string
          medicamentos: string[] | null
          observacoes: string | null
          paciente_id: string
          pressao_arterial: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          alergias?: string[] | null
          cardiopatia?: boolean | null
          cirurgias_anteriores?: string[] | null
          created_at?: string
          diabetes?: boolean | null
          doencas_preexistentes?: string[] | null
          epilepsia?: boolean | null
          etilista?: boolean | null
          fumante?: boolean | null
          gestante?: boolean | null
          hemofilia?: boolean | null
          hepatite?: boolean | null
          hiv?: boolean | null
          id?: string
          medicamentos?: string[] | null
          observacoes?: string | null
          paciente_id: string
          pressao_arterial?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          alergias?: string[] | null
          cardiopatia?: boolean | null
          cirurgias_anteriores?: string[] | null
          created_at?: string
          diabetes?: boolean | null
          doencas_preexistentes?: string[] | null
          epilepsia?: boolean | null
          etilista?: boolean | null
          fumante?: boolean | null
          gestante?: boolean | null
          hemofilia?: boolean | null
          hepatite?: boolean | null
          hiv?: boolean | null
          id?: string
          medicamentos?: string[] | null
          observacoes?: string | null
          paciente_id?: string
          pressao_arterial?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anamneses_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: true
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anamneses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      atendentes: {
        Row: {
          ativo: boolean | null
          created_at: string
          email: string
          id: string
          meta_mensal: number | null
          nome: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string
          email: string
          id?: string
          meta_mensal?: number | null
          nome: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string
          email?: string
          id?: string
          meta_mensal?: number | null
          nome?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      attendance_queues: {
        Row: {
          active: boolean | null
          color: string | null
          contact_numbers: Json | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          team_member_ids: Json | null
          tenant_id: string
          updated_at: string
          whatsapp_button_label: string | null
        }
        Insert: {
          active?: boolean | null
          color?: string | null
          contact_numbers?: Json | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          team_member_ids?: Json | null
          tenant_id: string
          updated_at?: string
          whatsapp_button_label?: string | null
        }
        Update: {
          active?: boolean | null
          color?: string | null
          contact_numbers?: Json | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          team_member_ids?: Json | null
          tenant_id?: string
          updated_at?: string
          whatsapp_button_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_queues_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sessions: {
        Row: {
          assigned_at: string | null
          attendant_id: string | null
          attendant_name: string | null
          closed_at: string | null
          created_at: string
          duration_seconds: number | null
          first_response_at: string | null
          id: string
          lead_id: string
          lead_name: string | null
          lead_phone: string | null
          queue_id: string | null
          queue_name: string | null
          response_time_seconds: number | null
          started_waiting_at: string | null
          status: string | null
          tenant_id: string
          wait_time_seconds: number | null
        }
        Insert: {
          assigned_at?: string | null
          attendant_id?: string | null
          attendant_name?: string | null
          closed_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          first_response_at?: string | null
          id?: string
          lead_id: string
          lead_name?: string | null
          lead_phone?: string | null
          queue_id?: string | null
          queue_name?: string | null
          response_time_seconds?: number | null
          started_waiting_at?: string | null
          status?: string | null
          tenant_id: string
          wait_time_seconds?: number | null
        }
        Update: {
          assigned_at?: string | null
          attendant_id?: string | null
          attendant_name?: string | null
          closed_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          first_response_at?: string | null
          id?: string
          lead_id?: string
          lead_name?: string | null
          lead_phone?: string | null
          queue_id?: string | null
          queue_name?: string | null
          response_time_seconds?: number | null
          started_waiting_at?: string | null
          status?: string | null
          tenant_id?: string
          wait_time_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_attendant_id_fkey"
            columns: ["attendant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          attendant_id: string | null
          attendant_name: string | null
          content: string | null
          created_at: string
          file_name: string | null
          id: string
          instance: string | null
          lead_id: string
          media_url: string | null
          metadata: Json | null
          mime_type: string | null
          phone: string | null
          reply_to_content: string | null
          reply_to_id: string | null
          reply_to_sender: string | null
          sender: string
          status: string | null
          tenant_id: string
          timestamp: string
          type: string
        }
        Insert: {
          attendant_id?: string | null
          attendant_name?: string | null
          content?: string | null
          created_at?: string
          file_name?: string | null
          id: string
          instance?: string | null
          lead_id: string
          media_url?: string | null
          metadata?: Json | null
          mime_type?: string | null
          phone?: string | null
          reply_to_content?: string | null
          reply_to_id?: string | null
          reply_to_sender?: string | null
          sender: string
          status?: string | null
          tenant_id?: string
          timestamp?: string
          type?: string
        }
        Update: {
          attendant_id?: string | null
          attendant_name?: string | null
          content?: string | null
          created_at?: string
          file_name?: string | null
          id?: string
          instance?: string | null
          lead_id?: string
          media_url?: string | null
          metadata?: Json | null
          mime_type?: string | null
          phone?: string | null
          reply_to_content?: string | null
          reply_to_id?: string | null
          reply_to_sender?: string | null
          sender?: string
          status?: string | null
          tenant_id?: string
          timestamp?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_attendant_id_fkey"
            columns: ["attendant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_read_status: {
        Row: {
          id: string
          last_read_at: string
          lead_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          id?: string
          last_read_at?: string
          lead_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          id?: string
          last_read_at?: string
          lead_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_read_status_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_read_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_reports: {
        Row: {
          attendant_id: string | null
          attendant_name: string | null
          audio_url: string | null
          created_at: string
          dente_regiao: string | null
          duration_seconds: number | null
          id: string
          metadata: Json | null
          patient_id: string
          patient_name: string | null
          prescricoes: Json | null
          procedimento: string | null
          queixa_principal: string | null
          report: string | null
          tenant_id: string
          transcription: string | null
        }
        Insert: {
          attendant_id?: string | null
          attendant_name?: string | null
          audio_url?: string | null
          created_at?: string
          dente_regiao?: string | null
          duration_seconds?: number | null
          id?: string
          metadata?: Json | null
          patient_id: string
          patient_name?: string | null
          prescricoes?: Json | null
          procedimento?: string | null
          queixa_principal?: string | null
          report?: string | null
          tenant_id: string
          transcription?: string | null
        }
        Update: {
          attendant_id?: string | null
          attendant_name?: string | null
          audio_url?: string | null
          created_at?: string
          dente_regiao?: string | null
          duration_seconds?: number | null
          id?: string
          metadata?: Json | null
          patient_id?: string
          patient_name?: string | null
          prescricoes?: Json | null
          procedimento?: string | null
          queixa_principal?: string | null
          report?: string | null
          tenant_id?: string
          transcription?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_appointment_categories: {
        Row: {
          color: string | null
          description: string | null
          id: number
          raw: Json | null
          synced_at: string | null
          tenant_id: string
        }
        Insert: {
          color?: string | null
          description?: string | null
          id: number
          raw?: Json | null
          synced_at?: string | null
          tenant_id: string
        }
        Update: {
          color?: string | null
          description?: string | null
          id?: number
          raw?: Json | null
          synced_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_appointment_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_appointments: {
        Row: {
          business_id: number | null
          category_color: string | null
          category_description: string | null
          category_id: number | null
          chair_id: number | null
          date: string | null
          from_time: string | null
          id: number
          notes: string | null
          patient_id: number | null
          patient_name: string | null
          professional_id: number | null
          professional_name: string | null
          raw: Json | null
          status: string | null
          synced_at: string | null
          tenant_id: string
          to_time: string | null
        }
        Insert: {
          business_id?: number | null
          category_color?: string | null
          category_description?: string | null
          category_id?: number | null
          chair_id?: number | null
          date?: string | null
          from_time?: string | null
          id: number
          notes?: string | null
          patient_id?: number | null
          patient_name?: string | null
          professional_id?: number | null
          professional_name?: string | null
          raw?: Json | null
          status?: string | null
          synced_at?: string | null
          tenant_id: string
          to_time?: string | null
        }
        Update: {
          business_id?: number | null
          category_color?: string | null
          category_description?: string | null
          category_id?: number | null
          chair_id?: number | null
          date?: string | null
          from_time?: string | null
          id?: number
          notes?: string | null
          patient_id?: number | null
          patient_name?: string | null
          professional_id?: number | null
          professional_name?: string | null
          raw?: Json | null
          status?: string | null
          synced_at?: string | null
          tenant_id?: string
          to_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_chairs: {
        Row: {
          business_id: number | null
          id: number
          name: string | null
          raw: Json | null
          synced_at: string | null
          tenant_id: string
        }
        Insert: {
          business_id?: number | null
          id: number
          name?: string | null
          raw?: Json | null
          synced_at?: string | null
          tenant_id: string
        }
        Update: {
          business_id?: number | null
          id?: number
          name?: string | null
          raw?: Json | null
          synced_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_chairs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_clinics: {
        Row: {
          active: string | null
          address: string | null
          business_name: string | null
          company_id: number | null
          email: string | null
          id: number
          landline: number | null
          name: string | null
          no_limit_apt_same_time: string | null
          other_landline: number | null
          raw: Json | null
          slot_time: number | null
          subscriber_business_uid: string | null
          synced_at: string | null
          tenant_id: string
          working_days_hours: Json | null
        }
        Insert: {
          active?: string | null
          address?: string | null
          business_name?: string | null
          company_id?: number | null
          email?: string | null
          id: number
          landline?: number | null
          name?: string | null
          no_limit_apt_same_time?: string | null
          other_landline?: number | null
          raw?: Json | null
          slot_time?: number | null
          subscriber_business_uid?: string | null
          synced_at?: string | null
          tenant_id: string
          working_days_hours?: Json | null
        }
        Update: {
          active?: string | null
          address?: string | null
          business_name?: string | null
          company_id?: number | null
          email?: string | null
          id?: number
          landline?: number | null
          name?: string | null
          no_limit_apt_same_time?: string | null
          other_landline?: number | null
          raw?: Json | null
          slot_time?: number | null
          subscriber_business_uid?: string | null
          synced_at?: string | null
          tenant_id?: string
          working_days_hours?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_clinics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_documents: {
        Row: {
          category: string | null
          date: string | null
          file_url: string | null
          id: number
          patient_id: number | null
          raw: Json | null
          synced_at: string | null
          tenant_id: string
          title: string | null
        }
        Insert: {
          category?: string | null
          date?: string | null
          file_url?: string | null
          id: number
          patient_id?: number | null
          raw?: Json | null
          synced_at?: string | null
          tenant_id: string
          title?: string | null
        }
        Update: {
          category?: string | null
          date?: string | null
          file_url?: string | null
          id?: number
          patient_id?: number | null
          raw?: Json | null
          synced_at?: string | null
          tenant_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_estimates: {
        Row: {
          amount: number | null
          business_id: number | null
          create_date: string | null
          date: string | null
          id: number
          patient_id: number | null
          patient_name: string | null
          procedure_list: Json | null
          professional_id: number | null
          professional_name: string | null
          raw: Json | null
          status: string | null
          synced_at: string | null
          tenant_id: string
          treatment_id: number | null
        }
        Insert: {
          amount?: number | null
          business_id?: number | null
          create_date?: string | null
          date?: string | null
          id: number
          patient_id?: number | null
          patient_name?: string | null
          procedure_list?: Json | null
          professional_id?: number | null
          professional_name?: string | null
          raw?: Json | null
          status?: string | null
          synced_at?: string | null
          tenant_id: string
          treatment_id?: number | null
        }
        Update: {
          amount?: number | null
          business_id?: number | null
          create_date?: string | null
          date?: string | null
          id?: number
          patient_id?: number | null
          patient_name?: string | null
          procedure_list?: Json | null
          professional_id?: number | null
          professional_name?: string | null
          raw?: Json | null
          status?: string | null
          synced_at?: string | null
          tenant_id?: string
          treatment_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_estimates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_evolutions: {
        Row: {
          date: string | null
          description: string | null
          id: number
          patient_id: number | null
          professional_id: number | null
          raw: Json | null
          synced_at: string | null
          tenant_id: string
          treatment_id: number | null
        }
        Insert: {
          date?: string | null
          description?: string | null
          id: number
          patient_id?: number | null
          professional_id?: number | null
          raw?: Json | null
          synced_at?: string | null
          tenant_id: string
          treatment_id?: number | null
        }
        Update: {
          date?: string | null
          description?: string | null
          id?: number
          patient_id?: number | null
          professional_id?: number | null
          raw?: Json | null
          synced_at?: string | null
          tenant_id?: string
          treatment_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_evolutions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_financial_entries: {
        Row: {
          amount: number | null
          business_id: number | null
          date: string | null
          description: string | null
          external_id: string | null
          id: number
          patient_id: number | null
          raw: Json
          source: string
          synced_at: string | null
          tenant_id: string | null
        }
        Insert: {
          amount?: number | null
          business_id?: number | null
          date?: string | null
          description?: string | null
          external_id?: string | null
          id?: number
          patient_id?: number | null
          raw: Json
          source: string
          synced_at?: string | null
          tenant_id?: string | null
        }
        Update: {
          amount?: number | null
          business_id?: number | null
          date?: string | null
          description?: string | null
          external_id?: string | null
          id?: number
          patient_id?: number | null
          raw?: Json
          source?: string
          synced_at?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_financial_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_monthly_summary: {
        Row: {
          bank_slip: number | null
          business_id: number
          cash: number | null
          credit_card: number | null
          debit_card: number | null
          id: number
          period_month: string
          pix: number | null
          raw: Json
          source: string
          synced_at: string | null
          tenant_id: string | null
          total_amount: number | null
          total_in: number | null
          total_out: number | null
        }
        Insert: {
          bank_slip?: number | null
          business_id?: number
          cash?: number | null
          credit_card?: number | null
          debit_card?: number | null
          id?: number
          period_month: string
          pix?: number | null
          raw: Json
          source: string
          synced_at?: string | null
          tenant_id?: string | null
          total_amount?: number | null
          total_in?: number | null
          total_out?: number | null
        }
        Update: {
          bank_slip?: number | null
          business_id?: number
          cash?: number | null
          credit_card?: number | null
          debit_card?: number | null
          id?: number
          period_month?: string
          pix?: number | null
          raw?: Json
          source?: string
          synced_at?: string | null
          tenant_id?: string | null
          total_amount?: number | null
          total_in?: number | null
          total_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_monthly_summary_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_patients: {
        Row: {
          birth_date: string | null
          document_id: string | null
          email: string | null
          id: number
          mobile_phone: string | null
          name: string | null
          notes: string | null
          raw: Json | null
          sex: string | null
          synced_at: string | null
          tenant_id: string
        }
        Insert: {
          birth_date?: string | null
          document_id?: string | null
          email?: string | null
          id: number
          mobile_phone?: string | null
          name?: string | null
          notes?: string | null
          raw?: Json | null
          sex?: string | null
          synced_at?: string | null
          tenant_id: string
        }
        Update: {
          birth_date?: string | null
          document_id?: string | null
          email?: string | null
          id?: number
          mobile_phone?: string | null
          name?: string | null
          notes?: string | null
          raw?: Json | null
          sex?: string | null
          synced_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_patients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_professionals: {
        Row: {
          full_name: string | null
          id: number
          raw: Json | null
          synced_at: string | null
          tenant_id: string
          user_name: string | null
        }
        Insert: {
          full_name?: string | null
          id: number
          raw?: Json | null
          synced_at?: string | null
          tenant_id: string
          user_name?: string | null
        }
        Update: {
          full_name?: string | null
          id?: number
          raw?: Json | null
          synced_at?: string | null
          tenant_id?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_professionals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_push_log: {
        Row: {
          action: string
          clinicorp_id: string | null
          created_at: string
          entity_type: string
          error_message: string | null
          id: number
          local_id: string
          payload: Json | null
          response: Json | null
          status: string
        }
        Insert: {
          action: string
          clinicorp_id?: string | null
          created_at?: string
          entity_type: string
          error_message?: string | null
          id?: number
          local_id: string
          payload?: Json | null
          response?: Json | null
          status: string
        }
        Update: {
          action?: string
          clinicorp_id?: string | null
          created_at?: string
          entity_type?: string
          error_message?: string | null
          id?: number
          local_id?: string
          payload?: Json | null
          response?: Json | null
          status?: string
        }
        Relationships: []
      }
      clinicorp_settings: {
        Row: {
          api_token: string | null
          base_url: string | null
          created_at: string
          enabled: boolean | null
          id: number
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          subscriber_id: string | null
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          api_token?: string | null
          base_url?: string | null
          created_at?: string
          enabled?: boolean | null
          id?: number
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          subscriber_id?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          api_token?: string | null
          base_url?: string | null
          created_at?: string
          enabled?: boolean | null
          id?: number
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          subscriber_id?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: []
      }
      clinicorp_specialties: {
        Row: {
          description: string | null
          id: number
          raw: Json | null
          synced_at: string | null
          tenant_id: string
        }
        Insert: {
          description?: string | null
          id: number
          raw?: Json | null
          synced_at?: string | null
          tenant_id: string
        }
        Update: {
          description?: string | null
          id?: number
          raw?: Json | null
          synced_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_specialties_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_user_settings: {
        Row: {
          api_token: string | null
          base_url: string | null
          created_at: string
          enabled: boolean | null
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          subscriber_id: string | null
          updated_at: string
          user_id: string
          webhook_secret: string | null
        }
        Insert: {
          api_token?: string | null
          base_url?: string | null
          created_at?: string
          enabled?: boolean | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          subscriber_id?: string | null
          updated_at?: string
          user_id: string
          webhook_secret?: string | null
        }
        Update: {
          api_token?: string | null
          base_url?: string | null
          created_at?: string
          enabled?: boolean | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          subscriber_id?: string | null
          updated_at?: string
          user_id?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinicorp_user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicorp_webhook_events: {
        Row: {
          error_message: string | null
          event_type: string | null
          external_id: string | null
          headers: Json | null
          id: number
          ip: string | null
          payload: Json
          processed_at: string | null
          received_at: string
          status: string
        }
        Insert: {
          error_message?: string | null
          event_type?: string | null
          external_id?: string | null
          headers?: Json | null
          id?: number
          ip?: string | null
          payload: Json
          processed_at?: string | null
          received_at?: string
          status?: string
        }
        Update: {
          error_message?: string | null
          event_type?: string | null
          external_id?: string | null
          headers?: Json | null
          id?: number
          ip?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
          status?: string
        }
        Relationships: []
      }
      comissoes: {
        Row: {
          created_at: string
          data: string | null
          dentista_id: string | null
          descricao: string | null
          id: string
          paciente_id: string | null
          pago: boolean | null
          percentual: number | null
          procedimento: string | null
          status: string | null
          tenant_id: string
          tratamento_id: string | null
          updated_at: string
          valor: number | null
        }
        Insert: {
          created_at?: string
          data?: string | null
          dentista_id?: string | null
          descricao?: string | null
          id?: string
          paciente_id?: string | null
          pago?: boolean | null
          percentual?: number | null
          procedimento?: string | null
          status?: string | null
          tenant_id: string
          tratamento_id?: string | null
          updated_at?: string
          valor?: number | null
        }
        Update: {
          created_at?: string
          data?: string | null
          dentista_id?: string | null
          descricao?: string | null
          id?: string
          paciente_id?: string | null
          pago?: boolean | null
          percentual?: number | null
          procedimento?: string | null
          status?: string | null
          tenant_id?: string
          tratamento_id?: string | null
          updated_at?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "comissoes_dentista_id_fkey"
            columns: ["dentista_id"]
            isOneToOne: false
            referencedRelation: "dentistas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comissoes_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comissoes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comissoes_tratamento_id_fkey"
            columns: ["tratamento_id"]
            isOneToOne: false
            referencedRelation: "tratamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      consultations: {
        Row: {
          appointment_id: string | null
          clinical_report_id: string | null
          created_at: string
          dente_regiao: string | null
          dentist_id: string | null
          dentist_name: string | null
          duration_seconds: number | null
          finished_at: string | null
          gravacoes_count: number | null
          id: string
          metadata: Json | null
          observacoes: string | null
          patient_id: string
          patient_name: string | null
          prescricoes: Json | null
          procedimento: string | null
          queixa_principal: string | null
          started_at: string | null
          status: string | null
          tenant_id: string
        }
        Insert: {
          appointment_id?: string | null
          clinical_report_id?: string | null
          created_at?: string
          dente_regiao?: string | null
          dentist_id?: string | null
          dentist_name?: string | null
          duration_seconds?: number | null
          finished_at?: string | null
          gravacoes_count?: number | null
          id?: string
          metadata?: Json | null
          observacoes?: string | null
          patient_id: string
          patient_name?: string | null
          prescricoes?: Json | null
          procedimento?: string | null
          queixa_principal?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id: string
        }
        Update: {
          appointment_id?: string | null
          clinical_report_id?: string | null
          created_at?: string
          dente_regiao?: string | null
          dentist_id?: string | null
          dentist_name?: string | null
          duration_seconds?: number | null
          finished_at?: string | null
          gravacoes_count?: number | null
          id?: string
          metadata?: Json | null
          observacoes?: string | null
          patient_id?: string
          patient_name?: string | null
          prescricoes?: Json | null
          procedimento?: string | null
          queixa_principal?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultations_clinical_report_id_fkey"
            columns: ["clinical_report_id"]
            isOneToOne: false
            referencedRelation: "clinical_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contatos: {
        Row: {
          avatar_url: string | null
          cargo: string | null
          created_at: string
          email: string | null
          empresa: string | null
          favorito: boolean | null
          id: string
          nome: string
          observacoes: string | null
          telefone: string | null
          tenant_id: string
          tipo: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string
          email?: string | null
          empresa?: string | null
          favorito?: boolean | null
          id?: string
          nome: string
          observacoes?: string | null
          telefone?: string | null
          tenant_id?: string
          tipo?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string
          email?: string | null
          empresa?: string | null
          favorito?: boolean | null
          id?: string
          nome?: string
          observacoes?: string | null
          telefone?: string | null
          tenant_id?: string
          tipo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contatos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_atendimentos: {
        Row: {
          atendente_id: string
          created_at: string
          id: string
          lead_id: string
          resumo: string | null
          tenant_id: string
          tipo: string | null
        }
        Insert: {
          atendente_id: string
          created_at?: string
          id?: string
          lead_id: string
          resumo?: string | null
          tenant_id: string
          tipo?: string | null
        }
        Update: {
          atendente_id?: string
          created_at?: string
          id?: string
          lead_id?: string
          resumo?: string | null
          tenant_id?: string
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_atendimentos_atendente_id_fkey"
            columns: ["atendente_id"]
            isOneToOne: false
            referencedRelation: "atendentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_atendimentos_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          assigned_to: string | null
          assigned_to_name: string | null
          avatar_url: string | null
          awaiting_queue_selection: boolean | null
          consciousness_level: string | null
          created_at: string
          email: string | null
          id: string
          kanban_stage: string | null
          nome: string
          observacoes: string | null
          orcamento_id: string | null
          origem: string | null
          paciente_id: string | null
          priority: boolean | null
          queue_id: string | null
          queue_name: string | null
          status: string | null
          telefone: string | null
          tenant_id: string
          updated_at: string
          valor: number | null
        }
        Insert: {
          assigned_to?: string | null
          assigned_to_name?: string | null
          avatar_url?: string | null
          awaiting_queue_selection?: boolean | null
          consciousness_level?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kanban_stage?: string | null
          nome: string
          observacoes?: string | null
          orcamento_id?: string | null
          origem?: string | null
          paciente_id?: string | null
          priority?: boolean | null
          queue_id?: string | null
          queue_name?: string | null
          status?: string | null
          telefone?: string | null
          tenant_id: string
          updated_at?: string
          valor?: number | null
        }
        Update: {
          assigned_to?: string | null
          assigned_to_name?: string | null
          avatar_url?: string | null
          awaiting_queue_selection?: boolean | null
          consciousness_level?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kanban_stage?: string | null
          nome?: string
          observacoes?: string | null
          orcamento_id?: string | null
          origem?: string | null
          paciente_id?: string | null
          priority?: boolean | null
          queue_id?: string | null
          queue_name?: string | null
          status?: string | null
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "attendance_queues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dentistas: {
        Row: {
          ativo: boolean | null
          clinicorp_professional_id: string | null
          comissao_percentual: number | null
          cor_agenda: string | null
          created_at: string
          cro: string | null
          email: string | null
          especialidade: string | null
          id: string
          nome: string
          sala: string | null
          telefone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean | null
          clinicorp_professional_id?: string | null
          comissao_percentual?: number | null
          cor_agenda?: string | null
          created_at?: string
          cro?: string | null
          email?: string | null
          especialidade?: string | null
          id?: string
          nome: string
          sala?: string | null
          telefone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean | null
          clinicorp_professional_id?: string | null
          comissao_percentual?: number | null
          cor_agenda?: string | null
          created_at?: string
          cro?: string | null
          email?: string | null
          especialidade?: string | null
          id?: string
          nome?: string
          sala?: string | null
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dentistas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque: {
        Row: {
          categoria: string | null
          created_at: string
          fornecedor: string | null
          id: string
          localizacao: string | null
          lote: string | null
          nome: string
          quantidade: number | null
          quantidade_minima: number | null
          tenant_id: string
          unidade: string | null
          updated_at: string
          validade: string | null
          valor_unitario: number | null
        }
        Insert: {
          categoria?: string | null
          created_at?: string
          fornecedor?: string | null
          id?: string
          localizacao?: string | null
          lote?: string | null
          nome: string
          quantidade?: number | null
          quantidade_minima?: number | null
          tenant_id: string
          unidade?: string | null
          updated_at?: string
          validade?: string | null
          valor_unitario?: number | null
        }
        Update: {
          categoria?: string | null
          created_at?: string
          fornecedor?: string | null
          id?: string
          localizacao?: string | null
          lote?: string | null
          nome?: string
          quantidade?: number | null
          quantidade_minima?: number | null
          tenant_id?: string
          unidade?: string | null
          updated_at?: string
          validade?: string | null
          valor_unitario?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_movimentos: {
        Row: {
          created_at: string
          id: string
          item_id: string
          motivo: string | null
          quantidade: number
          tenant_id: string
          tipo: string
          usuario_nome: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          motivo?: string | null
          quantidade: number
          tenant_id: string
          tipo: string
          usuario_nome?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          motivo?: string | null
          quantidade?: number
          tenant_id?: string
          tipo?: string
          usuario_nome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_movimentos_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "estoque"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      etapas: {
        Row: {
          cor: string | null
          created_at: string
          funil_id: string
          id: string
          nome: string
          ordem: number | null
          probabilidade: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cor?: string | null
          created_at?: string
          funil_id: string
          id?: string
          nome: string
          ordem?: number | null
          probabilidade?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cor?: string | null
          created_at?: string
          funil_id?: string
          id?: string
          nome?: string
          ordem?: number | null
          probabilidade?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "etapas_funil_id_fkey"
            columns: ["funil_id"]
            isOneToOne: false
            referencedRelation: "funis"
            referencedColumns: ["id"]
          },
        ]
      }
      exame_tipos: {
        Row: {
          ativo: boolean
          categoria: string | null
          codigo_tiss: string | null
          created_at: string
          id: string
          nome: string
          preco: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string | null
          codigo_tiss?: string | null
          created_at?: string
          id?: string
          nome: string
          preco?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string | null
          codigo_tiss?: string | null
          created_at?: string
          id?: string
          nome?: string
          preco?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exame_tipos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      exames: {
        Row: {
          arquivo_url: string | null
          clinica_origem: string | null
          codigo: string | null
          created_at: string
          created_by: string | null
          data_entrega: string | null
          data_realizacao: string | null
          data_solicitacao: string
          dentista_solicitante_id: string | null
          fornecedor_terc: string | null
          id: string
          laudo_texto: string | null
          modo_entrega: string | null
          observacoes: string | null
          paciente_id: string | null
          prioridade: string
          status: string
          tenant_id: string
          terceirizado: boolean
          tipo_exame_id: string | null
          tipo_nome: string
          updated_at: string
          valor: number | null
        }
        Insert: {
          arquivo_url?: string | null
          clinica_origem?: string | null
          codigo?: string | null
          created_at?: string
          created_by?: string | null
          data_entrega?: string | null
          data_realizacao?: string | null
          data_solicitacao?: string
          dentista_solicitante_id?: string | null
          fornecedor_terc?: string | null
          id?: string
          laudo_texto?: string | null
          modo_entrega?: string | null
          observacoes?: string | null
          paciente_id?: string | null
          prioridade?: string
          status?: string
          tenant_id: string
          terceirizado?: boolean
          tipo_exame_id?: string | null
          tipo_nome: string
          updated_at?: string
          valor?: number | null
        }
        Update: {
          arquivo_url?: string | null
          clinica_origem?: string | null
          codigo?: string | null
          created_at?: string
          created_by?: string | null
          data_entrega?: string | null
          data_realizacao?: string | null
          data_solicitacao?: string
          dentista_solicitante_id?: string | null
          fornecedor_terc?: string | null
          id?: string
          laudo_texto?: string | null
          modo_entrega?: string | null
          observacoes?: string | null
          paciente_id?: string | null
          prioridade?: string
          status?: string
          tenant_id?: string
          terceirizado?: boolean
          tipo_exame_id?: string | null
          tipo_nome?: string
          updated_at?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exames_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exames_dentista_solicitante_id_fkey"
            columns: ["dentista_solicitante_id"]
            isOneToOne: false
            referencedRelation: "dentistas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exames_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exames_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exames_tipo_exame_id_fkey"
            columns: ["tipo_exame_id"]
            isOneToOne: false
            referencedRelation: "exame_tipos"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_bank_accounts: {
        Row: {
          account: string | null
          active: boolean | null
          agency: string | null
          balance: number | null
          bank: string
          color: string | null
          created_at: string
          id: string
          name: string
          tenant_id: string
          type: string | null
          updated_at: string
        }
        Insert: {
          account?: string | null
          active?: boolean | null
          agency?: string | null
          balance?: number | null
          bank: string
          color?: string | null
          created_at?: string
          id?: string
          name: string
          tenant_id: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          account?: string | null
          active?: boolean | null
          agency?: string | null
          balance?: number | null
          bank?: string
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_bills: {
        Row: {
          bank_account_id: string | null
          category: string
          created_at: string
          description: string
          due_date: string
          id: string
          payment_date: string | null
          recurrent: boolean | null
          status: string | null
          supplier: string | null
          tenant_id: string
          updated_at: string
          value: number
        }
        Insert: {
          bank_account_id?: string | null
          category: string
          created_at?: string
          description: string
          due_date: string
          id?: string
          payment_date?: string | null
          recurrent?: boolean | null
          status?: string | null
          supplier?: string | null
          tenant_id: string
          updated_at?: string
          value: number
        }
        Update: {
          bank_account_id?: string | null
          category?: string
          created_at?: string
          description?: string
          due_date?: string
          id?: string
          payment_date?: string | null
          recurrent?: boolean | null
          status?: string | null
          supplier?: string | null
          tenant_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_bills_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "fin_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_bills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_employees: {
        Row: {
          active: boolean | null
          admission_date: string | null
          bank_account_id: string | null
          benefits: number | null
          cpf: string | null
          created_at: string
          id: string
          name: string
          role: string
          salary: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          admission_date?: string | null
          bank_account_id?: string | null
          benefits?: number | null
          cpf?: string | null
          created_at?: string
          id?: string
          name: string
          role: string
          salary?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          admission_date?: string | null
          bank_account_id?: string | null
          benefits?: number | null
          cpf?: string | null
          created_at?: string
          id?: string
          name?: string
          role?: string
          salary?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_employees_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "fin_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_movements: {
        Row: {
          bank_account_id: string | null
          bank_name: string | null
          bill_id: string | null
          category: string
          created_at: string
          date: string
          description: string
          id: string
          patient: string | null
          payroll_id: string | null
          tenant_id: string
          type: string
          value: number
        }
        Insert: {
          bank_account_id?: string | null
          bank_name?: string | null
          bill_id?: string | null
          category: string
          created_at?: string
          date: string
          description: string
          id?: string
          patient?: string | null
          payroll_id?: string | null
          tenant_id?: string
          type: string
          value: number
        }
        Update: {
          bank_account_id?: string | null
          bank_name?: string | null
          bill_id?: string | null
          category?: string
          created_at?: string
          date?: string
          description?: string
          id?: string
          patient?: string | null
          payroll_id?: string | null
          tenant_id?: string
          type?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_movements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "fin_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_movements_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "fin_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_movements_payroll_id_fkey"
            columns: ["payroll_id"]
            isOneToOne: false
            referencedRelation: "fin_payrolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_overdue: {
        Row: {
          created_at: string
          days_late: number | null
          id: string
          patient: string
          procedure: string | null
          tenant_id: string
          value: number
        }
        Insert: {
          created_at?: string
          days_late?: number | null
          id?: string
          patient: string
          procedure?: string | null
          tenant_id: string
          value: number
        }
        Update: {
          created_at?: string
          days_late?: number | null
          id?: string
          patient?: string
          procedure?: string | null
          tenant_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_overdue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_payrolls: {
        Row: {
          bank_account_id: string | null
          benefits: number | null
          created_at: string
          deductions: number | null
          employee_id: string
          employee_name: string
          gross_salary: number | null
          id: string
          month: string
          net_salary: number | null
          payment_date: string | null
          status: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bank_account_id?: string | null
          benefits?: number | null
          created_at?: string
          deductions?: number | null
          employee_id: string
          employee_name: string
          gross_salary?: number | null
          id?: string
          month: string
          net_salary?: number | null
          payment_date?: string | null
          status?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          bank_account_id?: string | null
          benefits?: number | null
          created_at?: string
          deductions?: number | null
          employee_id?: string
          employee_name?: string
          gross_salary?: number | null
          id?: string
          month?: string
          net_salary?: number | null
          payment_date?: string | null
          status?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_payrolls_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "fin_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_payrolls_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "fin_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_payrolls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      financeiro: {
        Row: {
          categoria: string | null
          clinicorp_financial_id: string | null
          created_at: string
          data: string
          descricao: string | null
          forma_pagamento: string | null
          id: string
          observacoes: string | null
          paciente_id: string | null
          parcela_atual: number | null
          parcelas: number | null
          recorrente: boolean | null
          status: string | null
          tenant_id: string
          tipo: string
          updated_at: string
          valor: number
          vencimento: string | null
        }
        Insert: {
          categoria?: string | null
          clinicorp_financial_id?: string | null
          created_at?: string
          data?: string
          descricao?: string | null
          forma_pagamento?: string | null
          id?: string
          observacoes?: string | null
          paciente_id?: string | null
          parcela_atual?: number | null
          parcelas?: number | null
          recorrente?: boolean | null
          status?: string | null
          tenant_id?: string
          tipo: string
          updated_at?: string
          valor: number
          vencimento?: string | null
        }
        Update: {
          categoria?: string | null
          clinicorp_financial_id?: string | null
          created_at?: string
          data?: string
          descricao?: string | null
          forma_pagamento?: string | null
          id?: string
          observacoes?: string | null
          paciente_id?: string | null
          parcela_atual?: number | null
          parcelas?: number | null
          recorrente?: boolean | null
          status?: string | null
          tenant_id?: string
          tipo?: string
          updated_at?: string
          valor?: number
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financeiro_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_ups: {
        Row: {
          created_at: string
          data_agendada: string
          data_conclusao: string | null
          id: string
          lead_id: string
          nota: string | null
          status: string | null
          tenant_id: string
          tipo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_agendada: string
          data_conclusao?: string | null
          id?: string
          lead_id: string
          nota?: string | null
          status?: string | null
          tenant_id: string
          tipo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_agendada?: string
          data_conclusao?: string | null
          id?: string
          lead_id?: string
          nota?: string | null
          status?: string | null
          tenant_id?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      funis: {
        Row: {
          ativo: boolean | null
          cor: string | null
          created_at: string
          descricao: string | null
          id: string
          nome: string
          ordem: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean | null
          cor?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          ordem?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean | null
          cor?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          ordem?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number
          created_at: string | null
          currency: string | null
          due_date: string | null
          gateway: string | null
          gateway_charge_id: string | null
          id: string
          metadata: Json | null
          paid_at: string | null
          payment_url: string | null
          status: string
          subscription_id: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          gateway?: string | null
          gateway_charge_id?: string | null
          id?: string
          metadata?: Json | null
          paid_at?: string | null
          payment_url?: string | null
          status?: string
          subscription_id?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          gateway?: string | null
          gateway_charge_id?: string | null
          id?: string
          metadata?: Json | null
          paid_at?: string | null
          payment_url?: string | null
          status?: string
          subscription_id?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kanban_movements: {
        Row: {
          created_at: string
          from_stage: string | null
          id: string
          lead_id: string
          moved_by: string | null
          moved_by_name: string | null
          reason: string | null
          tenant_id: string
          to_stage: string
        }
        Insert: {
          created_at?: string
          from_stage?: string | null
          id?: string
          lead_id: string
          moved_by?: string | null
          moved_by_name?: string | null
          reason?: string | null
          tenant_id: string
          to_stage: string
        }
        Update: {
          created_at?: string
          from_stage?: string | null
          id?: string
          lead_id?: string
          moved_by?: string | null
          moved_by_name?: string | null
          reason?: string | null
          tenant_id?: string
          to_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "kanban_movements_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kanban_movements_moved_by_fkey"
            columns: ["moved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kanban_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tag_assignments: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          tag_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          tag_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          tag_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "lead_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tag_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tags: {
        Row: {
          color: string
          created_at: string
          icon: string | null
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          atendente_id: string | null
          created_at: string
          data_conversao: string | null
          data_perda: string | null
          email: string | null
          etapa_id: string | null
          funil_id: string | null
          id: string
          motivo_perda: string | null
          nome: string
          observacoes: string | null
          origem: string | null
          paciente_id: string | null
          status: string | null
          telefone: string | null
          tenant_id: string
          updated_at: string
          valor_estimado: number | null
        }
        Insert: {
          atendente_id?: string | null
          created_at?: string
          data_conversao?: string | null
          data_perda?: string | null
          email?: string | null
          etapa_id?: string | null
          funil_id?: string | null
          id?: string
          motivo_perda?: string | null
          nome: string
          observacoes?: string | null
          origem?: string | null
          paciente_id?: string | null
          status?: string | null
          telefone?: string | null
          tenant_id: string
          updated_at?: string
          valor_estimado?: number | null
        }
        Update: {
          atendente_id?: string | null
          created_at?: string
          data_conversao?: string | null
          data_perda?: string | null
          email?: string | null
          etapa_id?: string | null
          funil_id?: string | null
          id?: string
          motivo_perda?: string | null
          nome?: string
          observacoes?: string | null
          origem?: string | null
          paciente_id?: string | null
          status?: string | null
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
          valor_estimado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_funil_id_fkey"
            columns: ["funil_id"]
            isOneToOne: false
            referencedRelation: "funis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ads_accounts: {
        Row: {
          access_token: string | null
          account_id: string
          account_name: string
          connected: boolean | null
          created_at: string
          id: string
          last_sync: string | null
          tenant_id: string
        }
        Insert: {
          access_token?: string | null
          account_id: string
          account_name: string
          connected?: boolean | null
          created_at?: string
          id?: string
          last_sync?: string | null
          tenant_id: string
        }
        Update: {
          access_token?: string | null
          account_id?: string
          account_name?: string
          connected?: boolean | null
          created_at?: string
          id?: string
          last_sync?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ads_campaigns: {
        Row: {
          account_id: string
          campaign_id: string
          created_at: string
          daily_budget: number | null
          id: string
          lifetime_budget: number | null
          name: string
          objective: string | null
          start_time: string | null
          status: string | null
          stop_time: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          campaign_id: string
          created_at?: string
          daily_budget?: number | null
          id?: string
          lifetime_budget?: number | null
          name: string
          objective?: string | null
          start_time?: string | null
          status?: string | null
          stop_time?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          campaign_id?: string
          created_at?: string
          daily_budget?: number | null
          id?: string
          lifetime_budget?: number | null
          name?: string
          objective?: string | null
          start_time?: string | null
          status?: string | null
          stop_time?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ads_insights: {
        Row: {
          actions: Json | null
          campaign_id: string
          clicks: number | null
          conversions: number | null
          cost_per_conversion: number | null
          cost_per_lead: number | null
          cpc: number | null
          cpm: number | null
          created_at: string
          ctr: number | null
          date_start: string
          date_stop: string
          id: string
          impressions: number | null
          leads: number | null
          reach: number | null
          spend: number | null
          tenant_id: string
        }
        Insert: {
          actions?: Json | null
          campaign_id: string
          clicks?: number | null
          conversions?: number | null
          cost_per_conversion?: number | null
          cost_per_lead?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          date_start: string
          date_stop: string
          id?: string
          impressions?: number | null
          leads?: number | null
          reach?: number | null
          spend?: number | null
          tenant_id: string
        }
        Update: {
          actions?: Json | null
          campaign_id?: string
          clicks?: number | null
          conversions?: number | null
          cost_per_conversion?: number | null
          cost_per_lead?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          date_start?: string
          date_stop?: string
          id?: string
          impressions?: number | null
          leads?: number | null
          reach?: number | null
          spend?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_insights_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      odontogramas: {
        Row: {
          created_at: string
          dentes: Json | null
          id: string
          observacoes: string | null
          paciente_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dentes?: Json | null
          id?: string
          observacoes?: string | null
          paciente_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dentes?: Json | null
          id?: string
          observacoes?: string | null
          paciente_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "odontogramas_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: true
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odontogramas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos: {
        Row: {
          clinicorp_estimate_id: string | null
          created_at: string
          dentista_id: string | null
          desconto: number | null
          forma_pagamento: string | null
          id: string
          itens: Json | null
          observacoes: string | null
          paciente_id: string | null
          parcelas: number | null
          status: string | null
          tenant_id: string
          updated_at: string
          validade: string | null
          valor_total: number | null
        }
        Insert: {
          clinicorp_estimate_id?: string | null
          created_at?: string
          dentista_id?: string | null
          desconto?: number | null
          forma_pagamento?: string | null
          id?: string
          itens?: Json | null
          observacoes?: string | null
          paciente_id?: string | null
          parcelas?: number | null
          status?: string | null
          tenant_id: string
          updated_at?: string
          validade?: string | null
          valor_total?: number | null
        }
        Update: {
          clinicorp_estimate_id?: string | null
          created_at?: string
          dentista_id?: string | null
          desconto?: number | null
          forma_pagamento?: string | null
          id?: string
          itens?: Json | null
          observacoes?: string | null
          paciente_id?: string | null
          parcelas?: number | null
          status?: string | null
          tenant_id?: string
          updated_at?: string
          validade?: string | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_dentista_id_fkey"
            columns: ["dentista_id"]
            isOneToOne: false
            referencedRelation: "dentistas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      origens: {
        Row: {
          cor: string | null
          created_at: string
          id: string
          nome: string
          slug: string
          tenant_id: string
        }
        Insert: {
          cor?: string | null
          created_at?: string
          id?: string
          nome: string
          slug: string
          tenant_id: string
        }
        Update: {
          cor?: string | null
          created_at?: string
          id?: string
          nome?: string
          slug?: string
          tenant_id?: string
        }
        Relationships: []
      }
      pacientes: {
        Row: {
          bairro: string | null
          celular: string | null
          cep: string | null
          cidade: string | null
          complemento: string | null
          convenio: string | null
          cpf: string | null
          created_at: string
          created_by: string | null
          data_nascimento: string | null
          email: string | null
          estado: string | null
          id: string
          logradouro: string | null
          nome: string
          numero: string | null
          numero_carteira: string | null
          observacoes: string | null
          rg: string | null
          sexo: string | null
          status: string
          telefone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          celular?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          convenio?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          data_nascimento?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          logradouro?: string | null
          nome: string
          numero?: string | null
          numero_carteira?: string | null
          observacoes?: string | null
          rg?: string | null
          sexo?: string | null
          status?: string
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          celular?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          convenio?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          data_nascimento?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          logradouro?: string | null
          nome?: string
          numero?: string | null
          numero_carteira?: string | null
          observacoes?: string | null
          rg?: string | null
          sexo?: string | null
          status?: string
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          descricao: string | null
          display_order: number | null
          features: Json | null
          id: string
          max_dentistas: number | null
          max_pacientes: number | null
          max_usuarios: number | null
          max_whatsapp_instances: number | null
          nome: string
          preco_anual: number | null
          preco_mensal: number
          slug: string
          trial_days: number
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          display_order?: number | null
          features?: Json | null
          id?: string
          max_dentistas?: number | null
          max_pacientes?: number | null
          max_usuarios?: number | null
          max_whatsapp_instances?: number | null
          nome: string
          preco_anual?: number | null
          preco_mensal?: number
          slug: string
          trial_days?: number
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          display_order?: number | null
          features?: Json | null
          id?: string
          max_dentistas?: number | null
          max_pacientes?: number | null
          max_usuarios?: number | null
          max_whatsapp_instances?: number | null
          nome?: string
          preco_anual?: number | null
          preco_mensal?: number
          slug?: string
          trial_days?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      procedimentos_catalogo: {
        Row: {
          ativo: boolean | null
          categoria: string | null
          codigo: string | null
          cor: string | null
          created_at: string
          descricao: string | null
          duracao_minutos: number | null
          id: string
          nome: string
          requer_dente: boolean | null
          requer_face: boolean | null
          tenant_id: string
          updated_at: string
          valor_convenio: number | null
          valor_particular: number | null
          versao_atual: number | null
        }
        Insert: {
          ativo?: boolean | null
          categoria?: string | null
          codigo?: string | null
          cor?: string | null
          created_at?: string
          descricao?: string | null
          duracao_minutos?: number | null
          id?: string
          nome: string
          requer_dente?: boolean | null
          requer_face?: boolean | null
          tenant_id: string
          updated_at?: string
          valor_convenio?: number | null
          valor_particular?: number | null
          versao_atual?: number | null
        }
        Update: {
          ativo?: boolean | null
          categoria?: string | null
          codigo?: string | null
          cor?: string | null
          created_at?: string
          descricao?: string | null
          duracao_minutos?: number | null
          id?: string
          nome?: string
          requer_dente?: boolean | null
          requer_face?: boolean | null
          tenant_id?: string
          updated_at?: string
          valor_convenio?: number | null
          valor_particular?: number | null
          versao_atual?: number | null
        }
        Relationships: []
      }
      procedimentos_versoes: {
        Row: {
          alterado_por: string | null
          categoria: string | null
          codigo: string | null
          cor: string | null
          created_at: string
          descricao: string | null
          duracao_minutos: number | null
          id: string
          motivo: string | null
          nome: string
          procedimento_id: string
          requer_dente: boolean | null
          requer_face: boolean | null
          tenant_id: string
          valido_ate: string | null
          valido_desde: string
          valor_convenio: number | null
          valor_particular: number | null
          versao: number
        }
        Insert: {
          alterado_por?: string | null
          categoria?: string | null
          codigo?: string | null
          cor?: string | null
          created_at?: string
          descricao?: string | null
          duracao_minutos?: number | null
          id?: string
          motivo?: string | null
          nome: string
          procedimento_id: string
          requer_dente?: boolean | null
          requer_face?: boolean | null
          tenant_id: string
          valido_ate?: string | null
          valido_desde?: string
          valor_convenio?: number | null
          valor_particular?: number | null
          versao: number
        }
        Update: {
          alterado_por?: string | null
          categoria?: string | null
          codigo?: string | null
          cor?: string | null
          created_at?: string
          descricao?: string | null
          duracao_minutos?: number | null
          id?: string
          motivo?: string | null
          nome?: string
          procedimento_id?: string
          requer_dente?: boolean | null
          requer_face?: boolean | null
          tenant_id?: string
          valido_ate?: string | null
          valido_desde?: string
          valor_convenio?: number | null
          valor_particular?: number | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "procedimentos_versoes_procedimento_id_fkey"
            columns: ["procedimento_id"]
            isOneToOne: false
            referencedRelation: "procedimentos_catalogo"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          id: string
          is_super_admin: boolean | null
          nome: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          id: string
          is_super_admin?: boolean | null
          nome?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_super_admin?: boolean | null
          nome?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prontuarios: {
        Row: {
          anexos: Json | null
          created_at: string
          dentista_id: string | null
          descricao: string | null
          id: string
          odontograma: Json | null
          paciente_id: string | null
          tenant_id: string
          tipo: string | null
          titulo: string | null
          updated_at: string
        }
        Insert: {
          anexos?: Json | null
          created_at?: string
          dentista_id?: string | null
          descricao?: string | null
          id?: string
          odontograma?: Json | null
          paciente_id?: string | null
          tenant_id: string
          tipo?: string | null
          titulo?: string | null
          updated_at?: string
        }
        Update: {
          anexos?: Json | null
          created_at?: string
          dentista_id?: string | null
          descricao?: string | null
          id?: string
          odontograma?: Json | null
          paciente_id?: string | null
          tenant_id?: string
          tipo?: string | null
          titulo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prontuarios_dentista_id_fkey"
            columns: ["dentista_id"]
            isOneToOne: false
            referencedRelation: "dentistas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prontuarios_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prontuarios_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          keys_auth: string
          keys_p256dh: string
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          keys_auth: string
          keys_p256dh: string
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          keys_auth?: string
          keys_p256dh?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reactivation_rules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          inactive_days: number
          last_run_at: string | null
          message_template: string
          name: string
          origin: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          inactive_days?: number
          last_run_at?: string | null
          message_template: string
          name: string
          origin?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          inactive_days?: number
          last_run_at?: string | null
          message_template?: string
          name?: string
          origin?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactivation_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reactivation_sends: {
        Row: {
          error_message: string | null
          id: string
          lead_id: string | null
          message: string
          paciente_id: string | null
          phone: string
          responded_at: string | null
          rule_id: string | null
          sent_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          error_message?: string | null
          id?: string
          lead_id?: string | null
          message: string
          paciente_id?: string | null
          phone: string
          responded_at?: string | null
          rule_id?: string | null
          sent_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          error_message?: string | null
          id?: string
          lead_id?: string | null
          message?: string
          paciente_id?: string | null
          phone?: string
          responded_at?: string | null
          rule_id?: string | null
          sent_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactivation_sends_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "reactivation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactivation_sends_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      satisfaction_ratings: {
        Row: {
          attendant_id: string | null
          attendant_name: string | null
          created_at: string
          id: string
          lead_id: string
          lead_phone: string | null
          rating: number
          session_id: string | null
          tenant_id: string
        }
        Insert: {
          attendant_id?: string | null
          attendant_name?: string | null
          created_at?: string
          id?: string
          lead_id: string
          lead_phone?: string | null
          rating: number
          session_id?: string | null
          tenant_id: string
        }
        Update: {
          attendant_id?: string | null
          attendant_name?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          lead_phone?: string | null
          rating?: number
          session_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "satisfaction_ratings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "satisfaction_ratings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          canceled_at: string | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string
          gateway: string | null
          gateway_subscription_id: string | null
          id: string
          metadata: Json | null
          plan_id: string
          started_at: string
          status: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string
          gateway?: string | null
          gateway_subscription_id?: string | null
          id?: string
          metadata?: Json | null
          plan_id: string
          started_at?: string
          status?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          canceled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string
          gateway?: string | null
          gateway_subscription_id?: string | null
          id?: string
          metadata?: Json | null
          plan_id?: string
          started_at?: string
          status?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      tenants: {
        Row: {
          cnpj: string | null
          created_at: string | null
          current_period_end: string | null
          email_contato: string | null
          id: string
          metadata: Json | null
          nome: string
          plan_id: string | null
          slug: string
          status: string
          telefone: string | null
          trial_ends_at: string | null
          updated_at: string | null
        }
        Insert: {
          cnpj?: string | null
          created_at?: string | null
          current_period_end?: string | null
          email_contato?: string | null
          id?: string
          metadata?: Json | null
          nome: string
          plan_id?: string | null
          slug: string
          status?: string
          telefone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Update: {
          cnpj?: string | null
          created_at?: string | null
          current_period_end?: string | null
          email_contato?: string | null
          id?: string
          metadata?: Json | null
          nome?: string
          plan_id?: string | null
          slug?: string
          status?: string
          telefone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_logs: {
        Row: {
          created_at: string
          from_user_id: string | null
          from_user_name: string | null
          id: string
          lead_id: string
          lead_name: string | null
          lead_phone: string | null
          queue_id: string | null
          queue_name: string | null
          reason: string
          tenant_id: string
          to_user_id: string | null
          to_user_name: string | null
        }
        Insert: {
          created_at?: string
          from_user_id?: string | null
          from_user_name?: string | null
          id?: string
          lead_id: string
          lead_name?: string | null
          lead_phone?: string | null
          queue_id?: string | null
          queue_name?: string | null
          reason: string
          tenant_id: string
          to_user_id?: string | null
          to_user_name?: string | null
        }
        Update: {
          created_at?: string
          from_user_id?: string | null
          from_user_name?: string | null
          id?: string
          lead_id?: string
          lead_name?: string | null
          lead_phone?: string | null
          queue_id?: string | null
          queue_name?: string | null
          reason?: string
          tenant_id?: string
          to_user_id?: string | null
          to_user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transfer_logs_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_logs_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tratamento_etapas: {
        Row: {
          created_at: string
          data_realizada: string | null
          dente: string | null
          dentista_id: string | null
          descricao: string
          id: string
          observacoes: string | null
          ordem: number | null
          status: string | null
          tenant_id: string
          tratamento_id: string
          updated_at: string
          valor: number | null
        }
        Insert: {
          created_at?: string
          data_realizada?: string | null
          dente?: string | null
          dentista_id?: string | null
          descricao: string
          id?: string
          observacoes?: string | null
          ordem?: number | null
          status?: string | null
          tenant_id: string
          tratamento_id: string
          updated_at?: string
          valor?: number | null
        }
        Update: {
          created_at?: string
          data_realizada?: string | null
          dente?: string | null
          dentista_id?: string | null
          descricao?: string
          id?: string
          observacoes?: string | null
          ordem?: number | null
          status?: string | null
          tenant_id?: string
          tratamento_id?: string
          updated_at?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tratamento_etapas_dentista_id_fkey"
            columns: ["dentista_id"]
            isOneToOne: false
            referencedRelation: "dentistas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tratamento_etapas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tratamento_etapas_tratamento_id_fkey"
            columns: ["tratamento_id"]
            isOneToOne: false
            referencedRelation: "tratamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      tratamentos: {
        Row: {
          created_at: string
          dente: string | null
          dentista_id: string | null
          descricao: string
          id: string
          observacoes: string | null
          orcamento_id: string | null
          paciente_id: string | null
          plano: string | null
          status: string | null
          tenant_id: string
          updated_at: string
          valor: number | null
        }
        Insert: {
          created_at?: string
          dente?: string | null
          dentista_id?: string | null
          descricao: string
          id?: string
          observacoes?: string | null
          orcamento_id?: string | null
          paciente_id?: string | null
          plano?: string | null
          status?: string | null
          tenant_id: string
          updated_at?: string
          valor?: number | null
        }
        Update: {
          created_at?: string
          dente?: string | null
          dentista_id?: string | null
          descricao?: string
          id?: string
          observacoes?: string | null
          orcamento_id?: string | null
          paciente_id?: string | null
          plano?: string | null
          status?: string | null
          tenant_id?: string
          updated_at?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tratamentos_dentista_id_fkey"
            columns: ["dentista_id"]
            isOneToOne: false
            referencedRelation: "dentistas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tratamentos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tratamentos_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tratamentos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          push_enabled: boolean
          recovery_sound_enabled: boolean
          sound_enabled: boolean
          sound_type: string
          sound_volume: number
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          push_enabled?: boolean
          recovery_sound_enabled?: boolean
          sound_enabled?: boolean
          sound_type?: string
          sound_volume?: number
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          push_enabled?: boolean
          recovery_sound_enabled?: boolean
          sound_enabled?: boolean
          sound_type?: string
          sound_volume?: number
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          created_at: string
          description: string | null
          id: string
          instance_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          instance_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          instance_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_tenant_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "manager"
        | "dentist"
        | "reception"
        | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "admin",
        "manager",
        "dentist",
        "reception",
        "user",
      ],
    },
  },
} as const
