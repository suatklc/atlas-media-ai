import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CheckCircle2,
  FilePlus2,
  FolderKanban,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";

export type NavItem = {
  label: string;
  icon: LucideIcon;
  active?: boolean;
};

export const navItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Analytics", icon: BarChart3 },
  { label: "Projects", icon: FolderKanban },
  { label: "Team", icon: Users },
  { label: "Messages", icon: MessageSquare },
  { label: "Settings", icon: Settings },
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
    label: "Total Conversations",
    value: "12,483",
    change: "+12.3%",
    trend: "up",
    icon: MessageSquare,
  },
  {
    label: "Active Projects",
    value: "36",
    change: "+4.1%",
    trend: "up",
    icon: FolderKanban,
  },
  {
    label: "API Requests",
    value: "842K",
    change: "+8.7%",
    trend: "up",
    icon: Zap,
  },
  {
    label: "Success Rate",
    value: "99.2%",
    change: "-0.2%",
    trend: "down",
    icon: CheckCircle2,
  },
];

export type QuickAction = {
  label: string;
  icon: LucideIcon;
};

export const quickActions: QuickAction[] = [
  { label: "New Conversation", icon: Plus },
  { label: "New Project", icon: FilePlus2 },
  { label: "Invite Team", icon: UserPlus },
  { label: "View Reports", icon: BarChart3 },
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
    title: "New conversation started",
    description: "Onboarding assistant · Project Atlas",
    time: "2m ago",
    icon: MessageSquare,
  },
  {
    id: "2",
    title: "Model fine-tune completed",
    description: "atlas-core-v2 · 99.2% accuracy",
    time: "1h ago",
    icon: Sparkles,
  },
  {
    id: "3",
    title: "New team member joined",
    description: "Elena Marin joined the workspace",
    time: "3h ago",
    icon: UserPlus,
  },
  {
    id: "4",
    title: "Project created",
    description: "Customer Support Copilot",
    time: "5h ago",
    icon: FolderKanban,
  },
  {
    id: "5",
    title: "Weekly usage report generated",
    description: "842K requests processed this week",
    time: "1d ago",
    icon: BarChart3,
  },
];
