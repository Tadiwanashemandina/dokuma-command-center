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
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_records: {
        Row: {
          activity_date: string
          created_at: string
          department: string | null
          hours_today: number | null
          id: string
          imported_at: string
          last_seen_at: string | null
          off_project_minutes: number | null
          on_project_minutes: number | null
          person_name: string
          role: string | null
          screenshots_count: number | null
          source: string
          status: string | null
          storage_used_mb: number | null
        }
        Insert: {
          activity_date: string
          created_at?: string
          department?: string | null
          hours_today?: number | null
          id?: string
          imported_at?: string
          last_seen_at?: string | null
          off_project_minutes?: number | null
          on_project_minutes?: number | null
          person_name: string
          role?: string | null
          screenshots_count?: number | null
          source?: string
          status?: string | null
          storage_used_mb?: number | null
        }
        Update: {
          activity_date?: string
          created_at?: string
          department?: string | null
          hours_today?: number | null
          id?: string
          imported_at?: string
          last_seen_at?: string | null
          off_project_minutes?: number | null
          on_project_minutes?: number | null
          person_name?: string
          role?: string | null
          screenshots_count?: number | null
          source?: string
          status?: string | null
          storage_used_mb?: number | null
        }
        Relationships: []
      }
      ai_daily_briefs: {
        Row: {
          body: string
          brief_date: string
          created_at: string
          generated_by: string
          headline: string
          id: string
        }
        Insert: {
          body: string
          brief_date: string
          created_at?: string
          generated_by?: string
          headline: string
          id?: string
        }
        Update: {
          body?: string
          brief_date?: string
          created_at?: string
          generated_by?: string
          headline?: string
          id?: string
        }
        Relationships: []
      }
      applications: {
        Row: {
          candidate_id: string
          id: string
          job_opening_id: string
          stage: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          id?: string
          job_opening_id: string
          stage?: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          id?: string
          job_opening_id?: string
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_job_opening_id_fkey"
            columns: ["job_opening_id"]
            isOneToOne: false
            referencedRelation: "job_openings"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          created_at: string
          date: string
          employee_id: string
          id: string
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          date: string
          employee_id: string
          id?: string
          source?: string
          status: string
        }
        Update: {
          created_at?: string
          date?: string
          employee_id?: string
          id?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      candidates: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          resume_url: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          phone?: string | null
          resume_url?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          resume_url?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          created_at: string
          id: string
          industry: string | null
          name: string
          notes: string | null
          primary_contact_email: string | null
          primary_contact_name: string | null
          relationship_owner: string | null
          tier: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          relationship_owner?: string | null
          tier?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          relationship_owner?: string | null
          tier?: string | null
        }
        Relationships: []
      }
      delivery_metrics: {
        Row: {
          closed_defects_count: number
          commits_count: number
          created_at: string
          deploys_count: number
          id: string
          metric_date: string
          open_defects_count: number
          project_id: string | null
          repo_name: string
          source: string
        }
        Insert: {
          closed_defects_count?: number
          commits_count?: number
          created_at?: string
          deploys_count?: number
          id?: string
          metric_date: string
          open_defects_count?: number
          project_id?: string | null
          repo_name: string
          source?: string
        }
        Update: {
          closed_defects_count?: number
          commits_count?: number
          created_at?: string
          deploys_count?: number
          id?: string
          metric_date?: string
          open_defects_count?: number
          project_id?: string | null
          repo_name?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_metrics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_tasks: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          employee_id: string
          id: string
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          employee_id: string
          id?: string
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          employee_id?: string
          id?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_tasks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          created_at: string
          department: string | null
          employment_date: string | null
          full_name: string
          id: string
          jira_account_id: string | null
          role_title: string | null
          status: string
          supervisor_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          department?: string | null
          employment_date?: string | null
          full_name: string
          id?: string
          jira_account_id?: string | null
          role_title?: string | null
          status?: string
          supervisor_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          department?: string | null
          employment_date?: string | null
          full_name?: string
          id?: string
          jira_account_id?: string | null
          role_title?: string | null
          status?: string
          supervisor_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_accounts: {
        Row: {
          created_at: string
          currency: string
          current_balance: number
          id: string
          is_active: boolean
          name: string
          opening_balance: number
          type: string
        }
        Insert: {
          created_at?: string
          currency?: string
          current_balance?: number
          id?: string
          is_active?: boolean
          name: string
          opening_balance?: number
          type: string
        }
        Update: {
          created_at?: string
          currency?: string
          current_balance?: number
          id?: string
          is_active?: boolean
          name?: string
          opening_balance?: number
          type?: string
        }
        Relationships: []
      }
      finance_company_totals: {
        Row: {
          as_of_date: string
          contracted_revenue_usd: number
          created_at: string
          id: string
          outstanding_receivables_usd: number
          revenue_pipeline_usd: number
        }
        Insert: {
          as_of_date: string
          contracted_revenue_usd: number
          created_at?: string
          id?: string
          outstanding_receivables_usd: number
          revenue_pipeline_usd: number
        }
        Update: {
          as_of_date?: string
          contracted_revenue_usd?: number
          created_at?: string
          id?: string
          outstanding_receivables_usd?: number
          revenue_pipeline_usd?: number
        }
        Relationships: []
      }
      finance_creditors: {
        Row: {
          amount_owed: number
          created_at: string
          due_date: string | null
          id: string
          name: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_owed: number
          created_at?: string
          due_date?: string | null
          id?: string
          name: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_owed?: number
          created_at?: string
          due_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      finance_payment_notices: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          notes: string | null
          payee: string
          period: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          id?: string
          notes?: string | null
          payee: string
          period: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          notes?: string | null
          payee?: string
          period?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      finance_reports: {
        Row: {
          content: Json
          generated_at: string
          generated_by: string | null
          id: string
          period_end: string
          period_start: string
          published_at: string | null
          published_by: string | null
          status: string
          type: string
        }
        Insert: {
          content?: Json
          generated_at?: string
          generated_by?: string | null
          id?: string
          period_end: string
          period_start: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          type: string
        }
        Update: {
          content?: Json
          generated_at?: string
          generated_by?: string | null
          id?: string
          period_end?: string
          period_start?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          type?: string
        }
        Relationships: []
      }
      finance_transactions: {
        Row: {
          account_id: string
          amount: number
          category: string | null
          counterparty: string | null
          created_at: string
          created_by: string | null
          date: string
          description: string | null
          dlap_share_pct: number | null
          id: string
          is_dlap: boolean
          is_reversed: boolean
          reference_no: string | null
          reverses_transaction_id: string | null
          source: string
          type: string
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          category?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string | null
          dlap_share_pct?: number | null
          id?: string
          is_dlap?: boolean
          is_reversed?: boolean
          reference_no?: string | null
          reverses_transaction_id?: string | null
          source?: string
          type: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          category?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string | null
          dlap_share_pct?: number | null
          id?: string
          is_dlap?: boolean
          is_reversed?: boolean
          reference_no?: string | null
          reverses_transaction_id?: string | null
          source?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_reverses_transaction_id_fkey"
            columns: ["reverses_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      jira_tasks_cache: {
        Row: {
          due_date: string | null
          employee_id: string
          fetched_at: string
          id: string
          jira_issue_key: string
          status: string | null
          summary: string | null
          url: string | null
        }
        Insert: {
          due_date?: string | null
          employee_id: string
          fetched_at?: string
          id?: string
          jira_issue_key: string
          status?: string | null
          summary?: string | null
          url?: string | null
        }
        Update: {
          due_date?: string | null
          employee_id?: string
          fetched_at?: string
          id?: string
          jira_issue_key?: string
          status?: string | null
          summary?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jira_tasks_cache_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      job_descriptions: {
        Row: {
          created_at: string
          effective_date: string
          employee_id: string | null
          id: string
          reporting_line: string | null
          requirements: string | null
          responsibilities: string | null
          role_title: string | null
          version: number
        }
        Insert: {
          created_at?: string
          effective_date?: string
          employee_id?: string | null
          id?: string
          reporting_line?: string | null
          requirements?: string | null
          responsibilities?: string | null
          role_title?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          effective_date?: string
          employee_id?: string | null
          id?: string
          reporting_line?: string | null
          requirements?: string | null
          responsibilities?: string | null
          role_title?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_descriptions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      job_openings: {
        Row: {
          department: string | null
          id: string
          opened_at: string
          status: string
          title: string
        }
        Insert: {
          department?: string | null
          id?: string
          opened_at?: string
          status?: string
          title: string
        }
        Update: {
          department?: string | null
          id?: string
          opened_at?: string
          status?: string
          title?: string
        }
        Relationships: []
      }
      kpi_feed: {
        Row: {
          as_of_date: string
          company: string
          id: string
          metric_name: string
          unit: string | null
          updated_at: string
          value: number | null
        }
        Insert: {
          as_of_date?: string
          company?: string
          id?: string
          metric_name: string
          unit?: string | null
          updated_at?: string
          value?: number | null
        }
        Update: {
          as_of_date?: string
          company?: string
          id?: string
          metric_name?: string
          unit?: string | null
          updated_at?: string
          value?: number | null
        }
        Relationships: []
      }
      leave_balances: {
        Row: {
          days_allocated: number
          days_remaining: number | null
          days_used: number
          employee_id: string
          leave_type_id: string
          year: number
        }
        Insert: {
          days_allocated: number
          days_remaining?: number | null
          days_used?: number
          employee_id: string
          leave_type_id: string
          year: number
        }
        Update: {
          days_allocated?: number
          days_remaining?: number | null
          days_used?: number
          employee_id?: string
          leave_type_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_balances_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          days_requested: number
          employee_id: string
          end_date: string
          hr_comment: string | null
          hr_decision_at: string | null
          id: string
          leave_type_id: string
          reason: string | null
          start_date: string
          status: string
          supervisor_comment: string | null
          supervisor_decision_at: string | null
          supervisor_id: string | null
        }
        Insert: {
          created_at?: string
          days_requested: number
          employee_id: string
          end_date: string
          hr_comment?: string | null
          hr_decision_at?: string | null
          id?: string
          leave_type_id: string
          reason?: string | null
          start_date: string
          status?: string
          supervisor_comment?: string | null
          supervisor_decision_at?: string | null
          supervisor_id?: string | null
        }
        Update: {
          created_at?: string
          days_requested?: number
          employee_id?: string
          end_date?: string
          hr_comment?: string | null
          hr_decision_at?: string | null
          id?: string
          leave_type_id?: string
          reason?: string | null
          start_date?: string
          status?: string
          supervisor_comment?: string | null
          supervisor_decision_at?: string | null
          supervisor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          days_per_year: number
          id: string
          name: string
        }
        Insert: {
          days_per_year: number
          id?: string
          name: string
        }
        Update: {
          days_per_year?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      meeting_action_items: {
        Row: {
          created_at: string
          description: string
          due_date: string | null
          id: string
          meeting_id: string
          owner_name: string | null
          status: string
        }
        Insert: {
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          meeting_id: string
          owner_name?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          meeting_id?: string
          owner_name?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_action_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          attendees: string[] | null
          created_at: string
          id: string
          meeting_date: string
          source_notes: string | null
          title: string
        }
        Insert: {
          attendees?: string[] | null
          created_at?: string
          id?: string
          meeting_date: string
          source_notes?: string | null
          title: string
        }
        Update: {
          attendees?: string[] | null
          created_at?: string
          id?: string
          meeting_date?: string
          source_notes?: string | null
          title?: string
        }
        Relationships: []
      }
      milestones: {
        Row: {
          created_at: string
          due_date: string | null
          id: string
          name: string
          project_id: string
          status: string
        }
        Insert: {
          created_at?: string
          due_date?: string | null
          id?: string
          name: string
          project_id: string
          status?: string
        }
        Update: {
          created_at?: string
          due_date?: string | null
          id?: string
          name?: string
          project_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_reviews: {
        Row: {
          comments: string | null
          created_at: string
          employee_id: string
          goals: Json
          id: string
          period: string
          rating: string | null
          reviewer_id: string | null
          status: string
        }
        Insert: {
          comments?: string | null
          created_at?: string
          employee_id: string
          goals?: Json
          id?: string
          period: string
          rating?: string | null
          reviewer_id?: string | null
          status?: string
        }
        Update: {
          comments?: string | null
          created_at?: string
          employee_id?: string
          goals?: Json
          id?: string
          period?: string
          rating?: string | null
          reviewer_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_reviews_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          role: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          role?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          role?: string
        }
        Relationships: []
      }
      project_finance: {
        Row: {
          as_of_date: string
          budget_usd: number | null
          contracted_revenue_usd: number | null
          cost_to_date_usd: number | null
          created_at: string
          id: string
          project_id: string
          receivables_usd: number | null
          revenue_pipeline_usd: number | null
        }
        Insert: {
          as_of_date?: string
          budget_usd?: number | null
          contracted_revenue_usd?: number | null
          cost_to_date_usd?: number | null
          created_at?: string
          id?: string
          project_id: string
          receivables_usd?: number | null
          revenue_pipeline_usd?: number | null
        }
        Update: {
          as_of_date?: string
          budget_usd?: number | null
          contracted_revenue_usd?: number | null
          cost_to_date_usd?: number | null
          created_at?: string
          id?: string
          project_id?: string
          receivables_usd?: number | null
          revenue_pipeline_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_finance_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget_usd: number | null
          client_id: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          owner_name: string | null
          start_date: string | null
          status: string
          target_end_date: string | null
          updated_at: string
        }
        Insert: {
          budget_usd?: number | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_name?: string | null
          start_date?: string | null
          status?: string
          target_end_date?: string | null
          updated_at?: string
        }
        Update: {
          budget_usd?: number | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_name?: string | null
          start_date?: string | null
          status?: string
          target_end_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      risks_issues_decisions: {
        Row: {
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          impact: string | null
          owner_name: string | null
          probability: string | null
          project_id: string | null
          severity: string | null
          status: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          impact?: string | null
          owner_name?: string | null
          probability?: string | null
          project_id?: string | null
          severity?: string | null
          status?: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          impact?: string | null
          owner_name?: string | null
          probability?: string | null
          project_id?: string | null
          severity?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "risks_issues_decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_name: string | null
          created_at: string
          due_date: string | null
          id: string
          project_id: string
          status: string
          title: string
        }
        Insert: {
          assignee_name?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          project_id: string
          status?: string
          title: string
        }
        Update: {
          assignee_name?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          project_id?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      training_records: {
        Row: {
          certificate_url: string | null
          completed_at: string | null
          course_name: string
          created_at: string
          employee_id: string
          expires_at: string | null
          id: string
          provider: string | null
        }
        Insert: {
          certificate_url?: string | null
          completed_at?: string | null
          course_name: string
          created_at?: string
          employee_id: string
          expires_at?: string | null
          id?: string
          provider?: string | null
        }
        Update: {
          certificate_url?: string | null
          completed_at?: string | null
          course_name?: string
          created_at?: string
          employee_id?: string
          expires_at?: string | null
          id?: string
          provider?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_ceo_dashboard_kpis: {
        Row: {
          active_projects: number | null
          contracted_revenue_usd: number | null
          critical_blockers: number | null
          high_risk_projects: number | null
          outstanding_receivables_usd: number | null
          overdue_tasks: number | null
          projects_amber: number | null
          projects_green: number | null
          projects_red: number | null
          revenue_pipeline_usd: number | null
          tasks_due_this_week: number | null
          team_utilisation_pct: number | null
        }
        Relationships: []
      }
      v_leave_requests: {
        Row: {
          created_at: string | null
          days_requested: number | null
          employee_id: string | null
          end_date: string | null
          hr_comment: string | null
          hr_decision_at: string | null
          id: string | null
          leave_type_id: string | null
          reason: string | null
          start_date: string | null
          status: string | null
          supervisor_comment: string | null
          supervisor_decision_at: string | null
          supervisor_id: string | null
        }
        Insert: {
          created_at?: string | null
          days_requested?: number | null
          employee_id?: string | null
          end_date?: string | null
          hr_comment?: string | null
          hr_decision_at?: string | null
          id?: string | null
          leave_type_id?: string | null
          reason?: never
          start_date?: string | null
          status?: string | null
          supervisor_comment?: string | null
          supervisor_decision_at?: string | null
          supervisor_id?: string | null
        }
        Update: {
          created_at?: string | null
          days_requested?: number | null
          employee_id?: string | null
          end_date?: string | null
          hr_comment?: string | null
          hr_decision_at?: string | null
          id?: string | null
          leave_type_id?: string | null
          reason?: never
          start_date?: string | null
          status?: string | null
          supervisor_comment?: string | null
          supervisor_decision_at?: string | null
          supervisor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      v_project_margins: {
        Row: {
          budget_usd: number | null
          cost_to_date_usd: number | null
          margin_pct: number | null
          project_id: string | null
        }
        Insert: {
          budget_usd?: number | null
          cost_to_date_usd?: number | null
          margin_pct?: never
          project_id?: string | null
        }
        Update: {
          budget_usd?: number | null
          cost_to_date_usd?: number | null
          margin_pct?: never
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_finance_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      v_training_expiring_soon: {
        Row: {
          certificate_url: string | null
          completed_at: string | null
          course_name: string | null
          created_at: string | null
          employee_id: string | null
          expires_at: string | null
          id: string | null
          provider: string | null
        }
        Insert: {
          certificate_url?: string | null
          completed_at?: string | null
          course_name?: string | null
          created_at?: string | null
          employee_id?: string | null
          expires_at?: string | null
          id?: string | null
          provider?: string | null
        }
        Update: {
          certificate_url?: string | null
          completed_at?: string | null
          course_name?: string | null
          created_at?: string | null
          employee_id?: string | null
          expires_at?: string | null
          id?: string | null
          provider?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_employee_id: { Args: never; Returns: string }
      current_role: { Args: never; Returns: string }
      get_account_balance_as_of: {
        Args: { p_account_id: string; p_as_of_date: string }
        Returns: number
      }
      get_unusual_transactions: {
        Args: { p_account_id: string; p_check_date: string }
        Returns: {
          account_id: string
          amount: number
          category: string | null
          counterparty: string | null
          created_at: string
          created_by: string | null
          date: string
          description: string | null
          dlap_share_pct: number | null
          id: string
          is_dlap: boolean
          is_reversed: boolean
          reference_no: string | null
          reverses_transaction_id: string | null
          source: string
          type: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "finance_transactions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      is_supervisor_of: { Args: { p_employee_id: string }; Returns: boolean }
      refresh_kpi_feed: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

// Hand-added literal unions mirroring the CHECK constraints in
// supabase/migrations/*.sql — `supabase gen types` widens these to plain
// `string`, so app code casts to these where it reads a constrained column.
export type ProjectStatus = "green" | "amber" | "red";
export type MilestoneStatus = "pending" | "on_track" | "at_risk" | "done";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type RidType = "risk" | "issue" | "decision";
export type Severity = "low" | "medium" | "high" | "critical";
export type ProbabilityImpact = "low" | "medium" | "high";
export type RidStatus = "open" | "mitigating" | "closed";
export type ClientTier = "strategic" | "key" | "standard";
export type ActivityStatus = "online" | "offline";
export type ActivitySource = "csv" | "api";
export type DeliverySource = "manual" | "github" | "illustrative";
export type ActionItemStatus = "open" | "done";
export type UserRole =
  | "admin" | "exec" | "viewer"
  | "finance_officer" | "finance_manager"
  | "employee" | "supervisor" | "hr_officer" | "hr_manager";

// Finance module (Phase 1)
export type FinanceAccountType = "bank" | "cash" | "mobile-money";
export type FinanceTransactionType = "debit" | "credit";
export type FinanceTransactionSource = "manual" | "excel-import";
export type FinanceReportType = "daily" | "weekly" | "monthly";
export type FinanceReportStatus = "draft" | "published";
export type FinanceCreditorStatus = "outstanding" | "partially_paid" | "paid";
export type FinancePaymentNoticeStatus = "scheduled" | "sent" | "paid";

// HR module (Phase 2)
export type EmployeeStatus = "active" | "on-leave" | "exited";
export type LeaveRequestStatus = "pending_supervisor" | "pending_hr" | "approved" | "rejected";
export type JobOpeningStatus = "open" | "closed";
export type ApplicationStage = "applied" | "shortlisted" | "interview" | "offer" | "hired" | "rejected";
export type PerformanceReviewStatus = "draft" | "submitted" | "acknowledged";
export type AttendanceStatus = "present" | "absent" | "late" | "on_leave";
export type AttendanceSource = "manual" | "lazyboss";
export type EmployeeTaskStatus = "todo" | "in_progress" | "done";
