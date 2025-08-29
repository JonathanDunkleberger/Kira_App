"use client";
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Profile = {
  plan: 'free' | 'supporter';
  stripe_customer_id?: string | null;
};

type ProfileContextType = {
  loading: boolean;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  refresh: () => Promise<void>;
};

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within <ProfileProvider>');
  return ctx;
}

export default function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user || null;
      setUserId(user?.id ?? null);
      setEmail(user?.email ?? null);
      if (!user) {
        setProfile(null);
        return;
      }

      const [{ data: entitlements }, { data: prof }] = await Promise.all([
        supabase.from('entitlements').select('plan').eq('user_id', user.id).maybeSingle(),
        supabase.from('profiles').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
      ]);

      const plan = (entitlements?.plan as Profile['plan'] | undefined) ?? 'free';
      const stripe_customer_id = (prof?.stripe_customer_id as string | null | undefined) ?? null;
      setProfile({ plan, stripe_customer_id });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      fetchProfile();
    });
    return () => {
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const value = useMemo<ProfileContextType>(() => ({
    loading,
    userId,
    email,
    profile,
    refresh: fetchProfile
  }), [loading, userId, email, profile]);

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}
