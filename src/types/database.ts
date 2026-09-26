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
          crate_type: string | null
          crate_type_id: string
          customer_id: string
          quantity: number
        }
        Insert: {
          crate_type?: string | null
          crate_type_id: string
          customer_id: string
          quantity?: number
        }
        Update: {
          crate_type?: string | null
          crate_type_id?: string
          customer_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "crate_obligations_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: false
            referencedRelation: "crate_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crate_obligations_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: false
            referencedRelation: "known_empty_crates"
            referencedColumns: ["crate_type_id"]
          },
          {
            foreignKeyName: "crate_obligations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      crate_types: {
        Row: {
          created_at: string
          empty_family: string | null
          id: string
          is_legacy: boolean
          legacy_key: string | null
          name: string
          pocket_count: number | null
          variant: string | null
        }
        Insert: {
          created_at?: string
          empty_family?: string | null
          id?: string
          is_legacy?: boolean
          legacy_key?: string | null
          name: string
          pocket_count?: number | null
          variant?: string | null
        }
        Update: {
          created_at?: string
          empty_family?: string | null
          id?: string
          is_legacy?: boolean
          legacy_key?: string | null
          name?: string
          pocket_count?: number | null
          variant?: string | null
        }
        Relationships: []
      }
      customer_payments: {
        Row: {
          amount: number
          business_date: string
          created_at: string
          customer_id: string
          id: string
          owed_after: number
          request_id: string
        }
        Insert: {
          amount: number
          business_date: string
          created_at?: string
          customer_id: string
          id?: string
          owed_after: number
          request_id: string
        }
        Update: {
          amount?: number
          business_date?: string
          created_at?: string
          customer_id?: string
          id?: string
          owed_after?: number
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          business_name: string | null
          created_at: string
          id: string
          name: string
          phone: string
        }
        Insert: {
          address?: string | null
          business_name?: string | null
          created_at?: string
          id?: string
          name: string
          phone: string
        }
        Update: {
          address?: string | null
          business_name?: string | null
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
      empty_crate_movements: {
        Row: {
          business_date: string
          crate_type: string | null
          crate_type_id: string
          created_at: string
          id: string
          movement_type: string
          previous_quantity: number | null
          quantity_change: number
          request_id: string
          resulting_quantity: number
        }
        Insert: {
          business_date: string
          crate_type?: string | null
          crate_type_id: string
          created_at?: string
          id?: string
          movement_type: string
          previous_quantity?: number | null
          quantity_change: number
          request_id: string
          resulting_quantity: number
        }
        Update: {
          business_date?: string
          crate_type?: string | null
          crate_type_id?: string
          created_at?: string
          id?: string
          movement_type?: string
          previous_quantity?: number | null
          quantity_change?: number
          request_id?: string
          resulting_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "empty_crate_movements_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: false
            referencedRelation: "crate_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empty_crate_movements_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: false
            referencedRelation: "known_empty_crates"
            referencedColumns: ["crate_type_id"]
          },
        ]
      }
      empty_crate_stock: {
        Row: {
          crate_type: string | null
          crate_type_id: string
          quantity: number
        }
        Insert: {
          crate_type?: string | null
          crate_type_id: string
          quantity?: number
        }
        Update: {
          crate_type?: string | null
          crate_type_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "empty_crate_stock_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: true
            referencedRelation: "crate_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empty_crate_stock_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: true
            referencedRelation: "known_empty_crates"
            referencedColumns: ["crate_type_id"]
          },
        ]
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
          crate_type: string | null
          crate_type_id: string
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
          crate_type?: string | null
          crate_type_id: string
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
          crate_type?: string | null
          crate_type_id?: string
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
        Relationships: [
          {
            foreignKeyName: "products_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: false
            referencedRelation: "crate_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: false
            referencedRelation: "known_empty_crates"
            referencedColumns: ["crate_type_id"]
          },
        ]
      }
      sale_items: {
        Row: {
          bottle_type: string | null
          bottles_per_crate: number
          bottles_returnable: boolean
          bottles_returned: number
          crate_type: string | null
          crate_type_id: string
          crates_out: number | null
          crates_returned: number
          id: string
          line_total: number
          product_id: string
          product_name: string
          returnable_bottles_out: number | null
          sale_id: string
          total_bottles: number
          whole_crates: number
        }
        Insert: {
          bottle_type?: string | null
          bottles_per_crate: number
          bottles_returnable: boolean
          bottles_returned?: number
          crate_type?: string | null
          crate_type_id: string
          crates_out?: number | null
          crates_returned?: number
          id?: string
          line_total: number
          product_id: string
          product_name: string
          returnable_bottles_out?: number | null
          sale_id: string
          total_bottles: number
          whole_crates?: number
        }
        Update: {
          bottle_type?: string | null
          bottles_per_crate?: number
          bottles_returnable?: boolean
          bottles_returned?: number
          crate_type?: string | null
          crate_type_id?: string
          crates_out?: number | null
          crates_returned?: number
          id?: string
          line_total?: number
          product_id?: string
          product_name?: string
          returnable_bottles_out?: number | null
          sale_id?: string
          total_bottles?: number
          whole_crates?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: false
            referencedRelation: "crate_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: false
            referencedRelation: "known_empty_crates"
            referencedColumns: ["crate_type_id"]
          },
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
          business_date: string | null
          created_at: string
          customer_id: string
          id: string
          paid_amount: number
          request_id: string | null
          request_payload: Json | null
          total_amount: number
        }
        Insert: {
          business_date?: string | null
          created_at?: string
          customer_id: string
          id?: string
          paid_amount: number
          request_id?: string | null
          request_payload?: Json | null
          total_amount: number
        }
        Update: {
          business_date?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          paid_amount?: number
          request_id?: string | null
          request_payload?: Json | null
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
      stock_movements: {
        Row: {
          bottles_per_crate: number
          business_date: string
          crate_type_id: string | null
          crates: number
          created_at: string
          id: string
          loose_bottles: number
          movement_type: string
          product_id: string
          product_name: string
          quantity_change: number
          request_id: string
          resulting_stock: number
          sale_id: string | null
        }
        Insert: {
          bottles_per_crate: number
          business_date: string
          crate_type_id?: string | null
          crates: number
          created_at?: string
          id?: string
          loose_bottles: number
          movement_type: string
          product_id: string
          product_name: string
          quantity_change: number
          request_id: string
          resulting_stock: number
          sale_id?: string | null
        }
        Update: {
          bottles_per_crate?: number
          business_date?: string
          crate_type_id?: string | null
          crates?: number
          created_at?: string
          id?: string
          loose_bottles?: number
          movement_type?: string
          product_id?: string
          product_name?: string
          quantity_change?: number
          request_id?: string
          resulting_stock?: number
          sale_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: false
            referencedRelation: "crate_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_crate_type_id_fkey"
            columns: ["crate_type_id"]
            isOneToOne: false
            referencedRelation: "known_empty_crates"
            referencedColumns: ["crate_type_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      known_empty_crates: {
        Row: {
          crate_type_id: string | null
          empty_family: string | null
          is_legacy: boolean | null
          name: string | null
          pocket_count: number | null
          quantity: number | null
          variant: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      create_crate_type: {
        Args: {
          p_empty_family: string
          p_id: string
          p_name: string
          p_pocket_count: number
          p_variant: string
        }
        Returns: string
      }
      edit_crate_type: {
        Args: {
          p_empty_family: string
          p_id: string
          p_name: string
          p_pocket_count: number
          p_variant: string
        }
        Returns: string
      }
      is_shop_owner: { Args: never; Returns: boolean }
      receive_stock: {
        Args: {
          p_business_date: string
          p_crates: number
          p_expected_bottles_per_crate: number
          p_expected_crate_type_id: string
          p_expected_empties: number
          p_expected_stock: number
          p_product_id: string
          p_request_id: string
        }
        Returns: Json
      }
      record_payment: {
        Args: {
          p_amount: number
          p_business_date: string
          p_customer_id: string
          p_request_id: string
        }
        Returns: Json
      }
      save_sale: {
        Args: {
          p_business_date: string
          p_customer_id: string
          p_lines: Json
          p_paid: number
          p_request_id: string
        }
        Returns: Json
      }
      set_current_stock: {
        Args: {
          p_business_date: string
          p_crates: number
          p_expected_bottles_per_crate: number
          p_expected_stock: number
          p_loose_bottles: number
          p_product_id: string
          p_request_id: string
        }
        Returns: Json
      }
      set_empty_crate_count: {
        Args: {
          p_business_date: string
          p_crate_type_id: string
          p_expected_quantity: number
          p_quantity: number
          p_request_id: string
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
