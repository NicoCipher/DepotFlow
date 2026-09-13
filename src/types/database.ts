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
      bottle_obligations: {
        Row: {
          bottle_type: string
          customer_id: string
          quantity: number
        }
        Insert: {
          bottle_type: string
          customer_id: string
          quantity?: number
        }
        Update: {
          bottle_type?: string
          customer_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "bottle_obligations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      crate_obligations: {
        Row: {
          crate_type: string
          customer_id: string
          quantity: number
        }
        Insert: {
          crate_type: string
          customer_id: string
          quantity?: number
        }
        Update: {
          crate_type?: string
          customer_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "crate_obligations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          business_name: string | null
          address: string | null
          created_at: string
          id: string
          name: string
          phone: string
        }
        Insert: {
          business_name?: string | null
          address?: string | null
          created_at?: string
          id?: string
          name: string
          phone: string
        }
        Update: {
          business_name?: string | null
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string
        }
        Relationships: []
      }
      deposits: {
        Row: {
          amount: number
          customer_id: string
        }
        Insert: {
          amount?: number
          customer_id: string
        }
        Update: {
          amount?: number
          customer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      empty_bottle_stock: {
        Row: {
          bottle_type: string
          quantity: number
        }
        Insert: {
          bottle_type: string
          quantity?: number
        }
        Update: {
          bottle_type?: string
          quantity?: number
        }
        Relationships: []
      }
      empty_crate_stock: {
        Row: {
          crate_type: string
          quantity: number
        }
        Insert: {
          crate_type: string
          quantity?: number
        }
        Update: {
          crate_type?: string
          quantity?: number
        }
        Relationships: []
      }
      money_owed: {
        Row: {
          amount: number
          customer_id: string
        }
        Insert: {
          amount?: number
          customer_id: string
        }
        Update: {
          amount?: number
          customer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_owed_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          bottle_price: number | null
          bottle_type: string | null
          bottles_per_crate: number
          bottles_returnable: boolean
          crate_type: string
          created_at: string
          empty_family: string | null
          full_crate_price: number
          half_crate_price: number | null
          id: string
          image_url: string | null
          name: string
          quarter_crate_price: number | null
          size: string | null
        }
        Insert: {
          bottle_price?: number | null
          bottle_type?: string | null
          bottles_per_crate: number
          bottles_returnable: boolean
          crate_type: string
          created_at?: string
          empty_family?: string | null
          full_crate_price: number
          half_crate_price?: number | null
          id?: string
          image_url?: string | null
          name: string
          quarter_crate_price?: number | null
          size?: string | null
        }
        Update: {
          bottle_price?: number | null
          bottle_type?: string | null
          bottles_per_crate?: number
          bottles_returnable?: boolean
          crate_type?: string
          created_at?: string
          empty_family?: string | null
          full_crate_price?: number
          half_crate_price?: number | null
          id?: string
          image_url?: string | null
          name?: string
          quarter_crate_price?: number | null
          size?: string | null
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          bottle_type: string | null
          bottles_per_crate: number
          bottles_returnable: boolean
          crate_type: string
          crates_out: number | null
          id: string
          line_total: number
          product_id: string
          product_name: string
          returnable_bottles_out: number | null
          sale_id: string
          total_bottles: number
        }
        Insert: {
          bottle_type?: string | null
          bottles_per_crate: number
          bottles_returnable: boolean
          crate_type: string
          crates_out?: number | null
          id?: string
          line_total: number
          product_id: string
          product_name: string
          returnable_bottles_out?: number | null
          sale_id: string
          total_bottles: number
        }
        Update: {
          bottle_type?: string | null
          bottles_per_crate?: number
          bottles_returnable?: boolean
          crate_type?: string
          crates_out?: number | null
          id?: string
          line_total?: number
          product_id?: string
          product_name?: string
          returnable_bottles_out?: number | null
          sale_id?: string
          total_bottles?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          paid_amount: number
          total_amount: number
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          paid_amount: number
          total_amount: number
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          paid_amount?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock: {
        Row: {
          product_id: string
          total_bottles: number
        }
        Insert: {
          product_id: string
          total_bottles?: number
        }
        Update: {
          product_id?: string
          total_bottles?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_shop_owner: { Args: Record<PropertyKey, never>; Returns: boolean }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
