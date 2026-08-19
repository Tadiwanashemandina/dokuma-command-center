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
    PostgrestVersion: "14.15"
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
    }
    Functions: {
      current_role: { Args: never; Returns: string }
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
export type UserRole = "admin" | "exec" | "viewer";
