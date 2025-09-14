import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-[#0b0b12] text-white grid place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12101b] p-6 shadow-2xl">
        <h1 className="text-2xl font-semibold text-center">Welcome back</h1>
        <p className="text-sm text-white/60 text-center mt-1">Sign in to continue.</p>
        <div className="mt-6 flex justify-center">
          <SignIn routing="path" path="/sign-in" redirectUrl="/" />
        </div>
      </div>
    </main>
  );
}
