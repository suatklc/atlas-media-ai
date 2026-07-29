type AuthHeadingProps = {
  title: string;
  subtitle?: string;
};

export default function AuthHeading({ title, subtitle }: AuthHeadingProps) {
  return (
    <div className="mb-8">
      <h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2>
      {subtitle && <p className="mt-1.5 text-sm text-zinc-400">{subtitle}</p>}
    </div>
  );
}
