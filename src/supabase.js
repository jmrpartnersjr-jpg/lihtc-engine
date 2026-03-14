import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://kxgvdtzzupxnwzugurqv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4Z3ZkdHp6dXB4bnd6dWd1cnF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NDQ4OTYsImV4cCI6MjA4ODIyMDg5Nn0.RLb5kYeZbd9gOHYfO8Pctg_eRz8ZlEYi7-BUkqlgiGE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
