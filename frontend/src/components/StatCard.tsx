interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  accent?: 'purple' | 'blue' | 'green' | 'orange' | 'cyan' | 'pink';
}

const ACCENTS: Record<NonNullable<StatCardProps['accent']>, string> = {
  purple: 'text-purple-400',
  blue: 'text-blue-400',
  green: 'text-green-400',
  orange: 'text-orange-400',
  cyan: 'text-cyan-400',
  pink: 'text-pink-400',
};

export function StatCard({ label, value, subtitle, accent = 'blue' }: StatCardProps) {
  return (
    <div className="bg-[#161b22] rounded-lg border border-[#30363d] p-3">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${ACCENTS[accent]}`}>{value}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
    </div>
  );
}
