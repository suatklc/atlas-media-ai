import { formatLongDateTR } from "@/lib/format";

type WelcomeSectionProps = {
  name: string;
};

export default function WelcomeSection({ name }: WelcomeSectionProps) {
  // Full display name, not just its first word — "Tekrar hoş geldiniz,
  // Suat Kılıç", not "..., Suat". The name itself already comes from the
  // real resolution priority (auth metadata -> profile -> fallback) in
  // dashboard/page.tsx; this component only ever renders what it's given.
  return (
    <section className="animate-fade-up mb-5">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-400">
        {formatLongDateTR(new Date())}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        Tekrar hoş geldiniz, {name}
      </h1>
      <p className="mt-1 text-base text-zinc-400">
        İlan metinleri, sosyal medya içerikleri ve müşteri mesajlarını{" "}
        <span className="font-medium text-indigo-400">Atlas</span> ile hızlıca hazırlayın.
      </p>
    </section>
  );
}
