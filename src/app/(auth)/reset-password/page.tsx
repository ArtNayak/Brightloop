import Link from "next/link";
import ResetForm from "./reset-form";

// The reset link in the email looks like /reset-password?token=abc...
// We read the token here (on the server) and hand it to the form.
export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 rounded bg-card p-6 shadow">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      {token ? (
        <ResetForm token={token} />
      ) : (
        <p className="text-sm text-destructive">
          This link is missing its token. <Link href="/forgot-password" className="underline">Request a new one</Link>.
        </p>
      )}
    </main>
  );
}
