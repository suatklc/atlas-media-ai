import Link from "next/link";
import { Menu } from "lucide-react";
import NotificationBell from "./NotificationBell";

type TopbarProps = {
  onMenuClick: () => void;
};

// The previous search box and avatar button had no function behind them and
// were removed rather than shown as working controls; the account/sign-out
// lives at the bottom of the sidebar.
export default function Topbar({ onMenuClick }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-zinc-800 bg-zinc-950/90 px-2 backdrop-blur sm:px-6 lg:h-16 lg:px-8">
      <button
        type="button"
        onClick={onMenuClick}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-200 hover:bg-zinc-800 hover:text-white lg:hidden"
        aria-label="Menüyü aç"
      >
        <Menu className="h-6 w-6" />
      </button>

      <Link href="#pano" className="flex min-h-11 items-center gap-2 lg:hidden">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold text-white">A</span>
        <span className="text-base font-semibold tracking-tight text-white">Atlas AI</span>
      </Link>

      <div className="ml-auto flex items-center">
        <NotificationBell />
      </div>
    </header>
  );
}
