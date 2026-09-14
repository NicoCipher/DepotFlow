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
      crate_types: {
        Row: {
          id: string
          name: string
          empty_family: string | null
          pocket_count: number | null
          variant: string | null
          is_legacy: boolean
          legacy_key: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          empty_family?: string | null
          pocket_count?: number | null
          variant?: string | null
          is_legacy?: boolean
          legacy_key?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          empty_family?: string | null
          pocket_count?: number | null
          variant?: string | null
          is_legacy?: boolean
          legacy_key?: string | null
          created_at?: string
        }
        Relationships: []
      }

      empty_crate_movements: {
        Row: {
          crate_type_id: string
          id: string
          crate_type: string | null
          movement_type: string
          previous_quantity: number | null
          quantity_change: number
          resulting_quantity: number
          business_date: string
          created_at: string
          request_id: string
        }
        Insert: {
          crate_type_id: string
          id?: string
          crate_type?: string | null
          movement_type: string
          previous_quantity?: number | null
          quantity_change: number
          resulting_quantity: number
          business_date: string
          created_at?: string
          request_id: string
        }
        Update: {
          crate_type_id?: string
          id?: string
          crate_type?: string | null
          movement_type?: string
          previous_quantity?: number | null
          quantity_change?: number
          resulting_quantity?: number
          business_date?: string
          created_at?: string
          request_id?: string
        }
        Relationships: [{
          foreignKeyName: "empty_crate_movements_crate_type_id_fkey"
          columns: ["crate_type_id"]
          isOneToOne: false
          referencedRelation: "crate_types"
          referencedColumns: ["id"]
        }]
      }

      stock_movements: {
        Row: {
          crate_type_id: string | null
          id: string
          product_id: string
          movement_type: string
          quantity_change: number
          resulting_stock: number
          business_date: string
          created_at: string
          request_id: string
          crates: number
          loose_bottles: number
          bottles_per_crate: number
          product_name: string
        }
        Insert: {
          crate_type_id?: string | null
          id?: string
          product_id: string
          movement_type: string
          quantity_change: number
          resulting_stock: number
          business_date: string
          created_at?: string
          request_id: string
          crates: number
          loose_bottles: number
          bottles_per_crate: number
          product_name: string
        }
        Update: {
          crate_type_id?: string | null
          id?: string
          product_id?: string
          movement_type?: string
          quantity_change?: number
          resulting_stock?: number
          business_date?: string
          created_at?: string
          request_id?: string
          crates?: number
          loose_bottles?: number
          bottles_per_crate?: number
          product_name?: string
        }
        Relationships: [{
          foreignKeyName: "stock_movements_crate_type_id_fkey"
          columns: ["crate_type_id"]
          isOneToOne: false
          referencedRelation: "crate_types"
          referencedColumns: ["id"]
        },{ foreignKeyName: "stock_movements_product_id_fkey"; columns: ["product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"] }]
      }

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
          crate_type_id: string
          crate_type: string | null
          customer_id: string
          quantity: number
        }
        Insert: {
          crate_type_id: string
          crate_type?: string | null
          customer_id: string
          quantity?: number
        }
        Update: {
          crate_type_id?: string
          crate_type?: string | null
          customer_id?: string
          quantity?: number
        }
        Relationships: [{
          foreignKeyName: "crate_obligations_crate_type_id_fkey"
          columns: ["crate_type_id"]
          isOneToOne: false
          referencedRelation: "crate_types"
          referencedColumns: ["id"]
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
          crate_type_id: string
          crate_type: string | null
          quantity: number
        }
        Insert: {
          crate_type_id: string
          crate_type?: string | null
          quantity?: number
        }
        Update: {
          crate_type_id?: string
          crate_type?: string | null
          quantity?: number
        }
        Relationships: [{
          foreignKeyName: "empty_crate_stock_crate_type_id_fkey"
          columns: ["crate_type_id"]
          isOneToOne: true
          referencedRelation: "crate_types"
          referencedColumns: ["id"]
        }]
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
          crate_type_id: string
          bottle_price: number | null
          bottle_type: string | null
          bottles_per_crate: number
          bottles_returnable: boolean
          crate_type: string | null
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
          crate_type_id: string
          bottle_price?: number | null
          bottle_type?: string | null
          bottles_per_crate: number
          bottles_returnable: boolean
          crate_type?: string | null
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
          crate_type_id?: string
          bottle_price?: number | null
          bottle_type?: string | null
          bottles_per_crate?: number
          bottles_returnable?: boolean
          crate_type?: string | null
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
        Relationships: [{
          foreignKeyName: "products_crate_type_id_fkey"
          columns: ["crate_type_id"]
          isOneToOne: false
          referencedRelation: "crate_types"
          referencedColumns: ["id"]
        }]
      }
      sale_items: {
        Row: {
          crate_type_id: string
          bottle_type: string | null
          bottles_per_crate: number
          bottles_returnable: boolean
          crate_type: string | null
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
          crate_type_id: string
          bottle_type?: string | null
          bottles_per_crate: number
          bottles_returnable: boolean
          crate_type?: string | null
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
          crate_type_id?: string
          bottle_type?: string | null
          bottles_per_crate?: number
          bottles_returnable?: boolean
          crate_type?: string | null
          crates_out?: number | null
          id?: string
          line_total?: number
          product_id?: string
          product_name?: string
          returnable_bottles_out?: number | null
          sale_id?: string
          total_bottles?: number
        }
        Relationships: [{
          foreignKeyName: "sale_items_crate_type_id_fkey"
          columns: ["crate_type_id"]
          isOneToOne: false
          referencedRelation: "crate_types"
          referencedColumns: ["id"]
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
      known_empty_crates: {
        Row: { crate_type_id: string | null; name: string | null; empty_family: string | null; pocket_count: number | null; variant: string | null; is_legacy: boolean | null; quantity: number | null }
        Relationships: []
      }
    }
    Functions: {
      create_crate_type: {
        Args: { p_id: string; p_name: string; p_empty_family: string; p_pocket_count: number; p_variant: string | null }
        Returns: string
      }

      set_empty_crate_count: {
        Args: {
          p_request_id: string
          p_crate_type_id: string
          p_quantity: number
          p_business_date: string
          p_expected_quantity: number | null
        }
        Returns: Json
      }

      set_current_stock: {
        Args: {
          p_request_id: string
          p_product_id: string
          p_crates: number
          p_loose_bottles: number
          p_business_date: string
          p_expected_stock: number
          p_expected_bottles_per_crate: number
        }
        Returns: Json
      }

      receive_stock: {
        Args: {
          p_business_date: string; p_request_id: string; p_product_id: string; p_crates: number; p_expected_stock: number; p_expected_empties: number; p_expected_bottles_per_crate: number; p_expected_crate_type_id: string };
        Returns: Json;
      }
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
