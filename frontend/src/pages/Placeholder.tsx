export default function Placeholder({ title, stage, description }: { title: string; stage: string; description: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="card border-dashed text-sm text-slate-400">
        <span className="mr-2 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{stage}</span>
        {description}
      </div>
    </div>
  );
}
