export default function WelcomeSection() {
  return (
    <section className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        Welcome back to{" "}
        <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
          Atlas AI
        </span>
      </h1>
      <p className="mt-1.5 text-sm text-zinc-400">
        Here&apos;s what&apos;s happening across your workspace today.
      </p>
    </section>
  );
}
