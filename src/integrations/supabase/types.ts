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
      admin_wallets: {
        Row: {
          admin_id: string
          balance: number
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          admin_id: string
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          admin_id?: string
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          ip: string | null
          meta: Json | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip?: string | null
          meta?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip?: string | null
          meta?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      challenges: {
        Row: {
          created_at: string
          expires_at: string
          from_user: string
          game_id: string | null
          game_mode: string
          id: string
          players_count: number
          stake: number
          status: string
          to_user: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          from_user: string
          game_id?: string | null
          game_mode?: string
          id?: string
          players_count?: number
          stake: number
          status?: string
          to_user: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          from_user?: string
          game_id?: string | null
          game_mode?: string
          id?: string
          players_count?: number
          stake?: number
          status?: string
          to_user?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          game_id: string | null
          id: string
          is_admin_broadcast: boolean | null
          recipient_id: string | null
          sender_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          game_id?: string | null
          id?: string
          is_admin_broadcast?: boolean | null
          recipient_id?: string | null
          sender_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          game_id?: string | null
          id?: string
          is_admin_broadcast?: boolean | null
          recipient_id?: string | null
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      fraud_alerts: {
        Row: {
          created_at: string
          id: string
          kind: string
          message: string
          meta: Json | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          message: string
          meta?: Json | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message?: string
          meta?: Json | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          user_id?: string | null
        }
        Relationships: []
      }
      game_audit: {
        Row: {
          action: string
          commission: number | null
          created_at: string
          game_id: string
          game_kind: string
          id: string
          meta: Json | null
          players_count: number | null
          pot: number | null
          stake: number | null
          ticket_number: string | null
          winner_id: string | null
        }
        Insert: {
          action: string
          commission?: number | null
          created_at?: string
          game_id: string
          game_kind: string
          id?: string
          meta?: Json | null
          players_count?: number | null
          pot?: number | null
          stake?: number | null
          ticket_number?: string | null
          winner_id?: string | null
        }
        Update: {
          action?: string
          commission?: number | null
          created_at?: string
          game_id?: string
          game_kind?: string
          id?: string
          meta?: Json | null
          players_count?: number | null
          pot?: number | null
          stake?: number | null
          ticket_number?: string | null
          winner_id?: string | null
        }
        Relationships: []
      }
      game_blocks: {
        Row: {
          blocked: boolean
          game_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          blocked?: boolean
          game_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          blocked?: boolean
          game_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      game_moves: {
        Row: {
          created_at: string
          game_id: string
          id: string
          piece: Json | null
          player_id: string
          side: string | null
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          piece?: Json | null
          player_id: string
          side?: string | null
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          piece?: Json | null
          player_id?: string
          side?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_moves_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          board_state: Json | null
          boneyard: Json | null
          cash_pool: number
          commission: number
          created_at: string
          current_turn: string | null
          endgame_votes: Json | null
          expires_at: string | null
          finished_at: string | null
          game_mode: string
          id: string
          is_tournament: boolean
          last_reason: string | null
          passes: number
          player1_hand: Json | null
          player1_id: string
          player2_hand: Json | null
          player2_id: string | null
          player3_hand: Json
          player3_id: string | null
          players_count: number
          reveal_until: string | null
          round_number: number
          score_p1: number
          score_p2: number
          score_p3: number
          stake: number
          status: Database["public"]["Enums"]["game_status"]
          ticket_number: string | null
          tournament_match_id: string | null
          turn_started_at: string | null
          updated_at: string
          winner_id: string | null
        }
        Insert: {
          board_state?: Json | null
          boneyard?: Json | null
          cash_pool?: number
          commission?: number
          created_at?: string
          current_turn?: string | null
          endgame_votes?: Json | null
          expires_at?: string | null
          finished_at?: string | null
          game_mode?: string
          id?: string
          is_tournament?: boolean
          last_reason?: string | null
          passes?: number
          player1_hand?: Json | null
          player1_id: string
          player2_hand?: Json | null
          player2_id?: string | null
          player3_hand?: Json
          player3_id?: string | null
          players_count?: number
          reveal_until?: string | null
          round_number?: number
          score_p1?: number
          score_p2?: number
          score_p3?: number
          stake: number
          status?: Database["public"]["Enums"]["game_status"]
          ticket_number?: string | null
          tournament_match_id?: string | null
          turn_started_at?: string | null
          updated_at?: string
          winner_id?: string | null
        }
        Update: {
          board_state?: Json | null
          boneyard?: Json | null
          cash_pool?: number
          commission?: number
          created_at?: string
          current_turn?: string | null
          endgame_votes?: Json | null
          expires_at?: string | null
          finished_at?: string | null
          game_mode?: string
          id?: string
          is_tournament?: boolean
          last_reason?: string | null
          passes?: number
          player1_hand?: Json | null
          player1_id?: string
          player2_hand?: Json | null
          player2_id?: string | null
          player3_hand?: Json
          player3_id?: string | null
          players_count?: number
          reveal_until?: string | null
          round_number?: number
          score_p1?: number
          score_p2?: number
          score_p3?: number
          stake?: number
          status?: Database["public"]["Enums"]["game_status"]
          ticket_number?: string | null
          tournament_match_id?: string | null
          turn_started_at?: string | null
          updated_at?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "games_tournament_match_id_fkey"
            columns: ["tournament_match_id"]
            isOneToOne: false
            referencedRelation: "tournament_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      lobby_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: []
      }
      login_attempts: {
        Row: {
          created_at: string
          id: string
          ip: string | null
          phone: string
          success: boolean
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: string | null
          phone: string
          success: boolean
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string | null
          phone?: string
          success?: boolean
          user_agent?: string | null
        }
        Relationships: []
      }
      ludo_games: {
        Row: {
          cash_pool: number
          commission: number
          consecutive_sixes: number
          created_at: string
          current_turn_seat: number
          dice_rolled: boolean
          finished_at: string | null
          id: string
          is_tournament: boolean
          last_dice: number | null
          pawns: Json
          player1_id: string
          player2_id: string | null
          player3_id: string | null
          player4_id: string | null
          players_count: number
          seat_assignment: Json | null
          skips_by_seat: Json
          stake: number
          status: Database["public"]["Enums"]["game_status"]
          ticket_number: string | null
          tournament_match_id: string | null
          turn_started_at: string | null
          updated_at: string
          winner_id: string | null
        }
        Insert: {
          cash_pool?: number
          commission?: number
          consecutive_sixes?: number
          created_at?: string
          current_turn_seat?: number
          dice_rolled?: boolean
          finished_at?: string | null
          id?: string
          is_tournament?: boolean
          last_dice?: number | null
          pawns?: Json
          player1_id: string
          player2_id?: string | null
          player3_id?: string | null
          player4_id?: string | null
          players_count?: number
          seat_assignment?: Json | null
          skips_by_seat?: Json
          stake: number
          status?: Database["public"]["Enums"]["game_status"]
          ticket_number?: string | null
          tournament_match_id?: string | null
          turn_started_at?: string | null
          updated_at?: string
          winner_id?: string | null
        }
        Update: {
          cash_pool?: number
          commission?: number
          consecutive_sixes?: number
          created_at?: string
          current_turn_seat?: number
          dice_rolled?: boolean
          finished_at?: string | null
          id?: string
          is_tournament?: boolean
          last_dice?: number | null
          pawns?: Json
          player1_id?: string
          player2_id?: string | null
          player3_id?: string | null
          player4_id?: string | null
          players_count?: number
          seat_assignment?: Json | null
          skips_by_seat?: Json
          stake?: number
          status?: Database["public"]["Enums"]["game_status"]
          ticket_number?: string | null
          tournament_match_id?: string | null
          turn_started_at?: string | null
          updated_at?: string
          winner_id?: string | null
        }
        Relationships: []
      }
      matchmaking_queue: {
        Row: {
          created_at: string
          game_mode: string
          id: string
          players_count: number
          stake: number
          user_id: string
        }
        Insert: {
          created_at?: string
          game_mode?: string
          id?: string
          players_count?: number
          stake: number
          user_id: string
        }
        Update: {
          created_at?: string
          game_mode?: string
          id?: string
          players_count?: number
          stake?: number
          user_id?: string
        }
        Relationships: []
      }
      password_reset_requests: {
        Row: {
          admin_note: string | null
          answers: Json | null
          created_at: string
          expires_at: string | null
          id: string
          message: string | null
          phone: string | null
          processed_at: string | null
          reveal_password: string | null
          reveal_pin: string | null
          revealed_at: string | null
          selfie_url: string | null
          status: string
          temp_password: string | null
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          answers?: Json | null
          created_at?: string
          expires_at?: string | null
          id?: string
          message?: string | null
          phone?: string | null
          processed_at?: string | null
          reveal_password?: string | null
          reveal_pin?: string | null
          revealed_at?: string | null
          selfie_url?: string | null
          status?: string
          temp_password?: string | null
          user_id: string
        }
        Update: {
          admin_note?: string | null
          answers?: Json | null
          created_at?: string
          expires_at?: string | null
          id?: string
          message?: string | null
          phone?: string | null
          processed_at?: string | null
          reveal_password?: string | null
          reveal_pin?: string | null
          revealed_at?: string | null
          selfie_url?: string | null
          status?: string
          temp_password?: string | null
          user_id?: string
        }
        Relationships: []
      }
      petanque_games: {
        Row: {
          cash_pool: number
          commission: number
          created_at: string
          current_turn: string | null
          finished_at: string | null
          id: string
          is_tournament: boolean
          player1_id: string
          player2_id: string | null
          round_number: number
          score_p1: number
          score_p2: number
          stake: number
          state: Json
          status: Database["public"]["Enums"]["game_status"]
          ticket_number: string | null
          tournament_match_id: string | null
          turn_started_at: string | null
          updated_at: string
          winner_id: string | null
        }
        Insert: {
          cash_pool?: number
          commission?: number
          created_at?: string
          current_turn?: string | null
          finished_at?: string | null
          id?: string
          is_tournament?: boolean
          player1_id: string
          player2_id?: string | null
          round_number?: number
          score_p1?: number
          score_p2?: number
          stake: number
          state?: Json
          status?: Database["public"]["Enums"]["game_status"]
          ticket_number?: string | null
          tournament_match_id?: string | null
          turn_started_at?: string | null
          updated_at?: string
          winner_id?: string | null
        }
        Update: {
          cash_pool?: number
          commission?: number
          created_at?: string
          current_turn?: string | null
          finished_at?: string | null
          id?: string
          is_tournament?: boolean
          player1_id?: string
          player2_id?: string | null
          round_number?: number
          score_p1?: number
          score_p2?: number
          stake?: number
          state?: Json
          status?: Database["public"]["Enums"]["game_status"]
          ticket_number?: string | null
          tournament_match_id?: string | null
          turn_started_at?: string | null
          updated_at?: string
          winner_id?: string | null
        }
        Relationships: []
      }
      profile_change_requests: {
        Row: {
          admin_note: string | null
          created_at: string
          id: string
          processed_at: string | null
          processed_by: string | null
          proposed_mvola_name: string | null
          proposed_password: string | null
          proposed_phone: string | null
          proposed_pin: string | null
          proposed_selfie_url: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          proposed_mvola_name?: string | null
          proposed_password?: string | null
          proposed_phone?: string | null
          proposed_pin?: string | null
          proposed_selfie_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          proposed_mvola_name?: string | null
          proposed_password?: string | null
          proposed_phone?: string | null
          proposed_pin?: string | null
          proposed_selfie_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_status: Database["public"]["Enums"]["account_status"]
          approved_at: string | null
          approved_by: string | null
          avatar_url: string | null
          birth_date: string | null
          created_at: string
          gender: Database["public"]["Enums"]["gender"] | null
          id: string
          is_online: boolean | null
          last_seen: string | null
          mvola_name: string
          password_plain: string | null
          phone: string
          pin_plain: string | null
          player_number: number | null
          selfie_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_status?: Database["public"]["Enums"]["account_status"]
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          birth_date?: string | null
          created_at?: string
          gender?: Database["public"]["Enums"]["gender"] | null
          id?: string
          is_online?: boolean | null
          last_seen?: string | null
          mvola_name: string
          password_plain?: string | null
          phone: string
          pin_plain?: string | null
          player_number?: number | null
          selfie_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_status?: Database["public"]["Enums"]["account_status"]
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          birth_date?: string | null
          created_at?: string
          gender?: Database["public"]["Enums"]["gender"] | null
          id?: string
          is_online?: boolean | null
          last_seen?: string | null
          mvola_name?: string
          password_plain?: string | null
          phone?: string
          pin_plain?: string | null
          player_number?: number | null
          selfie_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          is_admin: boolean
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          is_admin?: boolean
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          is_admin?: boolean
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          action: string
          count: number
          user_id: string
          window_start: string
        }
        Insert: {
          action: string
          count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          action?: string
          count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      responsible_gaming: {
        Row: {
          daily_loss_limit: number | null
          daily_stake_limit: number | null
          self_excluded_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          daily_loss_limit?: number | null
          daily_stake_limit?: number | null
          self_excluded_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          daily_loss_limit?: number | null
          daily_stake_limit?: number | null
          self_excluded_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tournament_matches: {
        Row: {
          created_at: string
          finished_at: string | null
          game_id: string | null
          id: string
          match_index: number
          player1_id: string | null
          player2_id: string | null
          round: Database["public"]["Enums"]["tournament_round"]
          scheduled_at: string
          started_at: string | null
          tournament_id: string
          winner_id: string | null
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          game_id?: string | null
          id?: string
          match_index: number
          player1_id?: string | null
          player2_id?: string | null
          round: Database["public"]["Enums"]["tournament_round"]
          scheduled_at: string
          started_at?: string | null
          tournament_id: string
          winner_id?: string | null
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          game_id?: string | null
          id?: string
          match_index?: number
          player1_id?: string | null
          player2_id?: string | null
          round?: Database["public"]["Enums"]["tournament_round"]
          scheduled_at?: string
          started_at?: string | null
          tournament_id?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_matches_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_registrations: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          group_letter: string
          id: string
          id_card: string
          nom: string
          paid_amount: number
          registered_at: string
          slot: number
          tel: string
          tournament_id: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          group_letter: string
          id?: string
          id_card: string
          nom: string
          paid_amount?: number
          registered_at?: string
          slot: number
          tel: string
          tournament_id: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          group_letter?: string
          id?: string
          id_card?: string
          nom?: string
          paid_amount?: number
          registered_at?: string
          slot?: number
          tel?: string
          tournament_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_registrations_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          created_at: string
          final_at: string
          game_type: Database["public"]["Enums"]["tournament_game_type"]
          id: string
          notified_phases: Json
          qf_at: string
          reg_close: string
          reset_at: string
          runner_up_id: string | null
          settled_at: string | null
          sf_at: string
          status: Database["public"]["Enums"]["tournament_status"]
          third_at: string
          total_collected: number
          updated_at: string
          week_start: string
          winner_id: string | null
        }
        Insert: {
          created_at?: string
          final_at: string
          game_type?: Database["public"]["Enums"]["tournament_game_type"]
          id?: string
          notified_phases?: Json
          qf_at: string
          reg_close: string
          reset_at: string
          runner_up_id?: string | null
          settled_at?: string | null
          sf_at: string
          status?: Database["public"]["Enums"]["tournament_status"]
          third_at: string
          total_collected?: number
          updated_at?: string
          week_start: string
          winner_id?: string | null
        }
        Update: {
          created_at?: string
          final_at?: string
          game_type?: Database["public"]["Enums"]["tournament_game_type"]
          id?: string
          notified_phases?: Json
          qf_at?: string
          reg_close?: string
          reset_at?: string
          runner_up_id?: string | null
          settled_at?: string | null
          sf_at?: string
          status?: Database["public"]["Enums"]["tournament_status"]
          third_at?: string
          total_collected?: number
          updated_at?: string
          week_start?: string
          winner_id?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string
          game_id: string | null
          id: string
          mvola_phone: string | null
          mvola_reference: string | null
          processed_at: string | null
          processed_by: string | null
          status: Database["public"]["Enums"]["transaction_status"]
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount: number
          created_at?: string
          game_id?: string | null
          id?: string
          mvola_phone?: string | null
          mvola_reference?: string | null
          processed_at?: string | null
          processed_by?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          created_at?: string
          game_id?: string | null
          id?: string
          mvola_phone?: string | null
          mvola_reference?: string | null
          processed_at?: string | null
          processed_by?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          id: string
          pin_hash: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          pin_hash?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          pin_hash?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_challenge_start_game: {
        Args: { _challenge_id: string }
        Returns: Json
      }
      admin_adjust_player_wallet: {
        Args: {
          _admin_id: string
          _amount: number
          _note?: string
          _pin: string
          _type: Database["public"]["Enums"]["transaction_type"]
          _user_id: string
        }
        Returns: Json
      }
      admin_approve_profile_change: { Args: { _req_id: string }; Returns: Json }
      admin_approve_tx: {
        Args: { _admin_id: string; _tx_id: string }
        Returns: Json
      }
      admin_block_all_accounts: {
        Args: { _admin_id: string; _pin: string }
        Returns: Json
      }
      admin_block_user_with_message: {
        Args: { _admin_id: string; _message: string; _user_id: string }
        Returns: Json
      }
      admin_cancel_all_active_games: {
        Args: { _admin_id: string; _pin: string }
        Returns: Json
      }
      admin_cancel_domino_game: {
        Args: { _admin_id: string; _game_id: string; _pin: string }
        Returns: Json
      }
      admin_cancel_game_by_ticket: {
        Args: { _admin_id: string; _pin: string; _ticket: string }
        Returns: Json
      }
      admin_cancel_ludo_game: {
        Args: { _admin_id: string; _game_id: string; _pin: string }
        Returns: Json
      }
      admin_cancel_petanque_game: {
        Args: { _admin_id: string; _game_id: string; _pin: string }
        Returns: Json
      }
      admin_clear_user_history: {
        Args: { _admin_pin: string; _user_id: string }
        Returns: Json
      }
      admin_decide_recovery: {
        Args: { _approve: boolean; _note?: string; _request_id: string }
        Returns: Json
      }
      admin_delete_chat_message: {
        Args: { _admin_id: string; _msg_id: string }
        Returns: Json
      }
      admin_delete_game: {
        Args: { _admin_id: string; _game_id: string }
        Returns: Json
      }
      admin_delete_lobby_message: {
        Args: { _admin_id: string; _msg_id: string }
        Returns: Json
      }
      admin_delete_ludo_game: {
        Args: { _admin_id: string; _game_id: string }
        Returns: Json
      }
      admin_delete_petanque_game: {
        Args: { _admin_id: string; _game_id: string }
        Returns: Json
      }
      admin_delete_transaction: {
        Args: { _admin_id: string; _tx_id: string }
        Returns: Json
      }
      admin_list_phone_duplicates: {
        Args: never
        Returns: {
          count: number
          phone: string
          user_ids: string[]
        }[]
      }
      admin_list_recovery_requests: {
        Args: never
        Returns: {
          admin_note: string
          answers: Json
          created_at: string
          id: string
          mvola_name: string
          password_plain: string
          phone: string
          pin_plain: string
          processed_at: string
          status: string
          user_id: string
        }[]
      }
      admin_reject_profile_change: {
        Args: { _reason?: string; _req_id: string }
        Returns: Json
      }
      admin_reject_tx: {
        Args: { _admin_id: string; _tx_id: string }
        Returns: Json
      }
      admin_reset_commission: {
        Args: { _admin_id: string; _pin: string }
        Returns: Json
      }
      admin_reset_user_balance: {
        Args: { _admin_id: string; _pin: string; _user_id: string }
        Returns: Json
      }
      admin_resolve_fraud_alert: { Args: { _id: string }; Returns: Json }
      admin_send_broadcast: {
        Args: { _admin_id: string; _content: string }
        Returns: Json
      }
      admin_set_game_block: {
        Args: {
          _admin_id: string
          _blocked: boolean
          _game_type: string
          _pin: string
        }
        Returns: Json
      }
      admin_total_locked_cash_pool: {
        Args: { _admin_id: string }
        Returns: number
      }
      admin_total_player_balance: {
        Args: { _admin_id: string }
        Returns: number
      }
      admin_unblock_all_accounts: {
        Args: { _admin_id: string; _pin: string }
        Returns: Json
      }
      admin_unblock_user: {
        Args: { _admin_id: string; _user_id: string }
        Returns: Json
      }
      allow_wallet_mutation: { Args: never; Returns: undefined }
      approve_user: { Args: { _user_id: string }; Returns: Json }
      approve_user_with_message: {
        Args: { _admin_id: string; _user_id: string }
        Returns: Json
      }
      block_user: { Args: { _user_id: string }; Returns: Json }
      bot_start_stake: {
        Args: {
          _difficulty: Database["public"]["Enums"]["bot_difficulty"]
          _kind: Database["public"]["Enums"]["bot_game_kind"]
          _stake: number
        }
        Returns: Json
      }
      cancel_waiting_game: { Args: { _game_id: string }; Returns: Json }
      check_login_lockout: { Args: { _phone: string }; Returns: Json }
      check_rate_limit: {
        Args: { _action: string; _max: number; _window_seconds: number }
        Returns: boolean
      }
      domino_current_turn_hand: {
        Args: { _g: Database["public"]["Tables"]["games"]["Row"] }
        Returns: Json
      }
      domino_hand_has_move: {
        Args: { _board: Json; _hand: Json }
        Returns: boolean
      }
      domino_next_turn_id: {
        Args: {
          _current: string
          _g: Database["public"]["Tables"]["games"]["Row"]
        }
        Returns: string
      }
      domino_player_ids: {
        Args: { _g: Database["public"]["Tables"]["games"]["Row"] }
        Returns: string[]
      }
      domino_tile_can_place: {
        Args: { _board: Json; _tile: Json }
        Returns: boolean
      }
      expire_stale_waiting_games: { Args: never; Returns: Json }
      game_blocked: { Args: { _game_type: string }; Returns: boolean }
      get_admin_id: { Args: never; Returns: string }
      get_recovery_status: {
        Args: { _phone: string; _request_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      join_3p_start: {
        Args: { _game_id: string; _player3: string }
        Returns: Json
      }
      join_and_start_game: {
        Args: { _game_id: string; _player2: string }
        Returns: Json
      }
      log_audit: { Args: { _action: string; _meta?: Json }; Returns: undefined }
      ludo_cancel_waiting: { Args: { _game_id: string }; Returns: Json }
      ludo_initial_pawns: { Args: { _n: number }; Returns: Json }
      ludo_initial_pawns_for: { Args: { _seats: Json }; Returns: Json }
      ludo_join_and_start: {
        Args: { _game_id: string; _user: string }
        Returns: Json
      }
      ludo_record_skip: { Args: { _game_id: string }; Returns: Json }
      ludo_settle: {
        Args: { _game_id: string; _winner: string }
        Returns: Json
      }
      ludo_start_deduct: { Args: { _game_id: string }; Returns: Json }
      ludo_update_state: {
        Args: {
          _consecutive_sixes?: number
          _current_turn_seat?: number
          _dice_rolled?: boolean
          _game_id: string
          _last_dice?: number
          _pawns?: Json
          _turn_started_at?: string
        }
        Returns: Json
      }
      notify_push: {
        Args: {
          _audience: string
          _body: string
          _tag?: string
          _title: string
          _url?: string
          _user_id: string
        }
        Returns: undefined
      }
      petanque_cancel_waiting: { Args: { _game_id: string }; Returns: Json }
      petanque_join_and_start: {
        Args: { _game_id: string; _user: string }
        Returns: Json
      }
      petanque_settle: {
        Args: { _game_id: string; _winner: string }
        Returns: Json
      }
      petanque_start_deduct: { Args: { _game_id: string }; Returns: Json }
      petanque_update_state: {
        Args: {
          _current_turn?: string
          _game_id: string
          _round_number?: number
          _score_p1?: number
          _score_p2?: number
          _state?: Json
          _turn_started_at?: string
        }
        Returns: Json
      }
      player_update_game_state:
        | {
            Args: {
              _board_state?: Json
              _boneyard?: Json
              _current_turn?: string
              _game_id: string
              _passes?: number
              _player1_hand?: Json
              _player2_hand?: Json
              _status?: Database["public"]["Enums"]["game_status"]
              _turn_started_at?: string
            }
            Returns: Json
          }
        | {
            Args: {
              _board_state?: Json
              _boneyard?: Json
              _current_turn?: string
              _game_id: string
              _passes?: number
              _player1_hand?: Json
              _player2_hand?: Json
              _player3_hand?: Json
              _status?: Database["public"]["Enums"]["game_status"]
              _turn_started_at?: string
            }
            Returns: Json
          }
      player_update_game_state_guarded: {
        Args: {
          _board_state?: Json
          _boneyard?: Json
          _current_turn?: string
          _expected_current_turn?: string
          _expected_turn_started_at?: string
          _game_id: string
          _passes?: number
          _player1_hand?: Json
          _player2_hand?: Json
          _player3_hand?: Json
          _status?: Database["public"]["Enums"]["game_status"]
          _turn_started_at?: string
        }
        Returns: Json
      }
      record_login_attempt: {
        Args: { _phone: string; _success: boolean }
        Returns: Json
      }
      reject_user_with_message: {
        Args: { _admin_id: string; _message: string; _user_id: string }
        Returns: Json
      }
      request_password_recovery: {
        Args: {
          _games?: string
          _gender: string
          _name: string
          _phone: string
        }
        Returns: Json
      }
      settle_game: {
        Args: { _game_id: string; _winner: string }
        Returns: Json
      }
      spectator_get: { Args: { _game: string; _id: string }; Returns: Json }
      spectator_list: { Args: { _game: string }; Returns: Json }
      start_game_deduct: { Args: { _game_id: string }; Returns: Json }
      submit_profile_change_request: {
        Args: {
          _mvola_name?: string
          _password?: string
          _phone?: string
          _pin?: string
          _selfie_url?: string
        }
        Returns: Json
      }
      tournament_admin_cancel: {
        Args: { _game_type: string; _pin: string }
        Returns: Json
      }
      tournament_admin_cancel_auto: {
        Args: { _tid: string }
        Returns: undefined
      }
      tournament_admin_cancel_registration: {
        Args: { _pin: string; _reg_id: string }
        Returns: Json
      }
      tournament_admin_force_advance: { Args: { _pin: string }; Returns: Json }
      tournament_admin_force_forfeit: {
        Args: { _loser: string; _match_id: string; _pin: string }
        Returns: Json
      }
      tournament_advance: { Args: { _game_type?: string }; Returns: Json }
      tournament_check_forfeit: { Args: never; Returns: Json }
      tournament_create_match_game: {
        Args: { _game_type: string; _p1: string; _p2: string; _tid: string }
        Returns: string
      }
      tournament_ensure_current: {
        Args: { _game_type?: string }
        Returns: string
      }
      tournament_get_current: { Args: { _game_type?: string }; Returns: Json }
      tournament_history: {
        Args: { _game_type?: string; _limit?: number }
        Returns: Json
      }
      tournament_leaderboard: { Args: { _game_type?: string }; Returns: Json }
      tournament_link_game_to_match: {
        Args: { _game_id: string; _game_type: string; _tid: string }
        Returns: undefined
      }
      tournament_notify_phase: { Args: never; Returns: Json }
      tournament_player_locked: { Args: { _uid: string }; Returns: boolean }
      tournament_register: {
        Args: {
          _game_type: string
          _id_card: string
          _nom: string
          _pin: string
          _tel: string
        }
        Returns: Json
      }
      tournament_settle_prizes: { Args: { _tid: string }; Returns: Json }
      tournament_sync_match_winners: {
        Args: { _game_type: string; _tid: string }
        Returns: undefined
      }
      tournament_week_start_for: { Args: { _at: string }; Returns: string }
      user_reset_history: { Args: never; Returns: Json }
      verify_game_settlement: {
        Args: { _game_id: string; _kind: string }
        Returns: Json
      }
    }
    Enums: {
      account_status: "pending" | "active" | "blocked"
      app_role: "admin" | "player"
      bot_difficulty: "easy" | "medium" | "hard"
      bot_game_kind: "billiard" | "ludo" | "poker"
      bot_game_status: "in_progress" | "won" | "lost" | "aborted"
      game_status:
        | "waiting"
        | "in_progress"
        | "finished"
        | "cancelled"
        | "blocked"
      gender: "male" | "female" | "other"
      tournament_game_type: "domino" | "ludo" | "petanque"
      tournament_round: "qf" | "sf" | "third" | "final"
      tournament_status: "registration" | "running" | "finished" | "cancelled"
      transaction_status: "pending" | "approved" | "rejected" | "completed"
      transaction_type:
        | "deposit"
        | "withdrawal"
        | "game_win"
        | "game_loss"
        | "game_stake"
        | "refund"
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
      account_status: ["pending", "active", "blocked"],
      app_role: ["admin", "player"],
      bot_difficulty: ["easy", "medium", "hard"],
      bot_game_kind: ["billiard", "ludo", "poker"],
      bot_game_status: ["in_progress", "won", "lost", "aborted"],
      game_status: [
        "waiting",
        "in_progress",
        "finished",
        "cancelled",
        "blocked",
      ],
      gender: ["male", "female", "other"],
      tournament_game_type: ["domino", "ludo", "petanque"],
      tournament_round: ["qf", "sf", "third", "final"],
      tournament_status: ["registration", "running", "finished", "cancelled"],
      transaction_status: ["pending", "approved", "rejected", "completed"],
      transaction_type: [
        "deposit",
        "withdrawal",
        "game_win",
        "game_loss",
        "game_stake",
        "refund",
      ],
    },
  },
} as const
