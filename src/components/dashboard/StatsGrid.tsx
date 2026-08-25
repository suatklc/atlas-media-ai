import { stats } from "@/lib/mock-data";
import StatCard from "./StatCard";

export default function StatsGrid() {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat, index) => (
        <StatCard key={stat.label} {...stat} delayMs={index * 60} />
      ))}
    </section>
  );
}
