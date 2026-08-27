import { formatLongDateTR } from "@/lib/format";

type WelcomeSectionProps = {
  name: string;
};

export default function WelcomeSection({ name }: WelcomeSectionProps) {
  const firstName = name.split(" ")[0];

  return (
    <section className="animate-fade-up mb-6">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {formatLongDateTR(new Date())}
      </p>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        Tekrar hoş geldiniz, {firstName}
      </h1>
      <p className="mt-1.5 text-sm text-zinc-400">
        İlan metinleri, sosyal medya içerikleri ve müşteri mesajlarını{" "}
        <span className="font-medium text-indigo-400">Atlas</span> ile hızlıca hazırlayın.
      </p>
    </section>
  );
}
