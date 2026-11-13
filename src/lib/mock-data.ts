import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarClock,
  CalendarDays,
  FileCheck2,
  Handshake,
  ImagePlus,
  LayoutDashboard,
  Settings,
  Share2,
  Wand2,
} from "lucide-react";

export type NavItem = {
  label: string;
  icon: LucideIcon;
  // The dashboard is a single page: every live item points at one of its
  // real sections (ids set in dashboard/page.tsx).
  href?: string;
  // DOM id of that section; drives the active highlight.
  sectionId?: string;
  // No page or function exists for this module yet — rendered as a clearly
  // labelled, non-navigating item, never as a working link.
  comingSoon?: boolean;
};

export const navItems: NavItem[] = [
  { label: "Pano", icon: LayoutDashboard, href: "#pano", sectionId: "pano" },
  { label: "İçerik Planı", icon: CalendarDays, href: "#icerik-plani", sectionId: "icerik-plani" },
  { label: "İçerik Hazırla", icon: Wand2, href: "#icerik-hazirla", sectionId: "icerik-hazirla" },
  { label: "Taslaklar ve Yayın", icon: FileCheck2, href: "#taslaklar", sectionId: "taslaklar" },
  { label: "Bağlı Hesaplar", icon: Share2, href: "#hesaplar", sectionId: "hesaplar" },
];

// Modules without a page yet — listed separately and disabled.
export const comingSoonNavItems: NavItem[] = [
  { label: "Yayın Takvimi", icon: CalendarClock, comingSoon: true },
  { label: "Ayarlar", icon: Settings, comingSoon: true },
];

export type Stat = {
  label: string;
  value: string;
  change: string;
  trend: "up" | "down";
  icon: LucideIcon;
};

export const stats: Stat[] = [
  {
    label: "Aktif İlanlar",
    value: "128",
    change: "+8.2%",
    trend: "up",
    icon: Building2,
  },
  {
    label: "Üretilen İçerik",
    value: "342",
    change: "+18.4%",
    trend: "up",
    icon: Wand2,
  },
  {
    label: "Sosyal Etkileşim",
    value: "24.6K",
    change: "+12.1%",
    trend: "up",
    icon: Share2,
  },
  {
    label: "Açık Fırsatlar",
    value: "37",
    change: "-3.4%",
    trend: "down",
    icon: Handshake,
  },
];

export type ModuleShortcut = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export const moduleShortcuts: ModuleShortcut[] = [
  {
    title: "İçerik Üretimi",
    description: "İlanlarınız için AI destekli metin ve görsel oluşturun.",
    icon: Wand2,
  },
  {
    title: "Gayrimenkul Yönetimi",
    description: "İlanlarınızı ekleyin, güncelleyin ve takip edin.",
    icon: Building2,
  },
  {
    title: "CRM",
    description: "Müşteri adaylarınızı ve fırsatlarınızı yönetin.",
    icon: Handshake,
  },
  {
    title: "Takvim",
    description: "Görüşmelerinizi ve paylaşım planınızı görüntüleyin.",
    icon: CalendarDays,
  },
];

export type ActivityItem = {
  id: string;
  title: string;
  description: string;
  time: string;
  icon: LucideIcon;
};

export const recentActivity: ActivityItem[] = [
  {
    id: "1",
    title: "Yeni ilan yayınlandı",
    description: "Bahçelievler'de 3+1 daire · Satılık",
    time: "12dk önce",
    icon: Building2,
  },
  {
    id: "2",
    title: "İçerik üretimi tamamlandı",
    description: "Instagram paylaşımı · 4 görsel, 1 metin",
    time: "48dk önce",
    icon: Wand2,
  },
  {
    id: "3",
    title: "Yeni fırsat oluşturuldu",
    description: "Ahmet Demir · Kadıköy'de villa arıyor",
    time: "2sa önce",
    icon: Handshake,
  },
  {
    id: "4",
    title: "Paylaşım planlandı",
    description: "Hafta sonu açık ev etkinliği duyurusu",
    time: "4sa önce",
    icon: ImagePlus,
  },
  {
    id: "5",
    title: "Görüşme takvime eklendi",
    description: "Zeynep Aydın ile yerinde inceleme",
    time: "6sa önce",
    icon: CalendarDays,
  },
];

export type QuickAction = {
  id: string;
  label: string;
  prompt: string;
};

export const quickActions: QuickAction[] = [
  {
    id: "listing-description",
    label: "İlan açıklaması oluştur",
    prompt: "Örnek bir gayrimenkul ilanı için ikna edici ve profesyonel bir açıklama metni yaz.",
  },
  {
    id: "whatsapp-message",
    label: "WhatsApp mesajı yaz",
    prompt: "Bir müşteriye gönderebileceğim kısa, samimi ve profesyonel bir WhatsApp mesajı yaz.",
  },
  {
    id: "portfolio-analysis",
    label: "Portföy analizi yap",
    prompt:
      "Bir emlak danışmanının portföyünü değerlendirirken dikkat etmesi gereken noktaları adım adım anlat.",
  },
  {
    id: "daily-plan",
    label: "Günlük plan oluştur",
    prompt: "Bir emlak danışmanı için örnek, verimli bir günlük çalışma planı oluştur.",
  },
];
