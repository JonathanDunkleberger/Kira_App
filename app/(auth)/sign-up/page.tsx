import Link from 'next/link';
import AuthForm from '@/components/AuthForm';

export default function SignUpPage() {
  return (
    <main className="min-h-screen bg-[#0b0b12] text-white grid place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12101b] p-6 shadow-2xl">
        <h1 className="text-2xl font-semibold text-center">Create your account</h1>
        <p className="text-sm text-white/60 text-center mt-1">
          You’ll be able to upgrade to Pro on the next step.
        </p>
        <div className="mt-6">
          <AuthForm mode="signup" afterSuccessHref="/?next=upgrade" />
        </div>
        <p className="text-sm text-white/50 mt-4 text-center">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-white hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
