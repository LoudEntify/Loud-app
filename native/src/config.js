import Constants from 'expo-constants';
const extra = Constants.expoConfig?.extra || {};
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE || extra.apiBase || 'https://loudentify.app';
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl;
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey;
