import Link from "next/link";

type AuthFooterLinkProps = {
  prompt: string;
  linkText: string;
  href: string;
};

export default function AuthFooterLink({ prompt, linkText, href }: AuthFooterLinkProps) {
  return (
    <p className="mt-8 text-center text-sm text-zinc-400">
      {prompt}{" "}
      <Link href={href} className="font-medium text-indigo-400 hover:text-indigo-300">
        {linkText}
      </Link>
    </p>
  );
}
